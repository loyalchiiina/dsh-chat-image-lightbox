import { existsSync, statSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname, resolve, isAbsolute, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import net from "node:net";

// defineTool is the model-facing tool contract. If the host does not expose it
// (older harness), the plugin still works: the image routes below are
// independent of the tool and the require simply fails soft.
var __defineTool = null;
var __defineToolTried = false;
function defineToolFor() {
  if (__defineToolTried) return __defineTool;
  __defineToolTried = true;
  try {
    __defineTool = createRequire(import.meta.url)("@deepseek-ai/dsh-tools").defineTool;
  } catch (e) {
    __defineTool = null;
  }
  return __defineTool;
}

// undici powers proxy-aware fetching. Direct fetch works without it, but the
// image sources used here (huaban, Bing) are only reachable through the local
// proxy on this network, so a missing undici degrades rather than breaks.
var __undici = null;
var __undiciTried = false;
function undiciFor() {
  if (__undiciTried) return __undici;
  __undiciTried = true;
  try {
    __undici = createRequire(import.meta.url)("undici");
  } catch (e) {
    __undici = null;
  }
  return __undici;
}

// ── Proxy discovery ────────────────────────────────────────────────────────
// The local VPN client moves its HTTP proxy between ports and the machine's
// HTTPS_PROXY variable is NOT updated to match (observed: env says 7890, the
// live proxy sits on 7891). So the environment is treated as a HINT that still
// has to answer a TCP probe, never as the answer.
var PROXY_CANDIDATES = [7890, 7891, 7897, 10809, 10808, 1080, 2080, 8889];
var __cachedProxy = undefined;
var __cachedDead = Object.create(null);

function probePort(port, timeoutMs) {
  return new Promise(function (done) {
    var sock = net.connect({ host: "127.0.0.1", port: port });
    var settled = false;
    var finish = function (ok) {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch (e) {}
      done(ok);
    };
    sock.setTimeout(timeoutMs, function () { finish(false); });
    sock.on("connect", function () { finish(true); });
    sock.on("error", function () { finish(false); });
  });
}

// "http://127.0.0.1:7890" → 7890; anything else is not probed.
function loopbackPortOf(url) {
  var m = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})/i.exec(String(url || ""));
  if (!m) return 0;
  var p = parseInt(m[1], 10);
  return Number.isFinite(p) && p > 0 && p < 65536 ? p : 0;
}

async function resolveProxyUrl() {
  if (__cachedProxy !== undefined) return __cachedProxy;
  var env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  var ports = [];
  var envPort = loopbackPortOf(env);
  if (envPort) ports.push(envPort);
  for (var i = 0; i < PROXY_CANDIDATES.length; i++) {
    if (ports.indexOf(PROXY_CANDIDATES[i]) < 0) ports.push(PROXY_CANDIDATES[i]);
  }
  for (var j = 0; j < ports.length; j++) {
    var p = ports[j];
    if (__cachedDead[p]) continue;
    /* eslint-disable no-await-in-loop */
    var alive = await probePort(p, 350);
    if (alive) { __cachedProxy = "http://127.0.0.1:" + p; return __cachedProxy; }
    __cachedDead[p] = true;
  }
  __cachedProxy = null;
  return null;
}

var BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

// One ProxyAgent per proxy URL: building one per request leaks sockets and has
// been observed to make the very first request fail.
var __agent = null;
var __agentUrl = null;
function proxyAgentFor(proxyUrl) {
  var undici = undiciFor();
  if (!undici || !undici.ProxyAgent) return null;
  if (__agent && __agentUrl === proxyUrl) return __agent;
  __agent = new undici.ProxyAgent(proxyUrl);
  __agentUrl = proxyUrl;
  return __agent;
}

async function httpGetText(url, referer, timeoutMs) {
  var proxyUrl = await resolveProxyUrl();
  var undici = undiciFor();
  var headers = { "user-agent": BROWSER_UA, "accept-language": "zh-CN,zh;q=0.9" };
  if (referer) headers.referer = referer;
  var init = { headers: headers, redirect: "follow" };
  if (timeoutMs) init.signal = AbortSignal.timeout(timeoutMs);
  var agent = proxyUrl ? proxyAgentFor(proxyUrl) : null;
  if (agent) init.dispatcher = agent;
  // Prefer undici's own fetch: it is the implementation the dispatcher contract
  // belongs to, and it is what the plugin's dependency tree guarantees.
  var doFetch = undici && typeof undici.fetch === "function" ? undici.fetch : fetch;
  try {
    var res = await doFetch(url, init);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } catch (e) {
    var cause = e && e.cause && e.cause.message ? " · " + e.cause.message : "";
    throw new Error((e && e.message ? e.message : String(e)) + cause +
      (proxyUrl ? " [proxy " + proxyUrl + "]" : " [no proxy]"));
  }
}

