# dsh-chat-image-lightbox 经验总账

> 跨 5 段会话的实战经验。写作时间 2026-10-21，版本基线 **1.8.9**。
> 目的：**下一个人（或下一次的自己）不用再踩一遍**。所有结论都带实测证据或代码坐标，不写"应该没问题"这种话。

---

## 0. 这份文档怎么用

| 你要做的事 | 直接跳 |
|---|---|
| 改插件代码前，先知道宿主有哪些死规矩 | §3 宿主硬约束清单 |
| 想验证"改好了没有" | §2.1 三层验证 + §2.2 探针纪律 |
| 用户又回你"一张没看见" | §4 图片投递铁律 |
| 搜图给不出图 / 给坏图 | §6 搜图链路 |
| 不知道自己又犯了哪个老错 | §7 反模式清单 |
| 想改界面功能（网格/列数/隐藏/灯箱） | §8 功能实现方法总账 |
| 想知道本地和 GitHub 差多少 | §9 上游差异 |
| 想复用现成的脚本/素材 | §10 资产索引 |

---

## 1. 会话谱系：每段留下了什么

| # | 会话 | 主题 | 留下的资产 |
|---|---|---|---|
| ① | `session-9b71641f` → `be72f192` | 从"改 asar、加遮罩"转向"到底什么问题没解决" | 认清"图片并列 + 文字不干扰"是不可回退的既有成果；"越修越乱"的观感来源（三处副本不同版本） |
| ② | `session-769d4e8f` | 模型列表/图片开关/推理等级的批量配置 | 与本插件无关，但同一套"配置要逐项核对、不许只看总开关"的纪律 |
| ③ | `session-d95237a9` | 流式期闪字符串、遮罩方案、A/B 方案定论 | **A 方案定论（不改 asar）**、`docs/VERIFIED-BASELINE.md`（236 行）、三层备份、`test/run-all.mjs` 一键回归、tag `v1.8.0-verified` |
| ④ | `session-407184b5` | 真发图验收驱动的 1.8.0→1.8.8 修 bug 战役（20 轮） | 每版 CHANGELOG 带实测对照；19 个探针套件；三处副本 Junction 同源 |
| ⑤ | 本次会话 | 10 格式 × 2 张全类型发图验收 + 文档/截图翻新 | 全格式验收表、`docs/EXPERIENCE.md`（本文）、六张真实效果图、1.8.9 铁律强化 |

**读谱系的两条结论**：

1. **同一个坑会跨会话重复**——"用户看不见图"在 ①③④⑤ 四段里各出现一次，每次的原因都不同（坏图源 / 流式期字面量 / 转码缺失 / 工具行折叠）。所以**症状同、根因必须重查**，不能套用上次结论。
2. **成果会跨会话丢失**——①里被验收通过的"图片并列 + 文字不干扰"，③因为改标签盐值把流式字面量从 8 字符变 11 字符而"改进变退步"。所以要有 §2.6 的基线固化。

---

## 2. 方法论（可迁移到任何 DSH 插件）

### 2.1 三层验证：只有界面层能验收

| 层 | 手段 | 能证明 | 不能证明 |
|---|---|---|---|
| 逻辑层 | 探针脚本断言 | 函数算得对、返回结构合 schema | 工具返回值会不会被**宿主校验拒收** |
| 运行时层 | `node --check` | 语法没崩 | 任何运行时行为 |
| **界面层** | **把图真发进对话正文，让用户看一眼** | 图**真的能显示**、布局对不对 | —— |

**实证**：1.8.1 我做了前两层，报"15 套件全绿"，用户一重启 `display_image(query=…)` **100% 报错**。旧探针只测内部函数，从不构造真实工具返回值，所以从不经过宿主的两道闸门。

### 2.2 探针必须有"鉴别力"（负控必须红）

任何新探针都要做一次**负控实验**：把它指向**坏代码**，它必须失败。

| 探针 | 正向 | 负控（指向坏代码） |
|---|---|---|
| `probe-source-health.mjs` | 45/45 | 指向 1.8.0 源码只过 4/22 |
| `probe-serve-integrity.mjs` | 33/33 | 把 `looksLikeImage` 改成恒 `true` → 失败 8 项 |
| `probe-heic-real.mjs` | 24/24 | 删掉 WIC 兜底 → 11 通过 / 4 失败 |
| 依赖自检 | 24/24 | 用坏副本 → 21/24，红的正是 `(sharp: available)` 那条 |

**拿现行 schema 做负控 = 自欺**（第一版我就那么写的，已改）：负控必须复现**旧版本的真实形状**。

### 2.3 探针不许复制生产逻辑

复制算法进探针 → 你测的是"复制品的对错"。1.8.4 就栽在这：`resolveDep` 少写一行 `var` → 每次抛 `ReferenceError` → `catch { return null }` 吞成 `null` → sharp 静默失效，**探针照样 23/23 全绿**。

正解：**import 真插件 → `apply()` → 只认它自己日志里打印的 `(sharp: available)`**。

### 2.4 真样本铁律：素材本身要先验

