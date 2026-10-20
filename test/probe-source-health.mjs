// 1.8.1：图源健康降级 / 转存并发 / 缓存上限 / 搜狗 forbid
//
// 这个探针回答的不是"代码长什么样"，而是"它真的会那样做吗"：纯函数被从
// lib/index.js 里按括号配平抠出来，在受控作用域里用假数据真跑一遍。
// 只有"抠出来能跑 + 假数据结果正确"才算通过，grep 到关键字不算。
import fs from "node:fs";

// SRC 可用环境变量覆盖：对旧版源码跑同一套断言，是证明"探针有鉴别力"的唯一办法
// （永远只对当前代码跑，探针全绿也可能是因为它什么都没查）。
const SRC = process.env.IG_SRC || "C:/Users/Administrator/.dsh/local-plugins/dsh-chat-image-lightbox/lib/index.js";
const src = fs.readFileSync(SRC, "utf8");

const checks = [];
const chk = (label, cond) => { checks.push([label, !!cond]); };

// ── 抠函数：按括号配平，从 `async function name(` 一直走到配平的 `}` ────────
function extractFn(header) {
  const start = src.indexOf(header);
  if (start < 0) return null;
  let i = src.indexOf("{", start);
  if (i < 0) return null;
  let depth = 0, inStr = null, inLine = false, inBlock = false, prev = "";
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === "\n") inLine = false; prev = c; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } prev = c; continue; }
    if (inStr) {
      if (c === "\\") { i++; prev = c; continue; }
      if (c === inStr) inStr = null;
      prev = c; continue;
    }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; prev = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
    prev = c;
  }
  return null;
}