// Binary sibling of httpGetText, for actually saving an image. Search results
// come back as signed CDN links that expire (Huaban's auth_key lasts about half
// an hour), so "display only" is not enough — the caller needs the bytes.
async function httpGetBuffer(url, referer, timeoutMs) {
  var proxyUrl = await resolveProxyUrl();
  var undici = undiciFor();
  var headers = { "user-agent": BROWSER_UA, "accept-language": "zh-CN,zh;q=0.9" };
  if (referer) headers.referer = referer;
  var init = { headers: headers, redirect: "follow" };
  if (timeoutMs) init.signal = AbortSignal.timeout(timeoutMs);
  var agent = proxyUrl ? proxyAgentFor(proxyUrl) : null;
  if (agent) init.dispatcher = agent;
  var doFetch = undici && typeof undici.fetch === "function" ? undici.fetch : fetch;
  try {
    var res = await doFetch(url, init);
    if (!res.ok) throw new Error("HTTP " + res.status);
    var buf = Buffer.from(await res.arrayBuffer());
    return { body: buf, type: res.headers.get("content-type") || "" };
  } catch (e) {
    var cause = e && e.cause && e.cause.message ? " · " + e.cause.message : "";
    throw new Error((e && e.cause ? e.cause.message : (e && e.message ? e.message : String(e))) + cause +
      (proxyUrl ? " [proxy " + proxyUrl + "]" : " [no proxy]"));
  }
}

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
// Read cap for a single image. Raised from 64 MB, which silently 404'd real
// chart exports — a Fluent merged comparison TIFF is routinely 70-80 MB, and
// the user sees only "the image did not load". Requests are loopback-only and
// the caller is the local user reading their own file, so a generous cap is
// the right trade here; the pixel budget below, not this, is what protects
// the renderer.
var MAX_FILE_SIZE = 512 * 1024 * 1024;

// Width the tool scales local images to by default. Chosen to be comfortably
// inside what the chat renderer handles while staying sharp on a large display.
var DEFAULT_RENDER_WIDTH = 1600;

