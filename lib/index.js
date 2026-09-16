import { existsSync, statSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";

// sharp (bundled with the plugin) converts browser-unrenderable formats —
// TIFF (e.g. Fluent chart exports), HEIC — to WebP on the fly so they display
// inline; `?raw=1` bypasses conversion so downloads always get the original file.
var __sharp = null;
function sharpFor() {
  if (__sharp !== null) return __sharp;
  try {
    __sharp = createRequire(import.meta.url)("sharp");
  } catch (e) {
    __sharp = false;
  }
  return __sharp;
}

var DEFAULT_GALLERY_ROOT = join(homedir(), ".dsh", "uploads");
var IMAGE_PREFIX = "/images";
var GALLERY_API_PREFIX = "/api/image-gallery";
var IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".ico", ".avif", ".tif", ".tiff", ".heic"]);
var MAX_DEPTH = 5;
var MAX_FILE_SIZE = 64 * 1024 * 1024;

var MIME_MAP = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".avif": "image/avif", ".tif": "image/tiff", ".tiff": "image/tiff", ".heic": "image/heic" };

// Formats Chromium can render in <img>; anything else is served converted.
var RENDERABLE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".ico", ".avif"]);

function mimeFor(file) { return MIME_MAP[extname(file).toLowerCase()] || "application/octet-stream"; }

function isLoopbackRequest(req) {
  var addr = req.socket.remoteAddress;
  if (!addr) return false;
  var n = addr.toLowerCase();
  if (n === "::1") return true;
  if (n.startsWith("::ffff:")) return n.slice(7).startsWith("127.");
  return n.startsWith("127.");
}

function guard(req, res) {
  if (isLoopbackRequest(req)) return true;
  res.writeHead(403, {"content-type": "application/json; charset=utf-8"});
  res.end(JSON.stringify({ok: false, error: "forbidden: loopback-only"}));
  return false;
}

function writeJson(res, status, body) {
  res.writeHead(status, {"content-type": "application/json; charset=utf-8"});
  res.end(JSON.stringify(body));
}

function listImages(dir, depth) {
  if (depth === undefined) depth = 0;
  if (depth > MAX_DEPTH) return [];
  var results = [];
  try {
    var entries = readdirSync(dir, {withFileTypes: true});
    for (var entry of entries) {
      var full = join(dir, entry.name);
      if (entry.isDirectory()) { results.push.apply(results, listImages(full, depth + 1)); }
      else if (entry.isFile() && IMAGE_EXTS.has(extname(entry.name).toLowerCase())) { results.push(full); }
    }
  } catch(e) {}
  return results;
}

function isUnderRoot(filePath, root) {
  var r = resolve(filePath);
  var rr = resolve(root);
  return r.startsWith(rr + "\\") || r === rr;
}

function imageFileHandler(galleryRoot) {
  return async function(req, res) {
    if (!guard(req, res)) return;
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    var parsed;
    try { parsed = new URL(req.url || "/", "http://img.local"); }
    catch(e) { res.writeHead(400); res.end(); return; }
    var relPath = decodeURIComponent(parsed.pathname.slice(IMAGE_PREFIX.length).replace(/^\/+/, ""));
    if (relPath === "") { res.writeHead(404); res.end(); return; }
    var filePath = join(galleryRoot, relPath);
    if (!isUnderRoot(filePath, galleryRoot)) { res.writeHead(403); res.end(); return; }
    try {
      var stat = statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) { res.writeHead(404); res.end(); return; }
      // `?w=<px>` optional resize; `?raw=1` forces the untouched original bytes
      // (used by the lightbox download button so TIFF/HEIC downloads keep
      // their original format).
      var wantW = 0;
      try {
        var q = parseInt(parsed.searchParams.get("w") || "0", 10);
        wantW = (!Number.isFinite(q) || q <= 0) ? 0 : Math.min(4096, Math.round(q));
      } catch (e) { wantW = 0; }
      var raw = parsed.searchParams.get("raw") === "1";
      var body = await readFile(filePath);
      var contentType = mimeFor(filePath);
      var ext = extname(filePath).toLowerCase();
      var renderable = RENDERABLE_EXTS.has(ext);
      // Convert when the browser cannot render the format (TIFF/HEIC), or when
      // an explicit width is requested. Full resolution unless ?w= given.
      if (!raw && sharpFor() && (!renderable || wantW > 0)) {
        try {
          var pipe = sharpFor()(body).rotate();
          if (wantW > 0) pipe = pipe.resize({ width: wantW, withoutEnlargement: true });
          body = await pipe.webp({ quality: 92 }).toBuffer();
          contentType = "image/webp";
        } catch (e2) { /* fall back to raw below */ }
      }
      res.writeHead(200, {"content-type": contentType, "content-length": String(body.byteLength), "cache-control": "public, max-age=3600"});
      if (req.method === "HEAD") { res.end(); return; }
      res.end(body);
    } catch(e) { res.writeHead(404); res.end(); }
  };
}

function listHandler(galleryRoot) {
  return function(req, res) {
    if (!guard(req, res)) return;
    var limit = 0;
    try { limit = parseInt(new URL(req.url || "/", "http://img.local").searchParams.get("limit") || "0", 10); } catch (e) {}
    if (!Number.isFinite(limit)) limit = 0;
    var files = listImages(galleryRoot);
    var rootLen = galleryRoot.length + 1;
    var items = files.map(function(f) {
      var rel = f.slice(rootLen).replace(/\\/g, "/");
      var st = statSync(f);
      return { name: rel, url: IMAGE_PREFIX + "/" + encodeURIComponent(rel), size: st.size, mtime: st.mtimeMs };
    });
    items.sort(function(a, b) { return b.mtime - a.mtime; });
    if (limit > 0 && items.length > limit) items = items.slice(0, limit);
    writeJson(res, 200, {ok: true, root: galleryRoot, count: items.length, items: items});
  };
}

function rootHandler(galleryRoot) {
  return function(req, res) {
    if (!guard(req, res)) return;
    writeJson(res, 200, {ok: true, root: galleryRoot});
  };
}

export var name = "image-gallery";
export var inject = ["webServer"];

export function apply(ctx) {
  var galleryRoot = DEFAULT_GALLERY_ROOT;
  ctx.logger.info("image-gallery: serving from " + galleryRoot + " (sharp: " + (sharpFor() ? "available" : "unavailable") + ")");
  ctx.effect(function() {
    var d1 = ctx.webServer.register({kind: "prefix", path: IMAGE_PREFIX, handler: imageFileHandler(galleryRoot)});
    var d2 = ctx.webServer.register({kind: "exact", path: GALLERY_API_PREFIX + "/list", handler: listHandler(galleryRoot)});
    var d3 = ctx.webServer.register({kind: "exact", path: GALLERY_API_PREFIX + "/root", handler: rootHandler(galleryRoot)});
    return function() { d1(); d2(); d3(); };
  }, "image-gallery: routes");
}
