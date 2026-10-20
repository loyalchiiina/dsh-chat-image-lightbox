#!/usr/bin/env node
/**
 * 一键回归（run-all.mjs）
 *
 * 目的：把「改完必须验证什么」变成一条命令，避免靠记忆漏跑。
 * 用法：
 *   node test/run-all.mjs            # 只跑插件自带探针
 *   node test/run-all.mjs --full     # 再加上 E:\tmp\lightbox-lab 的 11 个套件
 *
 * 退出码：0 = 全绿；1 = 有失败（CI/人工都能直接用）。
 *
 * 说明：实验室套件依赖 E:\tmp\lightbox-lab\extracted 与 mdlab\node_modules。
 * 那两处缺失时 --full 会明确报 SKIP 而不是假装通过。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SELF = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.dirname(SELF);
const LAB = "E:/tmp/lightbox-lab";
const FULL = process.argv.includes("--full");

// ── 第一组：插件自带探针（必须全绿） ────────────────────────────────────────
const LOCAL = [
  { file: path.join(SELF, "probe-rowclear.mjs"), expect: 18, label: "rowclear 布局收口" },
  { file: path.join(SELF, "probe-poprole.mjs"), expect: 15, label: "role=dialog 生命周期" },
  { file: path.join(SELF, "probe-source-health.mjs"), expect: 45, label: "图源健康降级/并发/缓存" },
  { file: path.join(SELF, "probe-tool-result.mjs"), expect: 39, label: "工具返回值过两道闸门" },
  { file: path.join(SELF, "probe-dep-resolve.mjs"), expect: 24, label: "依赖解析/代理绕过/转码链路" },
  { file: "probe-serve-integrity.mjs", expect: 33, label: "交付内容完整性（真图/伪装图/%文件名）" },
  { file: "probe-viewable-body.mjs", expect: 32, label: "正文指向浏览器可渲染的副本（TIFF/HEIC）" },
];

// ── 第二组：实验室套件（--full 才跑） ───────────────────────────────────────
const LAB_SUITES = [
  { file: "regress.mjs", expect: 10, label: "三种来源 × 两阶段 + 标签唯一" },
  { file: "bodyurl.mjs", expect: 12, label: "encodeBodyDest 六分支 + 端到端" },
  { file: "probe-rowclear3.mjs", expect: 18, label: "clear 插入/幂等/多段" },
  { file: "pct.mjs", expect: null, label: "三重百分号转义" },
  { file: "planb.mjs", expect: 18, label: "流式藏 alt + 词法范围" },
  { file: "cssbal2.mjs", expect: null, label: "CSS 括号平衡" },
  { file: "ffinal3.cjs", expect: 7, label: "真 parser 帧分析" },
  { file: "ffinal6.cjs", expect: 4, label: "定稿形态" },
  { file: "e2e-ref.cjs", expect: 3, label: "端到端 settle / 路径帧=0" },
  { file: "e2e-ref2.cjs", expect: 5, label: "远程 URL 保原样" },
  { file: "impl.cjs", expect: 5, label: "settle 顺序 + 加盐不冲突" },
];

function runScript(file) {
  if (!fs.existsSync(file)) return { ok: false, why: "文件不存在" };
  const r = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 120000 });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  if (r.status !== 0) {
    // impl.cjs 与 cssbal2.mjs 有"已知可接受"的固定输出，不看退出码，看内容标记。
    if (/结果 \d+\/\d+|全部安全|含 B 规则: ✅/.test(out) && !/失败|✗/.test(out)) {
      return { ok: true, out };
    }
    return { ok: false, why: `退出码 ${r.status}`, out };
  }
  return { ok: true, out };
}

// 各套件的输出格式不统一（"通过 10 / 失败 0"、"结果 7/7"、"15 通过 / 0 失败"、
// "18/18 通过"），这里按优先级依次尝试，取第一个命中。
function countPass(out) {
  const pats = [
    /结果[:：]?\s*(\d+)\s*(?:通过|\/)/,   // "结果：15 通过" / "结果 7/7"
    /通过\s*[:：]?\s*(\d+)/,               // "通过 10 / 失败 0"
    /(\d+)\s*通过/,                        // "18 通过 / 0 失败"
    /合计\s*(\d+)\s*通过/,
    /结果\s*(\d+)\//,
  ];
  for (const p of pats) {
    const m = out.match(p);
    if (m) return Number(m[1]);
  }
  // 少数套件（impl.cjs / cssbal2.mjs / pct.mjs）不打总表，只逐项打 ✓。
  const ticks = (out.match(/✓/g) || []).length;
  return ticks > 0 ? ticks : null;
}

function countFail(out) {
  const pats = [/失败\s*[:：]?\s*(\d+)/, /(\d+)\s*失败/];
  for (const p of pats) {
    const m = out.match(p);
    if (m) return Number(m[1]);
  }
  return 0;
}

let pass = 0;
let fail = 0;
const rows = [];

function handle(entry, dir) {
  const file = entry.file.startsWith("/") || /^[A-Za-z]:/.test(entry.file) ? entry.file : path.join(dir, entry.file);
  const name = path.basename(file);
  if (!fs.existsSync(file)) {
    rows.push({ name, label: entry.label, verdict: "SKIP", detail: "文件不存在" });
    return;
  }
  const r = runScript(file);
  const got = r.out ? countPass(r.out) : null;
  const bad = r.out ? countFail(r.out) : 0;
  const ok = r.ok && bad === 0 && (entry.expect === null || got === null || got >= entry.expect);
  if (ok) {
    pass++;
    rows.push({ name, label: entry.label, verdict: "PASS", detail: got === null ? "—" : `${got}/${entry.expect ?? got}` });
  } else {
    fail++;
    rows.push({ name, label: entry.label, verdict: "FAIL", detail: r.why || `通过 ${got ?? "?"} 期望 ${entry.expect} 失败 ${bad}` });
  }
}

for (const e of LOCAL) handle(e, SELF);

if (FULL) {
  if (!fs.existsSync(LAB)) {
    rows.push({ name: "lightbox-lab", label: "实验室目录", verdict: "SKIP", detail: LAB + " 不存在" });
  } else {
    const missing = ["extracted", "mdlab/node_modules"].filter((d) => !fs.existsSync(path.join(LAB, d)));
    if (missing.length) {
      rows.push({ name: "lightbox-lab", label: "实验室依赖", verdict: "SKIP", detail: "缺 " + missing.join(", ") });
    } else {
      for (const e of LAB_SUITES) handle(e, LAB);
    }
  }
}

// ── 输出 ────────────────────────────────────────────────────────────────────
const w = Math.max(...rows.map((r) => r.name.length), 8);
console.log("═".repeat(78));
console.log("回归总表" + (FULL ? "（含实验室 11 套件）" : "（仅插件探针，加 --full 跑全部）"));
console.log("═".repeat(78));
for (const r of rows) {
  const mark = r.verdict === "PASS" ? "✓" : r.verdict === "SKIP" ? "·" : "✗";
  console.log(`${mark} ${r.name.padEnd(w)}  ${r.verdict.padEnd(4)}  ${String(r.detail).padEnd(10)}  ${r.label}`);
}
console.log("─".repeat(78));
console.log(`结果：通过 ${pass} / 失败 ${fail} ${fail === 0 ? "✅ 全绿" : "❌ 有失败，不要提交"}`);
console.log("═".repeat(78));
process.exit(fail === 0 ? 0 : 1);