本机那个 `6239785344_…_毛晓彤__@weibo.com.heic` 前 32 字节是 `ff d8 ff e0 … JFIF`——**后缀 .heic，内容是普通 JPEG**。就因为这，1.8.3/1.8.4/1.8.5 三个 CHANGELOG 里那句「HEIC 已验证通过」全是假的；真 HEVC 一测立刻炸（`Support for this compression format has not been built in: HEVC`）。

**规矩**：`probe-heic-real.mjs` 的**第一条断言就是「素材不能是错标 JPEG」**。任何"XX 格式已验证"的结论，必须先证明样本的 magic 字节对得上。

### 2.5 时间线核对：没重启就是没生效

每一次"改了却没效果"，先比两个时间：**宿主进程启动时间** vs **源码 mtime**。

> 实例：宿主 `00:27:00` 启动，源码 `00:33:24` 才改完，`00:39:26` 写入的坏图仍是旧代码产出——我差点把它当成"修复失败"再改一遍。

日志侧佐证：`image-gallery: serving from … (sharp: available)`、`image delivery law registered (order 1500, N chars)`、`display_image tool registered`。**`N chars` 变化是判断铁律是否真加载的最快指纹**（1.8.6=537 → 1.8.7=682 → 1.8.9≈826）。

### 2.6 基线固化：验收过的写成代码坐标

`docs/VERIFIED-BASELINE.md`（236 行）记录 10 条已验收功能 + 受保护代码坐标 + 5 处版本分叉风险 + 10 条改动检查清单。git 侧打 tag：

```bash
git reset --hard v1.8.0-verified   # 一条命令回到验收态
```

三层备份（`~/.dsh/backups/dsh-chat-image-lightbox-1.8.0-<ts>/`）：源码 zip + 全分支 git bundle + 关键文件散装 + 144 个测试脚本 + SHA256.txt。**为什么三层**：只拷 zip 丢 git 历史；只拷 git 怕 `.git` 损坏；只拷关键文件丢测试脚本。

### 2.7 三处副本必须同源

`profiles/desktop`、`profiles/web`、`profiles/xiufu` 三处安装。1.8.0 时代是三份**拷贝**，结果"重启按声明回退到旧版"、web 端还是 1.7.11（我改的东西在 web 端一个都不存在）。

现在：三处全部 `link:` + **Junction 指向 `~/.dsh/local-plugins/dsh-chat-image-lightbox`**，以 `lib/index.js` 的 SHA256 三处一致为准。

### 2.8 诚实汇报：失败说出来，不许静默吞

- `catch (e3) {}` 空捕获 = 用户拿到一整屏坏图而日志干净。现在转存失败记 `rescueError`，note 明写「有 N 张被原站点拦截且无法转存」。
- 官方站点真的上不去（duitang/renwuji `Client network socket disconnected before secure TLS connection was established`），就如实说"本机到不了"，不假装成功。

### 2.9 不擅自 push / publish

`git push`、`npm publish` 每一版都等用户单独授权，且发布时 **GitHub 与 npm 必须同版本同内容**。

---

## 3. 宿主（DSH）硬约束清单

> 这一节是最贵的部分：全部来自读 `app.asar` 真实源码 + 实测，不是猜的。

### 3.1 正文图 与 工具行图 是两条完全不同的链路

| 路径 | 走谁 | 转码吗 |
|---|---|---|
| 工具行里的图 | 插件自己的 `/images` 路由 | ✅ TIFF→PNG、HEIC→WebP |
| **正文里的图** | 宿主把 `![](C:/…/x.tiff)` 改写成 `api/file?path=…` | ❌ `serveFile` 只按扩展名给 MIME，**原字节直出** |

宿主源码：`const mediaType = mime.lookup(target.displayPath) || "application/octet-stream"`。所以 `.tiff` → `image/tiff` → Chromium 没有解码器 → 「图片无法预览」。

**这是 1.8.5 的全部意义**：交付前先用 sharp 转一份浏览器能渲染的副本（无损源出 PNG、其余出 WebP q92），正文指向副本、原文件保留在 `localPath`。转码后仍超宿主单图上限（默认 **20 MB**，超了答 **413**，同样是"图片无法预览"）就按 ×0.7 递减宽度重转，最多 5 轮。

### 3.2 流式期本地图物理上不可能渲染

宿主写死两行，插件层绕不过：

```js
const file = streaming ? void 0 : parseFileLink(destination);   // 流式期跳过解析
pathImages: void 0                                              // 流式期不给本地图解析器
```

后果：流式期正文里会闪 `![图1][m541` 这类**字面量**（最长 17 字符、0.5~2 秒），settle 后正常出图。**路径本身实测 0 帧泄漏**（引用式定义行 `[m541]: C:/…` 被 `renderBlocks` 的 `.filter(e => e !== null)` 过滤掉）。

不要试图用 CSS/正则去遮：`!`、`![注意] 这里要说明一下`、完整内联图都会被误伤（172 种真实帧里只命中 84 种）。**A 方案（接受现状）是用户拍的板**，理由是 B 方案（改 asar）三条硬阻塞见 §3.9。

