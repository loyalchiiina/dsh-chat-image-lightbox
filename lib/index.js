import { existsSync, statSync, readdirSync, mkdirSync, writeFileSync, appendFileSync, unlinkSync, openSync, readSync, closeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname, resolve, isAbsolute, basename, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import https from "node:https";
import http from "node:http";

// ── DIAGNOSTIC SINK (temporary) ─────────────────────────────────────────────
// The browser half cannot write anywhere we can read, so it POSTs status here
// and the host appends it to a file. Remove once the switch question is settled.
var IG_DIAG_PATH = join(homedir(), ".dsh", "image-gallery-diag.log");
function igDiagWrite(line) {
  try { appendFileSync(IG_DIAG_PATH, new Date().toISOString() + "  " + line + "\n"); } catch (e) {}
}
function igDiagHandler() {
  return function (req, res) {
    if (!isLoopbackRequest(req)) { res.writeHead(403); res.end(); return; }
    var body = "";
    req.on("data", function (c) { body += c; if (body.length > 65536) { body = body.slice(0, 65536); req.destroy(); } });
    req.on("end", function () { igDiagWrite(body); res.writeHead(204); res.end(); });
  };
}

// ── Dependency resolution ──────────────────────────────────────────────────
// This plugin is installed as a directory Junction: profiles/<name>/node_modules/
// dsh-chat-image-lightbox → .dsh/local-plugins/dsh-chat-image-lightbox. Node
// resolves a require from the REAL path of the module, not the link, so
// createRequire(import.meta.url) walks up from local-plugins/ and finds nothing:
// sharp and undici live in profiles/<name>/node_modules, one directory the
// linker removed from the chain. Measured symptom: the startup line reads
//   image-gallery: serving from ... (sharp: unavailable)
// and every TIFF/HEIC then renders as "图片无法预览", plus undici-only proxy
// support silently disappears.
//
// So resolve against several roots: the module itself, the running executable,
// the harness' EXEPATH hint, the cwd, and every ancestor of those. First hit
// wins, and the answer is cached.
//
// Ancestors alone are not enough, which is worth spelling out because the first
// version of this got it wrong. From the plugin's real path the chain is
// `.dsh/local-plugins/<plugin>/lib` → `.dsh/local-plugins/<plugin>` →
// `.dsh/local-plugins` → `.dsh` → `C:\Users\<user>`, and `sharp` is in
// `.dsh/profiles/<name>/node_modules` — a SIBLING branch, never an ancestor.
// Same for the exe (`Programs/DSH NEXT/`). And EXEPATH is set by the bash tool,
// not by the host process, so it cannot be relied on either. Hence the explicit
// profile scan below: it is the only root that actually contains these deps.
var __depCache = Object.create(null);
function depBases() {
  var bases = [];
  try { bases.push(fileURLToPath(import.meta.url)); } catch (e) {}
  try { bases.push(process.execPath); } catch (e) {}
  try { if (process.env.EXEPATH) bases.push(process.env.EXEPATH); } catch (e) {}
  try { bases.push(join(process.cwd(), "noop.js")); } catch (e) {}
  // `…/.dsh/profiles/<name>/node_modules` — where a profile's own dependencies
  // (sharp, undici) actually live. Found from this module's real path by
  // walking up to the `.dsh` directory, then listing its profiles.
  try {
    var probe = dirname(fileURLToPath(import.meta.url));
    for (var up = 0; up < 6; up++) {
      var profRoot = join(probe, "profiles");
      if (existsSync(profRoot)) {
        var names = readdirSync(profRoot);
        for (var n = 0; n < names.length; n++) {
          var nm = join(profRoot, names[n], "node_modules");
          if (existsSync(nm)) bases.push(nm);
        }
        bases.push(profRoot);
        break;
      }
      var parent = dirname(probe);
      if (!parent || parent === probe) break;
      probe = parent;
    }
  } catch (e) {}
  return bases;
}
function resolveDep(name) {
  if (Object.prototype.hasOwnProperty.call(__depCache, name)) return __depCache[name];
  var bases = depBases();
  for (var i = 0; i < bases.length; i++) {
    var dir = bases[i];
    for (var up = 0; up < 8; up++) {
      try {
        var req = createRequire(join(dir, "noop.js"));
        var resolved = req.resolve(name);
        __depCache[name] = req;
        void resolved;
        return req;
      } catch (e) {}
      var parent = dirname(dir);
      if (!parent || parent === dir) break;
      dir = parent;
    }
  }
  __depCache[name] = null;
  return null;
}
function loadDep(name) {
  var req = resolveDep(name);
  if (!req) return null;
  try { return req(name); } catch (e) { return null; }
}

var __defineTool = null;
var __defineToolTried = false;
function defineToolFor() {
  if (__defineToolTried) return __defineTool;
  __defineToolTried = true;
  try {
    var dreq = resolveDep("@deepseek-ai/dsh-tools");
    __defineTool = dreq ? dreq("@deepseek-ai/dsh-tools").defineTool : null;
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
    __undici = loadDep("undici");
  } catch (e) {
    __undici = null;
  }
  return __undici;
}

var BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

// ── Proxy-or-direct ────────────────────────────────────────────────────────
// The proxy is a hint, not an authority. Measured on this machine:
//
//   c-ssl.duitang.com   direct 200 image/jpeg   through 7890: TLS reset, no reply
//   cn.bing.com         direct flaky            through 7890: works
//
// A proxy that is *listening* is not a proxy that can reach *this* host, and
// routing every image request through it made whole CDNs look dead. That in
// turn made the health gate drop perfectly loadable pictures.
//
// The trap underneath: this machine runs with NODE_USE_ENV_PROXY=1, so Node's
// global fetch consults HTTPS_PROXY on its own — "no dispatcher" does NOT mean
// "no proxy". The direct route is therefore built on node:https/http with an
// explicit Agent, which ignores the env var entirely (undici's Agent would work
// too, but it is an extra dependency to keep resolvable — see resolveDep).
// Verified: same URL, same headers, global fetch → TLS reset; node:https with
// `agent: new https.Agent()` → 200 image/jpeg.
//
// The managed route stays on fetch (i.e. whatever proxy the runtime applies),
// because that is the path that already works for cn.bing.com.

// One request on node:https/http, bypassing any environment proxy. Follows up
// to 5 redirects because CDNs bounce through a signed hop.
function rawDirectGet(urlStr, headers, timeoutMs, hops) {
  hops = hops || 0;
  return new Promise(function (resolveP, rejectP) {
    var u;
    try { u = new URL(urlStr); } catch (e) { rejectP(new Error("bad url " + urlStr)); return; }
    if (u.protocol !== "https:" && u.protocol !== "http:") { rejectP(new Error("unsupported protocol " + u.protocol)); return; }
    var isHttps = u.protocol === "https:";
    var settled = false;
    var timer = null;
    var finish = function (fn, arg) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(arg);
    };
    if (timeoutMs) {
      timer = setTimeout(function () { finish(rejectP, new Error("timeout after " + timeoutMs + "ms [direct]")); }, timeoutMs);
    }
    var opts = {
      host: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: "GET",
      headers: headers,
    };
    if (isHttps) {
      opts.agent = new https.Agent({ keepAlive: false });
      opts.servername = u.hostname;
    } else {
      opts.agent = new http.Agent({ keepAlive: false });
    }
    var req = (isHttps ? https : http).request(opts, function (res) {
      var status = res.statusCode || 0;
      var loc = res.headers && res.headers.location;
      if (status >= 300 && status < 400 && loc) {
        res.resume();
        if (hops >= 5) { finish(rejectP, new Error("too many redirects [direct]")); return; }
        var next;
        try { next = new URL(loc, urlStr).toString(); } catch (e) { finish(rejectP, new Error("bad redirect " + loc)); return; }
        finish(resolveP, rawDirectGet(next, headers, timeoutMs, hops + 1));
        return;
      }
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        finish(resolveP, { status: status, headers: res.headers || {}, body: Buffer.concat(chunks), route: "direct" });
      });
      res.on("error", function (e) { finish(rejectP, e); });
    });
    req.on("error", function (e) { finish(rejectP, e); });
    req.end();
  });
}

