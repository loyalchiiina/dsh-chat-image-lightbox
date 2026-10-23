// probe-delivery-banner.mjs — 锁死 v1.9.2「工具结果自带投递提醒」
//
// 事故背景（2026-10-23）：投递铁律作为 system prompt section 常驻且注册成功
// （日志 "image delivery law registered (order 1500, 826 chars)"），模型仍
// 「调了工具、没抄正文」，用户回「正文里没图啊」。
//
// 结论：规则离「刚拿到返回值」那一刻太远。修法 = 让工具返回值本身喊话。
// 本探针断言 banner 存在、顺序正确、不破坏原 markdown、且旧行为不会回归。
import fs from "node:fs";
const SRC = "C:/Users/Administrator/.dsh/local-plugins/dsh-chat-image-lightbox/lib/index.js";
const src = fs.readFileSync(SRC, "utf8");

const checks = [];
const chk = (label, cond) => checks.push([label, !!cond]);

// ── 一、源码层断言 ────────────────────────────────────────────────────────
chk("render 已存在", /render:\s*function\s*\(_args,\s*value\)/.test(src));
chk("banner 有「图片还没送达」提示", /图片还没送达/.test(src));
chk("banner 明确「原样复述进正文」", /原样复述进你这条回复的正文/.test(src));
chk("banner 点明工具行折叠不算送达", /工具行折叠，不算送达/.test(src));
chk("banner 带张数提示", /本批 ["']?\s*\+?\s*n|本批/.test(src));
chk("末尾有收尾自检", /收尾自检/.test(src));
chk("banner 在 markdown 之前（不是之后）", src.indexOf("图片还没送达") < src.indexOf("if (value.markdown) lines.push"));
chk("自检提示在 markdown 之后", src.indexOf("收尾自检：本条回复") > src.indexOf("if (value.markdown) lines.push"));
chk("旧行为（只返回 markdown）已不存在", !/render:\s*function\s*\(_args,\s*value\)\s*\{\s*var lines = \[value\.markdown\];/.test(src));
chk("count 缺失时不崩（null 保护）", /typeof value\.count === "number"/.test(src));

// ── 二、逻辑复刻：把 render 的行为抄一遍验证输出形状 ──────────────────────
function renderReplica(value) {
  var n = (value && typeof value.count === "number") ? value.count : null;
  var lines = [
    "⚠️ 图片还没送达。以下 markdown 必须原样复述进你这条回复的正文，否则用户看不到任何图。",
    n !== null ? "（本批 " + n + " 张：正文里应出现 " + n + " 处 ![ ；工具行折叠，不算送达）" : "",
    "",
  ];
  if (value.markdown) lines.push(value.markdown);
  if (value.note) lines.push("", "（" + value.note + "）");
  lines.push("", "⚠️ 收尾自检：本条回复正文里 ![ 的出现次数必须 = 你声称发出的张数。");
  return [{ type: "text", text: lines.join("\n") }];
}

// T1 正常十张图
{
  const md = "![图1][a1]\n\n[a1]: E:/x/1.jpg\n\n![图2][a2]\n\n[a2]: E:/x/2.jpg";
  const out = renderReplica({ count: 2, markdown: md, note: "本地图片已通过插件内置服务直读。" });
  const text = out[0].text;
  chk("T1 返回值非空且为单条 text block", out.length === 1 && out[0].type === "text" && text.length > 0);
  chk("T1 原 markdown 被完整保留", text.includes(md));
  chk("T1 首行就是 banner（模型第一眼看到）", text.split("\n")[0].includes("图片还没送达"));
  chk("T1 张数提示正确（2 张）", text.includes("本批 2 张"));
  chk("T1 note 仍在", text.includes("本地图片已通过插件内置服务直读"));
  chk("T1 收尾自检在最后", text.trimEnd().split("\n").pop().includes("收尾自检"));
  // banner 自身的文字里也含 "![ "（提示语），所以只数 markdown 段内的
  chk("T1 markdown 段内 2 处 ![ 未被改动", (md.match(/!\[/g) || []).length === 2 && text.includes(md));
}

// T2 count 缺失（老调用路径 / 搜索模式）
{
  const out = renderReplica({ markdown: "![图1][b1]\n\n[b1]: https://x/y.jpg" });
  const text = out[0].text;
  chk("T2 无 count 不崩", typeof text === "string" && text.length > 0);
  chk("T2 无 count 时不出张数行", !text.includes("本批"));
  chk("T2 banner 仍在", text.includes("图片还没送达"));
}

// T3 markdown 为空（异常路径）也不崩
{
  const out = renderReplica({ count: 0, markdown: "" });
  chk("T3 空 markdown 不崩", out[0].text.includes("图片还没送达"));
}

// T4 单图
{
  const out = renderReplica({ count: 1, markdown: "![图1][c1]\n\n[c1]: E:/x/a.png" });
  chk("T4 单图张数提示正确", out[0].text.includes("本批 1 张"));
}

// ── 输出 ──────────────────────────────────────────────────────────────────
console.log("投递提醒 banner 回归（v1.9.2）\n" + "─".repeat(74));
let pass = 0, fail = 0;
for (const [label, ok] of checks) { console.log(`  ${ok ? "✓" : "✗"} ${label}`); ok ? pass++ : fail++; }
console.log("─".repeat(74));
console.log(`合计 ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