### 3.3 desktop 端 origin 是 `dsh-app://app`

绝对回环 `http://127.0.0.1:<port>/images/…` 对页面而言是**跨源**，Chromium 渲染进程直接拦掉（`fetch` → `TypeError: Failed to fetch`、`<img>` → `onerror`，服务器命中 0）。站内根相对路径才继承页面源。

**同理**：本地图在流式期能出图的唯一通路是 `http(s)` 绝对 URL（`remoteImageUrl` 在 `imageSource` 里先于 `pathImages` 执行），但这条路在 desktop 是死的；web 端（页面自身就是 `http://127.0.0.1:port`）才成立。

### 3.4 输出侧两道闸门（漏一个字段整条结果作废）

1. **无损 JSON**：嵌套 `undefined` / `NaN` / `Infinity` / `-0` 一律拒收；
2. **`output.schema` + `additionalProperties: false`**：未声明字段 → 整条作废。

任何新加字段（`rescueError`、`unverified`…）**必须同步进 schema**；任何数字字段用 `Number.isFinite` 条件写入。宿主不是字段级容错，是**整条丢弃**。

### 3.5 工具结果默认折叠

界面把工具调用折成一行「⊗ 已调用工具，更新了计划，已写入文件」。**用户滚动正文看不到工具结果里的任何图**。这条不是风气问题，是界面行为 → 只能用铁律强制正文复述（§4）。

### 3.6 `IMAGE_ENVELOPE` 白名单只认 `read_image`（宿主架构级）

宿主源码 `lib/types/client/tool/models/image-card-model.js`（app.asar 内）：

```js
const IMAGE_ENVELOPE = /^<path>[^\n]*<\/path>\n<type>image<\/type>\n<content>\n[\s\S]*\n<\/content>$/u;
const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
function imageCardModel(block) {
  if (!("kind" in block) || block.isError) return null;
  const call = parsedToolCall(block);
  if (call?.name !== "read_image") return null;
  ...
}
```

- 只有 `read_image` 的工具结果会被提升成图片卡片；`display_image` 不在白名单，**永远拿不到这条通道**。
- `extraTexts(content)` 会把非 envelope 的 text 块拼在 gallery 下方；`fullyRendered(content)` 要求每块都合法，否则整条降级成 generic card。

配套：原生工具的 `output.render` **不能**返回图片块。宿主 `assertRenderedContent(value)` 只接受「content block 数组」（实际只能 `{ type: "text", text }`），否则抛错；只有 MCP 桥接的 `createMcpToolDefinition` → `prepareImageProjection` → `attachments.saveImages(decoded)` → `{ type: "image", attachment }` 这条路能产出图片块。原生插件工具走不了。

→ **结论：插件侧无法把图塞进工具结果让界面直接出图。「必须把 markdown 复述进正文」不是偷懒约定，而是宿主架构决定的唯一可行路径。**

### 3.7 `tool.call.images` 是官方图片槽位，只服务 `read_image`

槽位声明（宿主 `packages/client/ui-tool/src/client/contract/slots.ts:44`）：

```
{ key: "tool.call.images", kind: "single", scope: "session",
  summary: "Durable images of a settled image-bearing Tool call, rendered through the attachment presentation plugin.",
  declaredBy: "an entry in 'tool.call.toolview' (client-ui-tool), so it exists while that entry is mounted",
  occupants: ["client-ui-attachment MessageImages"], replaceRisk: "shadows-shipped-ui" }
```

官方填充者是 `client-ui-attachment` 的 `MessageImages`（`priority: 100`，同时填 `conversation.chat.user.images` / `conversation.chat.message.images` / `conversation.trajectory.images` / `tool.call.images`）。

官方 `read-image-toolview` 的注册范式（**声明 children 才能拿到槽位**）：

```js
ctx.slots.register({
  name: "tool.call.toolview", key: "read_image", locale: CONVERSATION_NS,
  children: { "tool.call.images": { kind: "single", scope: "session" } }
}, ReadImageRow);
```

宿主 README 原文：「内嵌图像预览依赖 UI 组合：工具结果卡片经由浏览器的 `tool.call.images` 槽位渲染图像，由附件呈现插件填充；**未组合该插件的 UI 改为显示结果的信封文本**。」

本插件 `lib/client.js` 的 `DisplayImageRow` 注册为 `{ name: "tool.call.toolview", key: "display_image" }`，**未声明 `children["tool.call.images"]`**。即便声明了也不解决问题——因为 3.6 的白名单只放 `read_image` 进来。声明与否的唯一差别是「能不能借官方附件组件渲染」，改变不了「藏在折叠区里」这个事实。

### 3.8 `ToolRow` + `useDisclosure`：工具行默认折叠的代码坐标

宿主 `lib/types/client/tool/` 的 `ToolRow` 组件：

