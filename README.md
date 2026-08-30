# DSH Chat Image Lightbox

[English](#english) | [中文](#中文)

---

## English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that displays images inline in the chat with a lightbox overlay — zoom, download (save-as dialog), and prev/next navigation.

### Features

- **Inline display**: Images in AI responses render directly in the chat (via markdown `![alt](url)`)
- **Click to zoom**: Click any image to open a full-screen lightbox; click again to zoom back out
- **Scroll to zoom & pan**: When zoomed in, use the mouse wheel to zoom further and drag to pan around the image
- **Download**: Click the download button ⬇ to save the image (triggers browser save-as dialog for same-origin images; filename is sanitized and the extension is derived from the image type)
- **Navigation**: Left/right arrow buttons, keyboard arrows, or swipe left/right on touch devices to switch between multiple images
- **Caption**: The viewer shows the current image's filename/caption
- **Accessible**: The lightbox is a proper `role="dialog"` with `aria-modal`, button `aria-label`s, and focus management (focus returns to the trigger on close)
- **Smooth**: Adjacent images are prefetched so navigation feels instant
- **Close**: Click backdrop, press Escape, or click ✕ to close
- **Thumbnail grid**: When one AI message contains **multiple images**, they automatically collapse into a tidy **fixed 3-column grid** (9 images = 3×3, 6 = 3×2, even rows); the grid shows light, fast thumbnails (auto `?w=` resized, so large originals are not downloaded into small tiles)
- **HD original on open**: Clicking any thumbnail opens the lightbox with the **full-resolution original image** (the `?w=` thumbnail param is stripped) — zooming in shows the real high-resolution file
- **Clean UI**: The lightbox toolbar (download / close), prev/next arrows, counter and caption are **hidden whenever the lightbox is closed** — they only appear while you are actually viewing an image, so they never clutter the chat layout
- **Auto-enhance**: MutationObserver automatically enhances new images added to the chat

### Installation

#### Method 1: npm (recommended)

```sh
dsh plugin --profile desktop add @loyalchiiina/dsh-chat-image-lightbox
```

#### Method 2: Manual

1. Copy the `lib/` folder and `cordis.patch.yml` to your DSH profile's `node_modules/@loyalchiiina/dsh-chat-image-lightbox/`
2. Add `@loyalchiiina/dsh-chat-image-lightbox` to your profile's `package.json` → `dsh.profile.bundles` array
3. Restart DSH Desktop

### Usage

1. Place images in `~/.dsh/uploads/` (or any directory served by your DSH instance)
2. In your AI response, use markdown image syntax:
   ```
   ![Description](http://127.0.0.1:<port>/images/your-image.jpg)
   ```
3. The image will display inline with lightbox enhancement

**Note**: For the download button to trigger a save-as dialog, the image must be served from the same origin as your DSH instance (e.g., via the `/images/` route). Cross-origin images will open in a new tab instead.

### Troubleshooting image display (important)

When an image shows as blank, a blob of text, or the lightbox opens empty, check in this order:

#### ① Images must use an http(s) URL — base64/data-URI and attachments are NOT rendered

DSH renders images into `<img>` only from http(s) URLs. It does **not** render `data:image/png;base64,...` inline, nor "file-delivery/attachment" messages (those appear as tool-call text, not an image).

- ✅ Correct — markdown + http URL:
  ```
  ![Description](http://127.0.0.1:<port>/images/your-image.jpg)
  ```
- ✅ Correct — any non-hotlink-protected external image:
  ```
  ![Description](https://some-cdn.com/image.jpg)
  ```
- ❌ Will NOT render — base64 inline:
  ```
  ![Description](data:image/png;base64,....)
  ```

#### ② Blank image / empty lightbox = hotlink protection on the image host (source limit, not this plugin)

Some hosts (e.g. **Sina Weibo sinaimg**, some CDNs) enforce `Referer`-checking: a request without the expected `Referer` returns 403, so the image frame renders but no pixels load (clicking still opens the lightbox, but there is no image).

- No normal webpage can hotlink these directly (including all sites except Weibo) — this is not something any plugin can fix.
- **Workaround**: download the image to `~/.dsh/uploads/` (fetch with a proper `Referer`, or just save it from the browser), then serve it via `/images/`.

Example — fetching a hotlink-protected image (Windows):
```
curl -e "https://weibo.com" -o image.jpg "https://wx1.sinaimg.cn/.../xxx.jpg"
```

#### ③ Supported image formats

| Format | Rendered by browser | Notes |
|--------|--------------------|-------|
| jpg / jpeg / png / gif / webp / bmp / svg / ico | ✅ Yes | Mainstream formats — display + lightbox work |
| **tiff** | ❌ No | Browsers cannot render tiff in `<img>`; no plugin can show it directly — convert to png/jpg first |
| **heic** | ❌ No | Apple iPhone format — convert first |

**Converting tiff / heic** (needs Python + Pillow):
```sh
python -c "from PIL import Image; Image.open('image.tif').convert('RGB').save('image.png')"
# Downscale huge files first: Image.open('image.tif').convert('RGB').thumbnail((2000,2000)) then save
```
Put the resulting png in `~/.dsh/uploads/` and display via `/images/`.

#### ④ Plugin not working after changes — restart fully

After installing or editing plugin files, **fully quit all DSH Desktop processes** (Task Manager → end every `DSH Desktop.exe`) and reopen. Closing just the window does not quit (background processes stay). Old/unloaded code keeps the plugin inactive otherwise.

#### ⑤ Is it actually the plugin? Quick checklist

- Test with a `/images/`-served upload — if it displays and lightboxes, the plugin is fine.
- Test with a non-hotlink-host image (e.g. `https://picsum.photos/800/600`) — if that works, the plugin is generic.
- If neither uploads nor external images lightbox → the plugin client didn't load, usually because DSH wasn't fully restarted or the install is incomplete.

### Keyboard & Mouse

| Action | Input |
|--------|-------|
| Open lightbox | Click an image |
| Zoom in / out | Click image, or mouse wheel when zoomed |
| Pan | Drag the image while zoomed |
| Prev / next | `←` / `→` keys, on-screen arrows, or swipe |
| Close | `Esc`, click backdrop, or ✕ |

### HTTP API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/images/<path>` | GET | Serve an uploaded image (loopback-only, with extension/security guards) |
| `/api/image-gallery/list` | GET | List images under the gallery root; supports `?limit=N` |
| `/api/image-gallery/root` | GET | Return the configured gallery root path |

### How It Works

| Component | Description |
|-----------|-------------|
| **Host** (`lib/index.js`) | Registers `/images/` file-serving route and `/api/image-gallery/list` + `/api/image-gallery/root` APIs on `ctx.webServer` |
| **Client** (`lib/client.js`) | Uses `MutationObserver` to watch for `<img>` elements in the chat, adds click handlers that open a lightbox overlay |

### Requirements

- DeepSeek Harness ≥ 2.0 (with `webServer` service)
- Node.js ≥ 22

### License

MIT

---

## 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：在对话框中直接显示图片，支持放大、下载（弹出另存为）、左右切换。

### 功能

- **内联显示**：AI 回复中的图片直接在对话框渲染（通过 markdown `![描述](url)`）
- **点击放大**：点击任意图片打开全屏 lightbox，再点一次缩回
- **滚轮缩放 + 拖拽平移**：放大后可用鼠标滚轮继续缩放，按住拖拽平移查看细节
- **下载**：点击下载按钮 ⬇ 保存图片（同源图片弹出"另存为"对话框；文件名会清洗，扩展名按图片类型自动补全）
- **切换**：左右箭头按钮、键盘方向键，或在触屏上左右滑动切换多张图片
- **文件名**：查看器底部显示当前图片的文件名/标题
- **无障碍**：lightbox 是标准的 `role="dialog"`（含 `aria-modal`、按钮 `aria-label` 与焦点管理，关闭后焦点回到触发元素）
- **预取**：自动预取相邻图片，切换更顺滑
- **关闭**：点击遮罩层、按 Esc 或点 ✕ 关闭
- **缩略图网格**：当一条 AI 消息里包含**多张图片**时，自动折叠成整齐的**固定 3 列网格**（9 张=3×3、6 张=3×2，行数整齐）；网格显示轻量快速缩略图（自动 `?w=` 缩放，不会把大原图下载进小格子）
- **点开即高清原图**：点击任意缩略图打开 lightbox 时，直接加载**全分辨率原图**（去掉 `?w=` 缩略参数），放大看到的是真正的原图清晰度
- **界面干净**：lightbox 的工具按钮（下载/关闭）、左右切换箭头、计数、标题在 lightbox **关闭时全部隐藏**，仅在实际看图时才显示，不会在对话界面留下按钮干扰布局
- **自动增强**：MutationObserver 自动增强新加入对话的图片

### 安装

#### 方式一：npm（推荐）

```sh
dsh plugin --profile desktop add @loyalchiiina/dsh-chat-image-lightbox
```

#### 方式二：手动安装

1. 把 `lib/` 文件夹和 `cordis.patch.yml` 复制到 DSH profile 的 `node_modules/@loyalchiiina/dsh-chat-image-lightbox/`
2. 在 profile 的 `package.json` → `dsh.profile.bundles` 数组中添加 `@loyalchiiina/dsh-chat-image-lightbox`
3. 重启 DSH Desktop

### 使用方法

1. 把图片放到 `~/.dsh/uploads/` 目录（或 DSH 实例提供的任意目录）
2. AI 回复中使用 markdown 图片语法：
   ```
   ![描述](http://127.0.0.1:<端口>/images/你的图片.jpg)
   ```
3. 图片会内联显示并自动带 lightbox 增强

**注意**：下载按钮要弹出"另存为"对话框，图片必须从 DSH 同源路由提供（如 `/images/` 路由）。跨域图片会在新标签页打开。

### 图片显示常见问题排查（重要）

遇到"图片显示不出来 / 点开是空白 / 只看到一串文字"时，按以下顺序排查：

#### ① 图片必须用 DSH 能识别的 URL 显示，不能依赖 base64 或附件

DSH 对话只对**http(s) 图片 URL**渲染成 `<img>`，**不支持 `data:image/png;base64,...` 内嵌**，也不支持以"附件/文件交付"方式直接显示（那只会显示成工具调用文字）。

- ✅ 正确：markdown 图片语法 + http URL
  ```
  ![描述](http://127.0.0.1:<端口>/images/你的图片.jpg)
  ```
- ✅ 正确：任意**无防盗链**的外链图片
  ```
  ![描述](https://某个图床.com/图片.jpg)
  ```
- ❌ 错误：base64 内嵌（DSH 渲染不出，只看到一串 `iVBORw0...`）
  ```
  ![描述](data:image/png;base64,....)   ← 不会显示
  ```

#### ② 图片空白 / 点开灯箱没图案 = 图源防盗链（图床限制，非插件问题）

部分图床（如**新浪微博 sinaimg、部分 CDN**）强制 `Referer` 校验：请求不带特定 `Referer` 就返回 403，导致图片加载不出（有 `<img>` 框但内容空白，点击能弹灯箱但没图）。

- 这类图**任何普通网页都无法直接外链显示**（包括微博自己以外的所有站点），不是本插件能解决的。
- **解决办法**：把图下载到本地 `~/.dsh/uploads/`（可用带 `Referer` 的脚本抓取，或直接用浏览器保存），再通过 `/images/` 路由显示。

示例：抓取带防盗链的图（Windows 下用带 Referer 的 curl 或脚本下载后放入 uploads）：
```
curl -e "https://weibo.com" -o 图.jpg "https://wx1.sinaimg.cn/.../xxx.jpg"
```

#### ③ 支持哪些图片格式

| 格式 | 浏览器直接显示 | 说明 |
|------|--------------|------|
| jpg / jpeg / png / gif / webp / bmp / svg / ico | ✅ 支持 | 主流格式，直接显示 + 灯箱 |
| **tiff** | ❌ 不支持 | **Web 浏览器 `<img>` 不原生渲染 tiff**，任何网页/插件都无法直接显示；需转成 png/jpg |
| **heic** | ❌ 不支持 | 同上，苹果手机图片格式，需转码 |

**tiff / heic 转码方法**（安装 Python + Pillow）：
```sh
python -c "from PIL import Image; Image.open('图.tif').convert('RGB').save('图.png')"
# 超大图建议先缩小：Image.open('图.tif').convert('RGB').thumbnail((2000,2000)) 再 save
```
转出的 png 放到 `~/.dsh/uploads/`，用 `/images/` 显示。

#### ④ 彻底重启后插件不生效

改过插件文件或刚安装后，必须**彻底退出 DSH 进程再重开**（任务管理器结束所有 `DSH Desktop.exe` 进程），否则旧代码/未加载状态不生效。仅"关闭窗口"不算退出（后台进程残留）。

#### ⑤ 判断是不是插件问题的清单

- 用 `/images/` 上传图测：如果上传图正常显示 + 灯箱，说明插件正常
- 换无防盗链图床（如 picsum.photos）的图测：正常则插件通用
- 若上传图、外链图都不亮灯箱 → 插件 client 未加载，多半是没彻底重启或没装正确

### 键盘与鼠标

| 操作 | 输入 |
|------|------|
| 打开 lightbox | 点击图片 |
| 放大 / 缩小 | 点击图片，或放大后滚动滚轮 |
| 平移 | 放大后按住拖拽 |
| 上一张 / 下一张 | `←` / `→` 方向键、屏幕箭头、或滑动 |
| 关闭 | `Esc`、点击遮罩层、或 ✕ |

### HTTP 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/images/<path>` | GET | 提供上传图片（仅本机回环，带扩展名/安全校验） |
| `/api/image-gallery/list` | GET | 列出图库根目录下图片，支持 `?limit=N` |
| `/api/image-gallery/root` | GET | 返回配置的图库根目录路径 |

### 工作原理

| 组件 | 说明 |
|------|------|
| **Host** (`lib/index.js`) | 在 `ctx.webServer` 上注册 `/images/` 文件服务路由和 `/api/image-gallery/list` + `/api/image-gallery/root` 接口 |
| **Client** (`lib/client.js`) | 用 `MutationObserver` 监听对话中的 `<img>` 元素，添加点击处理器打开 lightbox |

### 环境要求

- DeepSeek Harness ≥ 2.0（需要 `webServer` 服务）
- Node.js ≥ 22

### 许可证

MIT
