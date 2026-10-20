// probe-heic-real.mjs — 真 HEVC HEIC 必须真能转成浏览器可渲染的图片
//
// WHY THIS PROBE EXISTS
// ---------------------
// For three releases the suite claimed "HEIC works". It did not. The only
// .heic file on this machine is mislabelled: extension .heic, bytes
// ff d8 ff e0 … JFIF, i.e. an ordinary JPEG. The converter dutifully
// "converted" it and the assertion passed, while a genuine HEIC was never
// decoded once.
//
// The gap underneath is sharp's own build: its bundled libheif has no HEVC
// decoder. It reads the container fine
//     metadata => format=heif compression=hevc
// and then throws the instant pixels are requested
//     Support for this compression format has not been built in: HEVC
// So a metadata-only assertion is worthless here, and it is exactly the
// assertion that produced the false green.
//
// This probe therefore ships a genuine HEVC HEIC
// (test/fixtures/real-hevc.heic, ftyp brand mif1, 293608 bytes, box walk
// ftyp/meta/mdat covering the whole file) and demands PNG bytes out.

import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const PLUGIN = path.join(HERE, "..", "lib", "index.js");
const FIXTURE = path.join(HERE, "fixtures", "real-hevc.heic");

let pass = 0, fail = 0;
const failures = [];
function chk(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name + (detail ? " — " + detail : "")); console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}

console.log("── probe-heic-real: 真 HEVC HEIC 必须真能转码 ──");

// ── 1. 素材本身必须是真 HEIC，不是错标的 JPEG ─────────────────────────────
console.log("\n[1] 素材真实性（防止再拿错标文件冒充 HEIC）");
let fx = null;
try { fx = fs.readFileSync(FIXTURE); } catch (e) { fx = null; }
chk("fixture 存在", !!fx, FIXTURE);
if (fx) {
  const brand = fx.subarray(4, 8).toString("ascii") === "ftyp" ? fx.subarray(8, 12).toString("ascii") : null;
  chk("fixture 是 ISOBMFF (offset4 = ftyp)", fx.subarray(4, 8).toString("ascii") === "ftyp", "head=" + fx.subarray(0, 12).toString("hex"));
  chk("fixture brand 是 heic/heix/hevc/mif1 之一", ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(String(brand)), "brand=" + brand);
  chk("fixture 不是错标的 JPEG（不是 FFD8FF 开头）", !(fx[0] === 0xff && fx[1] === 0xd8 && fx[2] === 0xff), "head=" + fx.subarray(0, 12).toString("hex"));
  // box 结构必须完整覆盖整个文件，否则是截断下载
  let off = 0, boxes = [];
  while (off + 8 <= fx.length) {
    const size = fx.readUInt32BE(off);
    const type = fx.subarray(off + 4, off + 8).toString("ascii");
    boxes.push(type);
    if (size === 0 || size < 8) break;
    off += size;
  }
  chk("box 结构完整覆盖文件（未被截断）", off >= fx.length, "walk ended at " + off + " / " + fx.length + " boxes=" + boxes.join(","));
  chk("含 ftyp 与 mdat", boxes.includes("ftyp") && boxes.includes("mdat"), "boxes=" + boxes.join(","));
}