// Files above this size are served pre-sized instead of at native resolution.
// 8192 wide keeps a 4:3 image at ~33 MP, well inside the smooth-decoding range,
// and still far more detail than any screen shows at once.
var HUGE_FILE_BYTES = 12 * 1024 * 1024;
var SAFE_WIDTH_FOR_HUGE = 8192;

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
    // `?abs=<absolute path>` serves an image from anywhere on this machine.
    // Requests are loopback-only (see guard), so the exposure is the same as
    // the harness's own filesystem tools, and it lets display_image show a file
    // in place instead of copying it into the gallery root first.
    var absParam = parsed.searchParams.get("abs");
    var filePath;
    if (absParam) {
      filePath = resolve(decodeURIComponent(absParam));
    } else {
      if (relPath === "") { res.writeHead(404); res.end(); return; }
      filePath = join(galleryRoot, relPath);
      if (!isUnderRoot(filePath, galleryRoot)) { res.writeHead(403); res.end(); return; }
    }
    try {
      var stat = statSync(filePath);
      if (!stat.isFile()) {
        res.writeHead(404, {"content-type": "text/plain; charset=utf-8"});
        res.end("not a file: " + filePath);
        return;
      }
      if (stat.size > MAX_FILE_SIZE) {
        // Say WHY. A silent 404 for an oversized file is indistinguishable from
        // a missing file, and that cost real debugging time.
        res.writeHead(413, {"content-type": "text/plain; charset=utf-8"});
        res.end("file too large: " + (stat.size / 1024 / 1024).toFixed(1) + "MB > " +
          (MAX_FILE_SIZE / 1024 / 1024) + "MB limit");
        return;
      }
      // `?w=<px>` optional resize; `?raw=1` forces the untouched original bytes
      // (used by the lightbox download button so TIFF/HEIC downloads keep
      // their original format).
      var wantW = 0;
      try {
        var q = parseInt(parsed.searchParams.get("w") || "0", 10);
        // Raised from 4096: the cap was silently downscaling large chart exports
        // (a 3840-wide TIFF asked for its own size came back at 4096-ok, but an
        // 8000-wide one was cut). Browser decoding handles far more than this.
        wantW = (!Number.isFinite(q) || q <= 0) ? 0 : Math.min(16384, Math.round(q));
      } catch (e) { wantW = 0; }
      var raw = parsed.searchParams.get("raw") === "1";
      var body = await readFile(filePath);
      var contentType = mimeFor(filePath);
      var ext = extname(filePath).toLowerCase();
      var renderable = RENDERABLE_EXTS.has(ext);

      // Pixel budget — a safety net, not a quality policy.
      //
      // Measured with a real 19200x10800 (207 MP) Fluent chart export,
      // losslessly converted to a 61.9 MB PNG: it displays promptly and scrolls
      // smoothly. So native resolution is the right default, and the earlier
      // "big images freeze the page" conclusion was wrong — that 404'd on the
      // file-size cap and never reached the renderer at all.
      //
      // What remains worth guarding is Chromium's own decode ceiling: past
      // roughly 256 MP it simply fails. This cap sits below that and only
      // engages for genuinely extreme inputs. Override with ?w=<px> or
      // ?full=1.
      var SAFE_PIXELS = 240e6;
      var downscaledFrom = null;
      if (!raw && wantW === 0 && parsed.searchParams.get("full") !== "1" && sharpFor()) {
        try {
          var probeMeta = await sharpFor()(body).metadata();
          var px = (probeMeta.width || 0) * (probeMeta.height || 0);
          if (px > SAFE_PIXELS) {
            var scale = Math.sqrt(SAFE_PIXELS / px);
            wantW = Math.max(1024, Math.round((probeMeta.width || 4096) * scale));
            downscaledFrom = probeMeta.width + "x" + probeMeta.height + " (" + Math.round(px / 1e6) + "MP)";
          }
        } catch (e) { /* unreadable metadata: leave wantW as-is */ }
      }

      // Convert when the browser cannot render the format (TIFF/HEIC), or when
      // an explicit width is requested.
      //
      // LOSSLESS for the formats that exist precisely because they are lossless:
      // TIFF is what chart/diagram exports use, and re-encoding it as lossy WebP
      // measurably damages thin lines (measured on a real 3840x6480 export:
      // mean abs error 1.10/255, max single-channel error 166, ~10% of pixels
      // altered). PNG round-trips it bit-exactly and is also much faster on this
      // kind of image (0.25s vs 5.5s for lossless WebP).
      //
      // Photo-ish sources (JPEG) stay on WebP: they are already lossy and PNG
      // would balloon the transfer for no visible gain.
      var losslessSource = (ext === ".tif" || ext === ".tiff" || ext === ".png" || ext === ".bmp");
      if (!raw && sharpFor() && (!renderable || wantW > 0)) {
        try {
          var pipe = sharpFor()(body).rotate();
          if (wantW > 0) pipe = pipe.resize({ width: wantW, withoutEnlargement: true });
          if (losslessSource) {
            body = await pipe.png({ compressionLevel: 6 }).toBuffer();
            contentType = "image/png";
          } else {
            body = await pipe.webp({ quality: 92 }).toBuffer();
            contentType = "image/webp";
          }
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

// "Show in folder" — opens the OS file manager with the file selected.
//
// Loopback-only (guard), and the path must be an existing file, so the worst a
// caller can do is open a folder picker on a file they can already read. No
// shell is involved: the path is passed as an argv entry to explorer.exe, never
// concatenated into a command string, so a crafted filename cannot inject one.
function revealHandler() {
  return function(req, res) {
    if (!guard(req, res)) return;
    var abs = null;
    try {
      var parsed = new URL(req.url || "/", "http://img.local");
      abs = parsed.searchParams.get("abs");
    } catch (e) {}
    if (!abs) { writeJson(res, 400, {ok: false, error: "missing abs"}); return; }
    var filePath;
    try { filePath = resolve(decodeURIComponent(abs)); }
    catch (e) { writeJson(res, 400, {ok: false, error: "bad path"}); return; }

    try {
      var st = statSync(filePath);
      if (!st.isFile()) { writeJson(res, 404, {ok: false, error: "not a file"}); return; }
    } catch (e) {
      writeJson(res, 404, {ok: false, error: "文件不存在"}); return;
    }

    try {
      if (process.platform === "win32") {
        // /select,<path> highlights the file in its containing folder.
        spawn("explorer.exe", ["/select," + filePath], { detached: true, stdio: "ignore" }).unref();
      } else if (process.platform === "darwin") {
        spawn("open", ["-R", filePath], { detached: true, stdio: "ignore" }).unref();
      } else {
        // Linux: no universal "reveal", so open the containing directory.
        spawn("xdg-open", [dirname(filePath)], { detached: true, stdio: "ignore" }).unref();
      }
      writeJson(res, 200, {ok: true, path: filePath});
    } catch (e) {
      writeJson(res, 500, {ok: false, error: e && e.message ? e.message : String(e)});
    }
  };
}

// ── Image sources ──────────────────────────────────────────────────────────
// Each source returns [{ url, title }]; the caller truncates and reports which
// source answered. Sources are tried in order, so a dead one costs a fallback
// rather than a failure.

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/");
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, "").trim();
}

// Result filtering, ported from the image-display skill's 选图过滤 section:
// keyword searches drag in adverts and other celebrities. These are positional
// hints only — a title that matches nothing is kept, so an unusual query is
// never filtered down to nothing.
var NOISE_WORDS = [
  "同款", "KISSCAT", "接吻猫", "花胶", "礼盒", "优惠", "券", "包邮", "淘宝", "京东",
  "拼多多", "代购", "广告", "带货", "直播", "链接", "下单", "购买", "价格",
];
var OTHER_CELEBS = [
  "赵丽颖", "杨颖", "Angelababy", "关晓彤", "田曦薇", "杨幂", "迪丽热巴", "刘诗诗",
  "唐嫣", "鞠婧祎", "白鹿", "虞书欣", "宋祖儿", "周也", "张婧仪", "李沁",
];

function isNoisy(item) {
  var t = String(item && item.title || "") + " " + String(item && item.url || "");
  for (var i = 0; i < NOISE_WORDS.length; i++) {
    if (t.indexOf(NOISE_WORDS[i]) >= 0) return true;
  }
  return false;
}

// True when the title mentions a different celebrity AND does not mention the
// one being searched for.
function mentionsOtherCeleb(item, query) {
  var t = String(item && item.title || "");
  if (!t) return false;
  if (t.indexOf(query) >= 0) return false;
  for (var i = 0; i < OTHER_CELEBS.length; i++) {
    if (t.indexOf(OTHER_CELEBS[i]) >= 0) return true;
  }
  return false;
}

// Identity of an image, for de-duplication.
//
// The same picture commonly shows up more than once: the same CDN object with
// different signing parameters, or the same photo re-hosted under a slightly
// different URL. Stripping the known signature parameters collapses the first
// case; a size+title signature collapses the second without touching URLs.
var SIGN_PARAMS = ["auth_key", "sign", "token", "x-signature", "expires", "e", "t", "x-oss-process"];

function normImageKey(item) {
  var raw = String(item && item.url || "");
  if (!raw) return "";
  var base = raw.split("#")[0];
  var q = "";
  var qi = base.indexOf("?");
  if (qi >= 0) { q = base.slice(qi + 1); base = base.slice(0, qi); }
  base = base.toLowerCase().replace(/^https?:\/\//, "");
  // Drop only the parameters known to be signatures/expiry, so genuinely
  // different images (whose path or other params differ) stay distinct.
  if (q) {
    var kept = [];
    var parts = q.split("&");
    for (var i = 0; i < parts.length; i++) {
      var k = parts[i].split("=")[0].toLowerCase();
      if (SIGN_PARAMS.indexOf(k) >= 0) continue;
      kept.push(parts[i]);
    }
    if (kept.length) base += "?" + kept.join("&");
  }
  var dim = "";
  if (typeof item.width === "number" && typeof item.height === "number") {
    dim = "|" + item.width + "x" + item.height;
  }
  return base + dim;
}

function dedupeResults(items) {
  var seen = {};
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || !it.url) continue;
    var key = normImageKey(it);
    if (!key || seen[key]) continue;
    seen[key] = true;
    out.push(it);
  }
  return out;
}