```js
const { expanded, toggle: toggleExpand } = useDisclosure();
const imageBody = image !== void 0 && image !== null && renderSlot !== void 0 && loadImage !== void 0 ? image : null;
const card = askQuestionBody ?? terminalBody ?? diffBody ?? readBody ?? imageBody ?? searchBody ?? webBody ?? detailsBody;
const expandable = state !== "preparing" && (inputRaw !== null || outputText !== null || card !== null);
const open = expanded && expandable;
```

`function useDisclosure(version = 0) { const [expandedVersion, setExpandedVersion] = react.useState(null); return { expanded: expandedVersion === version, ... } }` → **`expandedVersion` 初值 `null`，默认折叠**。

图片**只在 `open === true` 的 `expandedContent` 分支里渲染**；折叠态 `collapsedContent` 只渲染一行 `summaryText` + ExitCodeBadge + suffix + diffStat。

再往上一层：一轮内的多次工具调用还会被折进 `ProcessGroup`（`var ProcessGroup = class { key; turn; members; nodes = []; ... }`，DOM 属性 `data-step-process` / `data-step-process-body`），`ProcessGroupHeader` 用 `data?.closed === false && policy.liveProcessDetail` 决定是否展开 → **过程组也是默认收起的**。

→ 所以：任何工具的图片，用户都必须手动点开工具行才看得见；`display_image` 的图即使 `DisplayImageRow` 渲染完全正确，也藏在两层折叠里。这就是「必须复述进正文」的最终架构证据。

### 3.9 改 asar 为什么被否（B 方案）

| 阻塞 | 实测依据 |
|---|---|
| 没有"装插件时自动执行"的钩子 | `dshmarket/lib/profile.js` 只做 manifest/lockfile/pnpm，无 postinstall 语义 |
| 改了也必须完全重启 | `record.bundle` 读进内存后 `serveBundle` 只查内存 Map，唯一刷新通道 `rebuilt(id)` 比对 mtime，asar 是虚拟路径触发不了 |
| **与已有的 asar 补丁直接冲突** | 机器上已有 `~/.dsh/backups/asar-patch-20261021` 在改 header 的 integrity 哈希；两个自动化写同一个 180 MB 文件、无锁无协商 → DSH 直接起不来 |
| 升级即失效 | DSH 升级整包替换 `app.asar` |

---

## 4. 图片投递铁律：条款演进与事故

### 4.1 事故（1.8.8 失效的记录，务必读）

20 张全格式图交付成功 → 我把图全留在 `display_image` 的工具结果里，**正文只写了一张"格式对照表"** → 用户两次追问：

> 「啥意思你把图发哪里了」→「一张没看见啊」（附截图：正文只有表，工具行折成一行灰字）

**为什么旧铁律挡不住**：1.7.8~1.8.8 只写了「不得只依赖工具调用行」。我确实"没有只依赖"——正文写了字。形式上合规，实质上零图。

### 4.2 1.8.9 条款（`lib/index.js` → `IMAGE_LAW_TEXT`）

1. **必须复述**：display_image 返回后，把 markdown 原样抄进当前回复正文；只留工具结果 = 违规。
2. **表格、结论、清单都不算图**：正文里没有 `![` 就是没发图。
3. 每张图各自成段，禁止「见上文」「已发送 N 张」「图已生成」。
4. 路径不是图、链接文字不是图。
5. 引用式两行（`![图1][1]` + `[1]: C:/…`）必须成对出现，只贴一行会渲染失败。
6. 编号由插件决定；多批用 `start=<上一批末尾+1>`，否则正文出现两组「图1」（1.8.7 用户实测抱怨「为啥从序号3开始」）。
7. **收尾自检**：数正文里 `![` 的出现次数，必须等于声称的张数。

### 4.3 编号 `start` 参数的由来

`bodyMarkdown` 的 alt 是"本次调用内"的序号。一个回复调 3 次（目录 4 张 + keep 2 张 + 搜图 3 张）→ 三组「图1…」→ 用户看到"从序号 3 开始"。1.8.7 加 `start` 参数解决。

---

## 5. 版本账（1.8.0 → 1.8.9）

