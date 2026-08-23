# DSH Chat Image Lightbox

[English](#english) | [中文](#中文)

---

## English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that displays images inline in the chat with a lightbox overlay — zoom, download (save-as dialog), and prev/next navigation.

### Features

- **Inline display**: Images in AI responses render directly in the chat (via markdown `![alt](url)`)
- **Click to zoom**: Click any image to open a full-screen lightbox
- **Download**: Click the download button ⬇ to save the image (triggers browser save-as dialog for same-origin images)
- **Navigation**: Left/right arrow buttons or keyboard arrows to switch between multiple images
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

### How It Works

| Component | Description |
|-----------|-------------|
| **Host** (`lib/index.js`) | Registers `/images/` file-serving route and `/api/image-gallery/list` API on `ctx.webServer` |
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
- **点击放大**：点击任意图片打开全屏 lightbox
- **下载**：点击下载按钮 ⬇ 保存图片（同源图片弹出"另存为"对话框）
- **切换**：左右箭头按钮或键盘方向键切换多张图片
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

### 工作原理

| 组件 | 说明 |
|------|------|
| **Host** (`lib/index.js`) | 在 `ctx.webServer` 上注册 `/images/` 文件服务路由和 `/api/image-gallery/list` API |
| **Client** (`lib/client.js`) | 用 `MutationObserver` 监听对话中的 `<img>` 元素，添加点击处理器打开 lightbox |

### 环境要求

- DeepSeek Harness ≥ 2.0（需要 `webServer` 服务）
- Node.js ≥ 22

### 许可证

MIT