function filterResults(items, query) {
  var clean = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || !it.url) continue;
    if (isNoisy(it)) continue;
    if (mentionsOtherCeleb(it, query)) continue;
    clean.push(it);
  }
  // Never filter a query down to nothing: if everything looked noisy, the
  // heuristics are wrong for this query, so fall back to the raw list.
  var base = clean.length ? clean : items.filter(function (x) { return x && x.url; });
  return dedupeResults(base);
}

// Huaban's public search endpoint. Needs a browser UA (curl's UA gets 405) and
// a huaban referer; renderable originals come back on the gd-hbimg CDN.
async function sourceHuaban(query, want) {
  var url = "https://api.huaban.com/search/file?text=" + encodeURIComponent(query) +
            "&per_page=" + Math.min(40, Math.max(10, want * 4)) + "&page=1";
  var text = await httpGetText(url, "https://huaban.com/", 20000);
  var data = JSON.parse(text);
  var pins = Array.isArray(data.pins) ? data.pins : [];
  var out = [];
  for (var i = 0; i < pins.length; i++) {
    var p = pins[i];
    var f = p && p.file;
    if (!f || !f.url) continue;
    // Skip tiny thumbnails and obviously non-photo assets.
    if (typeof f.width === "number" && f.width < 600) continue;
    out.push({ url: f.url, title: stripTags(p.raw_text || "").slice(0, 80), width: f.width, height: f.height });
  }
  return out;
}