// ── 静态：结构与顺序 ──────────────────────────────────────────────────────
chk("SOURCE_HEALTH_MIN 存在且为 0.3", /var SOURCE_HEALTH_MIN = 0\.3;/.test(src));
chk("SOURCES 中 Bing 排在花瓣之前", /var SOURCES = \[\s*\{ id: "bing"/.test(src));
chk("searchImages 调用了 sampleSourceHealth", /var health = await sampleSourceHealth\(clean, 4\);/.test(src));
chk("低于阈值时会记录并继续下一个源", /health\.ratio < SOURCE_HEALTH_MIN/.test(src));
chk("所有源都不达标时退回可加载率最高者", /if \(!fallback \|\| health\.ratio > fallback\.ratio\)/.test(src));
chk("退回时标记 degraded 供调用方如实告知", /return \{ images: fallback\.images, source: fallback\.source, errors: errors, degraded: true \};/.test(src));
chk("健康度报告的是抽样实测值（不是整批推算）",
  /health: \{ ok: health\.ok, sampled: health\.sampled, failed: health\.failed \}/.test(src));
chk("没有把 ratio 外推成整批数量", !/Math\.round\(health\.ratio \* clean\.length\)/.test(src));
// 1.8.3：探测失败（网络/TLS）必须与「可加载」「被拦」分开计数
chk("sampleSourceHealth 把探测失败单独计数", /else if \(p\.error\) \{ failed\+\+/.test(src));
chk("note 会如实报出探测失败张数", /张探测失败（未验证）/.test(src));
chk("搜狗 forbid 被识别为图源不可用", /\/forbid\/i\.test\(String\(data\.info \|\| ""\)\)/.test(src));
chk("已抽样的图不再重复探测", /picked\[pi\]\.blocked !== true/.test(src));
chk("转存走 4 路并发", /await mapLimit\(rescueIdx, 4, async function \(idx\)/.test(src));
chk("save_to 也走 4 路并发", /await mapLimit\(picked, 4, async function \(item, si\)/.test(src));
chk("转存失败会记 rescueError 而不是空 catch", /it\.rescueError = e3/.test(src));
chk("无法确认可加载的图不发给用户，并如实说明张数", /另有 " \+ lostCount \+ " 张无法确认可加载/.test(src));
chk("不可加载的图会被从结果里剔除", /picked\.splice\(droppedIdx\[dr\], 1\)/.test(src));
chk("全部不可加载时抛错而不是返回一屏坏图", /搜图失败：图源返回的/.test(src));
    chk("save_to 下载失败的图也不发，并说明张数", /keptSaved\.push\(picked\[ks\]\)/.test(src));
chk("httpGetText 有重试（应对 TLS 断连）", /for \(var attempt = 0; attempt < 2; attempt\+\+\)/.test(src));

// ── 行为①：mapLimit 真的并发，且顺序不乱 ──────────────────────────────────
const mapLimitSrc = extractFn("async function mapLimit(");
chk("mapLimit 可从源码抠出", mapLimitSrc !== null);

if (mapLimitSrc) {
  const mapLimit = new Function(mapLimitSrc + "\n; return mapLimit;")();
  let inflight = 0, peak = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);
  const out = await mapLimit(items, 4, async (x) => {
    inflight++;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 12));
    inflight--;
    return x * 2;
  });
  chk("mapLimit 并发峰值 = 4（不是串行）", peak === 4);
  chk("mapLimit 结果顺序与输入一致", JSON.stringify(out) === JSON.stringify(items.map((x) => x * 2)));

  // 串行会让 peak 恒为 1——用它证明这条断言有鉴别力
  let peakSerial = 0, inf2 = 0;
  const out2 = await mapLimit(items, 1, async (x) => { inf2++; peakSerial = Math.max(peakSerial, inf2); await new Promise((r) => setTimeout(r, 2)); inf2--; return x; });
  chk("limit=1 时退化为串行（峰值 1）", peakSerial === 1 && out2.length === 10);

  // 单项抛错不应吞掉整批：调用方各自 catch，这里验证错误能穿出来
  let threw = false;
  try { await mapLimit([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error("boom"); return x; }); }
  catch (e) { threw = /boom/.test(e.message); }
  chk("mapLimit 不静默吞错（调用方必须自己 catch）", threw);
}

// ── 行为②：sampleSourceHealth 的判定 ─────────────────────────────────────
const healthSrc = extractFn("async function sampleSourceHealth(");
chk("sampleSourceHealth 可从源码抠出", healthSrc !== null);

if (healthSrc) {
  const make = (probeImpl) => new Function("probeRemoteForBrowser", healthSrc + "\n; return sampleSourceHealth;")(probeImpl);

  // 4 张抽样里 3 张可加载 → 全通过，blocked 标记不落到通过的图上
  {
    const imgs = [{ url: "a" }, { url: "b" }, { url: "c" }, { url: "d" }];
    const fn = make(async (u) => ({ url: u, blocked: u === "a" }));
    const r = await fn(imgs, 4);
    chk("3/4 可加载 → ratio=0.75", r.sampled === 4 && r.ok === 3 && Math.abs(r.ratio - 0.75) < 1e-9);
    chk("只有被拦的那张带 blocked", imgs[0].blocked === true && !imgs[1].blocked && !imgs[2].blocked && !imgs[3].blocked);
  }
  // 🔴 1.8.3 实测根因：网络/TLS 探测失败曾被算成「可加载」——
  //    真搜一次 4 张里 1 张 TLS 断开，note 仍报「4 张可加载」，用户照样看到坏图。
  {
    const imgs = [{ url: "a" }, { url: "b" }, { url: "c" }, { url: "d" }];
    const fn = make(async (u) => (u === "d"
      ? { url: u, blocked: false, error: "fetch failed" }
      : { url: u, blocked: false }));
    const r = await fn(imgs, 4);
    chk("探测失败的图不计入 ok（3/4 而不是 4/4）",
      r.ok === 3 && r.failed === 1 && Math.abs(r.ratio - 0.75) < 1e-9);
    chk("探测失败不算防盗链（不给它打 blocked）", imgs[3].blocked === undefined);
  }
  // 1 张被拦 + 2 张探测失败 → 0.25 < 0.3，必须触发换源（否则用户拿到一屏坏图）
  {
    const imgs = [{ url: "a" }, { url: "b" }, { url: "c" }, { url: "d" }];
    const fn = make(async (u) => (u === "a" ? { url: u, blocked: true }
      : (u === "b" || u === "c") ? { url: u, blocked: false, error: "TLS 断开" }
        : { url: u, blocked: false }));
    const r = await fn(imgs, 4);
    chk("1 拦 + 2 探测失败 → ok=1 / failed=2 / ratio=0.25（低于 0.3 换源）",
      r.ok === 1 && r.blocked === 1 && r.failed === 2 && Math.abs(r.ratio - 0.25) < 1e-9);
  }
  // 全被拦（花瓣 567 现场的等价输入）→ ratio=0，调用方据此换源
  {
    const imgs = [{ url: "a" }, { url: "b" }];
    const r = await make(async (u) => ({ url: u, blocked: true }))(imgs, 4);
    chk("全部被拦 → ratio=0（触发换源）", r.ratio === 0 && imgs.every((x) => x.blocked === true));
  }
  // 空列表不能被当成"健康"以外的东西，也不能除零
  {
    const r = await make(async () => ({ blocked: false }))([], 4);
    chk("空列表 → sampled=0 且 ratio=1（不除零、不误判）", r.sampled === 0 && r.ratio === 1);
  }
  // cap 生效：只要 4 张样本，不是全量探测
  {
    const imgs = Array.from({ length: 20 }, (_, i) => ({ url: "u" + i }));
    let calls = 0;
    const r = await make(async (u) => { calls++; return { url: u, blocked: false }; })(imgs, 4);
    chk("cap=4 时只探测 4 张（不整批探测）", calls === 4 && r.sampled === 4);
  }
}

// ── 行为③：pruneAutoCache 的上限与最旧优先 ───────────────────────────────
const pruneSrc = extractFn("function pruneAutoCache(");
chk("pruneAutoCache 可从源码抠出", pruneSrc !== null);
chk("pruneAutoCache 会真的删文件", /unlinkSync\(rows\[idx\]\.path\)/.test(pruneSrc || ""));

if (pruneSrc) {
  // 造一个假文件系统：path -> {mtime, size}
  function runPrune(files, caps) {
    const state = new Map(files.map((f) => [f.name, { mtime: f.mtime, size: f.size }]));
    const d = {
      autoCacheDir: () => "CACHE",
      readdirSync: () => [...state.keys()],
      statSync: (p) => {
        const name = p.slice("CACHE/".length);
        const f = state.get(name);
        if (!f) throw new Error("ENOENT " + p);
        return { isFile: () => true, mtimeMs: f.mtime, size: f.size };
      },
      unlinkSync: (p) => { state.delete(p.slice("CACHE/".length)); },
      join: (a, b) => a + "/" + b,
      AUTO_CACHE_MAX_BYTES: caps.bytes,
      AUTO_CACHE_MAX_FILES: caps.files,
    };
    const fn = new Function(
      "autoCacheDir", "readdirSync", "statSync", "unlinkSync", "join",
      "AUTO_CACHE_MAX_BYTES", "AUTO_CACHE_MAX_FILES",
      pruneSrc + "\n; return pruneAutoCache;",
    )(d.autoCacheDir, d.readdirSync, d.statSync, d.unlinkSync, d.join, d.AUTO_CACHE_MAX_BYTES, d.AUTO_CACHE_MAX_FILES);
    return { r: fn(), left: [...state.keys()] };
  }

  // 600 × 1MB：文件数超限，应删到 500
  {
    const files = Array.from({ length: 600 }, (_, i) => ({ name: "f" + i, mtime: 1000 + i, size: 1024 * 1024 }));
    const { r, left } = runPrune(files, { bytes: 512 * 1024 * 1024, files: 500 });
    chk("600 文件 → 删到 500", r.removed === 100 && left.length === 500 && r.files === 500);
    chk("删的是最旧的（f0..f99 消失，f599 还在）", !left.includes("f0") && !left.includes("f99") && left.includes("f599"));
  }
  // 100 × 10MB = 1000MB：字节超限，应删到 ≤512MB
  {
    const files = Array.from({ length: 100 }, (_, i) => ({ name: "g" + i, mtime: 1000 + i, size: 10 * 1024 * 1024 }));
    const { r, left } = runPrune(files, { bytes: 512 * 1024 * 1024, files: 500 });
    chk("1000MB → 删到 ≤512MB", r.bytes <= 512 * 1024 * 1024 && left.length === 51 && r.removed === 49);
  }
  // 未超限时一个都不许删
  {
    const files = Array.from({ length: 100 }, (_, i) => ({ name: "h" + i, mtime: 1000 + i, size: 1024 * 1024 }));
    const { r, left } = runPrune(files, { bytes: 512 * 1024 * 1024, files: 500 });
    chk("100MB / 100 文件 → 一个都不删", r.removed === 0 && left.length === 100);
  }
  // 空目录不能崩
  {
    const { r } = runPrune([], { bytes: 512 * 1024 * 1024, files: 500 });
    chk("空缓存目录 → removed=0 不抛错", r.removed === 0 && r.files === 0);
  }
  // 删单个文件失败不能中断整轮（Windows 上文件可能被占用）
  {
    const files = Array.from({ length: 600 }, (_, i) => ({ name: "k" + i, mtime: 1000 + i, size: 1024 * 1024 }));
    const state = new Map(files.map((f) => [f.name, { mtime: f.mtime, size: f.size }]));
    const fn = new Function(
      "autoCacheDir", "readdirSync", "statSync", "unlinkSync", "join",
      "AUTO_CACHE_MAX_BYTES", "AUTO_CACHE_MAX_FILES",
      pruneSrc + "\n; return pruneAutoCache;",
    )(
      () => "CACHE",
      () => [...state.keys()],
      (p) => { const f = state.get(p.slice(6)); return { isFile: () => true, mtimeMs: f.mtime, size: f.size }; },
      (p) => { throw new Error("EBUSY"); },
      (a, b) => a + "/" + b,
      512 * 1024 * 1024,
      500,
    );
    const r = fn();
    chk("删不动时不崩（EBUSY 被吞，其余继续尝试）", r && r.removed === 0 && r.files === 600);
  }
}

// ── 行为④：正文拼装没被这轮改动碰到（m00800 保护对象） ───────────────────
const bodySrc = extractFn("function bodyMarkdown(");
chk("bodyMarkdown 仍是引用式两行结构", /out\.push\("!\[" \+ alt \+ "\]\[" \+ label \+ "\]"\)/.test(bodySrc || ""));
chk("bodyMarkdown 仍带 salt（防标签冲突）", /var salt = Math\.random\(\)/.test(bodySrc || ""));
chk("localUrl 未被改成绝对 URL（desktop 下会跨源失败）", /baseUrl\(\) \+ IMAGE_PREFIX \+ "\/\?abs="/.test(src));

// ── 汇总 ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
for (const [label, ok] of checks) {
  if (ok) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label); }
}
console.log(`\n结果 ${pass}/${checks.length}`);
process.exit(fail === 0 ? 0 : 1);
