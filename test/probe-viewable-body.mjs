// ── 探针：正文里那张图，浏览器到底解不解得开 ──────────────────────────────────
//
// 这个探针补的是一个**结构性的洞**，前面 17 个套件全绿也照样漏掉它：
//
// 插件用自己的 /images 路由把 TIFF 转成 PNG，工具行里的 <img> 因此正常；
// 但**正文**里那条 `![](C:/…/x.tiff)` 根本不走插件路由。宿主把它改写成
// `api/file?path=…`，而 serveFile 只按扩展名给 MIME、原字节直出，Chromium
// 没有 TIFF/HEIC 解码器 → 正文显示「图片无法预览」。
//
// 所以这里测的不是「插件能不能转码」（probe-dep-resolve 已测），而是
// **交付给正文的那个路径指向的文件，浏览器能不能直接渲染**：
//   • bodyPath 必须优先选 viewPath（转码副本），而不是原文件；
//   • 真的 apply() + 真的 execute()，返回值里的 markdown 必须指向 PNG/WebP；
//   • 伪装成 .jpg 的 HTML 错误页必须被剔掉，而不是发出去。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const SRC = process.env.IG_SRC || "C:/Users/Administrator/.dsh/local-plugins/dsh-chat-image-lightbox/lib/index.js";
const src = fs.readFileSync(SRC, "utf8");

const checks = [];
const chk = (label, cond, extra) => { checks.push([label, !!cond, extra]); };

