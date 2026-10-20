// 1.8.2：工具返回值必须同时过 DSH 的两道闸门（JSON 无损 + output.schema）
//
// 这一版是被两个真实故障逼出来的，两个都只在「真正调用工具」时才暴露：
//   ① tool "display_image" returned invalid output: value is not lossless JSON
//      Bing 不返回宽高 → picked 里出现 `width: undefined`；DSH 的 visitJsonValue
//      遇到嵌套 undefined 直接判 false，整条结果作废，一张图都到不了。
//   ② value.images[0].rescueError is not a declared property (additionalProperties:false)
//      1.8.1 新加的 rescueError 忘了在 output.schema 里声明 → 整条结果被校验器丢弃。
//
// 教训：旧探针都只调 searchImages 这一层函数，从不构造真实工具返回值，所以
// 1.8.1 十四条套件全绿，用户一重启搜图 100% 报错。本探针补的就是这一层——
// 真的 apply() 注册工具、真的调 execute()，再拿返回值去过两道闸门。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SRC = process.env.IG_SRC || "C:/Users/Administrator/.dsh/local-plugins/dsh-chat-image-lightbox/lib/index.js";
const src = fs.readFileSync(SRC, "utf8");
const ONLINE = process.env.IG_TOOL_ONLINE === "1";

const checks = [];
const chk = (label, cond) => { checks.push([label, !!cond]); };

// ── 抠函数 / 抠对象：按括号配平 ─────────────────────────────────────────────
function findBlock(text, from) {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0, i = start, inStr = null, inLine = false, inBlock = false;
  for (; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
    if (inStr) { if (c === "\\") { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return { text: text.slice(start, i + 1), start, end: i + 1 }; }
  }
  return null;
}
// 抠函数必须**含函数头**：从 header 一直切到配平的 `}`。只切 `{...}` 的话，
// new Function 拿到的是一段裸语句，第一次跑就报 "value is not defined"。
function extractFn(header) {
  const at = src.indexOf(header);
  if (at < 0) return null;
  const b = findBlock(src, at);
  return b ? src.slice(at, b.end) : null;
}
function extractBlock(text, marker) {
  if (!text) return null;
  const b = findBlock(text, text.indexOf(marker));
  return b ? b.text : null;
}
// properties 块顶层的键名（深度 0 上的 `name:`）
function topLevelKeys(block) {
  const body = block.slice(1, -1);
  const keys = [];
  let depth = 0, inStr = null, inLine = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i], n = body[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inStr) { if (c === "\\") { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "{" || c === "[" || c === "(") { depth++; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; continue; }
    if (depth === 0 && (c === "\n" || c === "," || c === " ")) {
      const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i));
      if (m) { keys.push(m[1]); i += m[0].length - 1; }
    }
  }
  return keys;
}

// ── 复刻 DSH 的两道闸门（语义照抄 app.asar 的 visitJsonValue / 校验器） ─────
function isLosslessJson(value, ancestors = new Set()) {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(value) && !Object.is(value, -0);
  if (t !== "object") return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      if (Reflect.ownKeys(value).length !== value.length + 1) return false;
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i) || !isLosslessJson(value[i], ancestors)) return false;
      }
      return true;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return false;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || d.enumerable !== true) return false;
      if (!isLosslessJson(Reflect.get(value, key), ancestors)) return false;
    }
    return true;
  } finally { ancestors.delete(value); }
}

function validateSchema(schema, value, at = "value", errs = []) {
  if (!schema) return errs;
  if (schema.type) {
    const t = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    if (t !== schema.type) errs.push(`${at} expected ${schema.type}, got ${t}`);
  }
  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const props = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!Object.hasOwn(props, k)) errs.push(`${at}.${k} is not a declared property (additionalProperties: false)`);
      }
    }
    for (const k of Object.keys(props)) {
      if (Object.hasOwn(value, k)) validateSchema(props[k], value[k], `${at}.${k}`, errs);
    }
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) validateSchema(schema.items, value[i], `${at}[${i}]`, errs);
  }
  return errs;
}

// ── 静态①：execute 附着到 item 的每个字段都必须在 output.schema 里声明 ──────
const executeBody = extractFn("async execute(args, exec)");
chk("execute 体可从源码抠出", executeBody !== null);

const attached = new Set();
if (executeBody) {
  const re = /\.([A-Za-z_$][\w$]*)\s*=\s*(?!=)/g;
  let m;
  while ((m = re.exec(executeBody))) attached.add(m[1]);
}
const toolBlock = extractFn("return defineTool(");
const imagesBlock = extractBlock(toolBlock, "images:");
const itemsBlock = extractBlock(imagesBlock, "items:");
const propsBlock = extractBlock(itemsBlock, "properties:");
const declared = propsBlock ? new Set(topLevelKeys(propsBlock)) : new Set();