// Get a URL as bytes, trying the runtime's route first and the direct route
// second. An HTTP status is an answer and is returned as-is; only a transport
// failure moves on to the other route.
async function getBytes(url, headers, timeoutMs) {
  var lastErr = null;
  try {
    var init = { headers: headers, redirect: "follow" };
    if (timeoutMs) init.signal = AbortSignal.timeout(timeoutMs);
    var res = await fetch(url, init);
    var body = Buffer.from(await res.arrayBuffer());
    var hdrs = {};
    try { res.headers.forEach(function (v, k) { hdrs[String(k).toLowerCase()] = v; }); } catch (e) {}
    return { status: res.status, headers: hdrs, body: body, route: "runtime" };
  } catch (e) {
    lastErr = e;
  }
  try {
    return await rawDirectGet(url, headers, timeoutMs, 0);
  } catch (e2) {
    var c1 = lastErr && lastErr.cause && lastErr.cause.message ? lastErr.cause.message : (lastErr && lastErr.message ? lastErr.message : String(lastErr));
    var c2 = e2 && e2.message ? e2.message : String(e2);
    var err = new Error(c1 + " · " + c2);
    err.cause = e2;
    throw err;
  }
}

async function httpGetText(url, referer, timeoutMs) {
  var headers = { "user-agent": BROWSER_UA, "accept-language": "zh-CN,zh;q=0.9" };
  if (referer) headers.referer = referer;
  var lastErr = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var got = await getBytes(url, headers, timeoutMs);
      if (got.status < 200 || got.status >= 300) throw new Error("HTTP " + got.status);
      return got.body.toString("utf8");
    } catch (e) {
      lastErr = e;
      // An HTTP status is an answer; retrying will not change it.
      if (e && /^HTTP \d/.test(String(e.message || ""))) break;
      if (attempt === 0) await new Promise(function (r) { setTimeout(r, 250); });
    }
  }
  throw lastErr;
}

// Binary sibling of httpGetText, for actually saving an image. Search results
// come back as signed CDN links that expire (Huaban's auth_key lasts about half
// an hour), so "display only" is not enough — the caller needs the bytes.
//
// A 2xx is NOT proof that these bytes are a picture. Measured on this machine:
// one rescued file, saved as `image-4-go3m.jpg` and served back as
// `image/jpeg`, began with `0a0a0a0a<!doctype html>` — a CDN's HTML error page
// that answered 200 with an image content-type. The browser decodes it, fails,
// and shows "图片无法预览"; nothing upstream noticed, because every layer only
// ever inspected the status code. So sniff the magic bytes and refuse anything
// that is not a real image container.
function looksLikeImage(buf) {
  if (!buf || buf.length < 12) return false;
  var b = buf;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true;
  // WEBP: "RIFF" .... "WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;
  // TIFF: "II*\0" or "MM\0*"
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) return true;
  // BMP: "BM"
  if (b[0] === 0x42 && b[1] === 0x4d) return true;
  // AVIF / HEIC (ISOBMFF): size(4) + "ftyp" at offset 4
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true;
  return false;
}

// Some hosts answer 403 to a foreign Referer and 200 to their own.
//
// Measured 2026-10-21 over 36 real Bing hits: the caller-supplied (Huaban)
// Referer fetched 32/36; each host's OWN origin fetched 32/36; trying both
// fetched 33/36. i1.hdslb.com is only reachable with a self-referer
// (403 -> 200, 1.5 MB), while gd-hbimg.huaban.com is the reverse (a
// self-referer makes Tencent EdgeOne answer 567). So neither header is
// universally right and the fix is to try the other one before giving up.
function selfRefererFor(url) {
  try {
    var u = new URL(url);
    return u.protocol + "//" + u.host + "/";
  } catch (e) {
    return null;
  }
}

async function httpGetBuffer(url, referer, timeoutMs) {
  var headers = { "user-agent": BROWSER_UA, "accept-language": "zh-CN,zh;q=0.9" };
  if (referer) headers.referer = referer;
  var selfRef = selfRefererFor(url);
  var triedSelf = !selfRef || selfRef === referer;
  var lastErr = null;
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var got = await getBytes(url, headers, timeoutMs);
      if (got.status < 200 || got.status >= 300) {
        // A refusal tied to the Referer is worth one retry with the host's own.
        if (!triedSelf && (got.status === 403 || got.status === 401 || got.status === 567)) {
          triedSelf = true;
          headers.referer = selfRef;
          attempt--;
          continue;
        }
        throw new Error("HTTP " + got.status);
      }
      if (!looksLikeImage(got.body)) {
        var hint = String(got.body.slice(0, 40).toString("utf8") || "")
          .replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 30);
        throw new Error("不是图片（content-type=" + (got.headers["content-type"] || "无") +
          "，开头=" + hint + "）");
      }
      return { body: got.body, type: got.headers["content-type"] || "" };
    } catch (e) {
      lastErr = e;
      // An HTTP status is an answer; retrying will not change it. Same for
      // "this is HTML, not a picture" — the next attempt gets the same page.
      if (e && (/^HTTP \d/.test(String(e.message || "")) || /^不是图片/.test(String(e.message || "")))) break;
      if (attempt === 0) await new Promise(function (r) { setTimeout(r, 250); });
    }
  }
  throw lastErr;
}

// sharp (bundled with the plugin) converts browser-unrenderable formats —
// TIFF (e.g. Fluent chart exports), HEIC — to WebP on the fly so they display
// inline; `?raw=1` bypasses conversion so downloads always get the original file.
var __sharp = null;
function sharpFor() {
  if (__sharp !== null) return __sharp;
  try {
    __sharp = loadDep("sharp");
  } catch (e) {
    __sharp = false;
  }
  return __sharp;
}

// ── WIC fallback: the HEIC path sharp cannot take ───────────────────────────
// sharp's bundled libheif is compiled WITHOUT the HEVC decoder. It still reads
// the CONTAINER fine —
//     metadata => format=heif 1440x960 compression=hevc
// — and then dies the moment real pixels are requested:
//     heif: Error while loading plugin: Support for this compression format has
//     not been built in: HEVC (a suitable decoder plugin is libde265)
// That split is exactly what made an earlier "HEIC works" conclusion wrong:
// metadata success was read as decode success.
//
// Windows ships HEIFImageExtension + HEVCVideoExtension and WIC decodes these
// files without complaint, so fall back to a one-shot PowerShell + WIC
// transcode to PNG. Measured on a genuine 1440x960 HEVC HEIC: 532 ms to a
// 520x347 PNG. The script travels as -EncodedCommand (UTF-16LE base64) so no
// path or quote ever has to survive a command line.
var __wicOk = null;
function wicAvailable() {
  if (__wicOk !== null) return __wicOk;
  __wicOk = (process.platform === "win32");
  return __wicOk;
}

function wicToPng(src, dst, width, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var q = function (v) { return "'" + String(v).replace(/'/g, "''") + "'"; };
    var w = Math.max(0, Math.round(width || 0));
    var lines = [
      "Add-Type -AssemblyName PresentationCore",
      "$src = " + q(src),
      "$dst = " + q(dst),
      "$w = " + w,
      "$dec = [System.Windows.Media.Imaging.BitmapDecoder]::Create((New-Object System.Uri -ArgumentList $src),'None','OnLoad')",
      "$frame = $dec.Frames[0]",
      "if ($w -gt 0 -and $frame.PixelWidth -gt $w) {",
      "  $sx = $w / $frame.PixelWidth",
      "  $t = New-Object System.Windows.Media.Imaging.TransformedBitmap",
      "  $t.BeginInit()",
      "  $t.Source = $frame",
      "  $t.Transform = New-Object System.Windows.Media.ScaleTransform -ArgumentList $sx,$sx",
      "  $t.EndInit()",
      "  $frame = [System.Windows.Media.Imaging.BitmapFrame]::Create($t)",
      "}",
      "$enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder",
      "$enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($frame))",
      "$fs = [System.IO.File]::Create($dst)",
      "$enc.Save($fs)",
      "$fs.Close()",
      "Write-Output ('DONE ' + $frame.PixelWidth + 'x' + $frame.PixelHeight)"
    ];
    var b64 = Buffer.from(lines.join("\r\n"), "utf16le").toString("base64");
    var cp;
    try {
      cp = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", b64], { windowsHide: true });
    } catch (e) { reject(e); return; }
    var out = "", err = "";
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      try { cp.kill(); } catch (e) {}
      reject(new Error("WIC 转码超时"));
    }, timeoutMs || 60000);
    cp.stdout.on("data", function (d) { out += d.toString(); });
    cp.stderr.on("data", function (d) { err += d.toString(); });
    cp.on("error", function (e) { if (done) return; done = true; clearTimeout(timer); reject(e); });
    cp.on("close", function (code) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) { reject(new Error("WIC exit " + code + ": " + (err || out).slice(0, 200))); return; }
      resolve({ stdout: String(out).trim() });
    });
  });
}

