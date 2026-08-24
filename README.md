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