| 版本 | 提交 | 症状 → 根因 → 修法（一句话） |
|---|---|---|
| 1.8.0 | `5c4433c` | 正文改引用式图片（0 路径泄漏）+ 流式藏 alt + 图片行收口 clear |
| 1.8.1 | `016f95f` | 搜图"有结果"≠"图源可用" → 健康门禁 / 并发转存 / 缓存上限 / 失败如实上报 |
| 1.8.2 | `13acf5e` | 搜图 100% 报错 → Bing 排首位且不带宽高（`width: undefined`）+ `rescueError` 未进 schema → 撞宿主两道闸门 → 补声明 + `Number.isFinite` + `lossless()` 清洗 |
| 1.8.3 | `edc5c82` | 健康门禁把"探测失败"算成可加载（ratio 被稀释成 1.0）→ 只认 2xx + `image/*`；坏图直接从结果剔除不发 |
| 1.8.4 | `f397f61` `f581ad8` | TIFF/HEIC 全挂 → Junction 让 `createRequire` 从解析链上排除 sharp → `resolveDep()` 多根解析（含显式扫 profiles）；「直连」其实走代理 → 改 `node:https` + 显式 Agent |
| 1.8.4 | `e5c6835` | CDN 错误页被当图片发出 → 三层都只查状态码/content-type → 按 magic 字节判定，伪装文件 415；文件名含 `%` 被二次解码 → 优先已解码值 |
| 1.8.5 | `79e5575` | 正文 TIFF/HEIC 永不显示（走宿主 `api/file` 不转码）→ `ensureViewable()` 转副本 + `bodyPath()` 优先 `viewPath` |
| 1.8.6 | `0468c7d` | 真 HEIC 从没成功过（libheif 无 HEVC 解码器）→ Windows WIC 兜底（`-EncodedCommand`，永不经过命令行解析） |
| 1.8.7 | `fae2bc8` | 搜图只抽样 4 张就放行（图8 死链 404 XML、图9 307 跨域）→ 交付前逐张下载 + magic 校验；正文编号每次从图1 重数 → `start` 参数 |
| 1.8.8 | `cc9c6e4` | 搜「喜羊羊」3 张一张给不出（前几条 403）→ 候选池 `want×4`、分批下载凑够就停、403/401/567 换同源 Referer 重试 |
| 1.8.9 | 本条 | 铁律可被"只写表格"绕过 → 6 条硬约束 + 计数自检；六张效果图换真实截图；新增本文档 |

**贯穿所有版本的一条规律**：每次"修好了"之后，**下一轮真发图一定还能挖出新 bug**。这不是悲观，是 1.8.0→1.8.9 的实测事实（9 个版本 9 次）。所以验收必须每轮真发图，不许用"上次通过"代替。

---

## 6. 搜图链路经验

| 环节 | 坑（实测） | 现在做法 |
|---|---|---|
| 图源健康 | 花瓣 `api.huaban.com` 返回 200 + 20 条 pins，但图片域名全 567（腾讯 EdgeOne 拦非浏览器） | 每源**抽样 4 张按浏览器方式真探**，可加载率 < 30% 换下一个源；全不达标退回最高者并标 `degraded` 如实说明 |
| 可加载率口径 | 探测失败被算成可加载，note 写"4 张可加载"实际 2 张 fetch failed | ratio **只由确认 2xx + `image/*` 决定**；三种结果分开计数（可加载/被拦/未验证） |
| 候选池 | 只要 `want` 张 → 前 3 条恰好全 403 → 整查询失败 | `want × 4`，上限 40；每批 8 张、凑够 `want` 就停，四路并发打满 |
| 403 / 567 | 不存在"对所有主机都正确的 Referer"：`i1.hdslb.com` 要自身域名，`gd-hbimg.huaban.com` 要花瓣 Referer（自身反而 567） | 403/401/567 时**换同源 Referer 再试一次**；实测 33/36（单用一种 32/36） |
| content-type 会骗人 | CDN 返回 `200 + image/jpeg + HTML 正文`，三层全放行 → 一屏坏图 | 按 **magic 字节**判定（JPEG/PNG/GIF/WEBP/TIFF/BMP/ISOBMFF）；不是图 → 415 + 说明 |
| 探针取得到 ≠ 正文显示得出 | `getBytes` 手动跟 5 跳重定向 → 探针看到 200 真图；浏览器跨源 307 被拦 | 交付前**逐张下载落本地 + 校验 magic**，正文指向本地副本；下载失败剔除不发 |
| 图源顺序 | Bing 可用率 42~58%；搜狗接口回 `{"status":1,"info":"forbid"}` | Bing → 花瓣 → 搜狗；搜狗遇 forbid 立即抛"此图源暂不可用"，不空等 20 秒 |
| 缓存卫生 | `image-gallery-auto` 曾 129 文件 / 183 MB 无任何清理；同图按不同 width 各存一份 | `pruneAutoCache()`：> 500 文件或 > 512 MB 按 mtime 从旧删；单删失败（EBUSY）跳过 |

**用户提出过但不符合实际的方案（要会解释）**：「403 的就保存下来再发」——大部分 403 是**根本拿不到字节**，没有可保存的内容；真正的解是候选池 + Referer 切换。这个方向对，做法要修正。

---

## 7. 反模式清单（我犯过的，按代价排序）

| # | 反模式 | 代价 | 正确做法 |
|---|---|---|---|
| 1 | 只写表格/结论，图留在工具行 | 用户 20 张一张没看见，来回两轮 | §4.2 第 1、2、7 条 |
| 2 | 三层验证只做前两层就报"全绿" | 用户一重启功能 100% 挂 | §2.1 界面层才算验收 |
| 3 | 探针复制生产逻辑 | 23/23 全绿而 sharp 静默失效 | §2.3 import + apply |
| 4 | 拿真样本，但不验样本自己是真格式 | 三版 CHANGELOG 的"HEIC 已验证"是假的 | §2.4 先验 magic |
| 5 | 改了不看进程启动时间 | 把"没重启"误判成"修复失败"，重复改 | §2.5 |
| 6 | 修一个用户没抱怨的 bug，把用户在意的指标改差 | 字面量从 8 字符变 11 字符 | 指标交换要先问用户 |
| 7 | 空 `catch {}` | 一屏坏图 + 日志干净 | §2.8 |
| 8 | 建在偏题之上的进度（升版本、写 CHANGELOG） | "越修越乱" | 先对齐问题再动手 |
| 9 | 用户说"测试"就去做接口/环境取证 | 用户制止：「我说的测试是发图测试」 | 先确认测什么 |
| 10 | 把凭记忆/猜测当结论 | 校验项全是错的 | 一切结论带出处（日志/源码行号/实测数字） |