// Bing image search. The structured payload carries `murl` per result; the
// enclosing markup is escaped HTML, hence decodeEntities.
async function sourceBing(query, want) {
  var url = "https://cn.bing.com/images/search?q=" + encodeURIComponent(query) +
            "&form=HDRSC2&first=1&tsc=ImageHoverTitle";
  var text = await httpGetText(url, null, 20000);
  var hits = text.match(/murl&quot;:&quot;([^&]+?)&quot;/g) || [];
  var seen = Object.create(null);
  var out = [];
  for (var i = 0; i < hits.length; i++) {
    var m = /murl&quot;:&quot;([^&]+?)&quot;/.exec(hits[i]);
    if (!m) continue;
    var link = decodeEntities(m[1]);
    if (!/^https?:\/\//i.test(link)) continue;
    if (seen[link]) continue;
    seen[link] = true;
    out.push({ url: link, title: "" });
    if (out.length >= Math.max(20, want * 4)) break;
  }
  return out;
}

// Sogou image search — another independent index, useful when the first two
// return nothing for an unusual query. The endpoint answers with JSON carrying
// `picUrl` per item.
async function sourceSogou(query, want) {
  var url = "https://pic.sogou.com/napi/pc/searchList?mode=1&start=0&xml_len=" +
            Math.min(48, Math.max(10, want * 4)) + "&query=" + encodeURIComponent(query);
  var text = await httpGetText(url, "https://pic.sogou.com/", 20000);
  var data = JSON.parse(text);
  var list = (data && data.data && data.data.items) || [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var it = list[i] || {};
    var link = it.picUrl || it.oriPicUrl || it.thumbUrl;
    if (!link) continue;
    if (link.indexOf("//") === 0) link = "https:" + link;
    if (!/^https?:\/\//i.test(link)) continue;
    if (typeof it.width === "number" && it.width < 300) continue;
    out.push({ url: link, title: stripTags(it.title || "").slice(0, 80), width: it.width, height: it.height });
  }
  return out;
}

var SOURCES = [
  { id: "huaban", label: "花瓣", run: sourceHuaban },
  { id: "bing", label: "Bing 图片", run: sourceBing },
  { id: "sogou", label: "搜狗图片", run: sourceSogou },
];

async function searchImages(query, want, forcedSource) {
  var order = SOURCES;
  if (forcedSource) {
    order = SOURCES.filter(function (s) { return s.id === forcedSource; });
    if (!order.length) order = SOURCES;
  }
  var errors = [];
  for (var i = 0; i < order.length; i++) {
    var src = order[i];
    try {
      var found = await src.run(query, want);
      // Filter adverts / other celebrities before deciding this source is good;
      // a source whose results are all noise should fall through to the next.
      var clean = filterResults(found, query);
      if (clean.length) return { images: clean.slice(0, want), source: src.label, errors: errors };
      errors.push(src.label + ": 无可用结果");
    } catch (e) {
      errors.push(src.label + ": " + (e && e.message ? e.message : String(e)));
    }
  }
  return { images: [], source: null, errors: errors };
}

// ── display_image tool ─────────────────────────────────────────────────────
// One entry point for "show a picture in the conversation", so the agent never
// has to hand-roll a URL: local files/directories are served through the
// plugin's own /images route (with TIFF/HEIC conversion), remote links pass
// through, and keywords are searched across the sources above.

function buildDisplayTool(port, galleryRoot) {
  var defineTool = defineToolFor();
  if (typeof defineTool !== "function") return null;

  function baseUrl() {
    var p = typeof port === "function" ? port() : port;
    return "http://127.0.0.1:" + p;
  }

  // Formats whose whole reason to exist is fidelity (chart/diagram exports,
  // screenshots, bit-exact TIFF). These are served at native resolution by
  // default and converted losslessly — downscaling them silently would defeat
  // the point of asking for the file in the first place.
  function isFidelityFormat(file) {
    var e = extname(String(file || "")).toLowerCase();
    return e === ".tif" || e === ".tiff" || e === ".png" || e === ".bmp";
  }

  function localUrl(absPath, width) {
    var u = baseUrl() + IMAGE_PREFIX + "/?abs=" + encodeURIComponent(absPath);
    // Native resolution by default — including for fidelity formats and for
    // large chart exports. Measured: a 207 MP, 61.9 MB image displays promptly,
    // so there is nothing to gain by pre-shrinking it here. The route's own
    // pixel ceiling is the backstop for genuinely extreme inputs.
    var w = width;
    if (w === undefined || w === null) w = 0;
    if (w > 0) u += "&w=" + Math.round(w);
    // Cache-busting from the file's own mtime: regenerating an image under the
    // same name yields a new URL, so the browser cannot serve the stale one.
    // (The image-display skill calls this the 缓存铁律 — it is automatic here.)
    try {
      var mt = Math.round(statSync(absPath).mtimeMs);
      if (isFinite(mt) && mt > 0) u += "&v=" + mt;
    } catch (e) {}
    return u;
  }

  // ── helpers for saving remote images ──────────────────────────────────────
  // Real pixel dimensions of a file we already have. sharp is optional (the
  // plugin still works without it), so this returns null rather than throwing.
  async function readImageMeta(file) {
    var sharp = sharpFor();
    if (!sharp) return null;
    try {
      var m = await sharp(file).metadata();
      if (m && m.width && m.height) return { width: m.width, height: m.height };
    } catch (e) {}
    return null;
  }

  function extFromType(ct) {
    var t = String(ct || "").toLowerCase();
    if (t.indexOf("image/jpeg") >= 0) return ".jpg";
    if (t.indexOf("image/png") >= 0) return ".png";
    if (t.indexOf("image/webp") >= 0) return ".webp";
    if (t.indexOf("image/gif") >= 0) return ".gif";
    if (t.indexOf("image/avif") >= 0) return ".avif";
    if (t.indexOf("image/tiff") >= 0) return ".tif";
    if (t.indexOf("image/heic") >= 0 || t.indexOf("image/heif") >= 0) return ".heic";
    return "";
  }

  function extFromUrl(u) {
    try {
      var path = String(u).split("?")[0].split("#")[0];
      var m = /\.(jpe?g|png|webp|gif|avif|tiff?|heic|heif|bmp)$/i.exec(path);
      if (!m) return "";
      var e = "." + m[1].toLowerCase();
      return e === ".jpeg" ? ".jpg" : e === ".tiff" ? ".tif" : e;
    } catch (e2) { return ""; }
  }

  // Filesystem-safe stem. Keeps CJK (the names are usually Chinese), drops the
  // characters Windows refuses, and caps the length so `dir + name` stays sane.
  function safeBaseName(s) {
    var out = String(s || "").replace(/[\\/:*?"<>|\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
    if (!out) out = "image";
    if (out.length > 60) out = out.slice(0, 60).trim();
    return out;
  }

  function collectLocal(target, limit) {
    var files = [];
    if (!existsSync(target)) throw new Error("路径不存在: " + target);
    var st = statSync(target);
    if (st.isDirectory()) {
      var listed = listImages(target).sort(function (a, b) {
        return statSync(b).mtimeMs - statSync(a).mtimeMs;
      });
      files = listed.slice(0, limit);
    } else {
      files = [target];
    }
    return files;
  }

  return defineTool({
    name: "display_image",
    description:
      "把图片显示到对话里，返回可直接使用的 Markdown 图片链接。三种用法任选其一：" +
      "path=本地图片文件或目录绝对路径（自动转 TIFF/HEIC、默认原像素）；" +
      "url=网络图片直链；query=关键词联网搜图。" +
      "若还要把搜到的网图存到本地（网络直链带签名会过期），加 save_to=目标目录。",
    parameters: {
      path: { type: "string", description: "本地图片文件或目录的绝对路径" },
      url: { type: "string", description: "网络图片直链（http/https）" },
      query: { type: "string", description: "关键词，联网搜索图片，如「毛晓彤 写真」" },
      limit: { type: "number", description: "最多返回几张，默认 4" },
      width: { type: "number", description: "缩放宽度（像素）。省略 = 原像素不缩放（实测 2 亿像素也能流畅显示）；只在需要省流量/加速时传具体值" },
      source: { type: "string", description: "可选：强制指定图源（huaban / bing / sogou）" },
      save_to: { type: "string", description: "可选：把图片下载保存到该目录（不存在会自动创建）。网图直链带签名会过期，需要长期保留时传它；保存后返回的 Markdown 用本地直读链接，不再依赖外部 CDN" },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          mode: { type: "string" },
          count: { type: "number" },
          markdown: { type: "string" },
          images: {
            type: "array",
            items: {
              type: "object",
              properties: {
                url: { type: "string" },
                name: { type: "string" },
                title: { type: "string" },
                source: { type: "string" },
                width: { type: "number" },
                height: { type: "number" },
                bytes: { type: "number" },
                saved: { type: "string" },
                remoteUrl: { type: "string" },
              },
              // All fields the execute path may attach to an image item are
              // declared here. Omitting one while returning it made the runtime
              // validator drop the WHOLE result (additionalProperties:false),
              // which surfaced as "display_image returned nothing" — the search
              // had actually succeeded.
              additionalProperties: false,
            },
          },
          note: { type: "string" },
        },
        additionalProperties: false,
      },
      render: function (_args, value) {
        var lines = [value.markdown];
        if (value.note) lines.push("", "（" + value.note + "）");
        return [{ type: "text", text: lines.join("\n") }];
      },
    },
    async execute(args, exec) {
      var want = Math.max(1, Math.min(20, Math.round(args.limit || 4)));
      // Native resolution by default.
      //
      // An earlier version defaulted to 1600px on the assumption that big images
      // would not render. That assumption was wrong — it came from files hitting
      // the size cap and 404ing before any rendering was attempted. A 207 MP /
      // 61.9 MB image now displays promptly, so the default is "no scaling" and
      // `width` is opt-in for when bandwidth or load time actually matters.
      var width = args.width === undefined ? 0 : (Number(args.width) || 0);
      var picked;

      if (args.path) {
        var abs = isAbsolute(args.path) ? args.path : resolve(args.path);
        var files = collectLocal(abs, want);
        picked = files.map(function (f) {
          return { url: localUrl(f, width), name: basename(f), source: "local" };
        });
        var mode = "local";
        var note = "本地图片已通过插件内置服务直读（TIFF/HEIC 自动转 WebP" +
          (width > 0 ? "，默认缩到 " + width + "px 宽以便对话内渲染；需要原图传 width:0" : "") +
          "），本机可访问。注意：链接内含本机文件路径，转发对话或截图时请留意。";
      } else if (args.url) {
        if (!/^https?:\/\//i.test(args.url)) throw new Error("url 必须是 http/https 直链");
        picked = [{ url: args.url, name: "", source: "url" }];
        var mode2 = "url";
        var note2 = "已直传网络图片链接。";
      } else if (args.query) {
        var found = await searchImages(args.query, want, args.source);
        if (!found.images.length) {
          throw new Error("搜图失败：" + (found.errors.join(" / ") || "无图源可用"));
        }
        picked = found.images.map(function (r) {
          return {
            url: r.url, name: "", title: r.title || "", source: found.source,
            width: typeof r.width === "number" ? r.width : undefined,
            height: typeof r.height === "number" ? r.height : undefined,
          };
        });
        var mode3 = "search";
        var note3 = "图源：" + found.source +
          (found.errors.length ? "（已跳过 " + found.errors.join("、") + "）" : "");
      } else {
        throw new Error("请提供 path、url、query 三者之一");
      }

      // Optional: pull remote bytes down first.
      //
      // Search results are signed CDN links (Huaban's auth_key lives roughly
      // half an hour) and `url` mode is whatever the caller pasted. Saving
      // locally turns a link that will rot into a file that keeps working —
      // and the Markdown then points at our own /images route, so the picture
      // in the conversation no longer depends on the CDN at all.
      var savedNote = "";
      if (args.save_to && (mode2 === "url" || mode3 === "search")) {
        var outDir = isAbsolute(args.save_to) ? args.save_to : resolve(args.save_to);
        try { mkdirSync(outDir, { recursive: true }); } catch (e) {}
        var savedOk = 0, savedFail = [];
        for (var si = 0; si < picked.length; si++) {
          var item = picked[si];
          try {
            var got = await httpGetBuffer(item.url, "https://huaban.com/", 30000);
            if (!got.body || !got.body.length) throw new Error("空响应");
            var ext = extFromType(got.type) || extFromUrl(item.url) || ".jpg";
            var base = safeBaseName(item.title || item.name || ("image-" + (si + 1)));
            var dest = join(outDir, base + "-" + Date.now().toString(36).slice(-4) + ext);
            writeFileSync(dest, got.body);
            item.saved = dest;
            item.bytes = got.body.length;
            // Sources that report no dimensions (Bing) get them measured here,
            // so the caller can judge quality regardless of which source won.
            if (!item.width || !item.height) {
              var meta = await readImageMeta(dest);
              if (meta) { item.width = meta.width; item.height = meta.height; }
            }
            // Point the conversation at our own route instead of the expiring CDN.
            item.remoteUrl = item.url;
            item.url = localUrl(dest, width);
            savedOk++;
          } catch (e) {
            savedFail.push((item.title || item.url).slice(0, 30) + ": " + (e && e.message ? e.message : String(e)));
          }
        }
        // Deliberately does NOT echo outDir: that string ends up in the visible
        // conversation, and a screenshot of it would publish the local folder
        // layout. The caller already knows the path it passed in.
        savedNote = "；已保存 " + savedOk + "/" + picked.length + " 张到指定目录" +
          (savedFail.length ? "（失败 " + savedFail.length + " 张）" : "");
      }

      var md = picked.map(function (it) {
        var alt = it.name || it.title || "图片";
        return "![" + alt.replace(/[\[\]]/g, "") + "](" + it.url + ")";
      }).join("\n\n");

      return {
        mode: mode || mode2 || mode3,
        count: picked.length,
        markdown: md,
        images: picked,
        note: (note || note2 || note3) + savedNote,
      };
    },
  });
}

export var name = "image-gallery";
export var inject = ["webServer", "tools"];

export function apply(ctx) {
  var galleryRoot = DEFAULT_GALLERY_ROOT;
  ctx.logger.info("image-gallery: serving from " + galleryRoot + " (sharp: " + (sharpFor() ? "available" : "unavailable") + ")");
  ctx.effect(function() {
    var d1 = ctx.webServer.register({kind: "prefix", path: IMAGE_PREFIX, handler: imageFileHandler(galleryRoot)});
    var d2 = ctx.webServer.register({kind: "exact", path: GALLERY_API_PREFIX + "/list", handler: listHandler(galleryRoot)});
    var d3 = ctx.webServer.register({kind: "exact", path: GALLERY_API_PREFIX + "/root", handler: rootHandler(galleryRoot)});
    var d4 = ctx.webServer.register({kind: "exact", path: GALLERY_API_PREFIX + "/reveal", handler: revealHandler()});
    return function() { d1(); d2(); d3(); d4(); };
  }, "image-gallery: routes");

  // The model-facing half: one tool that turns a local path, a remote link or a
  // keyword search into a renderable image URL.
  var tool = buildDisplayTool(function() { return ctx.webServer.port; }, galleryRoot);
  if (tool && ctx.tools && typeof ctx.tools.register === "function") {
    ctx.effect(function() {
      return ctx.tools.register(tool);
    }, "image-gallery: display_image tool");
    ctx.logger.info("image-gallery: display_image tool registered");
  } else {
    ctx.logger.warn("image-gallery: display_image tool skipped (tools service or defineTool unavailable)");
  }
}
