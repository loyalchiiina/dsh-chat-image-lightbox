# 已验证基线（VERIFIED BASELINE）v1.8.0

> **这份文件的作用**：把「用户已经验收过、不许回退」的行为逐条写死在代码坐标上。
> 任何人（包括 AI）在改这个插件前，必须先把本文档读一遍，改完必须逐条对照。
>
> 基线锚点：commit `5c4433c` / tag `v1.8.0-verified` / version `1.8.0`
> 建立时间：2026-10-20
> 建立原因：用户在多个会话里反复遇到「改着改着把已经好的东西弄没了」，要求固化。

---

## 零、三条铁律

1. **不许回退本文件「一、已验收功能」里的任何一条**。要动先问用户。
2. **改完必须跑 `test/` 下的探针 + `E:\tmp\lightbox-lab` 的 11 个回归套件**，全绿才算改完。
3. **改 `lib/client.js` 的布局相关函数前，先读「二、受保护代码坐标」**，那几处是本插件最脆的地方，历史上每一处都曾把布局改坏过。

---

## 一、已验收功能（用户明确说过"正常/可以/牛啊"的）

| # | 功能 | 验收证据 | 实现位置 |
|---|------|----------|----------|
| 1 | **图片并列成网格**，列数可调 1~12（默认 3） | 会话 be72f192 seq=2006「随着列数得增加图块会变窄但是还是一列」→ 修复后 seq=2384「现在是正常了牛啊」 | `tickThumb()` + `.dsh-ig-tilewrap` CSS |
| 2 | **每格高度一致**（110px，`object-fit:contain` 居中） | seq=1573「高度不一致」→ seq=1761「高度是一致得」 | `TILE_H = 110` + `img.dsh-ig-tile` CSS |
| 3 | **最后一行补齐**，不留缺口 | 同 seq=1761 | `markGridHosts()` 补空 tile |
| 4 | **后续文字从最左端开始**，左侧不留大片空白 | seq=1761「跟着得文字不是从左侧开始得左侧空了很多」→ 修复后验收 | `markRowClears()` 插零高度 `clear:both` |
| 5 | **正文图片直接显示**，不显示 `/images/?abs=` 路径 | 1.7.9 时代实测：宿主 `parseFileLink()` 遇 `?` 直接 `return void 0` → 正文永远出不了图 | `bodyMarkdown()` 引用式 + 绝对路径 |
| 6 | **成组图片显示为"图N"**，不是一长串文件名 | 本会话 10 张图实测（m00999 截图） | `bodyMarkdown()` 的 `alt` |
| 7 | **点图全屏灯箱**（缩放/拖拽/下载/左右翻页） | 历史验收 | `ensureLightbox()` / `open()` |
| 8 | **TIFF/HEIC 自动转码**后能显示 | 1.7.x 起 | `lib/index.js` sharp 转码链 |
| 9 | **网图防盗链拦截时自动转存本地** | 1.7.x 起 | `autoCache` 分支 |
| 10 | **不卡死**（长会话 97 行 display_image 也不打满主线程） | 参考会话 9b71641f 的卡死事故 → `syncSwitchState()` 加 `if (!IG_DEBUG) return;` | `syncSwitchState()` 首行 |

---

## 二、受保护代码坐标（改前必读）

以下坐标基于 `lib/client.js`（3402 行）与 `lib/index.js`（当前 58462 B）。
**行号会漂移，用函数名 grep 定位，不要硬编码行号。**

### 2.1 `tickThumb(img)` — 网格布局的地基

- **只用 `img.parentElement`，绝不用 `closest()`**。
  历史事故：用 `closest()` 会一路向上找到某层"只有图片一个元素子节点"的大容器，给它打上 `.dsh-ig-tilewrap`（`float:left` + 宽 1/N），把整个会话头像都浮动到角落并缩小。
- **`hasText` 判定必须保留**：遍历 `host.childNodes`，文本节点 trim 后非空、或非 `IMG`/`BR` 元素的 `textContent` 非空 → 放弃打 tile 标。
  这条保证**带散文的容器永不被浮成 1/N 宽**（否则文字被挤成一列宽）。
- 图片内联样式由 `tickThumb` 逐条 `setProperty(..., "important")`；`untickThumb` 必须逐条 `removeProperty` 反向清理。

### 2.2 `markGridHosts()` — 补齐最后一行

- `cols = Math.max(1, Math.min(12, TILE_COLUMNS || 3))`。
- 先删所有 `[data-dsh-ig-spacer]`、移除 `.dsh-ig-rowfill` 与 `flex` / `--dsh-ig-span` 内联 → **幂等**。
- `remainder = wraps.length % cols`，`missing = cols - remainder`，在**最后一个 tile 的 `parentElement`（那个 `<p>`）内、`lastTile.nextSibling` 之前**插入 `missing` 个空 tile。

