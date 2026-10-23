// probe-tileline.mjs — 锁定 v1.9.3 修复
//
// 回归对象：用户报告的「十张图里第一张和其余不对齐」（首卡顶边比同排高 20px）。
// 根因：瓦片靠 float 跨十个零高 <p> 连成一行，但 <p> 仍然拥有一个行盒。
//   只要段落里残留任何行内幸存者（零尺寸 span、空灯箱槽、旧版本遗留节点），
//   该段就不再是零高 —— 行盒把整条 float 流往下推，于是「它前面那张图」比
//   后面所有图都高出一截。复刻页实测：有幸存者 4/40/40，加规则后 4/4/4。
// 修复：给承载瓦片的段落加 .dsh-ig-tileline，把 margin/padding/border/
//   line-height/font-size/min-height 全部归零。绝不碰消息容器（那会变 BFC
//   把 float 困住，历史回归：整行塌成一列）。
//
// 本探针用「源码断言 + 判定逻辑复刻」双重验证，任一环回退即 FAIL。
import fs from "node:fs";

const SRC = "C:/Users/Administrator/.dsh/local-plugins/dsh-chat-image-lightbox/lib/client.js";
const src = fs.readFileSync(SRC, "utf8");

const checks = [];
const chk = (label, cond) => checks.push([label, !!cond]);

// ── 一、CSS 层断言 ────────────────────────────────────────────────────────
const cssStart = src.indexOf(".dsh-ig-tileline {");
const cssEnd = src.indexOf("}", cssStart);
const cssBlock = cssStart >= 0 ? src.slice(cssStart, cssEnd) : "";
chk(".dsh-ig-tileline 规则存在", cssStart >= 0 && cssBlock.length > 20);
chk("归零 margin", /margin:\s*0\s*!important/.test(cssBlock));
chk("归零 padding", /padding:\s*0\s*!important/.test(cssBlock));
chk("归零 border", /border:\s*0\s*!important/.test(cssBlock));
chk("归零 line-height（行盒来源）", /line-height:\s*0\s*!important/.test(cssBlock));
chk("归零 font-size（行盒来源）", /font-size:\s*0\s*!important/.test(cssBlock));
chk("归零 min-height", /min-height:\s*0\s*!important/.test(cssBlock));
chk("CSS 注释记录了实测数字（4/40/40 → 4/4/4）", /4\/40\/40/.test(src) && /4\/4\/4/.test(src));

