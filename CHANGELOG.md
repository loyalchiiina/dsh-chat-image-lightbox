## 1.8.4 — 2026-10-21

### 🔴 修：TIFF / HEIC 一律「图片无法预览」——插件装成 Junction 后依赖加载不到

**症状**：`display_image(path="...fixture.tiff")` 返回的正文里只有一行「图片无法预览」。

**根因**：这张 TIFF 不是特例，**所有 TIFF/HEIC 都显示不出来**。启动日志早就写了答案：

```
image-gallery: serving from C:\Users\Administrator\.dsh\uploads (sharp: unavailable)
```

`sharp` 是把 TIFF/HEIC 转成浏览器能画的格式的唯一手段。它不可用，这两种格式就只能以
`application/octet-stream` 原样吐给浏览器 —— 于是显示失败。

**为什么不可用**：1.8.1 起插件在三个 profile 里都装成**目录 Junction**
（`profiles/<name>/node_modules/dsh-chat-image-lightbox` → `.dsh/local-plugins/dsh-chat-image-lightbox`）。
Node 解析 `require` 用的是模块的**真实路径**、不是链接路径，所以
`createRequire(import.meta.url)("sharp")` 从 `local-plugins/` 一路往上找，
而 `sharp` / `undici` 都在 `profiles/<name>/node_modules` —— 正好被链接从解析链上抹掉了。

实测（`require.resolve` 逐项验）：

| 依赖 | 修复前 | 真实位置 |
|---|---|---|
| `sharp` | ❌ MISSING | `profiles/<name>/node_modules/sharp` 0.35.5（libvips 8.18.7 可用） |
| `undici` | ❌ MISSING | `profiles/<name>/node_modules/undici` 7.30.0 |
| `@deepseek-ai/dsh-tools` | ✅ OK | 走 harness 自己的链 |

**修复**：新增 `resolveDep()` / `loadDep()` 多根解析 —— 依次从
`fileURLToPath(import.meta.url)`、`process.execPath`、`EXEPATH`、`process.cwd()`
出发，每个根向上走 8 层，首个命中即缓存。`sharp`、`undici`、`defineTool` 三处全部改走它。

> 教训：**Junction / symlink 会让 `createRequire(import.meta.url)` 找错目录。**
> 依赖解析不能假设「模块目录附近一定能找到 node_modules」。

### 🔴 修：直连实际上没直连——本机 `NODE_USE_ENV_PROXY=1` 把 `fetch` 全接走了

**症状**：搜索时 duitang 的图被报成「探测失败（未验证）」并剔除，
note 写「另有 1 张无法确认可加载……已跳过不发」——**可那张图明明能打开**。

**根因**：本机 `NODE_USE_ENV_PROXY=1` 且 `HTTPS_PROXY=http://127.0.0.1:7890`，
Node 全局 `fetch` 会**自己**套上这个代理，**不传 `dispatcher` 并不等于「不走代理」**。
同一 URL、同 headers 实测：

| 走法 | 结果 |
|---|---|
| `fetch(url, {headers})` | TLS reset（000） |
| `curl --noproxy '*' url` | **200 image/jpeg** ✓ |
| `curl -x http://127.0.0.1:7890 url` | 000（TLS reset） |
| `node:https.request({agent: new https.Agent()})` | **200** ✓ |

即 duitang **只认直连、走代理必失败**。旧代码想用 `undici.Agent()` 做「直连」，
可 `undici` 根本解析不到（见上一条），`directAgent` 恒为 `null` —— 那个「直连」分支
一直是空操作，两次尝试其实都走了同一个代理。于是健康门禁把好图判成坏图。

**修复**：新增 `rawDirectGet()`（`node:https` / `node:http` + **显式 Agent**，
完全无视 env 代理，自带 5 跳重定向与超时）和 `getBytes()`（先 runtime fetch，
transport 失败再直连）。`httpGetText` / `httpGetBuffer` / `probeRemoteForBrowser`
全部改走 `getBytes`。**HTTP 状态码视为答案，不换路重试。**

> 教训：**「不传 dispatcher」≠「不走代理」。** 要真直连，必须显式 `new Agent()`
> （undici）或直接用 `node:https` —— 后者更可靠，因为它连 undici 是否存在都不依赖。

### 实测验收（都是真跑，不是推断）

转码链路（真起 HTTP 服务请求插件自己的路由，只认 content-type 与 magic bytes）：

```
TIFF        → 200 image/png   1725575B  magic 89504e47  ✓
TIFF ?raw=1 → magic 49492a00（下载保住原格式）        ✓
HEIC        → 200 image/webp  magic 52494646          ✓
JPEG        → 原样 image/jpeg magic ffd8ff            ✓
```

搜索（真实网络）：

```
query「毛晓彤」 8898ms  采用 Bing  返回 5 张  health {ok:3, sampled:4, failed:0}
query「蔡秀彬」 5817ms  采用 Bing  返回 5 张  health {ok:4, sampled:4, failed:0}
```

（`failed: 0` 说明探测不再因为代理误判而失败；`ok < sampled` 是站点真的拒绝，
会如实体现在 note 里。）

### 探针

新增 `test/probe-dep-resolve.mjs`（**24 项**）：16 条静态结构断言 + 真 `apply()`
+ **真起 HTTP 服务**请求 TIFF/PNG 验转码 + **读插件自报的 sharp 状态**。它和旧探针的区别在于——
旧探针只测「函数行为对不对」，这个探针测「依赖到底加载到了没有」。
1.8.1~1.8.3 三个版本里 `sharp` 一直是死的，而 15 个套件全绿，就是因为没人测这件事。

`test/run-all.mjs` 的 LOCAL 从 4 套件变 **5 套件**，`--full` 共 **16 套件全绿 / 0 失败**。

### 补记：探针自己也有同一个盲区（改完当场发现的）

第一版探针 23 项全绿，但它**不能**发现 sharp 坏掉。原因是我把 `depBases` / `resolveDep`
复制进探针里自己跑，测的是「复制出来的算法对不对」，而不是「插件自己拿到了没有」。

这不是假设 —— 修 `__depCache` 少写一行 `var` 的那个瞬间就是这样：`resolveDep` 每次抛
`ReferenceError`，`loadDep` 里的 `catch (e) { return null }` 把它吞成 null，sharp 静默不可用，
而探针当时仍 23/23 全绿。**同一个错误（测行为、不测真实状态）在修它的过程里又犯了一次。**

所以加了第 24 项：导入插件、`apply()`、读它自己打印的那行
`image-gallery: serving from … (sharp: available)`，只认 `available`。
鉴别力实测：把 `__depCache` 声明删掉做出坏副本，指向它跑 → **21/24**，失败的正是新加的这条，
外加两条 TIFF 转码断言（拿到 `image/tiff` 而不是 `image/png`、magic 是 `49492a00`）。


### 🔴 修：一整屏「图片无法预览」的另一条独立原因——HTML 错误页被当成 .jpg 保存并发出

这条是**验收时真发图**才发现的，脚本永远看不见：

```
C:\Users\Administrator\.dsh\image-gallery-auto\image-4-go3m.jpg   14455B
前 16 字节:  0a 0a 0a 0a 0a 0a 0a 3c 21 64 6f 63 74 79 70 65
             → "\n\n\n\n\n\n\n<!doctype"
```

它被标成 `image/jpeg` 发给浏览器。浏览器解码失败 → **「图片无法预览」**。
而整条链路上没有一层报错，因为每一层都只看状态码和 `content-type`：

| 环节 | 当时检查了什么 | 漏了什么 |
|---|---|---|
| `httpGetBuffer` | `status` 是 2xx | 字节是不是图片 |
| `probeRemoteForBrowser` | `status` 2xx + `content-type` 以 `image/` 开头 | 同上 |
| `imageFileHandler` | 后缀 → `mimeFor()` | 文件内容与后缀是否一致 |

图源（CDN 拦截页）返回 **HTTP 200 + `content-type: image/jpeg` + HTML 正文** 时，
三层全部放行。于是「转存成功」的文件是个网页，用户看到一屏坏图。

**修复**：新增 `looksLikeImage(buf)`，按 **magic 字节**判定（JPEG `FFD8FF`、PNG `89504E47`、
GIF `GIF8`、WEBP `RIFF….WEBP`、TIFF `II*\0` / `MM\0*`、BMP `BM`、ISOBMFF `ftyp`），三处都接上：

- `httpGetBuffer`：非图片字节直接抛「不是图片（content-type=…，开头=…）」，且**不重试**
  （重试拿到的是同一张 HTML）；
- `probeRemoteForBrowser`：`blocked` 判定加上 `!looksLikeImage`，返回里带 `realBytes`；
- `imageFileHandler`：后缀是图片但字节不是 → **415** 并明说原因（svg/ico 豁免，它们是文本/容器格式）。