### 2.3 `markRowClears()` — 文字回到左端（最容易改坏的一处）

这是 v1.7.13 新增、真正解决「后续文字被挤到右侧」的函数。要点：

- 起点 `.dsh-ig-tilewrap` → `par = wrap.parentElement`（`<p>`）→ `run = par.parentElement`（markdown 容器）。
- **按"连续兄弟段"切分**，不是只取最后一个 tile：一个 run 里可能有多段图区（中间夹散文），每段都要各自收口。
- **先删所有 `[data-dsh-ig-rowclear]` 再插**（幂等，重复调用不会堆叠）。
- clear 元素：`div[data-dsh-ig-rowclear="1"][aria-hidden="true"]`，内联 `clear:both / height:0 / min-height:0 / margin:0 / padding:0 / border:0 / line-height:0 / font-size:0 / overflow:hidden` 全部 `important`。
- 插入位置：`host.insertBefore(clear, tail.nextSibling)`。

> ⚠️ `markRowClears()` 依赖 `.dsh-ig-tilewrap` 是 `run.children` 的后代且兄弟连续。
> 如果改动让 tilewrap 的**父层级**变了（比如给图片外面再包一层），这个函数会静默失效 —— 表现为"文字又开始从右边开始"。

### 2.4 布局 CSS（`lib/client.js` 的 `CSS` 数组，约 449~526 行）

```
.dsh-ig-tilewrap          float:left + width/max-width: calc(100% / var(--dsh-ig-cols,4))
                          + box-sizing:border-box + margin:2px 0 + padding:2px
                          + line-height:0 + min-height:0 + clear:none
.dsh-ig-tilewrap ~ *      clear: both          ← 收口辅助（真正收口靠 markRowClears）
.dsh-ig-gridhost {}       惰性占位，历史遗留，保留
.dsh-ig-tilewrap-empty    float:left + display:block + visibility:hidden + pointer-events:none
img.dsh-ig-tile           display:block + width:100% + height:110px
                          + object-fit:contain + object-position:center
                          + border-radius:6px + background:rgba(0,0,0,0.06)
                          + float:none + font-size:12px + line-height:0
```

> ⚠️ 源码注释已写明：**inline-block / 父级 flex / flow-root / 每格单独 clear 四种改法都试过，全部让 tile 退回一列，已回退**。不要再试。

### 2.5 正文拼装（`lib/index.js`）

| 函数 | 作用 | 不可改的地方 |
|------|------|--------------|
| `encodeBodyDest(absPath)` | 本机路径转 markdown destination | 顺序：先 `\`→`/`、再 `%`→`%25`、最后转义 `( ) ! ' * 空格 # ? < > "`。**`%` 必须最先转义**，否则二次编码错 |
| `bodyPath(item)` | 决定用本地副本还是远程 URL | 本地副本**优先**（用 `existsSync` 守卫），否则 `remoteUrl` 若 `^https?://`，否则 `item.url` |
| `encodeRemoteDest(url)` | 远程 URL 转义 | 括号仅当**配对深度不为 0**（不配平）时才转义 —— 配平括号裸写，否则签名 URL 会被破坏 |
| `bodyDest(item)` | 分派上面两个 | — |
| `bodyMarkdown(items)` | 拼 `![图N][saltN]` + 空行 + `[saltN]: <dest>` | **salt 必须保留**（3 位 base-36 随机前缀）：同一条消息里多次调 `display_image` 会撞标签，mdast 保留最早 definition → 第二组图静默显示第一组 |
| `localUrl(absPath,width)` | 工具行专用 URL | `baseUrl() + "/images/?abs=" + encodeURIComponent(absPath)`。**这个带 `?` 的 URL 只能用在工具行**（插件自造 `<img>`），写进正文必失败 |

---

## 三、宿主行为约束（为什么有些事做不到）

以下是 DSH 客户端写死的行为，插件层绕不过去，记录在此避免后人反复试错。

### 3.1 正文图片的完整链路

```
markdown destination (百分号编码的绝对路径，无 `?`)
  → MarkdownImage
      streaming ? void 0 : parseFileLink(destination)      ← 流式期直接跳过
      → fileImages.resolve(file.path)
  → fileMediaUrl(document.baseURI, resolveWorkspacePath(cwd, path))
  → dsh-app://app/api/file?path=<encoded 绝对路径>
  → 宿主 /api/file 路由 → serveFile → mime 判定 → 返回
```

- `parseFileLink()` 里逐字有 `if (destination.includes("?")) return void 0;` → **正文 destination 带 `?` 必失败**。这就是不能用 `/images/?abs=` 的原因。
- `vocabularyImageUrl()` 显式白名单放行 `dsh-app://app/api/file?` 前缀。
- `/api/file` 限制：路径必须绝对、`maxImageBytes` 默认 **20 MB**、`Cache-Control: private, no-store`。