var DEFAULT_GALLERY_ROOT = join(homedir(), ".dsh", "uploads");

// Where automatically rescued images go. Kept under the user's .dsh tree so the
// conversation never has to publish an unrelated path.
function autoCacheDir() {
  var dir = join(homedir(), ".dsh", "image-gallery-auto");
  try { mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}

// Would the browser be able to load this URL?
//
// The browser sends the page's origin as Referer, so a CDN that only accepts its
// own domain refuses to serve the image — Huaban's Tencent EdgeOne front answers
// with status 567 and an HTML block page ("请求已被站点的安全策略拦截") instead of
// an image, which the conversation shows as "图片无法预览".
//
// This deliberately does NOT use httpGetBuffer(): that helper throws on any
// non-2xx response, so a blocked image would land in its catch block and look
// like a network hiccup. Here the status and content-type are what matter, so a
// raw fetch is used and both are inspected.
async function probeRemoteForBrowser(url) {
  try {
    var headers = {
      "user-agent": BROWSER_UA,
      "accept": "image/avif,image/webp,image/*,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9",
      "referer": "http://127.0.0.1/",
    };
    // Same two-route walk as the download helpers: asking "can the browser load
    // this?" through a route that cannot reach the host answers the wrong
    // question, and the answer came back "no" for whole CDNs (duitang) that load
    // fine directly.
    var got = await getBytes(url, headers, 15000);
    var type = String(got.headers["content-type"] || "").toLowerCase();
    var ok = got.status >= 200 && got.status < 300;
    // Blocked when the response is not a 2xx, when it does not claim to be an
    // image, or — the case that slipped through — when it claims `image/jpeg`
    // and hands back an HTML error page. A CDN answering 200 with a block page
    // is exactly what "图片无法预览" looks like from the outside, and trusting
    // the content-type alone made this probe call such a response loadable.
    var looksReal = looksLikeImage(got.body);
    var blocked = !ok || type.indexOf("image/") !== 0 || !looksReal;
    return { url: url, blocked: blocked, status: got.status, type: type, route: got.route, realBytes: looksReal };
  } catch (e) {
    // A genuine network failure is not proof of hotlink protection: leave it.
    return { url: url, blocked: false, error: e && e.message ? e.message : String(e) };
  }
}

// How many of this source's pictures can the browser actually load?
//
// `searchImages` used to stop at the first source that returned a non-empty
// list, on the assumption that "has results" meant "has usable results". That
// assumption broke the moment a CDN started refusing the whole network: Huaban
// kept answering its search API with 200 and twenty pins while every single
// image URL came back 567 from Tencent EdgeOne, so the search never fell
// through and the user got a wall of "图片无法预览".
//
// Sampling a few URLs answers the question the user actually cares about. It is
// deliberately a sample: probing all of them costs a full round trip each and
// the caller re-probes what it needs anyway.
async function sampleSourceHealth(images, cap) {
  var n = Math.min(cap || 4, images.length);
  if (n <= 0) return { sampled: 0, ok: 0, failed: 0, blocked: 0, ratio: 1 };
  var probes = [];
  for (var i = 0; i < n; i++) probes.push(probeRemoteForBrowser(images[i].url));
  try { probes = await Promise.all(probes); } catch (e) {}
  // 三种结果必须分开数，**只有「确认取到 2xx 图片」才算可加载**：
  //   blocked = 站点明确拒绝（非 2xx / 根本不是图片）→ 交给转存路径去救；
  //   failed  = 网络/TLS 失败，探测本身没成功 → 既不能算「可加载」，也不是防盗链证据。
  // 这里曾把 failed 也算进 ok（"网络失败不是防盗链证据"就顺手 leave it），
  // 实测后果：4 张里 1 张 TLS 断开，仍报「4 张可加载」，用户看到的还是坏图。
  var ok = 0, failed = 0, blocked = 0;
  for (var j = 0; j < probes.length; j++) {
    var p = probes[j];
    if (!p) { failed++; continue; }
    if (p.blocked) { blocked++; if (images[j]) images[j].blocked = true; }
    else if (p.error) { failed++; if (images[j]) images[j].unverified = true; }
    else ok++;
  }
  return {
    sampled: probes.length,
    ok: ok,
    failed: failed,
    blocked: blocked,
    ratio: probes.length ? ok / probes.length : 1,
  };
}

// Bounded-concurrency map. Downloading a batch of rescued images one after
// another made a ten-picture search take 18 seconds — the round trips are what
// cost, not the bytes, so four at a time does the same work in about a quarter
// of the time without turning a search into a burst of twenty sockets.
async function mapLimit(items, limit, fn) {
  var out = new Array(items.length);
  var cursor = 0;
  var lanes = Math.max(1, Math.min(limit, items.length));
  async function lane() {
    for (;;) {
      var i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  var running = [];
  for (var k = 0; k < lanes; k++) running.push(lane());
  await Promise.all(running);
  return out;
}

// The rescue cache only ever grew: every hotlink-blocked picture is copied to
// disk and nothing ever removed it, so the folder had reached 129 files / 187 MB
// of images whose CDN links had long expired. Prune by both count and bytes,
// oldest first, before writing anything new.
var AUTO_CACHE_MAX_BYTES = 512 * 1024 * 1024;
var AUTO_CACHE_MAX_FILES = 500;
function pruneAutoCache() {
  try {
    var dir = autoCacheDir();
    var names = readdirSync(dir);
    var rows = [];
    var total = 0;
    for (var i = 0; i < names.length; i++) {
      var p = join(dir, names[i]);
      try {
        var st = statSync(p);
        if (!st.isFile()) continue;
        rows.push({ path: p, mtime: st.mtimeMs, size: st.size });
        total += st.size;
      } catch (e) {}
    }
    if (rows.length <= AUTO_CACHE_MAX_FILES && total <= AUTO_CACHE_MAX_BYTES) {
      return { removed: 0, files: rows.length, bytes: total };
    }
    rows.sort(function (a, b) { return a.mtime - b.mtime; });
    var removed = 0, idx = 0;
    while (idx < rows.length && (rows.length - removed > AUTO_CACHE_MAX_FILES || total > AUTO_CACHE_MAX_BYTES)) {
      try { unlinkSync(rows[idx].path); total -= rows[idx].size; removed++; } catch (e) {}
      idx++;
    }
    return { removed: removed, files: rows.length - removed, bytes: total };
  } catch (e) {
    return { removed: 0, error: e && e.message ? e.message : String(e) };
  }
}

// A tool result crosses a strict JSON border: the runtime walks every own key of
// the returned value and rejects the WHOLE call as soon as it meets an
// `undefined`, a NaN or an infinity — the caller sees
//   tool "display_image" returned invalid output: value is not lossless JSON
// and not a single picture arrives. Bing reports no dimensions, so every search
// that Bing won died there. The item below is now built without those keys, and
// the finished result goes through lossless() so a future field cannot
// reintroduce the same silent wipe-out.
function lossless(value, ancestors) {
  if (value === null) return null;
  var t = typeof value;
  if (t === "string" || t === "boolean") return value;
  if (t === "number") return Number.isFinite(value) && !Object.is(value, -0) ? value : undefined;
  if (t !== "object") return undefined;
  if (!ancestors) ancestors = new Set();
  if (ancestors.has(value)) return undefined;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      var arr = [];
      for (var i = 0; i < value.length; i++) {
        var av = lossless(value[i], ancestors);
        arr.push(av === undefined ? null : av);
      }
      return arr;
    }
    var out = {};
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      var rv = lossless(value[keys[k]], ancestors);
      if (rv !== undefined) out[keys[k]] = rv;
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

// slice() counts UTF-16 units, so cutting a title at 80 can split a surrogate
// pair and leave half an emoji in the value that travels to the conversation
// (and into the saved file name).
function truncateSafe(s, n) {
  var t = String(s === undefined || s === null ? "" : s);
  if (t.length <= n) return t;
  var cut = t.slice(0, n);
  var last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

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
// Ceiling for a transcoded body-viewable copy. The Host's api/file route
// rejects anything above ctx.attachments.imageLimits.maxImageBytes (measured
// default: 20 MB in the shipped app.asar), and a 413 renders as
// 图片无法预览. Stay comfortably under it.
var VIEW_MAX_BYTES = 16 * 1024 * 1024;

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
      // `searchParams.get` has ALREADY percent-decoded the value once. Decoding
      // it again is not harmless — it silently breaks every filename containing
      // a literal `%`. Measured both directions on this machine:
      //   `a%20b.jpg`      → second decode gives `a b.jpg`   → 404
      //   `折扣50%的图.jpg` → second decode hits `%的`        → URIError, handler dies
      // So take the value as given, and only fall back to one more decode when
      // the raw form is not on disk (a caller may still hand us a doubly-encoded
      // path). The fallback is wrapped because a malformed escape has to answer
      // 400, never throw out of the request handler.
      filePath = resolve(absParam);
      try {
        if (!existsSync(filePath)) {
          var onceMore = resolve(decodeURIComponent(absParam));
          if (existsSync(onceMore)) filePath = onceMore;
        }
      } catch (e) {
        if (!existsSync(filePath)) {
          res.writeHead(400, {"content-type": "text/plain; charset=utf-8"});
          res.end("bad abs path: " + e.message);
          return;
        }
      }
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

      // A file can LIE about itself. One rescued file sat in the cache as
      // `image-4-go3m.jpg` and was served as `image/jpeg`, but its bytes were a
      // CDN's HTML error page (`0a0a0a0a<!doctype html>…`) — the browser took
      // the content-type, failed to decode, and drew "图片无法预览" with no
      // explanation anywhere. Refusing here turns an unexplainable broken image
      // into a named error. SVG and ICO are text/container formats that the
      // magic-byte test does not cover, so they are exempt.
      if (!raw && renderable && ext !== ".svg" && ext !== ".ico" && !looksLikeImage(body)) {
        var headHint = String(body.slice(0, 48).toString("utf8") || "")
          .replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 40);
        res.writeHead(415, {"content-type": "text/plain; charset=utf-8"});
        res.end("这个文件不是图片（后缀 " + ext + "，实际开头是 " + headHint + "）。\n" +
                "多半是图源返回了错误页并被当成图片保存下来。");
        return;
      }

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
        } catch (e2) {
          // sharp is built without the HEVC decoder, so a genuine HEIC throws
          // here even though its metadata read fine. WIC on Windows decodes
          // it; without this the raw .heic would go to the browser and show
          // as 图片无法预览.
          if (wicAvailable()) {
            try {
              var wicTmp = join(tmpdir(), "ig-wic-" + Date.now().toString(36) + "-" +
                Math.random().toString(36).slice(2, 6) + ".png");
              await wicToPng(filePath, wicTmp, wantW > 0 ? wantW : 2048, 60000);
              body = await readFile(wicTmp);
              contentType = "image/png";
              try { unlinkSync(wicTmp); } catch (e5) {}
            } catch (e6) { /* fall back to raw below */ }
          }
        }
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
    out.push({ url: f.url, title: truncateSafe(stripTags(p.raw_text || ""), 80), width: f.width, height: f.height });
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
//
// Measured 2026-10-21: the endpoint now answers 200 with a 40-byte body
// `{"status":1,"info":"forbid","data":null}` — the API stopped serving
// anonymous callers. Reporting that plainly beats the old silence, which made
// it look like "this query has no pictures here".
async function sourceSogou(query, want) {
  var url = "https://pic.sogou.com/napi/pc/searchList?mode=1&start=0&xml_len=" +
            Math.min(48, Math.max(10, want * 4)) + "&query=" + encodeURIComponent(query);
  var text = await httpGetText(url, "https://pic.sogou.com/", 20000);
  var data = JSON.parse(text);
  if (data && /forbid/i.test(String(data.info || "")) && !data.data) {
    throw new Error("接口已停止对匿名请求返回结果（forbid），此图源暂不可用");
  }
  var list = (data && data.data && data.data.items) || [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var it = list[i] || {};
    var link = it.picUrl || it.oriPicUrl || it.thumbUrl;
    if (!link) continue;
    if (link.indexOf("//") === 0) link = "https:" + link;
    if (!/^https?:\/\//i.test(link)) continue;
    if (typeof it.width === "number" && it.width < 300) continue;
    out.push({ url: link, title: truncateSafe(stripTags(it.title || ""), 80), width: it.width, height: it.height });
  }
  return out;
}

// Order matters only when every source is healthy. Huaban used to lead because
// its results are curated portraits, but its CDN has been refusing this whole
// network with HTTP 567 regardless of referer, UA, cookie or proxy, so the
// source that actually serves pictures now goes first.
// Measured 2026-10-21: Bing 35 hits, images mostly loadable; Huaban 20 pins, 0%
// loadable; Sogou API answers "forbid".
var SOURCES = [
  { id: "bing", label: "Bing 图片", run: sourceBing },
  { id: "huaban", label: "花瓣", run: sourceHuaban },
  { id: "sogou", label: "搜狗图片", run: sourceSogou },
];

// A source is only worth returning if a meaningful share of its pictures can be
// loaded in the conversation. Below this, keep looking.
var SOURCE_HEALTH_MIN = 0.3;

async function searchImages(query, want, forcedSource) {
  var order = SOURCES;
  if (forcedSource) {
    order = SOURCES.filter(function (s) { return s.id === forcedSource; });
    if (!order.length) order = SOURCES;
  }
  var errors = [];
  // Best-effort result, kept in case no source clears the health bar: a partly
  // blocked list still beats refusing to answer.
  var fallback = null;
  for (var i = 0; i < order.length; i++) {
    var src = order[i];
    try {
      var found = await src.run(query, want);
      // Filter adverts / other celebrities before deciding this source is good;
      // a source whose results are all noise should fall through to the next.
      var clean = filterResults(found, query);
      if (!clean.length) {
        errors.push(src.label + ": 无可用结果");
        continue;
      }
      var health = await sampleSourceHealth(clean, 4);
      if (health.sampled > 0 && health.ratio < SOURCE_HEALTH_MIN) {
        // Hand the already-probed URLs to the caller so it does not re-probe
        // them, and record why this source was skipped.
        var why = health.sampled + " 张抽样仅 " + health.ok + " 张可加载";
        if (health.blocked) why += "，" + health.blocked + " 张被站点拦截";
        if (health.failed) why += "，" + health.failed + " 张探测失败（网络/TLS 未通，未验证）";
        errors.push(src.label + ": " + why);
        if (!fallback || health.ratio > fallback.ratio) {
          fallback = {
            images: clean.slice(0, Math.min(clean.length, Math.max(want * 4, want))),
            source: src.label,
            ratio: health.ratio,
          };
        }
        continue;
      }
      // Return a POOL, not exactly `want` pictures.
      //
      // Bing's ordering puts some hotlink-hostile hosts first (measured
      // 2026-10-21: 「喜羊羊」's first three hits were bkimg.cdn.bcebos.com and
      // i0.hdslb.com, all HTTP 403 to a non-browser request). Taking only the
      // first `want` and refusing when those fail made a query with 34 usable
      // candidates answer "一张都下载不下来". The pool is four times the ask so
      // the delivery step can skip dead entries and still fill the order.
      return {
        images: clean.slice(0, Math.min(clean.length, Math.max(want * 4, want))),
        source: src.label,
        errors: errors,
        // Report what was actually measured, not an extrapolation: saying
        // "sampled 4, 20 loadable" would read as nonsense to the caller.
        health: { ok: health.ok, sampled: health.sampled, failed: health.failed },
      };
    } catch (e) {
      errors.push(src.label + ": " + (e && e.message ? e.message : String(e)));
    }
  }
  if (fallback) {
    errors.push("所有图源可加载率均偏低，已退回可加载率最高的 " + fallback.source);
    return { images: fallback.images, source: fallback.source, errors: errors, degraded: true };
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

  // v1.7.7: root-relative URLs only.
  //
  // The desktop shell serves the conversation from the custom protocol
  // `dsh-app://app/` (location.origin === "dsh-app://app", location.port ===
  // ""). An absolute `http://127.0.0.1:<port>/images/...` is then a
  // cross-ORIGIN request from a non-HTTP origin, which Chromium refuses
  // outright: measured `fetch` → TypeError "Failed to fetch" and `<img>` →
  // error, with no request ever reaching the webServer (the log shows zero
  // /images hits). The same bytes served as `/images/...` succeed with
  // 200 image/webp.
  //
  // So never build an absolute URL here. The route lives on the same origin as
  // the page in every deployment (desktop custom protocol and web alike), so a
  // root-relative path is both correct and portable. Chrome additionally
  // blocks the loopback hop from a custom-scheme origin as an insecure private
  // network request, which is why "just use the port" cannot be repaired.
  function baseUrl() {
    return "";
  }

  // Formats whose whole reason to exist is fidelity (chart/diagram exports,
  // screenshots, bit-exact TIFF). These are served at native resolution by
  // default and converted losslessly — downscaling them silently would defeat
  // the point of asking for the file in the first place.
  function isFidelityFormat(file) {
    var e = extname(String(file || "")).toLowerCase();
    return e === ".tif" || e === ".tiff" || e === ".png" || e === ".bmp";
  }

  // ── Conversation-body destinations (Markdown) ────────────────────────────
  // The tool ROW (display_image's own renderer) builds its own <img> from
  // images[].url, so a root-relative `/images/?abs=…` route serves it fine.
  // The conversation BODY does not: the Host parses `![]()` destinations with
  // parseFileLink() → fileImages.resolve() → localPathMediaUrl(), and every one
  // of those treats a leading "/" as an absolute Workspace path. So
  // `/images/?abs=X` is stripped to `/images/` and resolved as
  // `api/file?path=%2Fimages%2F` — a 404 that renders "加载失败 · alt" instead of
  // the picture. The body therefore needs the REAL absolute file path.
  //
  // Verified against the shipped Host functions in app.asar (desktop
  // `dsh-app://app/` and web alike): forward slashes work, back slashes do not,
  // and a bare `(`, `)`, `'`, space, `#` or `?` terminates or corrupts the
  // Markdown destination. So escape exactly those and leave every other
  // character (including CJK) readable in the transcript.
  //
  // `%` MUST be escaped, and first. The Host's `localPathMediaUrl` runs
  // `decodeURIComponent(destination)` to recover the real path (inside a
  // try/catch that yields `undefined` when it throws), so the destination has
  // to be an ENCODED form of that path rather than its raw bytes:
  //   • a bare `%` (`折扣50%.jpg`) is not a valid escape → decode throws →
  //     the image silently renders as its alt text;
  //   • a name that already looks encoded (`a%20b.jpg`) decodes to `a b.jpg`
  //     and lands on a DIFFERENT file;
  //   • `d%2Fslash.jpg` decodes a path separator into the name.
  // Escaping `%` → `%25` round-trips all three (`50%25.jpg` → `50%.jpg`),
  // because the Host decodes exactly once.
  function encodeBodyDest(absPath) {
    return String(absPath).replace(/\\/g, "/").replace(/%/g, "%25").replace(/[()!'* #?<>"]/g, function (c) {
      return "%" + ("0" + c.charCodeAt(0).toString(16).toUpperCase()).slice(-2);
    });
  }

  // A destination the conversation body can render: local files become their
  // escaped absolute path, remote http(s) links stay as they are (the Host's
  // own remoteImageUrl accepts those directly).
  //
  // A LOCAL COPY ALWAYS WINS over the remote URL it was fetched from. Both
  // call sites above save the original link in `remoteUrl` purely for the
  // record ("Point the conversation at our own route instead of the expiring
  // CDN"), so preferring `remoteUrl` here would point the transcript back at
  // the very CDN the download was meant to escape: signed hotlink URLs expire,
  // and the image then breaks retroactively in every past reply. The file on
  // disk is ours and stays readable, so try it first and fall back to the
  // remote link only when the copy is gone (user deleted the cache, say).
  function bodyPath(item) {
    // A transcoded, browser-renderable copy always wins over the original: the
    // Host's api/file route streams raw bytes with the file's own MIME type and
    // Chromium has no TIFF/HEIC decoder (see ensureViewable below).
    if (item.viewPath) {
      try {
        if (existsSync(item.viewPath)) return { local: true, value: item.viewPath };
      } catch (e) {}
    }
    if (item.localPath) {
      // `existsSync` is a guard against a stale path, not a hot path: one stat
      // per image per tool call is far cheaper than a broken transcript.
      try {
        if (existsSync(item.localPath)) return { local: true, value: item.localPath };
      } catch (e) {}
    }
    if (item.remoteUrl && /^https?:\/\//i.test(item.remoteUrl)) return { local: false, value: item.remoteUrl };
    return { local: false, value: item.url };
  }

  // ── Why a local file is not enough ──────────────────────────────────────
  // THE CONVERSATION BODY NEVER REACHES THIS PLUGIN'S /images ROUTE.
  //
  // The Host parses an authored absolute path through parseFileLink() →
  // fileImages.resolve() → localPathMediaUrl() → fileMediaUrl(), which rewrites
  // it to `api/file?path=<encoded>`. That handler (SessionMediaReferences →
  // serveFile in the shipped app.asar) does exactly one thing about format:
  // `const mediaType = mime.lookup(target.displayPath)`, then streams the
  // ORIGINAL bytes. So a .tiff is answered as `image/tiff` — and Chromium has
  // no TIFF decoder, so <img> fires its error path and the transcript shows
  // 图片无法预览. The HEIC case is the same story.
  //
  // The lossless transcode inside imageFileHandler therefore only ever helps
  // the TOOL ROW, whose <img> is built from this plugin's own route. Measured
  // on the same file in the same session: 200 image/png and a rendered picture
  // through /images/?abs=…, and 图片无法预览 in the body.
  //
  // The body therefore needs a FILE the browser can decode, produced here.
  // PNG (lossless) for the fidelity formats, for the same measured reason
  // imageFileHandler uses PNG for them: WebP visibly damages thin chart lines.

  // First N bytes of a file. The magic check must not read a 60 MB TIFF into
  // memory just to look at its first four bytes.
  function headBytes(file, n) {
    try {
      var fd = openSync(file, "r");
      try {
        var buf = Buffer.alloc(n);
        var got = readSync(fd, buf, 0, n, 0);
        return buf.subarray(0, got);
      } finally {
        closeSync(fd);
      }
    } catch (e) { return null; }
  }

  async function ensureViewable(item, width) {
    var src = item && item.localPath;
    if (!src) return null;
    var e = extname(String(src)).toLowerCase();
    if (e === ".svg" || e === ".ico") return null;   // text / container formats
    if (RENDERABLE_EXTS.has(e)) return null;          // Chromium decodes it as-is
    var sh = sharpFor();
    if (!sh) return { error: "sharp 不可用，无法把 " + e + " 转成浏览器可显示的格式" };
    var keepLossless = (e === ".tif" || e === ".tiff" || e === ".bmp" || e === ".png");
    var outName = safeBaseName(basename(String(src)).replace(/\.[^.]+$/, "")) +
      "-view-" + Date.now().toString(36).slice(-4) + (keepLossless ? ".png" : ".webp");
    var out = join(autoCacheDir(), outName);
    try {
      var buf = await readFile(src);
      // Byte ceiling. The Host's api/file handler streams the file through
      // ctx.attachments.imageLimits.maxImageBytes (default 20 MB) and answers
      // 413 above it — which the transcript shows as 图片无法预览, the exact
      // symptom this function exists to remove. A TIFF chart export legitimately
      // becomes a 60 MB PNG at native size, so shrink until it fits instead of
      // gambling on the input being small.
      var w = width > 0 ? width : 0;
      var conv = null;
      for (var attempt = 0; attempt < 5; attempt++) {
        var pipe = sh(buf).rotate();
        if (w > 0) pipe = pipe.resize({ width: w, withoutEnlargement: true });
        conv = keepLossless
          ? await pipe.png({ compressionLevel: 6 }).toBuffer()
          : await pipe.webp({ quality: 92 }).toBuffer();
        if (conv.length <= VIEW_MAX_BYTES) break;
        if (w <= 0) {
          var meta = await sh(buf).metadata();
          var fullW = (meta && meta.width) || 0;
          if (!fullW) break;
          w = Math.max(1024, Math.round(fullW * 0.7));
        } else {
          w = Math.max(1024, Math.round(w * 0.7));
        }
        if (w <= 1024) break;   // already at the floor; further shrinking is pointless
      }
      if (!conv) return { error: "转码没有产出任何字节" };
      if (conv.length > VIEW_MAX_BYTES) {
        return { error: "转码后仍有 " + (conv.length / 1024 / 1024).toFixed(1) +
          "MB，超过宿主单图上限，正文会显示为加载失败" };
      }
      writeFileSync(out, conv);
      return { path: out, bytes: conv.length };
    } catch (err) {
      var sharpMsg = (err && err.message ? err.message : String(err));
      // sharp reached a codec it was not built with (HEVC-in-HEIC is the case
      // that matters here). Windows can still decode it through WIC.
      if (wicAvailable()) {
        var wicOut = out.replace(/\.[^.]+$/, "") + ".png";
        var wicW = width > 0 ? width : 2048;
        var wicErr = null;
        for (var wa = 0; wa < 4; wa++) {
          try {
            await wicToPng(src, wicOut, wicW, 60000);
            var wsz = statSync(wicOut).size;
            if (wsz <= VIEW_MAX_BYTES) return { path: wicOut, bytes: wsz, via: "wic" };
            if (wicW <= 1024) { wicErr = new Error("WIC 转码后仍有 " + (wsz / 1024 / 1024).toFixed(1) + "MB，超过宿主单图上限"); break; }
            wicW = Math.max(1024, Math.round(wicW * 0.7));
          } catch (e5) {
            wicErr = e5;
            break;
          }
        }
        return { error: sharpMsg + "；系统 WIC 兜底也失败：" + (wicErr && wicErr.message ? wicErr.message : "未知原因") };
      }
      return { error: sharpMsg };
    }
  }

  // Remote links keep their own encoding: signed CDN URLs routinely carry
  // `%2F`, `%3D`, … and re-encoding those would ask the server for a different
  // object. Only the characters that would actually break a Markdown
  // destination are touched:
  //   • whitespace and control characters must go — a raw space ends the
  //     destination;
  //   • `(` / `)` only when they are NOT balanced: micromark counts brackets
  //     while reading a destination, so `a(1).jpg` parses fine as-is and
  //     rewriting it to `a%281%29.jpg` would change the signed request path;
  //   • `<` and `>` would turn the destination into an angle-bracket span.
  function encodeRemoteDest(url) {
    var s = String(url).replace(/[\u0000-\u0020\u007f]/g, function (c) {
      return "%" + ("0" + c.charCodeAt(0).toString(16).toUpperCase()).slice(-2);
    }).replace(/[<>]/g, function (c) {
      return "%" + c.charCodeAt(0).toString(16).toUpperCase();
    });
    var depth = 0;
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) === "(") depth++;
      else if (s.charAt(i) === ")") { depth--; if (depth < 0) break; }
    }
    if (depth === 0) return s;
    return s.replace(/[()]/g, function (c) {
      return "%" + c.charCodeAt(0).toString(16).toUpperCase();
    });
  }

  function bodyDest(item) {
    var p = bodyPath(item);
    return p.local ? encodeBodyDest(p.value) : encodeRemoteDest(p.value);
  }

  // ── Why the body uses REFERENCE-style images ─────────────────────────────
  // The Host renders a streaming message through IncrementalMarkdownParser +
  // StreamingRenderer, which freezes everything but the last two blocks and
  // re-parses only the tail. A half-written `![alt](C:/…/x.jpg)` is NOT held
  // back — micromark sees plain text until the closing paren arrives, so the
  // whole path streams into the conversation character by character. Measured
  // against the shipped parser: 48 path-bearing frames for 2 inline images and
  // 241 for 10, i.e. roughly two seconds of visible `C:/Users/Administrator/…`
  // before the picture appears.
  //
  // A reference definition `[1]: C:/…/x.jpg` is a DEFINITION block, and the
  // Host's renderNode returns `null` for those (renderBlocks then filters them
  // out), so the path never reaches the DOM at all — 0 path-bearing frames for
  // the same 2 and 10 image documents. The cost is that the reference marker
  // itself streams literally for a few characters (`![图1][1` → 10 chars at
  // worst), which is the irreducible floor of any freeze-boundary scheme.
  //
  // The definition must come AFTER its reference and immediately, not hoisted
  // to the top: StreamingRenderer copies the frozen definitions into the frame
  // targets but only sees definitions that are in the CURRENT frame. Hoisting
  // every definition to the front pushed the literal peak to 101 characters
  // because the frozen tail no longer contained them.
  //
  // Labels carry a per-CALL salt, not a bare 1-based index. A bare index is
  // only unique inside one call, and one reply routinely contains several calls
  // (the delivery law asks for each batch to be its own paragraph). Two calls
  // both emitting `[1]: …` make the second group resolve to the FIRST call's
  // definition — mdast keeps the earliest definition for a repeated label — so
  // the user silently gets the same picture twice. Measured: with a bare index
  // the second call rendered image 1 again instead of image 2.
  //
  // The salt is 3 base-36 characters, so a label is 4–5 chars and the worst
  // streaming literal is `![图1][k3f1` (11 chars) instead of 8. That cost is
  // worth it: a collision is a wrong picture, not a cosmetic flicker.
  //
  // Numbering starts at `start` (default 1), not at 1 always. One reply
  // routinely carries several calls — a directory batch, then a search batch —
  // and each call numbering from 1 makes the body show TWO groups of 「图1」.
  // The user's own words: 「这次为啥从序号3开始」. The caller therefore passes
  // `start = last number + 1` for every batch after the first, and the alt text
  // runs 1..N across the whole reply. The reference label still counts from 1
  // inside the call, because the salt already keeps labels unique across calls.
  function bodyMarkdown(items, start) {
    var out = [];
    var salt = Math.random().toString(36).slice(2, 5) || "z9";
    var base = Math.floor(Number(start) || 0);
    if (!(base > 0)) base = 1;
    for (var i = 0; i < items.length; i++) {
      var label = salt + (i + 1);
      var alt = (items.length > 1 || base > 1) ? "图" + (base + i) : "图";
      out.push("![" + alt + "][" + label + "]");
      out.push("");
      out.push("[" + label + "]: " + bodyDest(items[i]));
      out.push("");
    }
    return out.join("\n").replace(/\n+$/, "");
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
      start: { type: "number", description: "可选：本批图片在正文里的起始编号，默认 1。同一次回复里分多批调用时，第二批传「上一批最后编号+1」（例如第一批 4 张就传 5），正文编号才会连续，用户才能数清一共几张" },
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
                // v1.7.2 automatic hotlink fallback:
                //   localised = the image was re-saved locally because the
                //               browser could not load the remote URL directly.
                // Both must be declared, or the runtime validator rejects the
                // entire result (additionalProperties:false) and the tool looks
                // like it returned nothing at all.
                localised: { type: "boolean" },
                blocked: { type: "boolean" },
                // The probe never got an answer (TLS/network). Neither "loadable"
                // nor proof of hotlink protection — but it cannot be shipped
                // either, so the rescue step tries it and the delivery step
                // drops it if that fails too.
                unverified: { type: "boolean" },
                // The on-disk file this item came from. The conversation body's
                // `![]()` destination is built from it (see encodeBodyDest),
                // because a root-relative `/images/?abs=…` route is rewritten by
                // the Host into `api/file?path=%2Fimages%2F` and never loads.
                localPath: { type: "string" },
                // A browser-renderable copy of localPath, produced when the
                // original format has no Chromium decoder (TIFF/HEIC). The
                // body Markdown points at THIS file: the Host's api/file route
                // streams raw bytes and would answer image/tiff, which renders
                // as 图片无法预览. Declared because additionalProperties:false
                // makes an undeclared field discard the whole result.
                viewPath: { type: "string" },
                // Why a blocked picture could not be re-saved locally. This has
                // to be declared: with additionalProperties:false an undeclared
                // field makes the runtime validator throw away the ENTIRE
                // result, and the tool then looks like it returned nothing.
                rescueError: { type: "string" },
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
        // v1.9.2 — 投递提醒就贴在返回值最上方。
        //
        // 背景（2026-10-23 事故）：投递铁律早已作为 system prompt section 常驻
        // （日志实测 "image delivery law registered (order 1500, 826 chars)"），
        // 但模型仍然「调了工具、没抄正文」，用户回「正文里没图啊」。
        // 原因不是规则缺失，而是规则离「刚拿到返回值」这一刻太远：模型看到
        // 一大段 markdown 就以为交付完成，顺手写总结收尾。
        //
        // 这条 banner 把「下一步必须做什么」放在模型视线第一行——工具结果
        // 是模型唯一一定会读到的位置，比任何常驻 section 都近。
        var n = (value && typeof value.count === "number") ? value.count : null;
        var lines = [
          "⚠️ 图片还没送达。以下 markdown 必须原样复述进你这条回复的正文，否则用户看不到任何图。",
          n !== null ? "（本批 " + n + " 张：正文里应出现 " + n + " 处 ![ ；工具行折叠，不算送达）" : "",
          "",
        ];
        if (value.markdown) lines.push(value.markdown);
        if (value.note) lines.push("", "（" + value.note + "）");
        lines.push("", "⚠️ 收尾自检：本条回复正文里 ![ 的出现次数必须 = 你声称发出的张数。");
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
          return { url: localUrl(f, width), localPath: f, name: basename(f), source: "local" };
        });
        var mode = "local";
        var note = "本地图片已通过插件内置服务直读" +
          (width > 0 ? "（默认缩到 " + width + "px 宽以便对话内渲染；需要原图传 width:0）" : "") +
          "。浏览器解不了的格式（TIFF/HEIC 等）已转成 PNG/WebP 副本写进正文，原文件保留不动。" +
          "注意：链接内含本机文件路径，转发对话或截图时请留意。";
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
          var item = {
            url: r.url, name: "", title: r.title || "", source: found.source,
            // Carried over from the health sample so the localisation step below
            // does not probe the same URLs a second time.
            blocked: r.blocked === true,
            unverified: r.unverified === true,
          };
          // Dimensions only when the source actually reported them. Writing
          // `width: undefined` is not "a missing field": the key exists with a
          // value the JSON border refuses, which kills the whole call. Bing
          // reports none, so this is the normal case for a Bing result.
          if (Number.isFinite(r.width)) item.width = r.width;
          if (Number.isFinite(r.height)) item.height = r.height;
          return item;
        });
        var mode3 = "search";
        var note3 = "图源：" + found.source +
          (found.health ? "（抽样 " + found.health.sampled + " 张，" + found.health.ok + " 张可加载" +
            (found.health.failed ? "，" + found.health.failed + " 张探测失败（未验证）" : "") + "）" : "") +
          "；交付前已逐张下载并校验字节" +
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

      // v1.7.2: AUTOMATIC fallback for hotlink-protected images.
      //
      // A remote URL can answer 200 to a plain request and still fail in the
      // browser: Huaban's CDN sits behind Tencent EdgeOne, which rejects any
      // request whose Referer is not its own domain. The conversation's <img>
      // sends Referer: http://127.0.0.1:<port>/, so such a picture renders as
      // "图片无法预览" even though the link is perfectly good.
      //
      // The check below reproduces what the browser does — request the URL with
      // a loopback Referer — and localises only the images that would be
      // blocked, so working links are left as cheap direct CDN references
      // (nothing is downloaded unnecessarily).
      if (!args.save_to && mode3 === "search") {
        // Download EVERY candidate before delivering it.
        //
        // This used to probe a handful and localise only what the probe called
        // "blocked", leaving the rest as cheap direct CDN references. That
        // optimisation shipped broken pictures: a search hit can be a dead link
        // (sinaimg answers 404 NoSuchKey) or a 307 onto a different image host,
        // and a FOUR-ITEM SAMPLE OF THIRTY-FIVE CANDIDATES never sees it. The
        // user then stares at 图片无法预览 with no way to tell which layer failed.
        //
        // Downloading everything costs one request per picture at four-way
        // concurrency (a few hundred ms for the usual 3-5 hits) and buys two
        // things: the file we deliver is proven to be an image by its own magic
        // bytes (httpGetBuffer rejects anything that is not), and the body
        // Markdown points at a local file, so no CDN expiry, redirect or
        // hotlink rule can break it later.
        pruneAutoCache();
        var fetchFail = [];
        var keptSearch = [];
        var fetchTried = 0;
        // Download in batches of eight and STOP once `want` pictures have
        // proven themselves. Downloading a whole forty-item pool to deliver
        // three pictures is wasteful, and downloading only the first three is
        // what broke 「喜羊羊」 (three hostile hosts, three 403s, nothing left).
        // Batch size eight keeps four-way concurrency saturated while bounding
        // the waste when the top of the ranking is unusable.
        var SEARCH_BATCH = 8;
        for (var po = 0; po < picked.length && keptSearch.length < want; po += SEARCH_BATCH) {
          var chunk = picked.slice(po, po + SEARCH_BATCH);
          fetchTried += chunk.length;
          await mapLimit(chunk, 4, async function (item, idx) {
            try {
              var g2 = await httpGetBuffer(item.url, "https://huaban.com/", 30000);
              var e2 = extFromType(g2.type) || extFromUrl(item.url) || ".jpg";
              var b2 = safeBaseName(item.title || item.name || ("image-" + (po + idx + 1)));
              var d2 = join(autoCacheDir(), b2 + "-" + Date.now().toString(36).slice(-4) + "-" + (po + idx) + e2);
              writeFileSync(d2, g2.body);
              item.remoteUrl = item.url;
              item.localPath = d2;
              item.bytes = g2.body.length;
              item.url = localUrl(d2, width);
              item.localised = true;
            } catch (e3) {
              // Recorded rather than swallowed: a picture nobody can load must
              // not be presented as delivered.
              item.rescueError = e3 && e3.message ? e3.message : String(e3);
            }
          });
          for (var ss = 0; ss < chunk.length; ss++) {
            if (chunk[ss].localised) keptSearch.push(chunk[ss]);
            else fetchFail.push((chunk[ss].title || String(chunk[ss].url)).slice(0, 30) + "：" + (chunk[ss].rescueError || "下载失败"));
          }
        }
        var fetchLost = fetchTried - keptSearch.length;
        // keptSearch keeps the source's own ordering, so taking the first
        // `want` of it delivers the best-ranked pictures that ACTUALLY
        // downloaded — not the first `want` regardless of whether they work.
        var wanted = keptSearch.slice(0, want);
        var over = keptSearch.length - wanted.length;
        picked = wanted;
        var bits = [];
        if (picked.length) {
          bits.push("已交付 " + picked.length + " 张（每张都验过 magic 字节）");
        }
        if (fetchLost > 0) {
          // Say so out loud, with a real reason. Silently returning a URL the
          // browser cannot load is how "search an image" ends with the user
          // staring at broken thumbnails and assuming the plugin is broken.
          bits.push(fetchLost + " 张下载失败（链接已失效或被站点拦截），已跳过不发。原因示例：" + fetchFail[0]);
        }
        if (picked.length && over > 0) bits.push("另有 " + over + " 张可用但未发（只取前 " + want + " 张）");
        if (bits.length) savedNote = "；" + bits.join("；");
        if (!picked.length) {
          throw new Error("搜图失败：图源返回的 " + fetchLost +
            " 张图片一张都下载不下来（链接失效或站点拦截）。建议换关键词或指定 source 换图源");
        }
      }

      if (args.save_to && (mode2 === "url" || mode3 === "search")) {
        var outDir = isAbsolute(args.save_to) ? args.save_to : resolve(args.save_to);
        try { mkdirSync(outDir, { recursive: true }); } catch (e) {}
        var savedOk = 0, savedFail = [];
        pruneAutoCache();
        await mapLimit(picked, 4, async function (item, si) {
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
              if (meta && Number.isFinite(meta.width) && Number.isFinite(meta.height)) {
                item.width = meta.width; item.height = meta.height;
              }
            }
            // Point the conversation at our own route instead of the expiring CDN.
            item.remoteUrl = item.url;
            item.localPath = dest;
            item.url = localUrl(dest, width);
            savedOk++;
          } catch (e) {
            savedFail.push((item.title || item.url).slice(0, 30) + ": " + (e && e.message ? e.message : String(e)));
          }
        });
        // Deliberately does NOT echo outDir: that string ends up in the visible
        // conversation, and a screenshot of it would publish the local folder
        // layout. The caller already knows the path it passed in.
        // Same rule as the branch above: a picture that was not saved has only
        // its remote URL left, and if that URL cannot load the body shows
        // "图片无法预览". Drop it and say how many.
        var keptSaved = [];
        for (var ks = 0; ks < picked.length; ks++) if (picked[ks].saved) keptSaved.push(picked[ks]);
        var droppedSaved = picked.length - keptSaved.length;
        picked = keptSaved;
        savedNote = "；已保存 " + savedOk + "/" + (savedOk + droppedSaved) + " 张到指定目录" +
          (droppedSaved ? "（" + droppedSaved + " 张下载失败已跳过不发）" : "");
        if (!picked.length) {
          throw new Error("保存失败：没有一张图片能下载（" + (savedFail[0] || "网络不可用") +
            "），已跳过不发。建议换关键词或指定 source 换图源");
        }
      }

      // Every local picture must be in a format the BROWSER can decode before
      // the Markdown names it, because the body route will not convert anything
      // (see ensureViewable). Two things happen here:
      //   • TIFF/HEIC are transcoded to a viewable copy, and the body points at
      //     that copy instead of the original;
      //   • a local file whose bytes are not an image at all (a CDN error page
      //     saved as .jpg) is dropped rather than shipped as 图片无法预览.
      pruneAutoCache();
      var convertedCount = 0;
      var viewFail = [];
      var dropView = [];
      for (var vb = 0; vb < picked.length; vb++) {
        var vItem = picked[vb];
        if (vItem.localPath) {
          var vHead = null;
          var vExt = extname(String(vItem.localPath)).toLowerCase();
          if (RENDERABLE_EXTS.has(vExt) && vExt !== ".svg" && vExt !== ".ico") {
            vHead = headBytes(vItem.localPath, 16);
            if (vHead && vHead.length >= 12 && !looksLikeImage(vHead)) {
              viewFail.push((vItem.title || basename(String(vItem.localPath))).slice(0, 30) +
                "：后缀是 " + vExt + "，内容却不是图片（多半是图源返回的错误页被当成图片保存）");
              dropView.push(vItem);
              continue;
            }
          }
        }
        var vGot = await ensureViewable(vItem, width);
        if (vGot && vGot.path) { vItem.viewPath = vGot.path; convertedCount++; }
        else if (vGot && vGot.error) { viewFail.push(vGot.error); dropView.push(vItem); }
      }
      if (dropView.length) {
        var keptView = [];
        for (var kv = 0; kv < picked.length; kv++) {
          if (dropView.indexOf(picked[kv]) === -1) keptView.push(picked[kv]);
        }
        picked = keptView;
        savedNote += "；另有 " + dropView.length + " 张本地文件不是可显示的图片或被转码失败" +
          (viewFail.length ? "（" + viewFail[0] + "）" : "") + "，已跳过不发";
        if (!picked.length) {
          throw new Error("没有一张图片能以浏览器可显示的格式交付" +
            (viewFail.length ? "：" + viewFail[0] : "") +
            "。若原图是 TIFF/HEIC，需要 sharp 转码，请确认插件依赖完整；" +
            "若提示内容不是图片，说明图源返回的是错误页，建议换关键词或指定 source 换图源");
        }
      }

      var md = bodyMarkdown(picked, args.start);

      // Last line of defence: whatever the branches above attached to an item,
      // nothing reaches the wire that the JSON border would reject.
      return lossless({
        mode: mode || mode2 || mode3,
        count: picked.length,
        markdown: md,
        images: picked,
        note: (note || note2 || note3) + savedNote,
      });
    },
  });
}

