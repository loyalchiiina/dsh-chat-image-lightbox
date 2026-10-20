// ── 探针：交付链路的「内容完整性」 ────────────────────────────────────────────
//
// 这个探针存在的理由，是验收时真发图才发现的两件事：
//
// ① 一个「转存成功」的缓存文件 image-4-go3m.jpg，14 KB，handler 按
//    content-type 标成 image/jpeg 发出去，浏览器解不开 → 「图片无法预览」。
//    打开一看开头是 `0a0a0a0a<!doctype html>`：CDN 的错误页，HTTP 200、
//    content-type 还写着 image/jpeg。每一层都只看状态码和 content-type，
//    所以整整一屏坏图没有任何一层报错。
// ② 文件名带 `%` 时 `?abs=` 被解码两次：`折扣50%的图.jpg` 直接抛
//    URIError 把请求打死，`a%20b.jpg` 静默变 `a b.jpg` 变 404。
//
// 两条都是「看起来成功了，发出去的却是坏图」，和之前 sharp/undici 那条
// 属于同一类：**没有一层去验证真正要交付的东西**。
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const SRC = process.env.IG_SRC || "C:/Users/Administrator/.dsh/local-plugins/dsh-chat-image-lightbox/lib/index.js";
const src = fs.readFileSync(SRC, "utf8");

let n = 0, fail = 0;
function chk(label, cond) {
  n++;
  if (cond) console.log("  ✓ " + label);
  else { fail++; console.log("  ✗ " + label); }
}
console.log("=== probe-serve-integrity ===");
console.log("被测源码: " + SRC);
console.log("");

