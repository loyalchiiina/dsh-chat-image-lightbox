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
| 想知道本地和 GitHub 差多少 | §8 上游差异 |
| 想复用现成的脚本/素材 | §9 资产索引 |

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

不要试图用 CSS/正则去遮：`!`、`![注意] 这里要说明一下`、完整内联图都会被误伤（172 种真实帧里只命中 84 种）。**A 方案（接受现状）是用户拍的板**，理由是 B 方案（改 asar）三条硬阻塞见 §3.6。

### 3.3 desktop 端 origin 是 `dsh-app://app`

绝对回环 `http://127.0.0.1:<port>/images/…` 对页面而言是**跨源**，Chromium 渲染进程直接拦掉（`fetch` → `TypeError: Failed to fetch`、`<img>` → `onerror`，服务器命中 0）。站内根相对路径才继承页面源。

**同理**：本地图在流式期能出图的唯一通路是 `http(s)` 绝对 URL（`remoteImageUrl` 在 `imageSource` 里先于 `pathImages` 执行），但这条路在 desktop 是死的；web 端（页面自身就是 `http://127.0.0.1:port`）才成立。

### 3.4 输出侧两道闸门（漏一个字段整条结果作废）

1. **无损 JSON**：嵌套 `undefined` / `NaN` / `Infinity` / `-0` 一律拒收；
2. **`output.schema` + `additionalProperties: false`**：未声明字段 → 整条作废。

任何新加字段（`rescueError`、`unverified`…）**必须同步进 schema**；任何数字字段用 `Number.isFinite` 条件写入。宿主不是字段级容错，是**整条丢弃**。

### 3.5 工具结果默认折叠

界面把工具调用折成一行「⊗ 已调用工具，更新了计划，已写入文件」。**用户滚动正文看不到工具结果里的任何图**。这条不是风气问题，是界面行为 → 只能用铁律强制正文复述（§4）。

### 3.6 改 asar 为什么被否（B 方案）

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

## 8. 与 GitHub 上游的差异（2026-10-21 实测）

```
本地 HEAD  = cc9c6e4  (1.8.8，本次升到 1.8.9)
origin/main = e359fa8  (package.json version = 1.7.9)
merge-base  = e359fa8  →  本地领先 18 个提交，远端无本地缺失的提交
```

**结论：GitHub 上的最新版（1.7.9）落后本地 18 个提交，且它在 desktop 端正文根本不出图。**

1.7.9 的正文拼装是根相对路径 `![文件名](/images/?abs=C%3A%5C…)`，而 `baseUrl()` 返回 `""`。在 desktop（origin `dsh-app://app`）settled 态会这样坏掉：

1. `parseFileLink()` 有 `if (destination.includes("?")) return void 0;` → 直接 undefined；
2. 回退 `imageSource(dest, pathImages)` → `localPathMediaUrl` 先 `value.split(/[?#]/u)[0]` 把 `?abs=…` 剥掉，只剩 `/images/`；
3. 拼成 `dsh-app://app/api/file?path=%2Fimages%2F` → 指向一个**目录**；
4. `/api/file` 读目录返回 `FS_NOT_REGULAR_FILE` + 403 → `<img onError>` → 页面显示「失败 · 文件名」。

**所以「以前能直接出图、不闪字符」的是 v1.7.5 及更早**（那时 `baseUrl()` 返回 `http://127.0.0.1:<port>`，正文是绝对 URL，走 `remoteImageUrl`，流式期也能渲染），代价是只在 web 端成立。**不要把 1.7.9 当成参考实现。**

---

## 9. 资产索引

| 资产 | 路径 |
|---|---|
| 插件源码 | `C:\Users\Administrator\.dsh\local-plugins\dsh-chat-image-lightbox\`（三处 profile 均为 Junction 指向此） |
| 已验证基线 | `docs/VERIFIED-BASELINE.md`（10 条已验收功能 + 代码坐标 + 检查清单） |
| 一键回归 | `node test/run-all.mjs --full`（19 套件）/ `IG_TOOL_ONLINE=1 node test/probe-tool-result.mjs`（真搜图过宿主闸门） |
| 真 HEVC 样本 | `test/fixtures/real-hevc.heic`（首条断言：不是错标 JPEG） |
| 全格式素材 | `E:\tmp\lightbox-lab\formats-188\`（固定素材 10 类×2）、`formats-rand\`（随机图源 10 类×2） |
| 素材生成器 | `E:\tmp\lightbox-lab\build-formats-188.mjs`、`build-formats-rand.mjs`（sharp 经 `createRequire(profiles/desktop/node_modules/noop.js)` 解析） |
| 转码副本 | `C:\Users\Administrator\.dsh\image-gallery-auto\`（`*-view-*.png|webp`；超过 500 文件或 512 MB 自动从旧删） |
| 备份 | `~\.dsh\backups\dsh-chat-image-lightbox-1.8.0-<ts>\`（zip + git bundle + 散装 + SHA256） |
| 宿主机理实验室 | `E:\tmp\lightbox-lab\`（`why_before_worked.cjs`、`mix_live.cjs`、`mask_verify.cjs`、`leak_decisive.cjs`） |
| 效果图（新） | `docs/images/lightbox.png`、`lightbox-swipe.png`、`columns-3col.png`、`columns-4col.png`、`columns-5col.png`、`hide-images.png` |

---

## 10. 下一次接手的 checklist

1. 先跑 `node test/run-all.mjs --full`，确认 19 套件全绿（不是就先用 `git reset --hard` 回基线）。
2. **发一张真图到正文**，让用户确认能看见——这一步不能跳（§2.1）。
3. 确认宿主加载的是你改的代码：进程启动时间 > 源码 mtime，且日志里 `delivery law (N chars)` 与源码 `IMAGE_LAW_TEXT.length` 对得上。
4. 动代码前读 `docs/VERIFIED-BASELINE.md` 的受保护坐标（`tickThumb` 只能用 `parentElement` 不能用 `closest()`——用 `closest()` 会把会话头像浮动到角落并缩小，真实事故）。
5. 新字段先进 `output.schema`；新数字先过 `Number.isFinite`。
6. 改完做负控实验，证明探针有鉴别力。
7. 报告里带实测数字与绝对路径；失败就说失败。
8. `git push` / `npm publish` 等用户单独授权，且两端同版本同内容。
