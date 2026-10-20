// ── 探针：常驻节点的 role="dialog" 泄漏（可对任意版本运行，自带鉴别力）────────
//
// 缺陷（web 端 1.7.10 / 1.7.11 真实事故）：
//   backdrop（图片查看器外壳）与 .dsh-ig-pop（工具栏面板）都是**常驻 body** 的节点，
//   关闭时只是 display:none / visibility:hidden。创建时就挂 role="dialog"，它们会
//   永远留在 document.querySelectorAll('[role="dialog"]') 里。而宿主与其它插件
//   普遍用「数弹窗」做闸门，例如 Agents AnyWhere 关闭回调首行：
//       if (document.querySelectorAll('[role="dialog"]').length > 1) return;
//   → ✕ 被静默吞掉 → #root 的 inert 撤不掉 → 整个界面点不动。
//
// 与 1.7.11 教训一致：探针必须**对修复前的代码变红**，否则只是在测「什么都没创建」。
// 用法：
//   node probe-poprole.mjs                    # 测当前 local-plugins 版本
//   LB_SRC=<某文件> node probe-poprole.mjs     # 测指定源码（用于鉴别力自证）
import { readFileSync } from "node:fs";

const SRC = process.env.LB_SRC || "C:/Users/Administrator/.dsh/local-plugins/dsh-chat-image-lightbox/lib/client.js";
const bundle = readFileSync(SRC, "utf8");

let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; bad.push(name); console.log("  ✗ " + name + (detail ? "  ← " + detail : "")); }
}

// ── 从 bundle 里抠函数源码（括号配平）────────────────────────────────────
function grab(name) {
  const i = bundle.indexOf("function " + name + "(");
  if (i < 0) return null;
  let d = 0, j = bundle.indexOf("{", i);
  for (let k = j; k < bundle.length; k++) {
    if (bundle[k] === "{") d++;
    else if (bundle[k] === "}") { d--; if (d === 0) return bundle.slice(i, k + 1); }
  }
  return null;
}

// ── 最小 DOM 桩（只实现探针用到的部分）───────────────────────────────────
function makeDoc() {
  const all = [];
  function El(tag) {
    const attrs = new Map();
    const node = {
      tagName: String(tag).toUpperCase(), children: [], parentNode: null,
      style: {}, innerHTML: "", textContent: "", className: "",
      classList: {
        _s: new Set(),
        add(...c) { c.forEach((x) => node.classList._s.add(x)); node.className = [...node.classList._s].join(" "); },
        remove(...c) { c.forEach((x) => node.classList._s.delete(x)); node.className = [...node.classList._s].join(" "); },
        contains(c) { return node.classList._s.has(c); },
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(c) { c.parentNode = node; node.children.push(c); return c; },
      removeChild(c) { const i = node.children.indexOf(c); if (i >= 0) node.children.splice(i, 1); c.parentNode = null; return c; },
      remove() { if (node.parentNode) node.parentNode.removeChild(node); },
      addEventListener() {}, removeEventListener() {},
      getBoundingClientRect() { return { left: 10, top: 100, right: 110, bottom: 140, width: 100, height: 40 }; },
      contains(n) { let p = n; while (p) { if (p === node) return true; p = p.parentNode; } return false; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      focus() {}, blur() {},
      get isConnected() { let p = node; while (p.parentNode) p = p.parentNode; return p === doc.body || p === doc.documentElement; },
      get offsetWidth() { return 240; }, get offsetHeight() { return 140; },
      _attrs: attrs,
    };
    all.push(node);
    return node;
  }
  const doc = {
    documentElement: null, body: null, head: null, activeElement: null,
    createElement: (t) => El(t),
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === '[role="dialog"]') return all.filter((n) => n._attrs.get("role") === "dialog");
      return [];
    },
  };
  doc.documentElement = El("html");
  doc.body = El("body");
  doc.head = El("head");
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  return doc;
}

// ── 抽出并执行真实函数 ───────────────────────────────────────────────────
// 只抽 popover 那对 + backdrop 的创建/开关片段；其余依赖用桩替代。
const fEnsurePop = grab("ensurePopover");
const fOpenPop = grab("openPopover");
const fClosePop = grab("closePopover");