// 从源码里按括号配平抠出同步函数（不复制逻辑，跑的是被测代码本身）。
function extractFn(header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error("找不到: " + header);
  let i = src.indexOf("{", start), depth = 0, inStr = null, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], nx = src[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inBlock) { if (c === "*" && nx === "/") { inBlock = false; i++; } continue; }
    if (inStr) { if (c === "\\") { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "/" && nx === "/") { inLine = true; i++; continue; }
    if (c === "/" && nx === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("未配平: " + header);
}

// ── 1. 静态结构：这两处修复必须在源码里 ──────────────────────────────────────
chk("有 looksLikeImage()（按 magic 字节判断，不信 content-type）", src.indexOf("function looksLikeImage(buf)") > 0);
chk("httpGetBuffer 会拒绝非图片字节", /if\s*\(!looksLikeImage\(got\.body\)\)/.test(src));
chk("拒绝后不再重试（重试拿到的是同一张 HTML）", /不是图片/.test(src) && /break;/.test(src));
chk("probeRemoteForBrowser 也按真实字节判定", /var looksReal = looksLikeImage\(got\.body\)/.test(src));
chk("probeRemoteForBrowser 把 realBytes 一起返回", /realBytes: looksReal/.test(src));
chk("handler 拒绝「后缀是图片但字节不是」的文件（415）", /415, \{"content-type": "text\/plain/.test(src));
chk("svg/ico 豁免 magic 检查（它们是文本/容器格式）", /ext !== "\.svg" && ext !== "\.ico"/.test(src));
chk("?abs= 不再无条件 decodeURIComponent 两次", /filePath = resolve\(absParam\);/.test(src));
chk("真实路径不存在时才尝试再解一次", /if \(!existsSync\(filePath\)\)/.test(src));
chk("二次解码抛错时答 400 而不是把请求打死", /res\.writeHead\(400, \{"content-type": "text\/plain/.test(src));

// ── 2. 行为：looksLikeImage 对七种真格式说 yes，对 HTML 说 no ────────────────
const looksLikeImage = new Function("return " + extractFn("function looksLikeImage(buf)"))();

const samples = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48]),
  gif: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0]),
  webp: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]),
  tiffLE: Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  tiffBE: Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0]),
  bmp: Buffer.from([0x42, 0x4d, 0x36, 0x00, 0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  avif: Buffer.from([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0]),
  // 真事：这次验收里被当作 .jpg 发出去的那个文件的开头
  htmlBlockPage: Buffer.from("\n\n\n\n\n\n\n<!doctype html>\n<html>", "utf8"),
  htmlBingBlock: Buffer.from("<html><head><meta charset=\"utf-8\" />", "utf8"),
  jsonError: Buffer.from('{"error":"forbidden"}', "utf8"),
  empty: Buffer.alloc(0),
};

for (const k of ["jpeg", "png", "gif", "webp", "tiffLE", "tiffBE", "bmp", "avif"]) {
  chk("looksLikeImage 认 " + k, looksLikeImage(samples[k]) === true);
}
for (const k of ["htmlBlockPage", "htmlBingBlock", "jsonError", "empty"]) {
  chk("looksLikeImage 拒 " + k, looksLikeImage(samples[k]) === false);
}

// ── 3. 行为：httpGetBuffer 真的会把「200 + image/jpeg + HTML」判死 ────────────
// 抠 httpGetBuffer 需要 getBytes / BROWSER_UA，这里注入一个假 getBytes 直接喂
// 三种响应，验的是「拿到字节之后那几行判断」而非网络。
const httpGetBufferSrc = extractFn("async function httpGetBuffer(url, referer, timeoutMs)");
const makeHttpGetBuffer = new Function("getBytes", "BROWSER_UA", "looksLikeImage",
  httpGetBufferSrc + "\nreturn httpGetBuffer;");

async function feed(status, ctype, body) {
  const fakeGet = async () => ({ status, headers: { "content-type": ctype }, body, route: "test" });
  const fn = makeHttpGetBuffer(fakeGet, "UA", looksLikeImage);
  try {
    const r = await fn("http://example/x.jpg", null, 1000);
    return { ok: true, type: r.type, len: r.body.length };
  } catch (e) {
    return { ok: false, msg: String(e && e.message || e) };
  }
}

const t1 = await feed(200, "image/jpeg", samples.jpeg);
chk("真 JPEG 放行", t1.ok === true && t1.type === "image/jpeg" && t1.len === samples.jpeg.length);

const t2 = await feed(200, "image/jpeg", samples.htmlBlockPage);
chk("200 + image/jpeg + HTML → 拒绝并说明原因: " + (t2.ok ? "(竟然放行了)" : t2.msg.slice(0, 40)),
    t2.ok === false && /不是图片/.test(t2.msg));

const t3 = await feed(200, "text/html", samples.htmlBingBlock);
chk("200 + text/html + HTML → 拒绝", t3.ok === false && /不是图片/.test(t3.msg));

const t4 = await feed(200, "", samples.png);
chk("没有 content-type 但字节是 PNG → 放行（字节比声明可信）", t4.ok === true);

const t5 = await feed(567, "text/html", samples.htmlBlockPage);
chk("567 → 拒绝且报 HTTP 567", t5.ok === false && /HTTP 567/.test(t5.msg));

// ── 4. 端到端：真起服务，验「含 % 的文件名」与「伪装文件」────────────────────
const routes = [];
const fakeCtx = {
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  effect(fn) { const d = fn(); return () => { if (typeof d === "function") d(); }; },
  webServer: { port: 0, register(spec) { routes.push(spec); return () => {}; } },
  systemPrompt: { section() { return () => {}; } },
  tools: { register() { return () => {}; } },
};
const mod = await import(pathToFileURL(SRC).href + "?serve=" + Date.now());
mod.apply(fakeCtx, { injectImageLaw: false });

const server = http.createServer((req, res) => {
  for (const r of routes) {
    const hit = r.kind === "exact" ? req.url.split("?")[0] === r.path : req.url.startsWith(r.path);
    if (hit) return r.handler(req, res);
  }
  res.writeHead(404); res.end("no route");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port + "/images/?abs=";

const tmp = path.join(os.tmpdir(), "ig-integrity-" + process.pid);
fs.mkdirSync(tmp, { recursive: true });

// 真 PNG（8x8 纯色，手写最小合法 PNG，不依赖 sharp）
function tinyPng() {
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(8 * (1 + 8 * 3));
  for (let y = 0; y < 8; y++) {
    const off = y * (1 + 8 * 3);
    raw[off] = 0;
    for (let x = 0; x < 8; x++) { raw[off + 1 + x * 3] = 30; raw[off + 2 + x * 3] = 120; raw[off + 3 + x * 3] = 200; }
  }
  const zlib = createRequire(import.meta.url)("node:zlib");
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const pngBytes = tinyPng();
const weirdNames = ["normal.png", "a%20b.png", "折扣50%的图.png", "50%off.png"];
for (const nm of weirdNames) fs.writeFileSync(path.join(tmp, nm), pngBytes);

const fakeJpg = path.join(tmp, "disguised.jpg");
fs.writeFileSync(fakeJpg, samples.htmlBlockPage);

async function get(p) {
  const r = await fetch(BASE + encodeURIComponent(p), { signal: AbortSignal.timeout(30000) });
  const b = Buffer.from(await r.arrayBuffer());
  return { status: r.status, type: String(r.headers.get("content-type") || "").split(";")[0].trim(), body: b };
}

for (const nm of weirdNames) {
  const r = await get(path.join(tmp, nm));
  chk("文件名含 % 能取到: " + nm + " → " + r.status,
      r.status === 200 && r.type === "image/png" && r.body.slice(0, 4).toString("hex") === "89504e47");
}

const rd = await get(fakeJpg);
chk("伪装成 .jpg 的 HTML 被拒（415，不是悄悄发出去）: " + rd.status, rd.status === 415);
chk("拒绝时说明真实原因（不是图片）", /不是图片/.test(rd.body.toString("utf8")));

server.closeAllConnections();
await new Promise((r) => server.close(r));
fs.rmSync(tmp, { recursive: true, force: true });

console.log("");
console.log((fail === 0 ? "全部通过 " : "失败 " + fail + " 项，") + n + " 项");
process.exitCode = fail === 0 ? 0 : 1;