---

## 8. 功能实现方法总账（client 侧，网格/列数/隐藏/灯箱怎么做的）

> 上一轮只记了"结论"，没记"方法"。这一节补上：每个界面功能**怎么做成的**、代码坐标在哪、以及为什么不能用另一种更自然的写法。

### 8.1 总纲：只加 class + 行内 `!important`，绝不移动 React 拥有的节点

DSH 的会话树归 React 所有。把图片 reparent 进自己创建的容器 → 宿主抛 `[object DOMException]`，**整段会话渲染不全**。
所以缩略图、分列、隐藏全部是"给已有节点打标记 + 用 CSS 改变布局"，唯一允许的 DOM 写操作是**创建自己的隐形占位元素**（§8.3-⑤），且必须由 `clearGridHosts()` 可逆撤销。

### 8.2 功能 → 方法 → 代码坐标（`lib/client.js`）

| 功能 | 实现方法 | 坐标 |
|---|---|---|
| **缩略图/分列** | `tickThumb()` 只给 `<img>` 加 `.dsh-ig-tile`、给**直接父级**加 `.dsh-ig-tilewrap`，列宽靠 CSS 变量 `--dsh-ig-cols` | `tickThumb` :1619、`untickThumb` :1776、`gridColumnCount` :1608 |
| **列数设置即默认值** | 工具栏输入框 = 默认值设置器：提交即 `setTileColumns()` → `localStorage[`dshIgTileColumns.default`]`，1–12 夹取，并主动删掉 4 个历史 key | `loadTileColumns` :1488、`setTileColumns` :1498 |
| **行末收口** | JS 不知道布局在哪换行，于是按**文档序第 N 个** tile 给 wrapper 打 `.dsh-ig-rowend`（`clear:both`），让后续正文另起一行 | `tickThumb` :1653-1670 |
| **短行补位** | 缺格处插入**隐形 float 占位元素**（`markGridHosts` 创建，`clearGridHosts` 撤销） | `markGridHosts` :1829、`clearGridHosts` :1923 |
| **隐藏/展开** | `.dsh-ig-hidden-block` 上 `display:none !important`，并且用 `:has(> img)` / `:has(> * > img)` **把外层包裹一起收掉**——这才是"不留空白带"的关键 | CSS :434-444、`setBlockMode` :1393、`blockMode` :1383 |
| **分组** | `isChatImage`（排除头像/图标）→ `messageContainer` → `groupFor`；同一段连续 DOM 用 `areAdjacent` + `runGroups` 切组 | :1206 / :1264 / :1317 / :1577 / :1589 |
| **图片身份键** | `srcKey()` = `img.currentSrc || img.src`，**原样作键、不剥 `?w=`**；`?w=` 只在"取原图"时剥掉，用于灯箱 src、下载与 `dataset.dshOrigSrc` | `srcKey` :1374、`stripResizeParam` :911（调用点 :920 / :1101 / :1753） |
| **缩略图取图** | ⚠️ **当前未接线**：`thumbnailSrcFor`（:1570，意图是给本地路由图追加 `?w=600`）**全仓零调用**，`isLocalImagePath`（:1567）**只被这个死函数调用**；缩略图模式并不改 `src`，全靠 CSS 尺寸 | 死代码，见 §8.5 |
| **灯箱** | `ensureLightbox()` 单例 + `open/navigate/close` 状态机；缩放 `setZoom` 0.25 步进 + `applyZoom` 一次写 transform；`prefetchNeighbors` 预取相邻图 | :629 / :839 / :902 / :1064 / :1088 / :1055 |
| **下载** | 同源图才走"另存为"（跨域会变成新标签页打开）；文件名由 `sanitizeName` 清洗 | `downloadCurrent` :1137、`sanitizeName` :1125 |
| **复制路径** | `navigator.clipboard` + `textarea` 兜底，成功后 `flashButton` 反馈 | `copyImagePath` :983 |

### 8.3 十条硬教训（每条都对应一次真实故障）