### 3.2 流式期本地图**物理上不可能**出图

两条独立封堵，缺一条都不成立：

1. `MarkdownImage` 里 `const file = streaming ? void 0 : parseFileLink(destination);`
2. `StreamingRenderer` 的两处 context（`frozenContext` / `tailContext`）都把 `pathImages` 强制置 `void 0`。

于是流式期 `src` 只可能来自 `imageSource(destination, void 0)`，而它能放行的只有 `http:`/`https:` 远程图。

**结论**：流式期本地图只能退化成 `span.imageAlt`（alt 文字）。要让本地图在流式期就出现，**只能改 asar 内的 `dsh-client-ui-primitives`**（动 DSH 本体）。

### 3.3 流式期为什么会闪 `![图1][k3f1` 这种字面量

- `imageReference` 的 definition 还没流到时 → `renderImageReference()` 返回**字面量字符串**。
- 这个字面量经 `renderNode` 的 `case "text": return node.value;` 变成**裸文本节点**，落在 `<p>` 里。
- 裸文本**不是** `span.imageAlt` → 现有 CSS `[data-streaming] [class*='imageAlt']` **对它无效**。
- 结论：这条只能靠"更早让 definition 到达"或"改宿主"解决；**纯 CSS / 纯文本正则都不可行**（实测两轮失败：`!`、`![注意] 这里要说明一下`、完整内联图都会被误伤，172 种帧只命中 84 种）。

### 3.4 路径字面量**已经 0 泄漏**

definition 块在宿主 `renderNode` 里 `return null`，`renderBlocks` 又 `.filter(e => e !== null)` → 定义块**永不产生 DOM**。

因此 `[k3f1]: C:/…/图片.jpg` 这一行从头到尾不出现在页面上。实测：单图/双图/三图/十图，含路径帧 **= 0**。

---

## 四、回归测试基线

### 4.1 插件自带探针（`test/`）

```bash
node test/probe-rowclear.mjs       # 18 项：clear 插入位置/幂等/多段
node test/probe-poprole.mjs        # 15 项：role=dialog 只在打开时存在
node test/probe-source-health.mjs  # 37 项：图源健康降级 / 转存并发 / 缓存上限 / 搜狗 forbid
node test/probe-tool-result.mjs    # 39 项：返回值过宿主两道闸门（IG_TOOL_ONLINE=1 → 45 项含真搜图）
node test/run-all.mjs --full       # 上面 4 个 + 实验室 11 套件 = 15 套件，一条命令全跑
```

> `probe-source-health.mjs` 的鉴别力是实测的：把 `IG_SRC` 指向 1.8.0 的源码（`git show 13a1b49:lib/index.js`）跑同一套断言 → 22 项只过 4 项；对新代码 → 37/37。

> 🔴 **`probe-tool-result.mjs` 的存在理由（1.8.2 的代价换来的）**：1.8.1 的 14 套件全绿，却在用户重启后**搜图 100% 报错** —— 因为所有旧探针都只测到 `searchImages` 这一层函数，**从不构造真实工具返回值**，也就从不经过宿主的两道闸门：
> ① 无损 JSON（嵌套 `undefined`/`NaN`/`Infinity`/`-0` → 整条结果被丢，报 `value is not lossless JSON`）；
> ② `output.schema` 的 `additionalProperties: false`（未声明字段 → 整条结果被丢）。
> 所以**任何新增的返回值字段都必须同时过这两关**，探针用「真 `apply()` + 真 `execute()` + 复刻两道闸门」来钉死；负控必须在**删掉该字段的 reduced schema** 上做（拿现 schema 做负控等于自欺）。

### 4.2 实验室 11 套件（`E:\tmp\lightbox-lab`）

| 套件 | 断言数 | 覆盖 |
|------|--------|------|
| `regress.mjs` | 10 | 三种图片来源 × 流式/稳定两阶段；同消息多次调用标签唯一性 |
| `bodyurl.mjs` | 12 | `encodeBodyDest` 六分支 + 三个端到端 |
| `probe-rowclear3.mjs` | 18 | T1~T6 clear 插入/幂等/多段/单图 |
| `pct.mjs` | — | `%` / `%20` / `%2F` 三重转义安全 |
| `planb.mjs` | 18 | 流式藏 alt / settled 不藏 / 词法只在 imageAlt / rowclear 调用序 |
| `cssbal2.mjs` | — | CSS 花括号平衡 + B 规则独立成块 |
| `ffinal3.cjs` | 7 | 真实 IncrementalMarkdownParser 帧分析 |
| `ffinal6.cjs` | 4 | 定稿形态（数字标签 + 引用在前定义紧跟） |
| `e2e-ref.cjs` | 3 | 端到端 settle / 路径帧 / altSpan |
| `e2e-ref2.cjs` | 5 | 远程 URL（含括号）保原样 |
| `impl.cjs` | 5 | settle 顺序 / 加盐不冲突 / 盐字符安全 / 远程 URL 完整 |