// ── 2. 静态断言：兜底解码器必须在位 ───────────────────────────────────────
console.log("\n[2] 源码结构：HEVC 兜底的接线是否还在");
let src = "";
try { src = fs.readFileSync(PLUGIN, "utf8"); } catch (e) {}
chk("源码可读", src.length > 1000);
chk("有 wicAvailable()", /function wicAvailable\(\)/.test(src));
chk("有 wicToPng(", /function wicToPng\(/.test(src));
chk("WIC 走 -EncodedCommand（避免引号地狱）", /"-EncodedCommand"/.test(src));
chk("ensureViewable 的 catch 里调用了 WIC 兜底", /System WIC|系统 WIC|wicToPng\(src, wicOut/.test(src));
chk("工具行 handler 的 catch 里也接了 WIC", /await wicToPng\(filePath, wicTmp/.test(src));

// ── 3. 真跑：sharp 必然失败，兜底必须成功 ────────────────────────────────
console.log("\n[3] 真跑转码（sharp 缺 HEVC 解码器，必须由 WIC 兜住）");
const mod = await import(pathToFileURL(PLUGIN).href);
const plugin = mod.default || mod;

const captured = { tools: [] };
const ctx = {
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  webServer: { port: 0, register: () => ({ dispose() {} }) },
  tools: { register: (t) => { captured.tools.push(t); } },
  systemPrompt: { section: () => ({ dispose() {} }) },
  inject: () => {},
  on: () => {},
  // apply() registers the tool inside ctx.effect(cb, label)
  effect: (cb) => { try { return cb(); } catch (e) { return undefined; } },
};
await plugin.apply(ctx, {});
chk("插件注册了 display_image 工具", captured.tools.length === 1, "count=" + captured.tools.length);

const tool = captured.tools[0];
if (tool && fx) {
  // A regression here THROWS ("没有一张图片能以浏览器可显示的格式交付"), because
  // the plugin refuses to hand over anything the browser cannot render. An
  // uncaught throw would abort the probe with a stack trace instead of a
  // readable red line, so capture it and report it as the failure it is.
  let out = null, threw = null;
  try {
    out = await tool.execute({ path: FIXTURE, width: 520 });
  } catch (e) {
    threw = e;
  }
  chk("真 HEIC 能转码而不抛错", threw === null,
    threw ? String(threw.message).split("\n")[0].slice(0, 200) : "");
  const im = out && out.images && out.images[0];
  chk("真 HEIC 没有被拒绝（返回了图片）", !!im, "note=" + String(out && out.note || "").slice(0, 200));
  if (im) {
    const vp = im.viewPath;
    chk("产出了 viewPath 副本", !!vp, "viewPath=" + vp);
    chk("viewPath 不是原 .heic（后缀已换成可渲染格式）", !!vp && !/\.heic$/i.test(vp), "viewPath=" + vp);
    chk("viewPath 指向 .png（WIC 兜底产出 PNG）", !!vp && /\.png$/i.test(vp), "viewPath=" + vp);

    if (vp && fs.existsSync(vp)) {
      const st = fs.statSync(vp);
      const fd = fs.openSync(vp, "r");
      const h = Buffer.alloc(16);
      fs.readSync(fd, h, 0, 16, 0);
      fs.closeSync(fd);
      const magic = h.subarray(0, 8).toString("hex");
      chk("副本真的存在", true, "bytes=" + st.size);
      chk("副本是真的 PNG（magic 89504e470d0a1a0a）", magic === "89504e470d0a1a0a", "magic=" + magic);
      chk("副本非空且合理（>10KB）", st.size > 10240, "bytes=" + st.size);
      chk("副本未超过宿主单图上限 16MB", st.size <= 16 * 1024 * 1024, "bytes=" + st.size);
      chk("原 .heic 未被改写", fs.statSync(FIXTURE).size === fx.length, "now=" + fs.statSync(FIXTURE).size + " was=" + fx.length);
    } else {
      chk("副本真的存在", false, "missing: " + vp);
      chk("副本是真的 PNG（magic 89504e470d0a1a0a）", false, "no file");
      chk("副本非空且合理（>10KB）", false, "no file");
      chk("副本未超过宿主单图上限 16MB", false, "no file");
      chk("原 .heic 未被改写", fs.statSync(FIXTURE).size === fx.length);
    }

    // 正文 markdown 必须指向副本，不能指向原 .heic
    const md = String(out.markdown || out.body || "");
    chk("正文 markdown 指向的是 PNG 副本而不是 .heic", !/\.heic/i.test(md) && /\.png/i.test(md), "md=" + md.slice(0, 160));
  }
}

console.log("\n" + "─".repeat(62));
console.log(fail === 0 ? `结果：${pass}/${pass} 全绿 ✅` : `结果：${pass} 通过 / ${fail} 失败 ❌`);
if (fail) { console.log("失败项："); for (const f of failures) console.log("  · " + f); }
process.exitCode = fail === 0 ? 0 : 1;
