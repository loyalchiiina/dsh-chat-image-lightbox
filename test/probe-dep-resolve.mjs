// 1.8.4：依赖解析 + 代理绕过 + 转码链路
//
// 这一版修的两个故障都发生在「插件能跑起来但功能静默失效」这一层，而且都是
// 我把插件改成目录 Junction 之后自己造的：
//
//   ① createRequire(import.meta.url)("sharp") → 找不到
//      Node 按模块的**真实路径**往上找，而插件被 Junction 指到
//      .dsh/local-plugins/，sharp / undici 其实在 profiles/<name>/node_modules。
//      症状：启动日志 `sharp: unavailable`，所有 TIFF/HEIC 显示「图片无法预览」。
//      旧探针从没查过这件事——它们只测函数行为，不测「依赖到底加载到了没有」。
//
//   ② 想走"直连"却走不掉
//      本机 NODE_USE_ENV_PROXY=1，Node 全局 fetch 会自动套用 HTTPS_PROXY，
//      不传 dispatcher 并不等于"不走代理"。duitang 这类只认直连的站点因此
//      被判成"探测失败"，可加载的图被当成坏图剔掉。
//      修法：直连用 node:https + 显式 Agent（完全无视 env），不用 undici。
//
// 本探针分三层：静态断言（结构还在）→ 行为断言（真的能加载）→ 端到端
// （真起 HTTP 服务请求一次，只认 content-type 与 magic bytes）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const SRC = process.env.IG_SRC || "C:/Users/Administrator/.dsh/local-plugins/dsh-chat-image-lightbox/lib/index.js";
const src = fs.readFileSync(SRC, "utf8");

const checks = [];
const chk = (label, ok, extra) => { checks.push([label, !!ok, extra]); };

// ── 静态：依赖解析不再依赖 import.meta.url 的目录 ──────────────────────────
chk("有 resolveDep 多根解析器", /function resolveDep\(name\)/.test(src));
chk("有 loadDep 封装", /function loadDep\(name\)/.test(src));
chk("解析根包含 EXEPATH（宿主给的 profile 线索）", /process\.env\.EXEPATH/.test(src));
chk("解析根包含 process.execPath", /process\.execPath/.test(src));
chk("sharp 不再用 createRequire(import.meta.url) 直接加载",
  !/createRequire\(import\.meta\.url\)\("sharp"\)/.test(src));
chk("undici 不再用 createRequire(import.meta.url) 直接加载",
  !/createRequire\(import\.meta\.url\)\("undici"\)/.test(src));
chk("sharp 走 loadDep", /__sharp = loadDep\("sharp"\)/.test(src));
chk("undici 走 loadDep", /__undici = loadDep\("undici"\)/.test(src));