// ── 图片投递铁律（system prompt section）─────────────────────
// 用户看不到工具调用的展开内容。若模型只在工具结果里“发”图而不在对话正文写
// markdown 图片，用户滑过工具行就认为“根本没发图”。这条 section 强制：任何
// 交付图片的场景，正文里必须有一条 ![](…) ，工具行折叠不可作为交付依据。
// 关闭方式：在 profile 的 cordis patch 里给本插件加 config.injectImageLaw: false。
var IMAGE_LAW_SECTION_NAME = "image-gallery:delivery-law";
var IMAGE_LAW_SECTION_ORDER = 1500;
var IMAGE_LAW_TEXT = "## 图片投递铁律（dsh-chat-image-lightbox）\n\n**调用 display_image 不等于把图发出去了。** 工具结果在界面上被折叠成一行「已调用工具」，用户滚动正文时**什么也看不到**，只会回你一句「一张没看见」。**只有写进你自己回复文本的 `![](…)` 才算送达。**\n\n硬性要求：\n1. **必须复述**。每次 display_image 返回后，把返回的 markdown **原样抄进你正在写的这条回复正文**里。只留在工具结果里 = 违规 = 用户看不到。\n2. **表格、结论、清单都不算图**。可以配表格，但表格里的文字不能替代图片本体；正文里没有 `![` 就是没发图。\n3. **每张图各自成段**，按顺序逐个粘贴，不许写「见上文」「已发送 5 张」「图已生成」。\n4. **路径不是图，链接文字不是图**。不要把本地路径、下载链接、附件名当成图片交付。\n5. **引用式写法两行必须一起贴**：`![图1][1]` 与 `[1]: C:/…/图片.jpg` 成对出现，只贴其中一行会渲染失败。不要改写、不要加反引号、不要转成普通链接。\n6. **编号由插件决定**。一次回复分多批发图时，第二批起给 display_image 传 `start=<上一批最后编号+1>`；正文不许自己改号，否则会出现两组「图1」。\n\n**收尾自检（每次回复前必做）**：数一遍这条回复正文里 `![` 的出现次数，必须等于你声称发出的张数。不相等就补贴，或如实说明「N 张没发出去」。\n\n> 事故记录（2026-10-21）：1.8.8 的旧版铁律只写了「不得只依赖工具调用行」，模型仍把 20 张全留在工具行、正文只写了一张格式对照表，用户回「一张没看见啊」。1.8.9 起把「必须复述 + 表格不算图 + 计数自检」写死为第 1、2 条与收尾自检——**工具行折叠是界面行为，绕不过去，只能靠正文复述**。\n";

