import { existsSync, statSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";

// Optional sharp-based on-the-fly resize for `?w=` (load lazily; if unavailable, fall back to raw).
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
var IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".ico"]);
var MAX_DEPTH = 5;
var MAX_FILE_SIZE = 20 * 1024 * 1024;

var MIME_MAP = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

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
    var pathname;
    try { pathname = new URL(req.url || "/", "http://img.local").pathname; }
    catch(e) { res.writeHead(400); res.end(); return; }
    var relPath = decodeURIComponent(pathname.slice(IMAGE_PREFIX.length).replace(/^\/+/, ""));
    if (relPath === "") { res.writeHead(404); res.end(); return; }
    var filePath = join(galleryRoot, relPath);
    if (!isUnderRoot(filePath, galleryRoot)) { res.writeHead(403); res.end(); return; }
    try {
      var stat = statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) { res.writeHead(404); res.end(); return; }
      // optional `?w=<px>` resize (uses sharp if available; falls back to raw otherwise)
      var wantW = 0;
      try {
        var q = parseInt(new URL(req.url || "/", "http://img.local").searchParams.get("w") || "0", 10);
        wantW = (!Number.isFinite(q) || q <= 0) ? 0 : Math.min(4096, Math.round(q));
      } catch (e) { wantW = 0; }
      var body = await readFile(filePath);
      var contentType = mimeFor(filePath);
      if (wantW > 0 && sharpFor()) {
        try {
          var out = await sharpFor()(body).rotate().resize({ width: wantW, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
          body = out;
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
    if (limit > 0 && limit < items.length) items = items.slice(0, limit);
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
  ctx.logger.info("image-gallery: serving from " + galleryRoot);
  ctx.effect(function() {
    var d1 = ctx.webServer.register({kind: "prefix", path: IMAGE_PREFIX, handler: imageFileHandler(galleryRoot)});
    var d2 = ctx.webServer.register({kind: "exact", path: GALLERY_API_PREFIX + "/list", handler: listHandler(galleryRoot)});
    var d3 = ctx.webServer.register({kind: "exact", path: GALLERY_API_PREFIX + "/root", handler: rootHandler(galleryRoot)});
    return function() { d1(); d2(); d3(); };
  }, "image-gallery: routes");
}