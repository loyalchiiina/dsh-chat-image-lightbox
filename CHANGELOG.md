# Changelog

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