**全绿基线：11 套件 0 失败。**

### 4.3 实验室依赖（缺了跑不起来）

- `E:\tmp\lightbox-lab\extracted\` — 从 asar 抠出的宿主源码（`dsh-client-ui-primitives__lib__index.js` 等）
- `E:\tmp\lightbox-lab\mdlab\node_modules\` — mdast / micromark gfm
- 完整副本已备份到 `.dsh\backups\dsh-chat-image-lightbox-1.8.0-*\lab-full\`

---

## 五、版本分叉风险（必须知道）

| 位置 | 版本 | 类型 | 风险 |
|------|------|------|------|
| `.dsh\local-plugins\dsh-chat-image-lightbox` | 1.8.1 | 真实目录 | **源码，唯一权威** |
| `profiles\desktop\node_modules\...` | 1.8.1 | **Junction** → local-plugins，声明 `link:` | 改源码即生效，安全 |
| `profiles\web\node_modules\...` | 1.8.1 | **Junction** → local-plugins，声明 `link:` | 2026-10-21 由「npm 固定版本 + 真实目录」改造而来，同 desktop |
| `profiles\xiufu\node_modules\...` | 1.8.1 | **Junction** → local-plugins，声明 `link:` | 同上 |
| npm registry | 1.7.9 | — | 1.7.10 / 1.7.11 / 1.8.0 / 1.8.1 都**尚未发布**（发布需用户当次授权） |

> ✅ **2026-10-21 起，三处副本不再是「三份拷贝」而是「同一个源」**：三个 profile 的 `dependencies` 都写成
> `link:C:/Users/Administrator/.dsh/local-plugins/dsh-chat-image-lightbox`，`node_modules` 下是 Junction。
> 这样既天然一致，也**不会再出现「重启按声明回退到旧版」**（`link:` 形态不参与版本号比对）。
> 改造前的两份旧副本已备份在 `~\.dsh\backups\lightbox-1.8.1-sync-*`。

---

## 六、备份与恢复

### 备份位置

```
C:\Users\Administrator\.dsh\backups\dsh-chat-image-lightbox-1.8.0-<时间戳>\
  source-1.8.0-5c4433c.zip       完整源码（git archive）
  repo-1.8.0-all-branches.bundle 完整 git 历史（含所有分支/tag）
  files\                         5 个关键文件散装副本
  testlab\                       144 个探针/实验脚本
  lab-full\                      extracted + mdlab + node_modules
  SHA256.txt                     所有文件校验和
```

### 恢复方式（任选）

```bash
# 1) 从 git 直接回退（最快，需 .git 完好）
cd C:\Users\Administrator\.dsh\local-plugins\dsh-chat-image-lightbox
git reset --hard v1.8.0-verified

# 2) 从 bundle 重建（.git 损坏时）
git clone C:\Users\Administrator\.dsh\backups\dsh-chat-image-lightbox-1.8.0-*\repo-1.8.0-all-branches.bundle restored
cd restored && git checkout v1.8.0-verified

# 3) 从 zip 解压（最兜底）
unzip C:\Users\Administrator\.dsh\backups\dsh-chat-image-lightbox-1.8.0-*\source-1.8.0-5c4433c.zip -d <目标目录>
```

---

## 七、改动检查清单（每次改完逐条打勾）

- [ ] `node --check lib/index.js` 通过
- [ ] `node --check lib/client.js` 通过
- [ ] `node test/probe-rowclear.mjs` 18/0
- [ ] `node test/probe-poprole.mjs` 15/0
- [ ] `node test/probe-source-health.mjs` 37/0
- [ ] `node test/probe-tool-result.mjs` 39/0（改过返回值/`output.schema` 时必须）
- [ ] `node test/run-all.mjs --full` 15 套件全绿（一条命令代替逐条手跑）
- [ ] `E:\tmp\lightbox-lab` 11 套件全绿
- [ ] 网格布局视觉验证：发 ≥10 张图，确认「并列 / 等高 / 末行补齐 / 文字回左端」
- [ ] 正文无路径泄漏（引用式定义行不上屏）
- [ ] 三处副本一致性：三个 profile 均为 `link:` + Junction（2026-10-21 起结构上自动一致，改完抽验一次 SHA256 即可）
- [ ] CHANGELOG 记录（含"为什么改"而不只是"改了什么"）
- [ ] 🔴 发布（git push / npm publish）前**单独向用户取得当次授权**
