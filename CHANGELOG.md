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