chk("output.schema.images.items.properties 可被解析", declared.size >= 10);
chk("execute 里没有附着字段却未声明的 item 属性",
  [...attached].every((f) => declared.has(f)));
chk("1.8.1 的 rescueError 已补进 schema（本次回归的根因之一）", declared.has("rescueError"));
chk("schema 覆盖了真实用到的字段（抽样核对）",
  ["url", "title", "width", "height", "bytes", "saved", "remoteUrl", "localised", "blocked", "localPath"]
    .every((f) => declared.has(f)));

// ── 静态②：搜索映射不再写出 undefined（本次回归的另一个根因） ───────────────
chk("搜索映射不再写 width: … : undefined", !/width: typeof r\.width === "number" \? r\.width : undefined/.test(src));
chk("搜索映射不再写 height: … : undefined", !/height: typeof r\.height === "number" \? r\.height : undefined/.test(src));
chk("维度只在 Number.isFinite 时写入", /if \(Number\.isFinite\(r\.width\)\) item\.width = r\.width;/.test(src));
chk("返回值经过 lossless() 兜底", /return lossless\(\{/.test(src));
chk("lossless / truncateSafe 均已定义", /function lossless\(value, ancestors\)/.test(src) && /function truncateSafe\(s, n\)/.test(src));
chk("标题不再用裸 slice（会切断代理对）", !/stripTags\([^)]*\)\.slice\(0, 80\)/.test(src));
chk("readImageMeta 的宽高只在有限数时写入", /Number\.isFinite\(meta\.width\) && Number\.isFinite\(meta\.height\)/.test(src));

// ── 行为①：lossless() 真跑（抠出来在受控作用域里执行） ──────────────────────
const losslessSrc = extractFn("function lossless(value, ancestors)");
const truncateSrc = extractFn("function truncateSafe(s, n)");
chk("lossless 可从源码抠出", losslessSrc !== null);
chk("truncateSafe 可从源码抠出", truncateSrc !== null);

if (losslessSrc && truncateSrc) {
  const lossless = new Function(losslessSrc + "\n; return lossless;")();
  const truncateSafe = new Function(truncateSrc + "\n; return truncateSafe;")();

  const cleaned = lossless({
    keep: 1, str: "中", zero: 0, no: false, nil: null,
    dead: undefined, nan: NaN, inf: Infinity, neg: -0,
    arr: [1, undefined, NaN, "x"],
    nested: { a: undefined, b: 2, deep: { c: Infinity, d: "d" } },
  });
  chk("undefined 值被删掉（不是留成 null）", !Object.hasOwn(cleaned, "dead"));
  chk("NaN / Infinity / -0 被删掉", !Object.hasOwn(cleaned, "nan") && !Object.hasOwn(cleaned, "inf") && !Object.hasOwn(cleaned, "neg"));
  chk("正常值原样保留", cleaned.keep === 1 && cleaned.str === "中" && cleaned.nil === null && cleaned.no === false);
  chk("数组里的坏值补成 null（长度不变）", JSON.stringify(cleaned.arr) === "[1,null,null,\"x\"]");
  chk("嵌套对象同样被清理", !Object.hasOwn(cleaned.nested, "a") && !Object.hasOwn(cleaned.nested.deep, "c") && cleaned.nested.deep.d === "d");
  chk("清理后的值通过无损 JSON 检查", isLosslessJson(cleaned));
  chk("清理前的值确实不通过（证明上面这条不是白给）", isLosslessJson({ dead: undefined }) === false);

  const cyc = { a: 1 }; cyc.self = cyc;
  chk("自引用不炸栈（返回 undefined 当作坏值）", (() => { try { lossless(cyc); return true; } catch { return false; } })());

  chk("truncateSafe 短串原样", truncateSafe("abc", 80) === "abc");
  chk("truncateSafe 不切断代理对", truncateSafe("a".repeat(79) + "😀" + "tail", 80) === "a".repeat(79));
  chk("truncateSafe 全角/普通截断正常", truncateSafe("abcdef", 3) === "abc");
}

// ── 行为②：真的注册工具、真的调 execute（本地分支，离线可跑） ───────────────
const mod = await import(pathToFileURL(SRC).href + "?probe=" + Date.now());
let tool = null;
const fakeCtx = {
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  effect(fn) { const d = fn(); return () => { if (typeof d === "function") d(); }; },
  webServer: { port: 1, register() { return () => {}; } },
  systemPrompt: { section() { return () => {}; } },
  tools: { register(t) { tool = t; return () => {}; } },
};
try { mod.apply(fakeCtx, { injectImageLaw: false }); } catch (e) { chk("apply 注册工具不抛错: " + (e && e.message), false); }
chk("apply() 之后拿到了 display_image 工具定义", !!tool && tool.name === "display_image");
chk("工具声明了 output.schema（两道闸门的其中一道）", !!(tool && tool.output && tool.output.schema));

if (tool && tool.output && tool.output.schema) {
  const schema = tool.output.schema;
  const dir = path.join(os.tmpdir(), "ig-tool-probe-" + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const png = path.join(dir, "dot.png");
  fs.writeFileSync(png, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64"));

  const res = await tool.execute({ path: png, limit: 1 }, {});
  chk("本地分支真实 execute 有返回", !!res && typeof res === "object");
  chk("返回值通过无损 JSON 检查（DSH 闸门一）", isLosslessJson(res));
  const errs = validateSchema(schema, res);
  chk("返回值通过 output.schema 校验（DSH 闸门二）: " + (errs[0] || "ok"), errs.length === 0);
  chk("markdown 里有图片语法", typeof res.markdown === "string" && res.markdown.includes("!["));
  // 实测（E:\tmp\lightbox-lab\dbg-tool-result.mjs）：本地分支返回的是**根相对**
  // `/images/?abs=…&v=…`，不是 http://127.0.0.1:<port>/… —— 这是对的：桌面端 port 默认 0，
  // 每次重启换端口，绝对 URL 必然失效。所以这里钉住「必须相对」并明确禁止「绝对」。
  const u0 = String(res.images[0].url || "");
  chk("images[0].url 是根相对 /images 路由: " + u0.slice(0, 40), /^\/images\/\?abs=/.test(u0));
  chk("images[0].url 不是绝对 URL（端口会漂移）", !/^https?:\/\//i.test(u0));
  chk("JSON 往返后仍等价（真无损）", JSON.stringify(JSON.parse(JSON.stringify(res))) === JSON.stringify(res));

  // ── 鉴别力：把两个真实 bug 的形状喂给复刻校验器，必须被抓住 ──────────────
  const shape1 = { mode: "search", count: 1, markdown: "x", images: [{ url: "u", title: "", width: undefined }], note: "n" };
  chk("复刻闸门能抓出 width: undefined（1.8.1 故障形状）", isLosslessJson(shape1) === false);
  const shape2 = { mode: "search", count: 1, markdown: "x", images: [{ url: "u", rescueError: "567" }], note: "n" };
  // 🔴 负控绝不能用**当前** schema：rescueError 已在修复里补进 schema，拿现 schema 验
  // 1.8.1 形状必然「通过」，这条负控就变成了自欺（第一版探针正是这么写的）。
  // 正解：从 schema 里删掉 rescueError，复现 1.8.1 的形状，校验器必须抓住它。
  const reduced = JSON.parse(JSON.stringify(schema));
  delete reduced.properties.images.items.properties.rescueError;
  chk("负控前提：删掉 rescueError 后的 schema 确实不再声明它",
    !Object.hasOwn(reduced.properties.images.items.properties, "rescueError"));
  chk("复刻闸门能抓出未声明字段 rescueError（1.8.1 故障形状）",
    validateSchema(reduced, shape2).length > 0);
  chk("同一形状在现 schema 下合法（证明补声明到位）", validateSchema(schema, shape2).length === 0);
  const shape3 = { mode: "search", count: 1, markdown: "x", images: [{ url: "u", width: NaN }], note: "n" };
  chk("复刻闸门能抓出 NaN 维度", isLosslessJson(shape3) === false);

  // ── 在线：真的搜一次，返回值过两道闸门（IG_TOOL_ONLINE=1） ────────────────
  if (ONLINE) {
    let live = null, liveErr = null;
    try { live = await tool.execute({ query: "毛晓彤", limit: 4 }, {}); } catch (e) { liveErr = e; }
    chk("在线搜图真的返回了结果: " + (liveErr ? liveErr.message : "ok"), !!live);
    if (live) {
      chk("在线结果通过无损 JSON 检查", isLosslessJson(live));
      const e2 = validateSchema(schema, live);
      chk("在线结果通过 output.schema 校验: " + (e2[0] || "ok"), e2.length === 0);
      chk("在线结果有图片", Array.isArray(live.images) && live.images.length > 0);
      chk("在线结果 note 说明了图源与抽样", /图源：/.test(String(live.note)));
      chk("没有宽高的图不写 width 键（Bing 的常态）",
        live.images.every((im) => !Object.hasOwn(im, "width") || Number.isFinite(im.width)));
    }
  }
}

// ── 汇总 ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
for (const [label, ok] of checks) {
  if (ok) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label); }
}
console.log(`\n结果 ${pass}/${checks.length}${ONLINE ? "" : "（离线；加 IG_TOOL_ONLINE=1 跑真实搜图）"}`);
process.exit(fail === 0 ? 0 : 1);