// 按括号配平抠函数（跑的是被测源码本身，不是复制品）
function extractFn(header) {
  const at = src.indexOf(header);
  if (at < 0) return null;
  let i = src.indexOf("{", at), depth = 0, inStr = null, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
    if (inStr) { if (c === "\\") { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}

console.log("=== probe-viewable-body ===");
console.log("被测源码: " + SRC);
console.log("");

// ── 1. 静态：修复必须在源码里 ────────────────────────────────────────────────
chk("有 ensureViewable()（把不可渲染格式转成浏览器能解的副本）",
  src.indexOf("async function ensureViewable(item, width)") > 0);
chk("有 headBytes()（只读前 N 字节判 magic，不为 4 字节读进 60MB）",
  src.indexOf("function headBytes(file, n)") > 0);
chk("有字节上限常量 VIEW_MAX_BYTES", /var VIEW_MAX_BYTES = \d+ \* 1024 \* 1024;/.test(src));
chk("bodyPath 优先使用 viewPath", /if \(item\.viewPath\) \{/.test(src));
chk("execute 里对所有图都过一遍 ensureViewable", /await ensureViewable\(vItem, width\)/.test(src));
chk("转码副本写进 autoCacheDir（不是凭空路径）", /join\(autoCacheDir\(\), outName\)/.test(src));
chk("本地文件字节不是图片就地剔除（HTML 错误页）", /!looksLikeImage\(vHead\)/.test(src));
chk("全部不可交付时明确抛错，不是静默空回复", /没有一张图片能以浏览器可显示的格式交付/.test(src));
chk("output.schema 声明了 viewPath（additionalProperties:false 下漏了就丢整条）",
  /viewPath: \{ type: "string" \}/.test(src));

// ── 2. 行为①：bodyPath 的两条分支，直接跑被测函数 ────────────────────────────
const tmpDir = path.join(os.tmpdir(), "ig-view-probe-" + process.pid);
fs.mkdirSync(tmpDir, { recursive: true });

const reqS = createRequire(path.join(process.env.EXEPATH || process.execPath, "noop.js"));
let sharp = null;
try { sharp = reqS("sharp"); } catch (e) {
  try { sharp = createRequire("C:/Users/Administrator/.dsh/profiles/desktop/noop.js")("sharp"); } catch (e2) {}
}
chk("拿到 sharp（转码能力是这条修复的前提）", !!sharp);

let tiffPath = null, heicLikePath = null;
if (sharp) {
  tiffPath = path.join(tmpDir, "chart.tiff");
  await sharp({ create: { width: 80, height: 60, channels: 3, background: { r: 200, g: 60, b: 30 } } })
    .tiff().toFile(tiffPath);
  // 扩展名是 .heic、内容是 TIFF：sharp 按 magic 解码，这里用来验证
  // 「非无损路径 → 转 WebP」这条分支（真 HEIC 编码在部分 libvips 上不可用）。
  heicLikePath = path.join(tmpDir, "shot.heic");
  fs.copyFileSync(tiffPath, heicLikePath);
}

const bodyPathSrc = extractFn("  function bodyPath(item)");
chk("bodyPath 可从源码抠出", bodyPathSrc !== null);
if (bodyPathSrc) {
  const bodyPath = new Function("existsSync", bodyPathSrc + "\n; return bodyPath;")(fs.existsSync);
  const viewFile = path.join(tmpDir, "chart-view.png");
  fs.writeFileSync(viewFile, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64"));
  const withView = bodyPath({ viewPath: viewFile, localPath: tiffPath, url: "/images/?abs=x" });
  chk("有 viewPath 时正文指向转码副本，而不是 TIFF",
    !!withView && withView.value === viewFile && /\.png$/.test(withView.value),
    withView && String(withView.value).slice(-24));
  const stale = bodyPath({ viewPath: path.join(tmpDir, "gone.png"), localPath: tiffPath });
  chk("viewPath 已被清理时回退到原文件（不会发出死路径）",
    !!stale && stale.value === tiffPath);
  const noView = bodyPath({ localPath: tiffPath });
  chk("没有 viewPath 时仍是原文件（对照：证明上面那条不是恒真）",
    !!noView && noView.value === tiffPath);
}

// ── 3. 行为②：真的 apply()、真的 execute()，看发出去的是什么 ─────────────────
const mod = await import(pathToFileURL(SRC).href + "?view=" + Date.now());
let tool = null;
const fakeCtx = {
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  effect(fn) { const d = fn(); return () => { if (typeof d === "function") d(); }; },
  webServer: { port: 1, register() { return () => {}; } },
  systemPrompt: { section() { return () => {}; } },
  tools: { register(t) { tool = t; return () => {}; } },
};
let applyErr = null;
try { mod.apply(fakeCtx, { injectImageLaw: false }); } catch (e) { applyErr = e; }
chk("apply() 不抛错: " + (applyErr ? applyErr.message : "ok"), !applyErr);
chk("注册到 display_image 工具", !!tool && tool.name === "display_image");

const MAGIC = {
  png: "89504e47",
  jpeg: "ffd8ff",
  webp: "52494646",
};
function head(p, n = 4) {
  const fd = fs.openSync(p, "r");
  try { const b = Buffer.alloc(n); const got = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, got).toString("hex"); }
  finally { fs.closeSync(fd); }
}
const createdViews = [];

if (tool && tiffPath) {
  let res = null, err = null;
  try { res = await tool.execute({ path: tiffPath, limit: 1 }, {}); } catch (e) { err = e; }
  chk("TIFF 走本地分支不报错: " + (err ? err.message : "ok"), !err && !!res);

  if (res && res.images && res.images[0]) {
    const im = res.images[0];
    chk("返回值带 viewPath（正文要用的地址）", typeof im.viewPath === "string" && im.viewPath.length > 3);
    if (typeof im.viewPath === "string") {
      createdViews.push(im.viewPath);
      chk("viewPath 文件真实存在", fs.existsSync(im.viewPath));
      chk("viewPath 是 PNG magic（Chromium 能解）: " + head(im.viewPath), head(im.viewPath) === MAGIC.png);
      chk("viewPath 不是 .tiff 后缀", !/\.tiff?$/i.test(im.viewPath), path.extname(im.viewPath));
      chk("viewPath 大小在上限内", fs.statSync(im.viewPath).size <= 16 * 1024 * 1024);
      // 正文里的 destination 已过 encodeBodyDest：反斜杠→正斜杠，`%` 等转义。
      // 比最后一段文件名（无特殊字符）才是稳的，比整个路径会被编码差异骗。
      const md = String(res.markdown || "");
      chk("markdown 指向 viewPath（正文实际用的就是它）",
        md.indexOf(path.basename(im.viewPath)) > 0, path.basename(im.viewPath));
      chk("markdown 不含原 TIFF 路径（否则正文必坏）",
        md.indexOf(tiffPath.replace(/\\/g, "/")) < 0 && md.indexOf(tiffPath) < 0);
    }
    chk("item 仍保留 localPath（原文件不丢，下载/复查还要用）",
      typeof im.localPath === "string" && im.localPath === tiffPath);
    chk("返回值无损 JSON（DSH 闸门一）",
      JSON.stringify(JSON.parse(JSON.stringify(res))) === JSON.stringify(res));
  }

  // 扩展名 .heic → 走 WebP 分支
  if (heicLikePath) {
    let r2 = null, e2 = null;
    try { r2 = await tool.execute({ path: heicLikePath, limit: 1 }, {}); } catch (e) { e2 = e; }
    const im2 = r2 && r2.images && r2.images[0];
    chk("HEIC 分支不报错: " + (e2 ? e2.message : "ok"), !e2 && !!im2);
    if (im2 && typeof im2.viewPath === "string") {
      createdViews.push(im2.viewPath);
      chk("HEIC 转成 WEBP magic: " + head(im2.viewPath), head(im2.viewPath) === MAGIC.webp);
    }
  }

  // 本来就能渲染的格式不许被无谓转码
  {
    const pngPath = path.join(tmpDir, "plain.png");
    fs.writeFileSync(pngPath, Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      "base64"));
    const r3 = await tool.execute({ path: pngPath, limit: 1 }, {});
    chk("普通 PNG 不产生 viewPath（不做无用转码）",
      !!r3 && r3.images && r3.images[0] && !r3.images[0].viewPath);
    chk("普通 PNG 的 markdown 直接指向原文件",
      !!r3 && String(r3.markdown || "").indexOf(path.basename(pngPath)) > 0, path.basename(pngPath));
  }

  // 伪装成图片的 HTML：必须被剔掉，绝不能发出去
  {
    const fake = path.join(tmpDir, "cdn-error.jpg");
    fs.writeFileSync(fake, "\n\n\n\n<!doctype html><html><body>blocked</body></html>");
    let r4 = null, e4 = null;
    try { r4 = await tool.execute({ path: fake, limit: 1 }, {}); } catch (e) { e4 = e; }
    chk("HTML 伪装成 .jpg 被拒（不再发出去当图片）",
      !!e4 || (r4 && r4.count === 0), e4 ? e4.message.slice(0, 40) : "count=" + (r4 && r4.count));
    chk("拒的时候说明了原因（不是静默空回复）",
      !!e4 && /不是可显示的图片|不是图片|内容却/.test(e4.message), e4 && e4.message.slice(0, 80));
  }
}

// 清掉本探针在自动缓存目录里留下的转码副本
for (const f of createdViews) { try { fs.unlinkSync(f); } catch (e) {} }
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}

// ── 汇总 ────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
for (const [label, ok, extra] of checks) {
  if (ok) { pass++; console.log("  ✓ " + label + (extra !== undefined ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✗ " + label + (extra !== undefined ? "  [" + extra + "]" : "")); }
}
console.log("\n结果 " + pass + "/" + checks.length);
process.exitCode = fail === 0 ? 0 : 1;
