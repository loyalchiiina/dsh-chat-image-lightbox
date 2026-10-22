#!/usr/bin/env node
/**
 * probe-toolview-urls.mjs — 工具行图片抽取（igImageUrls）回归
 *
 * 为什么需要这个探针（v1.9.0 事故）：
 *   1.8.0 把正文 markdown 从「内联式」改成「引用式」（`![图1][ab3]` +
 *   `[ab3]: C:/…/x.jpg`），目的是让流式期间不会把半截路径刷进对话。但
 *   `lib/client.js` 里的 `igImageUrls` 正则当时没跟着改，一直只认内联式。
 *   结果从 1.8.0 到 1.8.9，`DisplayImageRow` 永远抽到 0 个 URL，永远走
 *   纯文本分支——工具行展开后只显示 markdown 原文，一张图都不出。
 *
 *   插件侧的其它 8 个探针全部 PASS 也发现不了这个缺陷：它们验的是宿主侧
 *   交付链路（图源/转码/两道闸门/正文副本），没有一个覆盖客户端抽取函数。
 *   所以这个探针的价值不在「多一条断言」，而在「把客户端那一半也纳入回归」。
 *
 * 断言口径：
 *   - 引用式 / 内联式 / 折叠式 / 简写式 四种 markdown 形态都要能抽到
 *   - 本地 Windows 绝对路径必须被改写成 `/images/?abs=`（renderer 跑在
 *     `dsh-app://app`，裸 `C:/…` 会按该 origin 解析，永远加载不出来）
 *   - http(s) / 已根相对 / data: 原样透传，不改写
 *   - 无定义的引用式、纯文本、空串 → 0 个（负控必须红）
 *   - 重复 URL 去重；标签大小写不敏感（与宿主 renderImageReference 一致）
 *
 * 直接执行 `node test/probe-toolview-urls.mjs`，退出码 0 = 全绿。
 */
import fs from "node:fs";
import path from "node:path";

const SELF = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CLIENT = path.join(path.dirname(SELF), "lib", "client.js");
const SRC = fs.readFileSync(CLIENT, "utf8");

// 从 client.js 原文里取出两个函数（不转抄，保证探针验的就是发货代码）。
function grab(name) {
  const start = SRC.indexOf("function " + name + "(");
  if (start < 0) throw new Error("client.js 里找不到函数: " + name);
  let i = SRC.indexOf("{", start);
  let depth = 0;
  for (; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error("函数体不完整: " + name);
}

const factory = new Function(
  grab("igLocalToRoute") + "\n" + grab("igImageUrls") + "\nreturn { igImageUrls, igLocalToRoute };"
);
const { igImageUrls, igLocalToRoute } = factory();

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log((ok ? "✓" : "✗") + " " + label + (ok ? "" : "\n    期望 " + JSON.stringify(want) + "\n    实得 " + JSON.stringify(got)));
}

const ABS = "C:/Users/Administrator/.dsh/image-gallery-auto/a.jpg";
const ABS_ROUTE = "/images/?abs=" + encodeURIComponent(ABS);

// ── 1. 引用式：工具真实输出形态（1.8.0 起的发货形态，必须能抽到） ──────────
check(
  "引用式（工具真实输出）×2 张",
  igImageUrls("![图1][grs1]\n\n[grs1]: " + ABS + "\n\n![图2][grs2]\n\n[grs2]: C:/Users/x/b.png"),
  [ABS_ROUTE, "/images/?abs=" + encodeURIComponent("C:/Users/x/b.png")]
);

// ── 2. 内联式三种目标形态 ───────────────────────────────────────────────────
check("内联式 + Windows 绝对路径", igImageUrls("![图1](" + ABS + ")"), [ABS_ROUTE]);
check("内联式 + 根相对 /images", igImageUrls("![图1](/images/?abs=C%3A%2FUsers%2Fx.jpg)"), ["/images/?abs=C%3A%2FUsers%2Fx.jpg"]);
check("内联式 + http", igImageUrls("![图1](https://example.com/a.jpg)"), ["https://example.com/a.jpg"]);

// ── 3. 折叠式 / 简写式 ──────────────────────────────────────────────────────
check("折叠式 ![label][]", igImageUrls("![grs1][]\n\n[grs1]: " + ABS), [ABS_ROUTE]);
check("简写式 ![label]", igImageUrls("![grs1]\n\n[grs1]: " + ABS), [ABS_ROUTE]);

// ── 4. 负控：这些必须是 0（探针要有鉴别力） ────────────────────────────────
check("无定义的引用式 → 0", igImageUrls("![图1][nope]"), []);
check("纯文本 → 0", igImageUrls("已交付 5 张图，见工具行"), []);
check("空字符串 → 0", igImageUrls(""), []);
check("undefined → 0", igImageUrls(undefined), []);

// ── 5. 去重 / 大小写 / data: ────────────────────────────────────────────────
check("同一 URL 出现两次 → 去重为 1", igImageUrls("![a][x]\n\n[x]: " + ABS + "\n\n![b][y]\n\n[y]: " + ABS), [ABS_ROUTE]);
check("标签大小写不敏感", igImageUrls("![a][GRS1]\n\n[grs1]: " + ABS), [ABS_ROUTE]);
check("data: 原样透传", igImageUrls("![a](data:image/png;base64,AAA)"), ["data:image/png;base64,AAA"]);

// ── 6. 混合形态，顺序必须与文档顺序一致 ────────────────────────────────────
check(
  "混合 3 张，文档顺序保持",
  igImageUrls("![1][a]\n\n[a]: C:/1.jpg\n\n![2](https://e.com/2.jpg)\n\n![3](/images/?abs=x)"),
  ["/images/?abs=" + encodeURIComponent("C:/1.jpg"), "https://e.com/2.jpg", "/images/?abs=x"]
);

// ── 7. 路由改写函数的边界 ──────────────────────────────────────────────────
check("带空格路径被正确编码", igLocalToRoute("C:/a b/c d.jpg"), "/images/?abs=" + encodeURIComponent("C:/a b/c d.jpg"));
check("反斜杠路径也改写", igLocalToRoute("C:\\Users\\x.jpg"), "/images/?abs=" + encodeURIComponent("C:\\Users\\x.jpg"));
check("http 不改写 → null", igLocalToRoute("https://e.com/a.jpg"), null);
check("根相对不改写 → null", igLocalToRoute("/images/?abs=x"), null);
check("data: 不改写 → null", igLocalToRoute("data:image/png;base64,AAA"), null);
check("空串 → null", igLocalToRoute(""), null);

console.log("\n结果 " + pass + "/" + (pass + fail) + "  失败 " + fail);
process.exit(fail === 0 ? 0 : 1);