| # | 教训 | 证据 |
|---|---|---|
| ① | **列宽必须落在 wrapper 上，不能落在 `<img>` 上**。每个 markdown 图各在自己的 `<p>` 里，`float` 只在自己容器内生效 → 每个 tile 仍独占一行 | 早期"列数无效"报告 |
| ② | **wrapper 判定条件是"里面没有散文"，不是"唯一元素子节点"**。多图共享一个容器时后者直接拒绝 → 24 张只生成 12 个 wrapper | 诊断 "24 images enhanced, only 12 tile wrappers" |
| ③ | **布局定位只用 `parentElement`，绝不用 `closest()` 去"找该 float 的容器"**。`closest()` 会一路向上撞上某个"只有一个元素子节点"的大容器，给它 float:left + width:1/N → 会话头像被浮到角落并缩小。**但 `closest()` 本身不禁用**：全文件 8 处都是"祖先类型判定"用途（跳过头像/侧栏/工具栏、判"在灯箱遮罩里"、判"在按钮里"），见 §8.5 | 真实事故 + 实测 8 处合法用法 |
| ④ | **必须幂等 + 抑制 MutationObserver**。重复写同一个行内值也算一次 mutation，观察者据此要求再跑一遍 → 死循环冻 UI。三件套：`dataset.dshIgTile` 印章、`suppressObserver(ms)`、`setTimeout` 60ms 合并 | v1.7.2 打字冻界面 |
| ⑤ | **短行缝隙靠"补位"而不是"换布局"**。flex 父级、inline-block 行、grid host 三种重写全部失败——grid host 要求"容器里只有图片"，而 DSH 的行里永远还有散文 | 注释原文：「None of them ran」 |
| ⑥ | **`:has()` 是隐藏的关键**。只把 `img` 设成 `display:none`，外层 `<p>` 还在 → 留下一条空白带 | 用户"隐藏后留白"报告 |
| ⑦ | **行末收口按"文档序第 N 个"算，不能用累加计数器**——图片被重新 tick 时计数器会漂移 | `tickThumb` 注释 |
| ⑧ | **列数输入框必须回写真相**：不管用户是打字、回车、失焦还是从存储恢复，都统一 `inp.value = String(TILE_COLUMNS)` | `setTileColumns` :1503-1506 |
| ⑨ | **样式写行内 `!important` 才能压过宿主**：`<p>` 是宿主渲染的节点，其自身样式可能胜过样式表 | `setInline` 注释 |
| ⑩ | **旧实现被端到端验证过，就别为"更聪明"换掉**。原插件是把图片 MOVE 进自建 grid 容器（flex/grid 才能真正控制流动），验证通过后被"宿主搜寻法"替换——**缩略图模式正是这样坏掉的** | 源码注释原文 |

### 8.5 现状核对表（2026-10-21 文档↔代码逐条对齐后的修订）

> 本节是"经验与代码一致性"核验的产物：`E:\tmp\lightbox-lab\audit-doc-vs-code.mjs` 逐条比对行号/函数名/行为断言。
> 首次核验 **36 条行号全中，但 2 条行为断言是我写错的**，已按代码事实改写，这里留档。

| 项 | 我原先写的 | 代码事实 |
|---|---|---|
| 图片身份键 | "srcKey 先剥 `?w=` 再比对" | ❌ 实际 `srcKey = currentSrc || src`，**不剥参数**；剥参数发生在"取原图"三处（:920 / :1101 / :1753） |
| 缩略图 `?w=600` | "只对本地路由图追加 `?w=600`" | ❌ `thumbnailSrcFor` **全仓零调用**、`isLocalImagePath` 只被它调用，两者都是死代码；缩略图模式不改 src |
| `closest()` | "永远不用 `closest()`" | ⚠️ 过宽。全文件 8 处 `closest()` 都合法：:1187 跳过头像/侧栏/工具栏、:1210/:1325/:2157/:2169/:2232/:3001/:3020 判"在灯箱遮罩内"、:1248 判"在按钮内"。**禁的是拿它去爬"该 float 的容器"** |

**遗留待决（用户 2026-10-21 决定：先推 1.8.9，这两项「记住、后续再测试」——不要顺手改）**：

1. `thumbnailSrcFor`/`isLocalImagePath` 要不要真接线？接了能省带宽、缩略图更锐，但**必须同时把 `srcKey` 改成"剥掉 `?w=` 后比对"**，否则同一张图的缩略 URL 与原图 URL 会变成两个键，`modeSrc` 记账错乱（隐藏/展开状态会串）。
2. 不接线的话，建议删掉这两个函数（当前是"看起来有优化、实际没生效"的误导性死代码）；
3. 再测时必须**真发图 + 真点缩略图/隐藏按钮**，别只看单测：死代码一接线，第一处会炸的就是"同一张图的缩略 URL 与原图 URL 成了两个键 → 隐藏/展开状态串味"。
4. `tickThumb` 里那句提到 `closest()` 的只是**注释**（:1675，记录当年事故），代码里没有调用——改代码时别被注释误导成"这里还在用"。

### 8.4 由此得出的通用判断法

想加界面功能时，按这个顺序选方案：

1. **只加 class/行内样式就能做到？** → 就这条路（安全、可逆、React 无感）
2. 需要额外节点？ → 只能创建**自己的、隐形的、可撤销**的节点（占位符），绝不搬动别人的节点
3. 需要搬动宿主节点？ → **换方案**，不要试（`DOMException` + 渲染不全）

## 9. 与 GitHub 上游的差异（2026-10-21 实测）