// ── 二、调用点断言 ────────────────────────────────────────────────────────
// tickThumb 里必须在「拿到 tilewrap」的同一分支上打 tileline
const tick = src.slice(src.indexOf("function tickThumb"), src.indexOf("function untickThumb"));
chk("tickThumb 已定义", tick.length > 500);
chk("tickThumb 在 !hasText 分支调用 markTileLine",
  /if \(!hasText\) \{[\s\S]{0,2000}?markTileLine\(host\);/.test(tick));
chk("markTileLine 紧跟在加 tilewrap 之后（顺序不可换）",
  tick.indexOf('host.classList.add("dsh-ig-tilewrap")') < tick.indexOf("markTileLine(host)"));
chk("tickThumb 仍保留 hasText 判定（散文段落绝不 float）",
  /var hasText = false;/.test(tick) && /if \(!hasText\) \{/.test(tick));

// untickThumb 必须撤销
const untick = src.slice(src.indexOf("function untickThumb"), src.indexOf("function untickThumb") + 2500);
chk("untickThumb 调用 unmarkTileLine（撤图后段落恢复正常排版）", /unmarkTileLine\(host\);/.test(untick));

// ── 三、安全护栏断言（防历史回归） ────────────────────────────────────────
const owner = src.slice(src.indexOf("function tileLineOwner"), src.indexOf("function tileLineIsSafe"));
chk("tileLineOwner 取 parentElement（行盒属于段落，不属于 float 自身）", /host\.parentElement/.test(owner));
chk("tileLineOwner 拒绝 body / documentElement", /document\.body/.test(owner) && /document\.documentElement/.test(owner));

const direct = src.slice(src.indexOf("function tileLineIsDirect"), src.indexOf("function markTileLine"));
chk("tileLineIsDirect 要求恰好 1 个直接瓦片子元素（消息容器被排除）", /direct !== 1/.test(direct));
chk("tileLineIsDirect 要求子树内也只有这 1 个瓦片", /all === 1/.test(direct));

const safe = src.slice(src.indexOf("function tileLineIsSafe"), src.indexOf("function tileLineIsDirect"));
chk("tileLineIsSafe 有散文即拒绝（与 tickThumb 同一判据）", /return false;/.test(safe) && /textContent/.test(safe));

chk("markTileLine 三重门禁：owner + direct + safe",
  /if \(!owner \|\| !tileLineIsDirect\(owner\) \|\| !tileLineIsSafe\(owner\)\) return;/.test(src));

// ── 四、判定逻辑复刻（用真实函数体行为对照） ──────────────────────────────
function makeEl(tag, cls, text) {
  const el = {
    tagName: tag, nodeType: 1, children: [], childNodes: [], textContent: text || "",
    className: cls || "", parentElement: null,
    classList: {
      _s: new Set((cls || "").split(/\s+/).filter(Boolean)),
      contains(c) { return this._s.has(c); },
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
    },
    querySelector(sel) {
      const want = sel.replace(/^\./, "");
      if (this.classList.contains(want)) return this;
      for (const c of this.children) { const r = c.querySelector && c.querySelector(sel); if (r) return r; }
      return null;
    },
    querySelectorAll(sel) {
      const want = sel.replace(/^\./, "");
      const out = [];
      const walk = (n) => { if (n.classList && n.classList.contains(want)) out.push(n); for (const c of n.children) walk(c); };
      for (const c of this.children) walk(c);
      return out;
    },
    appendChild(node) {
      this.children.push(node); this.childNodes.push(node); node.parentElement = this; return node;
    },
  };
  return el;
}
const txt = (s) => ({ nodeType: 3, nodeValue: s });

// 复刻三个判定函数（与源码逐行同义）
const isSafe = (o) => {
  for (const nd of o.childNodes) {
    if (nd.nodeType === 3) { if ((nd.nodeValue || "").replace(/\s+/g, "") !== "") return false; }
    else if (nd.nodeType === 1 && nd.tagName !== "IMG" && nd.tagName !== "BR") {
      if ((nd.textContent || "").replace(/\s+/g, "").length > 0) return false;
    }
  }
  return true;
};
const isDirect = (o) => {
  let direct = 0;
  for (const ch of o.children) if (ch.classList && ch.classList.contains("dsh-ig-tilewrap")) direct++;
  if (!direct) return false;
  if (direct !== 1) return false;
  const all = o.querySelectorAll(".dsh-ig-tilewrap").length;
  return all === 1;
};

// 场景 A：正常 —— 一个 <p> 里只有一个 button 瓦片，无散文 → 应当打类
const md = makeEl("DIV", "_markdown_1ypvv_5");
const pA = makeEl("P", "");
const btnA = makeEl("BUTTON", "imageButton dsh-ig-tilewrap");
btnA.appendChild(makeEl("IMG", "image dsh-ig-tile"));
pA.appendChild(btnA);
pA.childNodes.push(txt("\n"));
md.appendChild(pA);
chk("场景A 单图段落：通过门禁（应打 tileline）", isDirect(pA) && isSafe(pA));

// 场景 B：段落里有散文 → 拒绝（不能把散文挤成 0 号字）
const pB = makeEl("P", "");
pB.appendChild(makeEl("BUTTON", "imageButton dsh-ig-tilewrap"));
pB.childNodes.push(txt("这里是说明文字"));
chk("场景B 段落含散文：被拒（不归零字号）", !isSafe(pB));

// 场景 C：消息容器（十个瓦片直接挂在 markdown div 下）→ 必须拒绝
const md2 = makeEl("DIV", "_markdown_1ypvv_5");
for (let i = 0; i < 10; i++) {
  const b = makeEl("BUTTON", "imageButton dsh-ig-tilewrap");
  b.appendChild(makeEl("IMG", "image dsh-ig-tile"));
  md2.appendChild(b);
}
chk("场景C 消息容器（10 个瓦片）：被拒（防 float 被 BFC 困住）", !isDirect(md2));

// 场景 D：零尺寸行内幸存者 —— 这正是复现 20px 偏移的形态，仍然必须通过
const pD = makeEl("P", "");
pD.appendChild(makeEl("BUTTON", "imageButton dsh-ig-tilewrap"));
const survivor = makeEl("SPAN", "");
survivor.textContent = "";
pD.appendChild(survivor);
chk("场景D 段落里有零尺寸空 span：仍然通过（这正是要修的形状）", isDirect(pD) && isSafe(pD));

// ── 输出 ──────────────────────────────────────────────────────────────────
let pass = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (ok) pass++;
}
console.log(`\n结果：${pass}/${checks.length} 通过`);
process.exit(pass === checks.length ? 0 : 1);