console.log("═".repeat(78));
console.log("源码: " + SRC);
console.log("阶段 1：函数可定位");
ok("ensurePopover 可定位", !!fEnsurePop);
ok("openPopover 可定位", !!fOpenPop);
ok("closePopover 可定位", !!fClosePop);
if (!fEnsurePop || !fOpenPop || !fClosePop) { console.log("\n无法继续（函数缺失）"); process.exitCode = 1; process.exit(); }

const doc = makeDoc();
// 声明这些函数引用的模块级变量 + 依赖
const prelude = `
  var popover = null, triggerBtn = null, popoverOpen = false;
`;
const runner = new Function(
  "document", "window",
  prelude + "\n" + fEnsurePop + "\n" + fOpenPop + "\n" + fClosePop + "\n" +
  "return {ensurePopover:ensurePopover, openPopover:openPopover, closePopover:closePopover, setTrigger:function(t){triggerBtn=t;}, state:function(){return {popover:popover, open:popoverOpen};}};"
);
const win = { innerWidth: 1440, innerHeight: 900 };
const api = runner(doc, win);

// triggerBtn 是真实 DOM 节点（openPopover 要用 getBoundingClientRect）
const trigger = doc.createElement("button");
trigger.className = "dsh-ig-trigger";
api.setTrigger(trigger);

const countDialogs = () => doc.querySelectorAll('[role="dialog"]').length;

console.log("\n阶段 2：popover 三态（创建 / 打开 / 关闭）");
// T1：创建态（mount 阶段就会调用）—— 不得带 role
const p = api.ensurePopover();
// 注意：bundle 用 `popover.className = "dsh-ig-pop"` 直接赋值（不走 classList），
// 所以这里必须同时看 className 与 classList，否则 T1 会假红。
const hasPopClass = !!p && (p.className || "").includes("dsh-ig-pop");
ok("T1 面板创建成功", hasPopClass, `className=${p && p.className}`);
ok("T1 创建后 role 必须不存在", p.getAttribute("role") === null,
   `实际 role=${p.getAttribute("role")}`);
ok("T1 创建后保留 aria-label（可发现性不丢）", p.getAttribute("aria-label") === "图片工具");
ok("T1 创建后全局弹窗计数为 0", countDialogs() === 0, `实际 ${countDialogs()}`);

// T2：打开态 —— 必须装回 role + aria-modal
api.openPopover();
ok("T2 打开后 role=dialog", p.getAttribute("role") === "dialog", `实际 ${p.getAttribute("role")}`);
ok("T2 打开后 aria-modal=true", p.getAttribute("aria-modal") === "true");

// T3：关闭态 —— 必须摘掉
api.closePopover();
ok("T3 关闭后 role 必须被摘掉", p.getAttribute("role") === null, `实际 role=${p.getAttribute("role")}`);
ok("T3 关闭后 aria-modal 必须被摘掉", p.getAttribute("aria-modal") === null);
ok("T3 关闭后全局弹窗计数为 0", countDialogs() === 0, `实际 ${countDialogs()}`);

// T4：二次打开 —— 无障碍语义不能丢（1.7.10 修复时的已知坑）
api.openPopover();
ok("T4 第二次打开 role 仍为 dialog", p.getAttribute("role") === "dialog", `实际 ${p.getAttribute("role")}`);
api.closePopover();

// ── 鉴别力自证：人为把 role 补回去，计数必须变 1 ──────────────────────────
console.log("\n阶段 3：鉴别力自证（证明探针真在数弹窗）");
p.setAttribute("role", "dialog");
ok("人为挂回 role 后计数必须变 1", countDialogs() === 1, `实际 ${countDialogs()}`);
p.removeAttribute("role");
ok("摘掉后计数回到 0", countDialogs() === 0, `实际 ${countDialogs()}`);

console.log("\n" + "═".repeat(78));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) console.log("失败项：\n  - " + bad.join("\n  - "));
process.exitCode = fail === 0 ? 0 : 1;