// ── 静态：直连必须用显式 Agent，不能靠 fetch 的默认行为 ────────────────────
chk("有 rawDirectGet 直连实现", /function rawDirectGet\(/.test(src));
chk("rawDirectGet 用 node:https 的 Agent", /new https\.Agent\(/.test(src));
chk("rawDirectGet 不经过 fetch（不受 NODE_USE_ENV_PROXY 影响）",
  (() => {
    const at = src.indexOf("function rawDirectGet(");
    const seg = src.slice(at, src.indexOf("\n// Get a URL as bytes", at) + 1);
    return at > 0 && seg.length > 100 && !/\bfetch\s*\(/.test(seg);
  })());
chk("rawDirectGet 自带重定向上限", /hops >= 5/.test(src));
chk("有 getBytes 双路取字节（先 runtime 再直连）", /async function getBytes\(/.test(src));
chk("getBytes 里 HTTP 状态视为答案（不换路重试）",
  /status: res\.status, headers: hdrs, body: body, route: "runtime"/.test(src));
chk("httpGetText / httpGetBuffer / probeRemoteForBrowser 都改走 getBytes",
  /var got = await getBytes\(url, headers, timeoutMs\);/.test(src) &&
  (src.match(/await getBytes\(url, headers/g) || []).length >= 3);
chk("旧的 fetchProxyThenDirect 已删除（它靠 undici.Agent，直连是假的）",
  !/function fetchProxyThenDirect/.test(src));

// ── 行为：真的把依赖加载起来 ───────────────────────────────────────────────
const mod = await import(pathToFileURL(SRC).href + "?dep=" + Date.now());

// 通过插件的真实注册流程拿一条路由，顺带证明 apply() 不炸。
const routes = [];
const fakeCtx = {
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  effect(fn) { const d = fn(); return () => { if (typeof d === "function") d(); }; },
  webServer: { port: 0, register(spec) { routes.push(spec); return () => {}; } },
  systemPrompt: { section() { return () => {}; } },
  tools: { register() { return () => {}; } },
};
let applyErr = null;
try { mod.apply(fakeCtx, { injectImageLaw: false }); } catch (e) { applyErr = e; }
chk("apply() 在 Junction 布局下不抛错: " + (applyErr ? applyErr.message : "ok"), !applyErr);

// ── 端到端：真起服务，请求一次，只认字节 ───────────────────────────────────
const server = http.createServer((req, res) => {
  for (const r of routes) {
    const hit = r.kind === "exact"
      ? req.url.split("?")[0] === r.path
      : req.url.startsWith(r.path);
    if (hit) return r.handler(req, res);
  }
  res.writeHead(404); res.end("no route");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const BASE = "http://127.0.0.1:" + PORT + "/images/?abs=";

async function get(u) {
  const r = await fetch(u, { signal: AbortSignal.timeout(60000) });
  const b = Buffer.from(await r.arrayBuffer());
  return { status: r.status, type: String(r.headers.get("content-type") || ""), bytes: b.length, head: b.slice(0, 4).toString("hex") };
}

// 现场造一个真 TIFF —— 不依赖任何外部素材，探针在任何机器上都能跑。
const tmpDir = path.join(os.tmpdir(), "ig-dep-probe-" + process.pid);
fs.mkdirSync(tmpDir, { recursive: true });
let tiffPath = null;
// 素材用 profile 里的 sharp 造（探针自己的依赖），被测点是插件能不能自己找到它。
{
  const reqS = createRequire(path.join(process.env.EXEPATH || process.execPath, "noop.js"));
  let sharpP = null;
  try { sharpP = reqS("sharp"); } catch (e) {
    try { sharpP = createRequire("C:/Users/Administrator/.dsh/profiles/desktop/noop.js")("sharp"); } catch (e2) {}
  }
  if (sharpP) {
    tiffPath = path.join(tmpDir, "probe.tiff");
    await sharpP({ create: { width: 64, height: 48, channels: 3, background: { r: 20, g: 120, b: 200 } } }).tiff().toFile(tiffPath);
  }
}
chk("能造出测试用 TIFF 素材（说明 sharp 真的拿到了）", !!tiffPath && fs.existsSync(tiffPath));

if (tiffPath) {
  const r = await get(BASE + encodeURIComponent(tiffPath));
  chk("TIFF 请求返回 200", r.status === 200, "status=" + r.status);
  chk("TIFF 被转成 PNG（content-type）: " + r.type, r.type.indexOf("image/png") === 0);
  chk("TIFF 响应字节是 PNG magic: " + r.head, r.head === "89504e47");

  const raw = await get(BASE + encodeURIComponent(tiffPath) + "&raw=1");
  chk("?raw=1 保住原始 TIFF magic（下载用）: " + raw.head, raw.head === "49492a00");
}

// ── 行为：本来就能渲染的格式不许被无谓转码 ────────────────────────────────
{
  const pngPath = path.join(tmpDir, "probe.png");
  // 1x1 PNG，不依赖 sharp
  fs.writeFileSync(pngPath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64"));
  const r = await get(BASE + encodeURIComponent(pngPath));
  chk("PNG 原样返回 image/png", r.type.indexOf("image/png") === 0, r.type);
}

// 关服必须先掐掉 keep-alive 连接：带着活动连接 process.exit 会在 libuv 里
// 撞 !(handle->flags & UV_HANDLE_CLOSING) 断言，让 23/23 的探针变成退出码 127。
try { if (server.closeAllConnections) server.closeAllConnections(); } catch (e) {}
await new Promise(function (r) { server.close(function () { r(); }); });
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}

// ── 汇总 ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
for (const [label, ok, extra] of checks) {
  if (ok) { pass++; console.log("  ✓ " + label + (extra !== undefined ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✗ " + label + (extra !== undefined ? "  [" + extra + "]" : "")); }
}
console.log(`\n结果 ${pass}/${checks.length}`);
// 不用 process.exit：libuv 在还有异步请求在飞时退出会撞
// !(handle->flags & UV_HANDLE_CLOSING) 断言（Windows），把 23/23 变成 127。
process.exitCode = fail === 0 ? 0 : 1;