```
origin/main = e359fa8  (package.json version = 1.7.9)
merge-base  = e359fa8  →  远端独有 0
本地领先    = 14 个提交（1.8.8 cc9c6e4）→ 17 个提交（1.8.9 HEAD，含本文档与截图）
```

**结论：GitHub 上的最新版（1.7.9）落后本地 17 个提交，且它在 desktop 端正文根本不出图。**

1.7.9 的正文拼装是根相对路径 `![文件名](/images/?abs=C%3A%5C…)`，而 `baseUrl()` 返回 `""`。在 desktop（origin `dsh-app://app`）settled 态会这样坏掉：

1. `parseFileLink()` 有 `if (destination.includes("?")) return void 0;` → 直接 undefined；
2. 回退 `imageSource(dest, pathImages)` → `localPathMediaUrl` 先 `value.split(/[?#]/u)[0]` 把 `?abs=…` 剥掉，只剩 `/images/`；
3. 拼成 `dsh-app://app/api/file?path=%2Fimages%2F` → 指向一个**目录**；
4. `/api/file` 读目录返回 `FS_NOT_REGULAR_FILE` + 403 → `<img onError>` → 页面显示「失败 · 文件名」。

**所以「以前能直接出图、不闪字符」的是 v1.7.5 及更早**（那时 `baseUrl()` 返回 `http://127.0.0.1:<port>`，正文是绝对 URL，走 `remoteImageUrl`，流式期也能渲染），代价是只在 web 端成立。**不要把 1.7.9 当成参考实现。**

---

## 10. 资产索引

| 资产 | 路径 |
|---|---|
| 插件源码 | `C:\Users\Administrator\.dsh\local-plugins\dsh-chat-image-lightbox\`（三处 profile 均为 Junction 指向此） |
| 已验证基线 | `docs/VERIFIED-BASELINE.md`（10 条已验收功能 + 代码坐标 + 检查清单） |
| 一键回归 | `node test/run-all.mjs --full`（自带 8 套件 + 实验室 11 套件 = 19，实测 19/19 全绿）/ `IG_TOOL_ONLINE=1 node test/probe-tool-result.mjs`（真搜图过宿主闸门） |
| 真 HEVC 样本 | `test/fixtures/real-hevc.heic`（首条断言：不是错标 JPEG） |
| 全格式素材 | `E:\tmp\lightbox-lab\formats-188\`（固定素材 10 类×2）、`formats-rand\`（随机图源 10 类×2） |
| 素材生成器 | `E:\tmp\lightbox-lab\build-formats-188.mjs`、`build-formats-rand.mjs`（sharp 经 `createRequire(profiles/desktop/node_modules/noop.js)` 解析） |
| 转码副本 | `C:\Users\Administrator\.dsh\image-gallery-auto\`（`*-view-*.png|webp`；超过 500 文件或 512 MB 自动从旧删） |
| 备份 | `~\.dsh\backups\dsh-chat-image-lightbox-1.8.0-<ts>\`（zip + git bundle + 散装 + SHA256） |
| 宿主机理实验室 | `E:\tmp\lightbox-lab\`（`why_before_worked.cjs`、`mix_live.cjs`、`mask_verify.cjs`、`leak_decisive.cjs`） |
| 效果图（新） | `docs/images/lightbox.png`、`lightbox-swipe.png`、`columns-3col.png`、`columns-4col.png`、`columns-5col.png`、`hide-images.png` |
| **技能库副本（本文）** | `E:\DSHskills\image-display\references\图片插件开发经验-1.8.9.md`（整文件复制，2026-10-21 同步；仓内为唯一基准） |
| **技能库开发日志** | `E:\DSHskills\dsh-config\references\plugin-development\references\lightbox-plugin-dev-log.md` §三十五（1.1.x–1.7.3 的三十四节 + 本次 1.8.9 接续） |
| 一致性核验脚本 | `E:\tmp\lightbox-lab\audit-doc-vs-code.mjs`（文档代码坐标/行为断言 ↔ 源码逐条比对） |

---

## 11. 下一次接手的 checklist

1. 先跑 `node test/run-all.mjs --full`，确认 19 套件全绿（不是就先用 `git reset --hard` 回基线）。
2. **发一张真图到正文**，让用户确认能看见——这一步不能跳（§2.1）。
3. 确认宿主加载的是你改的代码：进程启动时间 > 源码 mtime，且日志里 `delivery law (N chars)` 与源码 `IMAGE_LAW_TEXT.length` 对得上。
4. 动代码前读 `docs/VERIFIED-BASELINE.md` 的受保护坐标（`tickThumb` **布局定位**只能用 `parentElement`，不能用 `closest()` 去爬容器——`closest()` 会把会话头像浮动到角落并缩小，真实事故；祖先类型判定用 `closest()` 是合法的，见 EXPERIENCE §8.5）。
5. 新字段先进 `output.schema`；新数字先过 `Number.isFinite`。
6. 改完做负控实验，证明探针有鉴别力。
7. 报告里带实测数字与绝对路径；失败就说失败。
8. `git push` / `npm publish` 等用户单独授权，且两端同版本同内容。