export var name = "image-gallery";
export var inject = ["webServer", "tools", "systemPrompt"];

export function apply(ctx, config) {
  var galleryRoot = DEFAULT_GALLERY_ROOT;
  ctx.logger.info("image-gallery: serving from " + galleryRoot + " (sharp: " + (sharpFor() ? "available" : "unavailable") + ")");
  ctx.effect(function() {
    var d1 = ctx.webServer.register({kind: "prefix", path: IMAGE_PREFIX, handler: imageFileHandler(galleryRoot)});
    var d2 = ctx.webServer.register({kind: "exact", path: GALLERY_API_PREFIX + "/list", handler: listHandler(galleryRoot)});
    var d3 = ctx.webServer.register({kind: "exact", path: GALLERY_API_PREFIX + "/root", handler: rootHandler(galleryRoot)});
    var d4 = ctx.webServer.register({kind: "exact", path: GALLERY_API_PREFIX + "/reveal", handler: revealHandler()});
    var d5 = ctx.webServer.register({kind: "exact", path: GALLERY_API_PREFIX + "/diag", handler: igDiagHandler()});
    return function() { d1(); d2(); d3(); d4(); d5(); };
  }, "image-gallery: routes");

  // The model-facing half: one tool that turns a local path, a remote link or a
  // keyword search into a renderable image URL.
  // 图片投递铁律：驻留 system prompt，不依赖技能加载（技能是按需加载的，
  // prompt section 是常驻的）。只放最硬的 4 条，长文留在 README。
  var injectImageLaw = !(config && config.injectImageLaw === false);
  if (injectImageLaw && ctx.systemPrompt && typeof ctx.systemPrompt.section === "function") {
    ctx.effect(function() {
      return ctx.systemPrompt.section({
        name: IMAGE_LAW_SECTION_NAME,
        order: IMAGE_LAW_SECTION_ORDER,
        text: IMAGE_LAW_TEXT
      });
    }, "image-gallery: delivery law section");
    ctx.logger.info("image-gallery: image delivery law registered (order " + IMAGE_LAW_SECTION_ORDER + ", " + IMAGE_LAW_TEXT.length + " chars)");
  } else if (injectImageLaw) {
    ctx.logger.warn("image-gallery: systemPrompt service unavailable, delivery law skipped");
  }

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