> 教训：**`200` 和 `content-type` 都不构成「这是图片」的证据，只有字节构成。**
> 一个只会「下载并写盘」的转存函数，等于把远端的错误页原样存进了自己的缓存目录。

### 🟠 修：文件名带 `%` 时取不到图，甚至把请求打死（`?abs=` 被解码两次）

`searchParams.get("abs")` **已经**做过一次 percent 解码，代码里又 `decodeURIComponent` 了一次。
两个方向实测都坏：

| 文件名 | 二次解码后 | 结果 |
|---|---|---|
| `a%20b.jpg` | `a b.jpg` | **404**（文件明明在） |
| `折扣50%的图.jpg` | `折扣50%的图` 里的 `%的` 不是合法转义 | **URIError，未捕获，请求直接崩** |

**修复**：优先用 `searchParams` 给出的值；只有它在磁盘上不存在时，才尝试再解一次
（兼容仍传双编码路径的调用方）；二次解码抛错时答 **400**，绝不让异常穿出 handler。

> 教训：`searchParams` 的值是**已解码**的。对它再 `decodeURIComponent` 不是「保险」，
> 是把所有合法含有 `%` 的文件名变成 bug。

### 验收方式：真发图，不只看脚本数字

这一版的三条问题里有两条是**只有真发图才能看见**的（TIFF 显示失败、缓存里躺着 HTML）。
所以验收改成把每种图**真发进对话正文**，并另配一个端到端脚本 `E:\tmp\lightbox-lab\verify-all-forms.mjs`，
用插件自己的 handler 逐格式核对浏览器实际会收到的 `content-type` 与 magic bytes：

| 形态 | 结果 |
|---|---|
| TIFF（`fixture.tiff`） | 200 `image/png`，magic `89504e47` |
| HEIC（1080×1619） | 200 `image/webp`，magic `52494646` |
| JPEG / PNG / WEBP 原图 | 原样返回，magic 正确 |
| 目录多图（并列网格） | 6 张全部 200 |
| 文件名含空格 / `%20` / 中文 + `%` | 全部 200（修复前 404 或崩） |
| 远程直链 URL | 原样直传 |
| 关键词搜图 | Bing 4 张；被拒的 1 张转存后正常显示 |

### 新增探针 `test/probe-serve-integrity.mjs`（33 项）

10 条静态结构断言 + `looksLikeImage` 对 8 种真格式 / 4 种非图片字节的行为断言
+ 用假 `getBytes` 喂「200 + `image/jpeg` + HTML」等 5 种响应验 `httpGetBuffer` 的判断
+ **真起 HTTP 服务**验含 `%` 的文件名与伪装文件（其中 PNG 素材是手写的最小合法 PNG，不依赖 sharp）。

鉴别力实测：把 `looksLikeImage` 改成恒 `true` 造坏副本 → **失败 8 项**（25/33），
失败的正是「HTML 被拒」「415」「说明原因」几条。`run-all --full` 现在 **17 套件全绿**。

## 1.8.3 — 2026-10-21

### 🟠 修：健康门禁把「探测失败」当成「可加载」，抽样 4/4 全绿却仍有坏图

**症状**：`display_image(query="毛晓彤")` 返回的 note 写着
「图源：Bing 图片（抽样 4 张，4 张可加载）」，但正文里 5 张图有 3 张加载失败。

**根因**：`probeRemoteForBrowser()` 有三种返回形态，`sampleSourceHealth()` 只数了两种：

