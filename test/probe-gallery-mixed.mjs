// probe-gallery-mixed.mjs — 锁死 v1.9.1 修复
//
// 回归对象：用户报告的「发完图自动变四列 + 文字乱入」。
// 根因两条：
//   ① isGalleryContainer() 对散文/表格子节点只 continue 不拒绝，
//      图片 >= 2 就把整条消息行判成九宫格 → display:grid（auto-fill
//      minmax(180px,1fr) 在 826px 容器下正好 4 列）。
//   ② applyGalleries() 被 if (touched) 门控，流式后到的散文/表格永远
//      拿不到 dsh-ig-span，被当成普通 grid item 塞进 180px 轨道。
//
// 本探针用「源码断言 + 逻辑复刻 DOM 桩」双重验证，任一环回退即 FAIL。
import fs from "node:fs";
const SRC = "C:/Users/Administrator/.dsh/local-plugins/dsh-chat-image-lightbox/lib/client.js";
const src = fs.readFileSync(SRC, "utf8");

const checks = [];
const chk = (label, cond) => checks.push([label, !!cond]);

// ── 一、源码层断言 ────────────────────────────────────────────────────────
const isGal = src.slice(src.indexOf("function isGalleryContainer"), src.indexOf("function markGallery"));
chk("isGalleryContainer 已定义", isGal.length > 100);
chk("混合容器有 return false（v1.9.1 关键修复）", /isImgWrapper\(kid\)\)\s*\{[^}]*continue;\s*\}\s*\/\/[^\n]*\n(?:[^\n]*\n){0,20}?\s*return false;/.test(isGal) || /isImgWrapper\(kid\)\)\s*\{[^}]*continue;\s*\}[\s\S]{0,1200}?return false;/.test(isGal));
chk("不再对未知子节点静默落出循环", /return false;/.test(isGal));
chk("仍保留 imgCount >= 2 判定", /return imgCount >= 2;/.test(isGal));
chk("纯图容器（>=2 图）仍可成 gallery", !/return imgCount >= 1;/.test(isGal));

// enhance 尾部：applyGalleries 必须无条件调用
const enhanceTail = src.slice(src.indexOf("Mode syncing must NOT be conditional"));
chk("applyGalleries 不再被 touched 门控", !/if \(touched\) applyGalleries\(\);/.test(src));
chk("applyGalleries 无条件调用", /^\s*applyGalleries\(\);/m.test(enhanceTail));

// 网格列数根因：gallery CSS 仍是 auto-fill（保留能力），但混合容器已进不去
chk("gallery CSS 仍是 auto-fill（能力保留）", /\.dsh-ig-gallery \{[\s\S]{0,200}repeat\(auto-fill, minmax\(180px, 1fr\)\)/.test(src));

// ── 二、逻辑复刻：严格 DOM 桩 ──────────────────────────────────────────────
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
    insertBefore(node, ref) {
      if (ref === null || ref === undefined) this.children.push(node);
      else { const i = this.children.indexOf(ref); if (i >= 0) this.children.splice(i, 0, node); else this.children.push(node); }
      node.parentElement = this; return node;
    },
    removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); node.parentElement = null; return node; },
    isConnected: true,
  };
  return el;
}

// 复刻 v1.9.1 修复后的 isGalleryContainer
const isImgWrapper = (kid) => kid && kid.children.length === 1 && kid.children[0].tagName === "IMG";
function isGalleryContainerV191(mc) {
  if (!mc || mc === document_body) return false;
  const kids = mc.children;
  if (!kids || kids.length < 2) return false;
  let imgCount = 0;
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    if (kid.tagName === "IMG") {
      if (String(kid.className).indexOf("dsh-ig-img") >= 0) { imgCount++; continue; }
      return false;
    }
    if (kid.tagName === "BR") continue;
    if (isImgWrapper(kid)) { imgCount++; continue; }
    return false; // ← 修复点
  }
  return imgCount >= 2;
}
const document_body = { __body: true };

function imgWrap() { const b = makeEl("BUTTON", "_imageButton dsh-ig-tile dsh-ig-tilewrap"); b.insertBefore(makeEl("IMG", "_image dsh-ig-img"), null); return b; }
function txtP(t) { return makeEl("P", "", t || "说明文字"); }
function tableEl() { return makeEl("TABLE", "", "# 文件 内容"); }

// T1 实测场景：10 图 + 9 散文（旧逻辑会判成 gallery → 4 列）
{
  const mc = makeEl("DIV", "_markdown_1ypvv_5");
  for (let i = 0; i < 10; i++) mc.insertBefore(imgWrap(), null);
  for (let i = 0; i < 9; i++) mc.insertBefore(txtP("说明" + i), null);
  chk("T1 10图+9文 → 不判 gallery（实修前会 true）", isGalleryContainerV191(mc) === false);
}

// T2 图 + 表格（用户截图形态：表格被挤进图片行）
{
  const mc = makeEl("DIV", "_markdown_1ypvv_5");
  for (let i = 0; i < 4; i++) mc.insertBefore(imgWrap(), null);
  mc.insertBefore(tableEl(), null);
  chk("T2 4图+表格 → 不判 gallery", isGalleryContainerV191(mc) === false);
}

// T3 纯图容器仍应成 gallery（能力不能被修没）
{
  const mc = makeEl("DIV", "_markdown_1ypvv_5");
  for (let i = 0; i < 4; i++) mc.insertBefore(imgWrap(), null);
  chk("T3 纯 4 图 → 仍判 gallery", isGalleryContainerV191(mc) === true);
}

// T4 纯图 + BR 仍应成 gallery
{
  const mc = makeEl("DIV", "md");
  mc.insertBefore(imgWrap(), null); mc.insertBefore(makeEl("BR", ""), null); mc.insertBefore(imgWrap(), null);
  chk("T4 图+BR+图 → 仍判 gallery", isGalleryContainerV191(mc) === true);
}

// T5 单图 + 文字 → 不判
{
  const mc = makeEl("DIV", "md");
  mc.insertBefore(imgWrap(), null); mc.insertBefore(txtP(), null);
  chk("T5 单图+文 → 不判 gallery", isGalleryContainerV191(mc) === false);
}

// T6 单图无文字 → 不判（<2）
{
  const mc = makeEl("DIV", "md");
  mc.insertBefore(imgWrap(), null);
  chk("T6 单图 → 不判 gallery", isGalleryContainerV191(mc) === false);
}

// T7 文字在图片前面（散文先到）也不判
{
  const mc = makeEl("DIV", "md");
  mc.insertBefore(txtP("先说明"), null);
  for (let i = 0; i < 3; i++) mc.insertBefore(imgWrap(), null);
  chk("T7 文在图前 → 不判 gallery", isGalleryContainerV191(mc) === false);
}

// T8 空容器 / body 保护
chk("T8 空容器不崩且不判", isGalleryContainerV191(makeEl("DIV", "md")) === false);
chk("T8b body 不判", isGalleryContainerV191(document_body) === false);

// ── 输出 ──────────────────────────────────────────────────────────────────
console.log("gallery 混合容器回归（v1.9.1）\n" + "─".repeat(74));
let pass = 0, fail = 0;
for (const [label, ok] of checks) { console.log(`  ${ok ? "✓" : "✗"} ${label}`); ok ? pass++ : fail++; }
console.log("─".repeat(74));
console.log(`合计 ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
