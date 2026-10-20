// 严格 DOM 桩 v3：复刻「按段切分」的新逻辑，验证多段图区
import fs from "node:fs";
const SRC = "C:/Users/Administrator/.dsh/local-plugins/dsh-chat-image-lightbox/lib/client.js";
const src = fs.readFileSync(SRC, "utf8");

const checks = [];
const chk = (label, cond) => { checks.push([label, !!cond]); };

chk("markRowClears 已定义", /function markRowClears\(\)/.test(src));
chk("已在 thumb 分支调用", /markGridHosts\(\);[\s\S]{0,300}markRowClears\(\);/.test(src));
chk("clearGridHosts 会清理 rowclear", /querySelectorAll\("\[data-dsh-ig-rowclear\]"\)/.test(src));
chk("不修改 <p> 自身（无 rowhost）", !/classList\.add\("dsh-ig-rowhost"\)/.test(src));
chk("clear 是新建 div", /document\.createElement\("div"\)/.test(src));
chk("clear 带 clear:both", /setProperty\("clear", "both"/.test(src));
chk("实现了按段切分（spanEnd 变量）", /var spanEnd = null;/.test(src));
chk("碰到纯文字会中断当前段", /else if \(spanEnd !== null\)/.test(src));
chk("跳过自己的 clear 元素", /data-dsh-ig-rowclear"\)\) continue;/.test(src));

// ── 假 DOM ────────────────────────────────────────────────────────────────
function makeEl(tag, cls, text) {
  const el = {
    tagName: tag, nodeType: 1, children: [],
    className: cls || "", textContent: text || "", parentElement: null,
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, removeProperty(k) { delete this._p[k]; } },
    classList: {
      _s: new Set((cls || "").split(/\s+/).filter(Boolean)),
      contains(c) { return this._s.has(c); },
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
    },
    setAttribute(k, v) { this._attrs = this._attrs || {}; this._attrs[k] = v; },
    getAttribute(k) { return (this._attrs || {})[k]; },
    querySelector(sel) {
      const want = sel.replace(/^\./, "");
      if (this.classList.contains(want)) return this;
      for (const c of this.children) { const r = c.querySelector && c.querySelector(sel); if (r) return r; }
      return null;
    },
    get nextSibling() {
      if (!this.parentElement) return null;
      const s = this.parentElement.children, i = s.indexOf(this);
      return i >= 0 && i + 1 < s.length ? s[i + 1] : null;
    },
    insertBefore(node, ref) {
      if (ref === null || ref === undefined) this.children.push(node);
      else { const i = this.children.indexOf(ref); if (i >= 0) this.children.splice(i, 0, node); else this.children.push(node); }
      node.parentElement = this; return node;
    },
    removeChild(node) {
      const i = this.children.indexOf(node);
      if (i >= 0) this.children.splice(i, 1);
      node.parentElement = null; return node;
    },
    isConnected: true,
  };
  return el;
}

function imgP() { const p = makeEl("P", ""); p.insertBefore(makeEl("BUTTON", "_imageButton dsh-ig-tile dsh-ig-tilewrap"), null); return p; }
function txtP(t) { return makeEl("P", "", t || "文字"); }

// 复刻产品逻辑（v3 按段切分）
function runMarkRowClears(run, allTiles) {
  const lastPerParent = [];
  const seenRuns = [];
  for (const wrap of allTiles) {
    if (!wrap.isConnected) continue;
    const par = wrap.parentElement;
    if (!par) continue;
    const runEl = par.parentElement;
    if (!runEl) continue;
    if (seenRuns.indexOf(runEl) >= 0) continue;
    seenRuns.push(runEl);
    let spanEnd = null;
    for (const sib of runEl.children) {
      if (!sib || sib.nodeType !== 1) continue;
      if (sib.getAttribute && sib.getAttribute("data-dsh-ig-rowclear")) continue;
      let has = false;
      if (sib.classList && sib.classList.contains("dsh-ig-tilewrap")) has = true;
      else if (sib.querySelector && sib.querySelector(".dsh-ig-tilewrap")) has = true;
      if (has) { spanEnd = sib; }
      else if (spanEnd !== null) {
        if (!lastPerParent.includes(spanEnd)) lastPerParent.push(spanEnd);
        spanEnd = null;
      }
    }
    if (spanEnd !== null && !lastPerParent.includes(spanEnd)) lastPerParent.push(spanEnd);
  }
  for (let i = run.children.length - 1; i >= 0; i--) {
    if (run.children[i].getAttribute && run.children[i].getAttribute("data-dsh-ig-rowclear")) run.removeChild(run.children[i]);
  }
  for (const tail of lastPerParent) {
    const host = tail.parentElement;
    if (!host) continue;
    const clear = makeEl("DIV", "");
    clear.setAttribute("data-dsh-ig-rowclear", "1");
    clear.style.setProperty("clear", "both");
    clear.style.setProperty("height", "0");
    host.insertBefore(clear, tail.nextSibling);
  }
  return lastPerParent.length;
}
const getClears = (r) => r.children.filter((c) => c.getAttribute && c.getAttribute("data-dsh-ig-rowclear"));

// ── T1：10 图 + 9 文（实测场景）───
{
  const run = makeEl("DIV", "_markdown_1ypvv_5");
  const ps = []; for (let i = 0; i < 10; i++) { const p = imgP(); run.insertBefore(p, null); ps.push(p); }
  for (let i = 0; i < 9; i++) run.insertBefore(txtP("说明" + i), null);
  runMarkRowClears(run, ps.map((p) => p.children[0]));
  const c = getClears(run);
  chk(`T1 10图9文 → 1 个 clear（实 ${c.length}）`, c.length === 1);
  chk(`T1 位置 index=10（实 ${run.children.indexOf(c[0])}）`, run.children.indexOf(c[0]) === 10);
  chk("T1 前 10 个 <p> 未被改", run.children.slice(0, 10).every((p) => p.tagName === "P"));
}

// ── T2：幂等 ──
{
  const run = makeEl("DIV", "md");
  const ps = []; for (let i = 0; i < 10; i++) { const p = imgP(); run.insertBefore(p, null); ps.push(p); }
  for (let i = 0; i < 9; i++) run.insertBefore(txtP(), null);
  const t = ps.map((p) => p.children[0]);
  runMarkRowClears(run, t); runMarkRowClears(run, t); runMarkRowClears(run, t);
  const c = getClears(run);
  chk(`T2 幂等 3 次 → 仍 1 个（实 ${c.length}）位置 ${run.children.indexOf(c[0])}`, c.length === 1 && run.children.indexOf(c[0]) === 10);
}

// ── T3：两段图区（中间隔文字）→ 2 个 clear ──
{
  const run = makeEl("DIV", "md");
  const g1 = []; for (let i = 0; i < 3; i++) { const p = imgP(); run.insertBefore(p, null); g1.push(p); }
  run.insertBefore(txtP("中间文字"), null);
  const g2 = []; for (let i = 0; i < 3; i++) { const p = imgP(); run.insertBefore(p, null); g2.push(p); }
  run.insertBefore(txtP("尾文字"), null);
  runMarkRowClears(run, [...g1, ...g2].map((p) => p.children[0]));
  const c = getClears(run);
  chk(`T3 两段图区 → 2 个 clear（实 ${c.length}）`, c.length === 2);
  const positions = c.map((x) => run.children.indexOf(x));
  // 第一个 clear 插在 g1[2] 之后 → index 3；它把后面所有元素推后 1 位，
  // 所以 g2[2] 从 index 6 变成 7，第二个 clear 落在 index 8。
  chk(`T3 位置 = [3, 8]（实 [${positions}]）`, positions[0] === 3 && positions[1] === 8);
}

// ── T4：三段图区 → 3 个 clear ──
{
  const run = makeEl("DIV", "md");
  const all = [];
  for (let g = 0; g < 3; g++) {
    const ps = []; for (let i = 0; i < 2; i++) { const p = imgP(); run.insertBefore(p, null); ps.push(p); }
    all.push(...ps);
    if (g < 2) run.insertBefore(txtP("间隔" + g), null);
  }
  runMarkRowClears(run, all.map((p) => p.children[0]));
  chk(`T4 三段图区 → 3 个 clear（实 ${getClears(run).length}）`, getClears(run).length === 3);
}

// ── T5：单图 ──
{
  const run = makeEl("DIV", "md");
  const p = imgP(); run.insertBefore(p, null);
  run.insertBefore(txtP(), null);
  runMarkRowClears(run, [p.children[0]]);
  const c = getClears(run);
  chk(`T5 单图 → 1 个 clear 在 index 1（实 ${run.children.indexOf(c[0])}）`, c.length === 1 && run.children.indexOf(c[0]) === 1);
}

// ── T6：清理后再加，位置正确（模拟切模式来回）──
{
  const run = makeEl("DIV", "md");
  const ps = []; for (let i = 0; i < 4; i++) { const p = imgP(); run.insertBefore(p, null); ps.push(p); }
  for (let i = 0; i < 2; i++) run.insertBefore(txtP(), null);
  const t = ps.map((p) => p.children[0]);
  runMarkRowClears(run, t);
  const first = run.children.indexOf(getClears(run)[0]);
  // 清掉
  for (let i = run.children.length - 1; i >= 0; i--) if (run.children[i].getAttribute && run.children[i].getAttribute("data-dsh-ig-rowclear")) run.removeChild(run.children[i]);
  // 再来
  runMarkRowClears(run, t);
  const again = run.children.indexOf(getClears(run)[0]);
  chk(`T6 清理前后位置一致 ${first}=${again}`, first === 4 && again === 4);
}

console.log("严格 DOM 桩 v3（按段切分）\n" + "─".repeat(74));
let pass = 0, fail = 0;
for (const [label, ok] of checks) { console.log(`  ${ok ? "✓" : "✗"} ${label}`); ok ? pass++ : fail++; }
console.log("─".repeat(74));
console.log(`合计 ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