| 形态 | 含义 | 1.8.1/1.8.2 的算法 | 应该算 |
|---|---|---|---|
| `{blocked:true}` | 站点明确拒绝（非 2xx / 不是图片） | 拦截 | 不可加载 |
| `{blocked:false}` | 拿到 2xx 且 content-type 是 image/* | ✅ 可加载 | 可加载 |
| `{blocked:false, error:...}` | **网络/TLS 失败，根本没探到** | **❌ 也算可加载** | 不可加载（未验证） |

第三种当初是刻意留的（注释原文「A genuine network failure is not proof of hotlink protection:
leave it.」）——**不判它防盗链是对的，但顺手把它算成「可加载」是错的**。
实测（1.8.3 取证，真搜一次）：

```
note 原值：图源：Bing 图片（抽样 4 张，4 张可加载）
逐张实测：200 image/jpeg  ✓
          200 image/jpeg  ✓
          fetch failed    ✗  ← 却被算进「可加载」
          fetch failed    ✗
```

直接后果：**图源健康门禁（ratio < 0.3 换源）被这类失败稀释**，明明一半图打不开，
`ratio` 仍是 1.0，于是不换源、也不在 note 里说一句——用户看到的还是坏图，
而 note 还向他保证「4 张可加载」。这正是 1.8.1 想根治的那个谎言的最后一个出口。

**修复**：

- `sampleSourceHealth()` 三种结果分开计数，返回 `{sampled, ok, failed, blocked, ratio}`，
  **`ratio` 只由「确认取到 2xx 图片」的张数决定**；
- `failed` 不写回 `blocked`（探测失败不是防盗链证据，转存路径不该被它触发）；
- 换源原因里如实区分：「N 张被站点拦截」vs「N 张探测失败（网络/TLS 未通，未验证）」；
- note 同样分列：`抽样 4 张，3 张可加载，1 张探测失败（未验证）`。

**探针**：`probe-source-health.mjs` 37 → **45** 项，新增 8 条，其中三条是这次的等价输入：
`1 张被拦 + 2 张探测失败 → ok=1 / failed=2 / ratio=0.25`（低于 0.3 必须换源）、
`探测失败不算可加载`、`不可加载的图必须从结果里剔除`。

**同时修掉同一根源的第二个出口**：`ratio` 数对了还不够 —— 被拦/探测失败的图原先**照样发出去**，
只是 note 里加一句「会显示为加载失败」。用户要的是图，不是道歉。现在：

- 探测失败（`{blocked:false, error}`）标记 `unverified`，**与 `blocked` 一起进转存队列**（下载也许能成）；
- 转存也失败的，**直接从结果里剔除不发**（`picked.splice`），note 写明「另有 N 张无法确认可加载……已跳过不发」；
- `save_to` 分支同理：下载失败的图不再留在结果里（原先只报「失败 N 张」但坏图照样上屏）；
- 一张都不剩时**抛错**（「图源返回的 N 张图片全部无法确认可加载」），而不是返回一屏「图片无法预览」；
- `unverified` 已同步声明进 `output.schema`（`additionalProperties:false`，漏了就是 1.8.2 那个整条作废的坑）。

**实测（真搜「毛晓彤」，4 张结果逐张 curl 复核）**：

```
修复前：抽样 4 张，4 张可加载 → 实际 2 张 fetch failed 仍上屏
修复后：抽样 4 张，3 张可加载，1 张探测失败（未验证）；另有 1 张……已跳过不发
        发出 4 张 → 逐张实测全部 200 image/jpeg ✓
```

注意：duitang / renwuji 这类站点在本机会被 TLS 层直接断开（`Client network socket disconnected
before secure TLS connection was established`，curl 与 7890 代理同样不通），所以它们的图**必然**
进不了结果 —— 这是真实网络状况，现在会如实说出来，而不是假装成功。

**回归**：`node test/run-all.mjs --full` → **15 套件全绿 / 0 失败**；
`IG_TOOL_ONLINE=1 node test/probe-tool-result.mjs` → **45/45**（真搜一次，过宿主两道闸门）。

## 1.8.2 — 2026-10-21

### 🔴 修：搜图 100% 报错——返回值被 DSH 两道闸门整条丢弃（1.8.1 引入的回归）

**症状（用户重启后实测）**：

- `display_image(query="毛晓彤")`、`display_image(query="猫")`（复现 2 次）→
  `Error: tool "display_image" returned invalid output: value is not lossless JSON` —— 一张图都发不出来。
- `display_image(query="毛晓彤", source="huaban")` →
  `Error: ... "value.images[0].rescueError" is not a declared property (additionalProperties: false)`。

**根因：宿主对工具返回值有两道独立闸门，任一处不过就丢弃整条结果**（读 DSH 宿主 `app.asar` 源码证实）：

1. **无损 JSON**：`visitJsonValue` 要求每个键可枚举、数字 `Number.isFinite` 且 `!== -0`；源码注释原文
   `"Nested \`undefined\`, \`NaN\`, and infinities stay rejected."`
2. **`output.schema` + `additionalProperties: false`**：返回值出现未声明字段，整条结果作废。

对上 1.8.1 的两处改动：

- 1.8.1 把 Bing 提到 `SOURCES` 首位，而 **Bing 结果不带宽高**，旧映射写的是
  `width: typeof r.width === "number" ? r.width : undefined` → 每次搜图都带 undefined 键 → 闸门①拒收。
- 1.8.1 新加的 `it.rescueError = ...`（本意是把静默失败如实说出来）忘了在
  `output.schema.images.items.properties` 里声明 → 闸门②拒收。

**为什么 1.8.1 的 14 套件全绿却没挡住**：旧探针只测到 `searchImages` 这一层函数，
**从不构造真实工具返回值**，也就从不经过宿主校验。这是探针的盲区，不是运气不好。

**修复**：

- `output.schema.images.items.properties` 补上 `rescueError: { type: "string" }`；
- 宽高改为「先建 item，再 `if (Number.isFinite(...))` 写入」，不再写 undefined 键；
- 新增 `lossless()` 兜底：返回值出栈前递归清洗 undefined / NaN / ±Infinity / -0
  （数组内坏值补 null，带 ancestors Set 防自引用炸栈）；
- 新增 `truncateSafe()`：截断标题时避免切断 UTF-16 代理对（emoji）。

**新探针 `test/probe-tool-result.mjs`（离线 39 / 在线 45）**：真 `apply()` 注册工具 + 真 `execute()`，
再把返回值喂给**复刻的宿主两道闸门**。负控用「从 schema 里删掉 rescueError 的 reduced schema」
复现 1.8.1 形状——拿现 schema 做负控等于自欺（第一版就是这么写的，已改）。
`IG_TOOL_ONLINE=1` 真搜「毛晓彤」→ 45/45，返回值通过两道闸门。

**顺带钉死一条**：本地分支的 `images[].url` 是**根相对** `/images/?abs=…`，探针显式断言
「不得出现绝对 URL」——桌面端 `port: 0` 每次重启换端口，绝对 URL 必然失效。

**回归**：`node test/run-all.mjs --full` → **15 套件全绿 / 0 失败**。

## 1.8.1 — 2026-10-21

### 🐞 修：搜索图源「有结果」被当成「结果能用」，花瓣全坏时一张图都发不出来

**症状**：`display_image(query="毛晓彤", limit=5)` 要等 **18 秒**，然后返回 5 张图，但对话里**全部显示为加载失败**；`save_to` 保存 **0/5**。

**根因是一条假设错了**，不是某个函数写错：

```js
// 旧 searchImages
var clean = filterResults(found, query);
if (clean.length) return { images: clean.slice(0, want), ... };   // ← 「非空」就判定这个源可用
```

花瓣（huaban）的搜索 API 一直返回 200 + 20 条结果；**但它所有图片链接都返回 HTTP 567**（腾讯 EdgeOne 的安全策略拦截页）。于是：

1. 花瓣「有结果」→ 立即 `return`，**永远不会降级到 Bing**
2. `probeRemoteForBrowser` 判定 5 张全 blocked → 逐张转存（串行，10 张 18.4 秒）
3. 转存走同一个 CDN，**同样 567** → `catch (e3) {}` **空 catch 静默吞掉**
4. 图片 URL 保持原样 → 浏览器也加载不了 → 正文显示「失败 · 文件名」

**实测证据（10-21，本机）**

| 探测 | 结果 |
|---|---|
| `api.huaban.com/search/file` | 200，20 pins |
| 花瓣图片 URL（5 种 auth_key 变体） | **全 567** |
| 花瓣图片 URL（4 种 referer / UA / cookie / 代理直连） | **全 567** |
| `pic.sogou.com` API | 200，但 body 只有 40 字节 `{"status":1,"info":"forbid","data":null}` |
| `cn.bing.com` 直连 | 2 次里 1 次 TLS 断连（`Client network socket disconnected...`） |
| `cn.bing.com` 走 7890 代理 | 2/2 成功，35 hits |

**修复（`lib/index.js`，4 处）**

1. **图源健康度采样**（新增 `sampleSourceHealth`）：每个源抽 4 张真探一次，可加载率 < 30% 就记原因、继续下一个源。所有源都不达标时退回可加载率最高者，并标 `degraded: true` 如实告知 —— **不再把坏图当成好图交付**。
2. **图源顺序调整**：`Bing → 花瓣 → 搜狗`（花瓣本轮实测 0% 可加载，不该再排第一）。
3. **转存改 4 路并发**（新增 `mapLimit`）：10 张 18.4 秒 → 同等工作量约四分之一时间。已抽样的图不再重复 probe（每张少一次往返）。
4. **失败必须说出来**：转存失败的图记 `rescueError`，并在 `note` 里写明「有 N 张被原站点拦截且无法转存，对话里会显示为加载失败」，而不是空 catch。搜狗 `forbid` 也从静默变成明确报错。

**顺带修的一个卫生问题**：`~/.dsh/image-gallery-auto`（自动转存目录）**只写不删**，实测已累积 129 个文件 / 187 MB，最早的是 9 月 28 日。新增 `pruneAutoCache()`：超过 500 文件或 512 MB 就从最旧的开始删，每次转存前执行一次。

**`httpGetText` 加了 1 次重试**：Bing 直连实测约一半概率在建 TLS 时被断开，一次重试就把这个源从「时好时坏」变成「稳定可用」。HTTP 状态码类错误不重试（那是服务端给的答案，重试不会变）。

### 🧪 回归

`node test/run-all.mjs --full` → **14 套件全绿 / 0 失败**（新增 `test/probe-source-health.mjs` 37 项）。

新探针的鉴别力是**实测过的**，不是声称的：对 1.8.0 的 `lib/index.js`（`git show 13a1b49:lib/index.js`）跑同一套断言 → **4/22 通过**；对新代码 → **37/37**。通过的那 4 项全是「不许回退」类断言（`bodyMarkdown` 引用式 + salt + `localUrl` 不用绝对 URL），1.8.0 本来就有，符合预期。

端到端真跑（`E:/tmp/lightbox-lab/live_search_e2e.mjs`，真实网络）：

| query | 采用图源 | 抽样健康度 | 返回图可加载 |
|---|---|---|---|
| 毛晓彤 | Bing 图片（**自动降级成功**） | 4/4 | 3/3 |
| 蔡秀彬 | Bing 图片 | 4/4 | 2/3 |

强制 `source=huaban`（全 567 现场）→ `degraded: true` + 「4 张抽样仅 0 张可加载」，行为正确。

### 📌 本轮的三条教训

1. **「有结果」≠「结果能用」**。`if (clean.length) return` 这种写法在数据源降级时会把整个功能静默变成坏图。凡是对外部数据源的「可用性」判断，都要落到端到端可观测的那一步（这里是「浏览器能不能加载」），不能停在中间态。
2. **空 `catch {}` 是有毒的**。`catch (e3) {}` 让「转存失败」这个关键事实彻底消失，用户只能看到坏图，而日志里一片安静。哪怕不处理，也要把 `e.message` 记到对象上，并且**在用户能看到的 note 里说出来**。
3. **探针必须先证明它有鉴别力**。只对当前代码跑一遍全绿，等于什么都没验证 —— 可能是断言太松、可能是关键字没搜到。把旧版源码喂给新探针（`IG_SRC` 环境变量），看它是否**大量失败**，才是「这个探针真的在查东西」的证据。

---

## 1.8.0 — 2026-10-20

### 🐞 修：两个常驻节点长期占用 `role="dialog"`，会让别的插件把界面卡成不可点

**症状（不是本插件可见，而是别人的插件坏了）**

用户报「设置点了没反应」，整个界面点不动。真实的因果链不在本插件里，但**起点在本插件**：

```js
// Agents AnyWhere 的关闭回调首行
if (document.querySelectorAll('[role="dialog"]').length > 1) return;
```

它会先给 `#root` 加 `inert`，关闭时再撤掉。上面那行闸门一旦为真，`✕` 被**静默吞掉**，`inert` 就撤不掉 —— 全应用点击失效。

本插件有两个**常驻 `<body>`** 的节点，关闭时只是 `display:none` / `visibility:hidden`：

| 节点 | 何时创建 | 原实现的错误 |
|---|---|---|
| `.dsh-ig-backdrop`（图片查看器外壳） | 首次打开图片时 | 创建即挂 `role="dialog"`，此后**永不摘除** |
| `.dsh-ig-pop`（工具栏面板） | **mount 阶段**（要塞 4 个真实控件进去） | 创建即挂 `role="dialog"`，用户可能**一辈子不点开**它 |

`display:none` / `visibility:hidden` **不会**让 `querySelectorAll` 漏掉节点。于是「常驻 2 个 + 别人的弹窗 1 个」= 3 > 1，闸门永远为真。

**修复（`lib/client.js` 五处）**

- `ensureLightbox()` / `ensurePopover()`：**创建时不挂 `role`**，只保留 `aria-label`（可发现性不丢）
- `open()` / `openPopover()`：装 `role="dialog"` + `aria-modal="true"`
- `close()` / `closePopover()`：摘 `role` / `aria-modal` / `tabindex`

无障碍语义跟着**可见性**走，而不是跟着**创建**走。

**验证：`test/probe-poprole.mjs`（15 项，且证明有鉴别力）**

从 bundle 抠出真实的 `ensurePopover` / `openPopover` / `closePopover`，配最小 DOM 桩跑三态：

| 断言 | 修复前 | 修复后 |
|---|---|---|
| T1 创建后不得带 `role` | **FAIL** `role=dialog` | PASS `null` |
| T1 创建后全局弹窗计数 = 0 | **FAIL** `count=1` | PASS `count=0` |
| T1 保留 `aria-label` | PASS | PASS |
| T2 打开后 `role`/`aria-modal` | 部分 FAIL | PASS |
| T3 关闭后必须摘掉 | **FAIL** `role=dialog` | PASS |
| T3 关闭后计数 = 0 | **FAIL** `count=1` | PASS |
| T4 第二次打开语义不丢 | PASS | PASS |

**鉴别力自证**：`LB_SRC=<修复前文件> node test/probe-poprole.mjs` → **10 通过 / 5 失败**；对当前代码 → **15 通过 / 0 失败**。一个新探针在修复后全绿只能说明「没坏」，必须拿它跑修复前版本、跑红，才算真的在测这件事。

### 🐞 修：同一条消息里两次 `display_image`，第二组图会显示成第一组

正文改引用式后，标签原本是**裸 1 基序号**（`[1]:`、`[2]:`…）。序号只在**单次调用内**唯一，而一条回复里放多次调用是常态（投递铁律就要求「每批图各自成段」）。两次调用都发 `[1]:` 时，mdast **保留最早的 definition** —— 第二组图静默指向第一组的文件。

修复：标签加 3 位 base-36 盐（`var salt = Math.random().toString(36).slice(2,5) || "z9"`，`label = salt + (i+1)`）。代价是流式字面量从 8 字符升到 11 字符（`![图1][k3f1`）；收益是避免「显示错图」，这个交换成立。

### 🧪 测试迁移（不是产品缺陷）

- `regress.mjs`：正文从内联 `![](dest)` 改为引用式后，抽取器同步重写（先收定义行、再按文档序回填），并新增「两次调用标签唯一性」断言块 → **10/10**
- `bodyurl.mjs`：`bodyUrl` 已重命名为 `bodyPath`（返回 `{local, value}`），单元层改按对象比较 → **12/12**

### 同步内容

- `package.json` `version` 1.7.9 → **1.8.0**
- 新增 `test/probe-poprole.mjs`、`test/probe-rowclear.mjs`

### 教训

1. **「成对实现」不等于「成对执行」**。`openPopover`/`closePopover` 看着完全对称、读码挑不出毛病；漏的是**第三条路径 —— 创建**。凡是「创建 → 打开 → 关闭」三态的资源，准入属性只能在**打开**时给，不能在**创建**时给。
2. **常驻节点 + 全局角色 = 生态级 bug**。`display:none` 挡得住眼睛，挡不住 `querySelectorAll`。任何插件只要用「数弹窗」做闸门，就会被这个幽灵节点永久带偏。
3. **探针必须自证有鉴别力**。本轮第一版探针是**假绿**：`ensurePopover()` 根本没被执行（桩里 `mod` 取成了 factory 函数本身，`apply` 落到 `Function.prototype.apply`），`count=0` 是「什么都没创建」而不是「创建了但没有 role」。改成抠函数源码 + 受控作用域后，才对修复前版本跑出 5 红。
4. **两个分支会悄悄分叉**：这两个修复一度只存在于 web 的 `node_modules`（1.7.10 / 1.7.11），**从未进过 main、也从未发到 npm**（npm `versions` 尾部就是 `1.7.9`）。只比「本地 vs 实装」两方是查不出来的。

### 固化：已验证基线 + 一键回归 + 完整备份

用户提出「我担心你读对话漏记录，把已经好的版本弄没了，后续还需要在这些好的基础上改，你最好备份下」。
这不是一次性的备份请求，而是要求把「什么已经验收过、不许回退」变成**代码仓库里的硬约束**。

**新增 `docs/VERIFIED-BASELINE.md`（236 行）** —— 把验收状态写死在代码坐标上：

| 章节 | 内容 |
|---|---|
| 零、三条铁律 | 不许回退已验收功能／改完必须跑全绿／改布局函数前先读保护坐标 |
| 一、已验收功能表 | 10 条，每条带**验收证据**（用户原话 seq）与实现位置 |
| 二、受保护代码坐标 | `tickThumb` 的「只用 `parentElement` 不用 `closest()`」、`hasText` 判定、`markGridHosts` 补齐逻辑、`markRowClears` 的四条要点、布局 CSS 全量、正文拼装 6 个函数 |
| 三、宿主行为约束 | 正文图链路全图、流式期为何物理上出不了本地图、为何会闪字面量、为何路径已 0 泄漏 |
| 四、回归测试基线 | 自带探针 + 实验室 11 套件 + 依赖说明 |
| 五、版本分叉风险 | 5 个位置的真实版本对照表 |
| 六、备份与恢复 | 三条恢复路径（git reset / bundle clone / zip 解压） |
| 七、改动检查清单 | 10 条，含「发布前单独取得用户授权」 |

**新增 `test/run-all.mjs` —— 一条命令跑完全部回归**：

```bash
node test/run-all.mjs          # 插件自带探针（2 套）
node test/run-all.mjs --full   # 再加实验室 11 套件
```

- 各套件输出格式不统一（`通过 10 / 失败 0`、`结果 7/7`、`15 通过 / 0 失败`、`18/18 通过`），脚本按优先级依次尝试解析，最后回退到数 `✓`。
- 依赖缺失时报 `SKIP` 而**不是假装通过**。
- 退出码 0/1，可直接接 CI。
- 实测：`--full` → **13 套件全绿，0 失败**。

**完整备份**（`C:\Users\Administrator\.dsh\backups\dsh-chat-image-lightbox-1.8.0-20261020-221302\`）：

| 文件 | 作用 |
|---|---|
| `source-1.8.0-5c4433c.zip` | 完整源码（`git archive`，27 文件） |
| `repo-1.8.0-all-branches.bundle` | 完整 git 历史（所有分支 + tag），`.git` 损坏时用它重建 |
| `files\` | 5 个关键文件散装副本 |
| `testlab\` | 144 个探针/实验脚本 |
| `lab-full\` | `extracted`（宿主源码抠取）+ `mdlab`（mdast）+ `node_modules` |
| `SHA256.txt` | 9 个文件校验和 |

同步打了 git tag **`v1.8.0-verified`**（指向 `5c4433c`），一条 `git reset --hard v1.8.0-verified` 即可回到验收态。

### 教训（补充）

5. **「改完记得跑测试」靠记忆一定会漏**。旧方案是散在 `E:\tmp\lightbox-lab` 的 11 个脚本，没有任何清单，改动者只能凭印象挑几个跑（本轮之前就出现过只跑 4 个就宣称全绿）。做成 `run-all.mjs` + 固定期望数（`expect` 字段）后，"少跑"和"跑少了"都会暴露。
6. **备份不是拷一份 zip 就完事**。真正的风险是「回不去」：只拷源码 ⇒ 丢了 git 历史；只拷 git ⇒ `.git` 损坏时全丢；只拷关键文件 ⇒ 测试脚本没了、改完无法验证。所以本轮存了三层（zip / bundle / 散装）+ 测试资产 + 依赖。

## 1.7.9 — 2026-10-19

### 文档与代码对齐（无功能改动）

逐条核对 README / locale / package.json 与 `lib/index.js` / `lib/client.js` 的真实行为，修正 5 处不符。

| # | 位置 | 原写法 | 实际行为 | 取证 |
|---|---|---|---|---|
| 1 | README.md:190 / :206 / :361 / :377（中英共 4 处） | 教用户写 `![x](http://127.0.0.1:<port>/images/…)` | **这正是 1.7.7 修掉的故障写法**。桌面端页面 origin 是 `dsh-app://app`，绝对回环地址是跨源，Chromium 在渲染进程直接拦，请求到不了 webServer。必须用站内根相对 `/images/?abs=…` | 1.7.7 探针实测：相对路径 `200 / image/webp / nw=120 nh=213`；绝对 `fetch` 抛 `TypeError: Failed to fetch`、`img onerror` |
| 2 | README.md API 表（中英各一份） | 只列 3 条路由 | 实际 **5 条**，漏 `/api/image-gallery/reveal`（POST，在文件管理器定位）与 `/api/image-gallery/diag`（POST，客户端调试日志） | `lib/index.js:1044-1048` `webServer.register` 五处 |
| 3 | README.md:42-43 / :312 / :491 | 「DSH **2.0.14** 及以上」「已在 DSH NEXT **2.0.15** 验证」 | 与 `package.json` 不符：`engines.dsh` 与 `peerDependencies["@deepseek-ai/dsh"]` 都是 **`>=0.1.7-rc.1`**（不硬绑内核版本）。实测环境是 **2.0.18-next** | `package.json` `engines.dsh`；asar 读 `/package.json` = `dsh-desktop-next 2.0.18-next` |
| 4 | README.md:147 / :331 | 「再点一次缩回」 | `lib/client.js:646-651`：`zoomScale > 1` 时点击图片是 **`close()` 关闭灯箱**，不是缩回原比例 | `lightboxImg.addEventListener("click", …)` → `if (zoomScale > 1) { close(); return; }` |
| 5 | `locale/zh.json:4` / `locale/en.json:4` | 「支持缩放、多列布局与一键隐藏图片」 | 漏了 TIFF/HEIC 无损转码、防盗链自动转存、下载另存、左右翻页、图片投递铁律 | 与 `package.json` description 逐项比对 |

### 同步内容

- `package.json` `version` 1.7.8 → **1.7.9**
- `locale/zh.json` / `locale/en.json` 的 `meta.description` 重写（补齐转码 / 转存 / 下载翻页 / 投递铁律）
- README 中英两侧各 5 处修正

### 教训

1. **修复代码后必须回头改文档**：1.7.7 把 URL 改成根相对是正确修复，但 README 里 4 处教学示例仍写着旧写法，等于**官方文档在教用户触发同一个 bug**。这类「文档残留正好是刚修掉的坑」最难被用户识别——他们照文档写，然后报「还是显示不出来」。
2. **版本下限要抄 `package.json`，不要凭印象**：README 写 2.0.14 是历史遗留，而包实际声明 `>=0.1.7-rc.1`。后者才是 npm 安装时真正生效的约束。
3. API 表这类清单必须用 `grep webServer.register` 生成，手写必然漏。

## 1.7.8 — 2026-10-18

### 图片投递铁律（防"以为没发图"）

**问题**：图片渲染修好后仍然存在人机沟通层面的漏洞——`display_image` 的图只出现在**工具调用行**里，而工具行默认是折叠的。用户上下滚动正文时看不到折叠区里的内容，于是合理地认为"你根本没发图"。这不是渲染 bug，是**交付契约缺失**。

**修复**：插件宿主半边新增一条常驻 system prompt section（`image-gallery:delivery-law`，order 1500，503 字符），强制模型遵守：

1. 交付图片必须写在**回复正文**里（`![](…)` markdown），不得只依赖工具调用行。
2. 一次发多张时正文按序逐个粘贴，不许写成「见上文」「已发送 N 张」。
3. 路径不是图、链接文本不是图。
4. 工具返回的 markdown 就是最终形态，原样贴，不改写、不加反引号。

**为什么用 prompt section 而不是技能**：技能是按需加载的，prompt section 是常驻的——装插件即生效，不依赖任何技能被加载。

**关闭方式**：在 profile 的 cordis patch 里给本插件加 `config.injectImageLaw: false`。

**实现细节**：
- `inject` 从 `["webServer","tools"]` 扩展为 `["webServer","tools","systemPrompt"]`。
- `apply(ctx)` → `apply(ctx, config)`。
- 注册走 `ctx.effect(...)`，随插件 dispose 一起回收；`systemPrompt` 服务缺失时降级为 `logger.warn` 而非崩溃。
- 用 mock ctx 实跑 `apply` 验证：`SECTION name=image-gallery:delivery-law order=1500 chars=503` 正常注册，5 条路由与 `display_image` 工具注册均不受影响。

### Enforce image delivery in the conversation body

**Problem**: even after the rendering fix, a `display_image` picture only lived inside the (collapsed by default) tool call row. Scrolling the transcript, the user sees no image and concludes nothing was sent.

**Fix**: the host half now registers a resident system-prompt section (`image-gallery:delivery-law`, order 1500, 503 chars) that requires the model to (1) put every delivered image in the reply body as `![](…)`, (2) paste them one by one when sending several, (3) never treat a file path or a bare link as a delivered image, and (4) paste the tool's markdown verbatim.

**Why a prompt section, not a skill**: skills are loaded on demand; a prompt section is resident, so installing the plugin is enough.

**Opt out**: set `config.injectImageLaw: false` on the plugin's row in the profile patch.

## 1.7.7 — 2026-10-18

### 桌面端图片不显示（根因修复）

**症状**：DSH 桌面端对话里，`display_image` 的图片变成 `🔧 工具调用 · display_image` 折叠行，图片完全不出现；同一张图用 `/images/?abs=...` 相对路径却能正常加载。

**根因**：桌面端外壳把页面跑在自定义协议 `dsh-app://app` 下（`location.origin === "dsh-app://app"`、`location.port === ""`）。宿主半边 `baseUrl()` 产出的绝对 URL `http://127.0.0.1:<port>/images/...` 因此是**跨源请求**，Chromium 在渲染进程里直接拒绝——实测 `fetch` 得到 `TypeError: Failed to fetch`、`<img>` 触发 `error`，请求根本没离开渲染进程，所以宿主日志里 `/images/` 命中数为 0。

**修复**：所有面向浏览器的一半都改用**根相对路径**。
- `lib/index.js`：`baseUrl()` 返回 `""`，`localUrl()` 于是产出 `/images/?abs=...`。页面与路由在桌面自定义协议和网页端都同源，相对路径两边都对。
- `lib/client.js`：`igImageUrls()` 正则放宽为 `(?:https?://|/)`，接受根相对 markdown 源；`igDiag()` 的 POST 目标改 `/api/image-gallery/diag`。

**为何不能"继续用端口"**：自定义协议源到 `127.0.0.1` 的跳转属 Chromium 的私有网络访问限制，补端口无用；只有同源相对路径可靠。

**验证**：探针在真实页面里对比两种形式——相对 `/images/?abs=...` → `200 image/webp`，200x355，27116 bytes，`img.onload` 触发；绝对 `http://127.0.0.1:<port>/images/?abs=...` → `Failed to fetch` + `img.onerror`。

### Desktop: images did not render (root-cause fix)

**Symptom**: in the DSH desktop app a `display_image` picture collapsed into a `Tool call · display_image` row instead of the image, while the very same file loaded fine through a root-relative `/images/?abs=...` URL.

**Root cause**: the desktop shell serves the conversation from the custom protocol `dsh-app://app` (`location.origin === "dsh-app://app"`, `location.port === ""`). The host half's `baseUrl()` produced absolute `http://127.0.0.1:<port>/images/...` URLs, which are **cross-origin** from that scheme and are rejected inside the renderer — measured `fetch` → `TypeError: Failed to fetch`, `<img>` → `error`, and the request never reached the server (zero `/images/` hits in the host log).

**Fix**: every browser-facing piece now emits **root-relative** URLs.
- `lib/index.js`: `baseUrl()` returns `""`, so `localUrl()` yields `/images/?abs=...`. Route and page share an origin on both the desktop custom protocol and the web build.
- `lib/client.js`: `igImageUrls()` now accepts `(?:https?://|/)` sources, and `igDiag()` posts to `/api/image-gallery/diag`.

**Why the port cannot be kept**: a custom-scheme origin reaching `127.0.0.1` trips Chromium's private-network rules; only a same-origin relative path is reliable.

**Verification**: an in-page probe compared both forms — relative `/images/?abs=...` → `200 image/webp`, 200x355, 27116 bytes, `img.onload` fired; absolute `http://127.0.0.1:<port>/images/?abs=...` → `Failed to fetch` + `img.onerror`.

## 1.7.6 — 2026-10-14

### 合规性改进（无功能改动）

本次为**纯元数据与文档改动，未触碰任何运行代码**（`lib/*.js` 与上一版逐字节一致）：

- **包元数据**：`engines.node` 对齐 DSH 运行时（`^22.19.0 || >=24.0.0`）；补 `packageManager`；`files` 白名单补上裸目录 `lib`、`locale/*.json`、`icon.svg` 与多语言 README；`exports` 补 `./locale/*.json` 与 `./icon`。
- **交付元数据**（官方插件契约要求）：新增 `locale/en.json` 与 `locale/zh.json`（含 `meta.title` / `meta.description`），新增 `icon.svg`（插件管理器显示用图标，不再显示裸 id）。
- **多语言文档**：新增 `README-zh.md` 中文说明；`README-es/pt/hi.md` 标题与主 README 对齐。

以上改动使插件通过官方 `dsh-plugin-dev check` 全部检查项（`P=12 F=0 W=0`）。

### Compliance improvements (no functional changes)

This release is **metadata and documentation only — no runtime code was touched** (`lib/*.js` is byte-identical to the previous version):

- **Package metadata**: `engines.node` aligned with the DSH runtime (`^22.19.0 || >=24.0.0`); `packageManager` added; `files` allowlist now includes the bare `lib` directory, `locale/*.json`, `icon.svg` and the multi-language READMEs; `exports` gained `./locale/*.json` and `./icon`.
- **Display metadata** (required by the official plugin contract): added `locale/en.json` and `locale/zh.json` with `meta.title` / `meta.description`, plus `icon.svg` so the plugin manager shows a real name and icon instead of a bare id.
- **Multi-language docs**: added `README-zh.md`; `README-es/pt/hi.md` headings aligned with the main README.

With these changes the packages pass every official `dsh-plugin-dev check` item (`P=12 F=0 W=0`).

---

## 1.7.5 — fix: sharp version conflict broke image sending in DSH

- fix(deps): **`sharp` is now declared as `^0.35.3` instead of the exact
  `0.34.4`.** The DSH kernel (`@deepseek-ai/dsh-attachment-local`) depends on
  `sharp: ^0.35.3` from its very first release, so pinning `0.34.4` here forced
  **two different sharp versions into the same process**.
- Why that broke things: both sharp builds load a DLL named
  **`libvips-42.dll`** (identical filename), but they need different companions
  — `libvips-cpp-8.17.2.dll` for sharp 0.34.x vs `libvips-cpp-8.18.3.dll` for
  sharp 0.35.x. **Windows resolves DLLs by filename**, so whichever version
  loaded first won the namespace. When this plugin loaded `0.34.4` first, the
  kernel's subsequent `0.35.3` load failed with
  `ERR_DLOPEN_FAILED: The specified procedure could not be found`.
- The visible symptom was **sending any image in chat failed**, reported as
  `prompt rejected (session/agent-busy)` — a misleading wrapper the kernel uses
  for unclassified errors, which is why the real cause was hard to spot.
- **No plugin code changed.** All six sharp APIs this plugin uses
  (`metadata`, `rotate`, `resize({width, withoutEnlargement})`,
  `png({compressionLevel})`, `webp({quality})`, `toBuffer`) were verified
  compatible with 0.35.3, and the TIFF→PNG path was confirmed
  **pixel-identical** (lossless) on 0.35.3.
- The `^` range (rather than another exact pin) lets this dependency follow the
  kernel instead of drifting out of sync again.

## 1.7.4 - rename to unscoped package, official DSH peer declarations

- **Package renamed `@loyalchiiina/dsh-chat-image-lightbox` to `dsh-chat-image-lightbox`**
  (unscoped). The Cordis patch row `id`, `name`, and the client bundle's
  `__ModuleLoader__.load({ id })` all use the new bare name, so the three
  identities stay aligned.
- The patch row `id` was `image-gallery` and no longer matched the package
  name; it is now the full package name.
- **Added official DSH compatibility declarations.** The kernel checks
  `peerDependencies` on `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`
  (it does **not** read `engines.dsh` - see the official
  `packages/boot/app-boot/README.md`): `peerDependencies` now declare
  `@deepseek-ai/cordis` `^4.0.2` and `@deepseek-ai/dsh` `>=0.1.7-rc.1`,
  mirrored in `devDependencies`.
- `engines.dsh` previously held a **client/shell** version (`>=2.0.14`);
  it now states the **kernel** version (`>=0.1.7-rc.1`). Note that `^0.1.7`
  would *not* match the pre-release kernel `0.1.7-rc.2`, which is why the
  range is written with an explicit pre-release floor.

No functional change to the lightbox, thumbnail grid, hide/show, TIFF/HEIC
transcoding or hotlink fallback behaviour.


## 1.7.1 — fix: display_image images vanished after a moment

- fix(client): **images rendered by the `display_image` toolview row no longer
  disappear right after they appear.** The row is a `tool.call.toolview` slot,
  not a message block, so its `<img>` elements were invisible to
  `allBlocks()`/`syncFoldState` — yet `isChatImage()` still adopted them. That
  produced a tug-of-war: the MutationObserver re-applied our class on every
  mutation while React's next render wiped `className` again, and the row
  eventually got unmounted. Symptoms: images flash once, then vanish; scrolling
  back does not restore them; image size is irrelevant.
- fix(client): the toolview `<img>` now carries `data-dsh-ig-skip="1"` plus
  `className="dsh-ig-toolimg"`, and `isChatImage()` returns early for both —
  so the enhancer leaves tool-result images alone. Regular chat images are
  unaffected.
# Changelog

## 1.7.3 — docs: feature screenshots

- docs: four screenshots added under `docs/images/` and embedded in the README, one
  section each — `lightbox.png` (full-screen viewer), `columns-3col.png` and
  `columns-multi.png` (thumbnail grid at different column counts), and
  `hide-images.png` (hide / restore).
- chore: `files[]` now lists those four images individually instead of globbing
  `docs/images/**`, so the package is not published with the older 1.8 MB hero
  image that is no longer referenced anywhere. Tarball: 2.0 MB → 1.4 MB.

No functional change; the code is identical to 1.7.2.

## 1.7.2 — thumbnails/hide finalised, jump removed, hotlink fallback, no DOM reparenting

> Verified end to end on **DSH NEXT 2.0.15**. Minimum kernel: **DSH 2.0.14**.

### ⚠️ Breaking / removed

- **removed:** the **jump-to-image** feature. Its button (`⌖`), all of its code and
  its CSS were deleted. Across iterations it stayed unreliable — it stepped
  between message *blocks* rather than pictures, so with a batch of images in one
  container it appeared to do nothing, and it landed only on the first or last
  picture. Rather than ship a control that works only sometimes, it is gone.
  The toolbar panel now holds exactly: thumbnail switch, hide switch, column field.

### 🔴 Fixed: the conversation could render completely blank

- fix(client): **never reparent React-managed DOM nodes** — this is the headline
  bug of this release. An earlier build completed the thumbnail row by moving the
  `<img>` elements into a container the plugin created (`removeChild` +
  `appendChild`). That mutates the tree underneath DSH's virtual list, and the
  host logged:

  ```
  [warn] slot entry crashed in 'conversation.chat.node': [object DOMException]
  ```

  The whole transcript then rendered as **nothing** — no pictures, no prose —
  which reads to a user as "the content was deleted". All reparenting code was
  removed. The thumbnail look is now expressed purely with classes and inline
  styles on the existing elements; no node is moved, removed or recreated.

### Fixed: hidden images no longer leave a blank band

- fix(client): hiding used to hide only the `<img>`, leaving the wrapper's own
  margins/padding and a forced `min-height: 18px` behind — a large empty band
  stayed in the conversation. Now the wrappers that exist only to hold a picture
  are hidden as well (`:has(> img)`), and the block itself is tightened to zero
  margin/padding/min-height, so the row closes up completely.

### Fixed: only conversation images are touched

- fix(client): `isChatImage()` decided purely on pixel size, so the signed-in
  **account avatar** and the sidebar glyphs — ordinary `<img>` elements — were
  adopted as chat photos and got resized/moved when thumbnails were switched on.
  A new `isInConversation()` check rejects known chrome landmarks
  (`avatar` / `userRow` / `sidebar` / `toolbar` / `navRail`) and requires an
  ancestor that looks like the message list. Anything else is skipped.

### Fixed: text no longer squeezed by the thumbnail layout

- fix(client): the block used to be given `display: grid` plus a fixed column
  count, which laid the row's **prose and tables** into grid tracks — every line
  wrapped early. Grid styling of the block was removed. Tiles float at 1/N width
  and a wrapper is only floated when it holds a picture and no text.
- fix(client): the tile wrapper is now the image's **immediate parent** only. An
  earlier version used `closest()`, which could claim a much larger container and
  displace unrelated UI.

### Fixed: `display_image` results render as images

- fix(client): `package.json` now injects `@deepseek-ai/dsh-client-ui-tool`. The
  `tool.call.toolview` slot belongs to that package, and without it in `inject`
  the keyed registration was silently skipped — so `display_image` returned
  Markdown that never became an `<img>`.

### Fixed: text/no-op freezes

- fix(client): the MutationObserver now watches `attributes` + `class` (it only
  watched `childList`, so the re-adoption path in its own callback could never
  fire).
- fix(client): `tickThumb()` / `untickThumb()` are idempotent (a per-image stamp
  records the column count already applied), and a switch pass suppresses the
  observer while it writes. Previously each write produced mutations that the
  observer answered by re-applying what the pass was removing — an endless loop
  that **froze the client** when expanding after thumbnails or typing in the
  column field.
- fix(client): the scroll-anchor correction runs **once** on the next frame. The
  earlier multi-frame version contended with the browser's own relayout and fed
  the same loop.

### Added: automatic fallback for hotlink-protected images

- feat(host): a search result can answer `200` and still fail in the browser.
  Huaban's CDN (Tencent EdgeOne) rejects any request whose `Referer` is not its
  own domain, so the picture showed as "无法预览" even though the link was good.
  The tool probes each URL the way a browser would (loopback `Referer`) and
  **re-saves only the ones that would be blocked**, into
  `~/.dsh/image-gallery-auto/`. Working links stay direct, so nothing is
  downloaded unnecessarily. The reply notes how many were re-saved.

### Changed

- change: the trigger button shows the text **「对话图显控制」**; the `🖼` glyph
  was dropped (it read as a picture thumbnail rather than a control).
- change: the column field is labelled **「缩略图显示列数」** and its value is
  saved as the **default** for later launches. Default remains **3**.
- change: the diagnostics channel (`igDiag`) is **off by default**
  (`IG_DEBUG = false`). Three of its call sites sat on the hottest paths in the
  file — every DOM mutation, every scan, every image per scan — and each one was
  a loopback POST, which made the client stutter while output streamed. Hot paths
  now test the flag before building the string.
- chore: removed ~120 lines of dead code (`applyRowLayout`, `gridHostFor`,
  `hostHasText`) left over from the retired grid-host approach.


## 1.7.0 — display_image results now actually render in chat

> DSH only renders an image card for the built-in `read_image` tool; every
> other tool's result (including `display_image`) was shown as plain text, so
> markdown image URLs never became visible images. The client now registers the
> official `tool.call.toolview` slot for `display_image` and renders the
> returned image URLs as real `<img>` elements — lightbox, thumbnail grid and
> hide-all apply to them automatically via the existing MutationObserver.

- fix(client): register `tool.call.toolview` (key `display_image`) so
  display_image results render inline images instead of raw markdown text.
- dep(client): the client entry now injects `slots` and requires `react`
  (both provided by the DSH client runtime).


## 1.6.0 — native-resolution TIFF, copy-path & show-in-folder

> 本地 TIFF 改为默认**原像素无损显示**（纠正了一个把"64MB 大小上限导致的静默 404"
> 误判成"像素太多渲染卡死"的错误）；灯箱新增「复制文件路径」和「在文件夹中显示」。

- fix(host): **`MAX_FILE_SIZE` 64 MB → 512 MB**. The old cap silently 404'd real
  chart exports — a Fluent merged-comparison TIFF is routinely 70–80 MB — and a
  silent 404 is indistinguishable from a missing file. Oversized requests now
  return `413` with a plain-text reason instead of a bare 404.
- feat(host): **TIFF/TIF/PNG/BMP are re-encoded losslessly (PNG) and served at
  native resolution by default.** A real 19200×10800 (207 MP, 78.8 MB) export
  displays promptly at full size — measured pixel-exact (0 altered bytes across
  74.6 M channels). The old path was lossy WebP q92, which measurably damages
  thin lines (mean abs error 1.10/255, max single-channel 166, ~10% pixels
  altered). A 240 MP ceiling remains as a backstop for Chromium's own decode
  limit.
- feat(host): **`/api/image-gallery/reveal`** — "show in folder". Loopback-only,
  path must be an existing file, and `explorer /select,<path>` is spawned as an
  argv entry (never a shell string) so a crafted filename cannot inject a
  command. The browser cannot open a file manager itself, so the client asks the
  host half.
- feat(client): **「⧉ 复制图片文件路径」** in the lightbox toolbar — resolves the
  `abs` path from the image URL and writes it to the clipboard (with a
  `execCommand` fallback). Remote images are politely told there is no local
  path rather than silently doing nothing.
- feat(client): **「📂 在文件夹中显示」** in the lightbox toolbar — calls the
  reveal route. Same polite refusal for non-local images.
- chore: the fidelity finding and the format matrix (11 formats tested) are
  recorded in the plugin dev log, not shipped in the package.
- feat(client): **lightbox toolbar laid out as a 2-column grid** — close (✕) and
  download (⬇) share the top row, side by side; prev/next (‹ ›) sit under them
  and show only for multi-image groups; then copy-path / show-in-folder, then the
  conversation-wide thumbnail/hide switches. The zoom/pad cluster is positioned
  dynamically (`positionZoombar`) just below the toolbar, so it can never
  overlap it no matter how the toolbar's height changes. Prev/next references are
  captured at creation (a `querySelector` re-lookup had silently dropped them,
  reported as "you deleted the prev/next buttons").
- fix(client): **copy-path and show-in-folder give visible feedback** — a
  centered toast appears on every outcome, so a failure ("not a local file",
  clipboard denied) is never silent. The local path is recorded at enhance time
  (`data-dsh-ig-path`) so it survives URL re-signing, and copy falls back to
  `execCommand` when the Clipboard API is unavailable.

## 1.5.0 — conversation-wide image controls, thumbnail grid, jump-to-image

New: a compact popover (next to the composer's access-mode control) that acts on
**every** image block in the conversation at once, plus a host-side tool for
bringing images into the chat. 会话内全局图片控制（可调列数的缩略图网格 / 整块隐藏 /
跳图定位）+ 宿主侧 display_image 工具。

- feat(client): **one compact trigger ("🖼 图片") replaces the row of controls** —
  the four controls (缩略图 / 列数 / 隐藏 / 跳图) live in a fixed-position popover
  that slides out on demand; modelled on the same pattern used by `dsh-model-fold`
  (render hidden → measure → place, `mousedown`-safe, outside-press and Escape
  dismiss). The real controls are *moved* into the panel, not duplicated, so
  there is still exactly one of each.
- feat(client): **conversation-wide thumbnail grid** — one click collapses every
  image block into a CSS grid of small tiles (`object-fit: cover`), captions span
  the full row. Replaces the old per-block pseudo-element buttons.
- feat(client): **configurable columns per row** (1–12) with a small number field
  in the popover; persisted in `localStorage`; invalid input is clamped
  (`99 → 12`, `0 → 1`). Live-applied via `input`/`change`/`blur` and re-read
  right before entering the grid, so typing then immediately clicking the
  switch still uses the new value.
- feat(client): **hide / show whole blocks** — one click hides every image
  (block collapses to a slim strip), another restores it; images return intact
  because all inline styles are tracked and cleared per block.
- feat(client): **jump to the nearest image** — left click steps to the previous
  image, right click to the next; left triple-click jumps to the farthest image
  from the viewport centre, right triple-click to the nearest. Landing block
  flashes briefly. Stepping is relative to the last landed block and stops at
  the ends (it never wraps backwards, which previously read as "wrong direction").
- feat(client): **zoom / pan pad in the lightbox** (`⊖ ⊕ 1×` plus a d-pad, with a
  live percentage readout) — press-and-hold repeats; the wheel, drag, and
  keyboard gestures all still work. Toolbar moved to `top: 84px` so it clears
  the host window's own minimise/close buttons.
- feat(host): **`display_image` tool** — one entry point for showing a picture in
  the conversation: `path` (local file or directory, TIFF/HEIC transcoded),
  `url` (remote link), or `query` (keyword search). Returns ready-to-paste
  Markdown. The local proxy is discovered by TCP probe because the environment's
  `HTTPS_PROXY` pointed at a dead port. This is where the image-display skill's
  "how to get the picture" half now lives — fetching and transcoding are the
  plugin's job, so installing the plugin is enough; nothing has to be injected
  twice. Sources are tried in order (花瓣 → Bing 图片 → 搜狗图片) and each one's
  results are filtered before it counts as a success.
- feat(host): **result filtering** ported from that skill's 选图过滤 rules —
  adverts and shopping copy (`同款`, `接单`, `优惠`, `包邮` …) and other
  celebrities are dropped. If everything looks noisy the raw list is used
  instead, so an unusual query never filters down to nothing.
- feat(host): **`save_to` — download the pictures, not just show them.** Search
  results and `url` links can now be written to a directory (`save_to=<dir>`,
  created if missing). This closes the gap the image-display skill covers with
  its 落盘 branch, and it also fixes a real fragility: Huaban's links carry an
  `auth_key` that expires in roughly half an hour, so a conversation that only
  holds the CDN URL breaks later. Saved images are re-pointed at the plugin's own
  `/images` route, so what the chat shows is the local copy. Filenames keep CJK
  but drop Windows-illegal characters, and the extension is taken from the
  response content-type first, the URL second.
- feat(host): **search results are de-duplicated** — the same picture often
  appears more than once (same CDN object with different signing parameters, or
  the same photo re-hosted). Identity now strips the known signature/expiry
  parameters and adds a size signature, so genuine duplicates collapse while
  different images stay distinct.
- feat(host): **every result reports its real size** — `width`, `height` and
  `bytes`. Sources that publish dimensions (Huaban, Sogou) supply them directly;
  for sources that do not (Bing) they are measured with sharp after download.
  Without this, a 300×300 thumbnail and a 5464×7650 original looked identical in
  the result list.
- privacy: **the tool no longer echoes local paths into the conversation.** The
  `save_to` note used to print the destination folder; that text is visible in
  chat and would publish the local folder layout in any screenshot, so it now
  says "已保存 N/M 张到指定目录" instead. The `path` note additionally warns that
  its `?abs=` link contains a local path. Loopback `127.0.0.1` (proxy probe and
  the local image service) is functional, not identifying, and is the only
  address-shaped string in the package.
- feat(host): **downscaling is the default** — local images come back at
  `w=1600` unless the caller passes `width: 0`. Two independent verification
  runs both had to hand-downscale first (one source photo was 24 MB / 6548×4306
  and would not render at all), and that manual step was the slowest part of the
  flow; folding it into the tool makes the common case one call. The note in the
  result says so, and `width: 0` restores the untouched original.
- feat(host): `/images/?abs=<absolute path>` serves any file on this machine
  (loopback-only), so a local image can be shown in place instead of being
  copied into the gallery root first. The URL carries the file's mtime
  (`&v=<mtimeMs>`), which makes the skill's 缓存铁律 automatic: regenerating an
  image under the same name produces a new URL, so the browser cannot serve the
  stale copy.
- fix(client): **state synchronisation no longer depends on "freshly enhanced"** —
  the conversation is a virtual list; scrolling unmounts and remounts message
  nodes, and a remounted image is already stamped, so the old `if (touched)`
  gate left those blocks without their chosen mode applied.
- fix(client): **images re-adopt after React overwrites `className`** — a
  re-render can wipe our class while keeping the element; the "already handled"
  check now also requires the class, and the observer watches `class` attribute
  changes... *(see 1.5.0 notes: attribute watching was later withdrawn in favour
  of the class-check alone, which covers the same case without extra churn)*.
- fix(client): **per-block clearing instead of document-wide sweeps** — three
  separate bugs came from the same mistake: a global class sweep, a global
  button prune, and a global inline-style clear all ran *inside* the per-block
  loop, so each block undid the previous one's work. Batch operations now only
  touch the current block's subtree. (Symptom: the column count applied only to
  the newest message.)
- fix(client): **grid host selection** — the grid used to be applied to the
  message node, which typically wraps its whole content in a single child, so
  `repeat(4, …)` produced exactly one column. It now descends to the level whose
  direct children are the image wrappers.
- fix(client): **no more observer feedback loops** — every DOM write is guarded
  by a value comparison (writing `textContent` is a childList mutation), the
  observer has a re-entrancy guard, and a circuit breaker stops scanning if it
  ever exceeds 60 scans/second. Verified against a control build that reliably
  reproduced `JavaScript heap out of memory` without them.
- fix(client): **hot-reload instance ownership** — a reloaded module used to
  fight the previous instance's still-live observer, stacking duplicate control
  rows (measured: 51 buttons after 8 re-renders). Each instance now claims a
  unique id, superseded instances `disconnect()` outright, and the new instance
  sweeps stale nodes first.
- chore: tooltip self-report (`构建 / 状态 / 网格 / 块数 / 点按钮次数 …`) so the
  state of the page can be read without opening devtools.


## 1.4.2 — bilingual description and README hero

- **package.json description rewritten as a bilingual value proposition**: leads
  with "对话里的图，值得被认真看 / Images in chat deserve a proper look", then
  lists the capabilities (full-screen lightbox, scroll zoom, drag pan, download,
  prev/next, keyboard and touch controls, non-intrusive to host rendering).
- **README hero section added**: bilingual hook plus the package-name callout
  making clear the npm package is scoped (`@loyalchiiina/dsh-chat-image-lightbox`)
  while the GitHub repo is not — the two names differ, and users searching npm by
  the repo name previously hit a 404. Includes the lightbox screenshot with a
  caption. All existing English and Chinese documentation is unchanged.
## 1.4.1 — fix ghost toolbar residue

- fix(client): **close the lightbox with `display:none` after the fade-out** —
  on Electron/Chromium the `backdrop-filter` toolbar buttons are composited on
  their own layer, which sometimes ignored the parent's `opacity:0`/
  `visibility:hidden` and stayed painted on screen as unclickable ghosts
  (`pointer-events:none` made the ✕ dead; only an app reload cleared them).
  Removing the subtree from the render tree forces the compositor to drop
  the layer, so the residue can no longer survive a close.
- fix(client): purge stale `.dsh-ig-backdrop` orphans left by a previous
  module instance before creating a new one (live patch reload safety), so
  two toolbars can never stack.
- chore: sync the stale `v1.3.0` header comment in `lib/client.js`.

## 1.4.0 — TIFF/HEIC display + nine-grid

- feat(host): **TIFF/HEIC images now display inline** — browsers cannot render
  TIFF in `<img>`, so the server converts them to WebP (quality 92) on the fly
  at the full original resolution via bundled `sharp`; PNG/JPEG/etc. are still
  served untouched (no quality loss)
- feat(host): `?raw=1` param serves the untouched original bytes — the
  lightbox download button uses it, so a TIFF displayed as WebP still
  downloads as the original `.tif` file
- feat(client): **nine-grid for multi-image messages** — a message block with
  ≥2 enhanced images becomes a CSS grid (`display:contents` on wrappers, no
  nodes moved); text paragraphs span the full row above the tiles
- feat(client): download filename keeps the true extension (`.tif`) even when
  the served pixels are WebP
- feat(host): `MAX_FILE_SIZE` raised 20 MB → 64 MB (large chart TIFFs);
  `.tif/.tiff/.heic/.avif` added to the gallery listing and MIME map
- deps: bundled `sharp` so conversion works through the `link:` install

## 1.3.0 — ZCode-style rendering (rewrite of chat enhancement)

Fixes abnormal image display in conversations by adopting the way ZCode
renders chat images: style in place, never restructure the DOM.

- fix(client): **stop physically moving chat `<img>` nodes** into a plugin
  grid container. The old `rebuildGrid` fought DSH's React virtual list and
  caused `removeChild`/`insertBefore` errors, vanished or duplicated images.
  Enhancement is now class-only (`dsh-ig-img`); nodes stay where DSH put them.
- fix(client): lightbox groups are computed **at click time** from the live
  DOM (all enhanced images in the same message container) — no more stale
  group snapshots and no more merging images across different messages.
- fix(client): inline images are **capped, not cropped** — `max-height:
  min(460px, 64vh)` with preserved aspect ratio (the ZCode look), replacing
  the 140px `object-fit: cover` tiles that unreadably cropped charts.
- feat(client): multi-image containers whose children are all images get a
  responsive CSS-grid row via a parent class (`dsh-ig-row`) — CSS only, and
  it degrades gracefully if React re-renders.
- perf(client): removed the 2-second full-document polling and the 600 ms
  collapse debounce (no more flash of full-size images then collapse);
  new images are styled immediately on mutation.
- fix(client): caption element was created but never appended — filenames now
  actually show under the viewer; hidden state CSS added for counter/caption.
- fix(client): `close()` uses `removeAttribute('src')` instead of setting an
  empty `src` (which some browsers treat as a page-URL request).
- fix(client): unloaded images (naturalWidth 0) are enhanced instead of being
  permanently skipped by the size filter; icons inside buttons and lightbox
  internals are excluded.

## 1.2.0

- feat(client): collapse multi-image messages into a fixed 3-column thumbnail
  grid with `?w=600` fast thumbnails (superseded by the 1.3.0 rewrite above —
  the physical DOM moves this version introduced are what 1.3.0 removes)
- feat(client): lightbox opens with the full-resolution original

## 1.1.0

- feat(client): click image to zoom in/out (toggle)
- feat(client): mouse-wheel zoom and drag-to-pan when zoomed
- feat(client): touch swipe left/right to navigate on mobile
- feat(client): show image filename/caption under the viewer
- feat(client): accessible lightbox (`role="dialog"`, `aria-modal`, button `aria-label`s, focus management)
- perf(client): prefetch adjacent images for smoother navigation
- fix(client): sanitize download filename (strip query/illegal chars, derive extension from MIME)
- fix(client): restore lightbox DOM structure lost during refactor
- refactor(client): extract `makeBtn` button factory; normalize line endings to LF
- feat(server): `/api/image-gallery/list` supports `?limit=N`; add `/api/image-gallery/root` endpoint
- docs: expand README with full features, keyboard/mouse table, and HTTP API reference

## 1.0.0

- Initial release: inline chat images with a lightbox overlay — zoom, download (save-as), and prev/next navigation.
