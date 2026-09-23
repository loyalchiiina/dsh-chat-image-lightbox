/**
 * dsh-image-gallery browser half — v1.4.1 (ZCode-style rendering)
 *
 * Design principles (modeled on how ZCode renders chat images):
 *   1. NEVER physically move/reparent React-managed DOM nodes. Earlier grid
 *      rebuilds moved <img>s into a plugin container and fought DSH's virtual
 *      list (removeChild/insertBefore crashes, vanished/duplicated images).
 *      Now we only add CSS classes; everything stays exactly where DSH put it.
 *   2. Inline images are capped, not cropped: max-height min(460px, 64vh),
 *      aspect ratio preserved (the ZCode look). Charts/diagrams stay readable.
 *   3. Lightbox grouping is computed at click time from the live DOM (images
 *      inside the same message container) — no stale group snapshots, no
 *      cross-message merging bugs.
 *
 * Everything else is unchanged: full-screen lightbox with backdrop, wheel
 * zoom + drag pan, prev/next navigation (+ touch swipe, keyboard), download
 * of the full-resolution original, caption and counter.
 *
 * @module @loyalchiiina/dsh-chat-image-lightbox/client
 */

window.__ModuleLoader__.load({
  id: "@loyalchiiina/dsh-chat-image-lightbox",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    // ── CSS (injected once) ──────────────────────────────────────────────────

    var CSS = [
      "/* ── Lightbox overlay ───────────────────────────────────────────────── */",
      ".dsh-ig-backdrop {",
      "  position: fixed; inset: 0; z-index: 10000;",
      "  background: rgba(0, 0, 0, 0.88);",
      "  display: flex; align-items: center; justify-content: center;",
      "  opacity: 0; transition: opacity 0.2s ease;",
      "  pointer-events: none;",
      "}",
      ".dsh-ig-backdrop.dsh-ig-open {",
      "  opacity: 1; pointer-events: auto;",
      "}",
      ".dsh-ig-lightbox {",
      "  position: relative; max-width: 95vw; max-height: 92vh;",
      "  display: flex; align-items: center; justify-content: center;",
      "}",
      ".dsh-ig-lightbox img {",
      "  max-width: 95vw; max-height: 92vh;",
      "  object-fit: contain; border-radius: 8px;",
      "  box-shadow: 0 8px 40px rgba(0,0,0,0.6);",
      "  transition: transform 0.3s ease;",
      "  cursor: zoom-in;",
      "}",
      ".dsh-ig-lightbox img.dsh-ig-zoomed {",
      "  cursor: zoom-out;",
      "  max-width: none; max-height: none;",
      "  transform: scale(1.6);",
      "  transform-origin: center center;",
      "  will-change: transform;",
      "}",
      "/* ── Toolbar ──────────────────────────────────────────────────────── */",
      "/* Kept clear of the host window's own minimize/maximize/close controls,",
      "   which occupy the top-right corner of the title bar. Laid out as a",
      "   2-column grid: download/close on top, thumb/hide directly below them. */",
      ".dsh-ig-toolbar {",
      "  position: fixed; top: 84px; right: 20px; z-index: 10001;",
      /* Close + download on the top row, side by side (horizontal); everything
         else flows below in the same two-column grid. */
      "  display: grid; grid-template-columns: repeat(2, 40px);",
      "  gap: 8px; justify-items: center; align-items: center;",
      "}",
      ".dsh-ig-toolbar button {",
      "  width: 40px; height: 40px;",
      "  border-radius: 50%; border: none;",
      "  background: rgba(255,255,255,0.15);",
      "  color: #fff; font-size: 18px;",
      "  cursor: pointer; display: flex;",
      "  align-items: center; justify-content: center;",
      "  backdrop-filter: blur(8px);",
      "  transition: background 0.15s;",
      "  flex: 0 0 auto;",
      "}",
      ".dsh-ig-toolbar button:hover {",
      "  background: rgba(255,255,255,0.3);",
      "}",
      /* Prev/next in the toolbar grid. Match the 40px cells (slightly smaller
         visually is fine but keep the box 40px so the 2-col grid lines up). */
      ".dsh-ig-toolbar-nav {",
      "  font-size: 22px !important;",
      "  opacity: 1; transition: opacity .15s;",
      "}",
      ".dsh-ig-toolbar-nav.dsh-ig-hidden { opacity: 0; pointer-events: none; }",
      /* Toast for copy/open feedback. Button-title changes are invisible unless
         the user happens to hover; a transient toast is impossible to miss. */
      ".dsh-ig-toast {",
      "  position: fixed; left: 50%; top: 96px; transform: translateX(-50%);",
      "  z-index: 10002;",
      "  background: rgba(20,20,24,0.94); color: #fff;",
      "  padding: 8px 16px; border-radius: 8px;",
      "  font-size: 13px; line-height: 1.5; max-width: 70vw;",
      "  box-shadow: 0 4px 16px rgba(0,0,0,0.35);",
      "  pointer-events: none; white-space: pre-wrap; word-break: break-all;",
      "  opacity: 0; transform: translateX(-50%) translateY(-6px);",
      "  transition: opacity .18s, transform .18s;",
      "}",
      ".dsh-ig-toast.dsh-ig-show { opacity: 1; transform: translateX(-50%) translateY(0); }",
      "/* ── Zoom / pan pad (right side, under the download toolbar) ──────── */",
      "/* Buttons for zooming and moving the view, so the wheel and drag are no",
      "   longer the only way in. The mouse gestures keep working unchanged.",
      "   `top` is set from JS (positionZoombar) to sit just below the toolbar,",
      "   whose height changes when the prev/next arrows appear — a hard-coded",
      "   top would drift and overlap once the toolbar grows. */",
      ".dsh-ig-zoombar {",
      "  position: fixed; right: 20px; z-index: 10001;",
      "  display: grid; grid-template-columns: repeat(3, 36px);",
      "  grid-auto-rows: 36px; gap: 6px; justify-items: center;",
      "  align-items: center;",
      "}",
      ".dsh-ig-zoombar button {",
      "  width: 36px; height: 36px;",
      "  border-radius: 50%; border: none;",
      "  background: rgba(255,255,255,0.15);",
      "  color: #fff; font-size: 16px; line-height: 1;",
      "  cursor: pointer; display: flex;",
      "  align-items: center; justify-content: center;",
      "  -webkit-backdrop-filter: blur(8px);",
      "  backdrop-filter: blur(8px);",
      "  transition: background 0.15s;",
      "  user-select: none;",
      "}",
      ".dsh-ig-zoombar button:hover { background: rgba(255,255,255,0.32); }",
      ".dsh-ig-zoombar button:active { background: rgba(255,255,255,0.45); }",
      "/* Row/cell placement of the pad: zoom pair on top, d-pad below. */",
      ".dsh-ig-zoom-out { grid-column: 1; grid-row: 1; }",
      ".dsh-ig-zoom-in { grid-column: 2; grid-row: 1; }",
      ".dsh-ig-zoom-reset { grid-column: 3; grid-row: 1; font-size: 14px; }",
      ".dsh-ig-pan-up { grid-column: 2; grid-row: 2; }",
      ".dsh-ig-pan-left { grid-column: 1; grid-row: 3; }",
      ".dsh-ig-pan-reset { grid-column: 2; grid-row: 3; font-size: 14px; }",
      ".dsh-ig-pan-right { grid-column: 3; grid-row: 3; }",
      ".dsh-ig-pan-down { grid-column: 2; grid-row: 4; }",
      ".dsh-ig-zoombar .dsh-ig-zoom-level {",
      "  grid-column: 1 / -1; grid-row: 5;",
      "  color: rgba(255,255,255,0.55); font-size: 11px;",
      "  font-family: system-ui, sans-serif; line-height: 1;",
      "}",
      "/* ── Navigation arrows ────────────────────────────────────────────── */",
      ".dsh-ig-nav {",
      "  position: fixed; top: 50%; z-index: 10001;",
      "  transform: translateY(-50%);",
      "  width: 48px; height: 48px;",
      "  border-radius: 50%; border: none;",
      "  background: rgba(255,255,255,0.12);",
      "  color: #fff; font-size: 24px;",
      "  cursor: pointer; display: flex;",
      "  align-items: center; justify-content: center;",
      "  backdrop-filter: blur(8px);",
      "  transition: background 0.15s, opacity 0.15s;",
      "}",
      ".dsh-ig-nav:hover { background: rgba(255,255,255,0.25); }",
      ".dsh-ig-nav.dsh-ig-hidden { opacity: 0; pointer-events: none; }",
      ".dsh-ig-prev { left: 20px; }",
      ".dsh-ig-next { right: 20px; }",
      "/* ── Counter / caption ────────────────────────────────────────────── */",
      ".dsh-ig-counter {",
      "  position: fixed; bottom: 20px; left: 50%;",
      "  transform: translateX(-50%);",
      "  z-index: 10001;",
      "  color: rgba(255,255,255,0.7);",
      "  font-size: 13px; font-family: system-ui, sans-serif;",
      "  background: rgba(0,0,0,0.5);",
      "  padding: 4px 12px; border-radius: 12px;",
      "  backdrop-filter: blur(8px);",
      "}",
      ".dsh-ig-caption {",
      "  position: fixed; bottom: 52px; left: 50%;",
      "  transform: translateX(-50%);",
      "  z-index: 10001;",
      "  color: rgba(255,255,255,0.85);",
      "  font-size: 12px; font-family: system-ui, sans-serif;",
      "  max-width: 80vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
      "  background: rgba(0,0,0,0.5);",
      "  padding: 4px 12px; border-radius: 12px;",
      "  backdrop-filter: blur(8px);",
      "}",
      ".dsh-ig-counter.dsh-ig-hidden,",
      ".dsh-ig-caption.dsh-ig-hidden {",
      "  display: none !important;",
      "}",
      "/* ── Chat image: capped inline display (ZCode-style, no crop) ──────── */",
      "/* Class-only enhancement: the <img> stays exactly where DSH rendered it. */",
      ".dsh-ig-img {",
      "  display: block !important;",
      "  max-width: 100% !important;",
      "  width: auto !important;",
      "  height: auto !important;",
      "  max-height: min(460px, 64vh) !important;",
      "  object-fit: contain;",
      "  border-radius: 8px;",
      "  cursor: zoom-in !important;",
      "  transition: box-shadow 0.15s ease;",
      "}",
      ".dsh-ig-img:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.25); }",
      "/* Momentary highlight marking where the jump-to-image button landed. */",
      ".dsh-ig-flash {",
      "  animation: dsh-ig-flash-kf 1.1s ease-out 1;",
      "  border-radius: 8px;",
      "}",
      "@keyframes dsh-ig-flash-kf {",
      "  0%   { box-shadow: 0 0 0 3px rgba(24,144,255,0.85); }",
      "  60%  { box-shadow: 0 0 0 3px rgba(24,144,255,0.45); }",
      "  100% { box-shadow: 0 0 0 3px rgba(24,144,255,0); }",
      "}",
      /* Multi-image message (nine-grid): when a message block's element
         children are ALL image-only wrappers, the container becomes a CSS
         grid and each wrapper gets display:contents so its <img> becomes a
         grid item — pure CSS, no nodes created/moved/removed; if React
         re-renders and drops the classes, images fall back to the capped
         inline style until the next scan re-applies them. */
      ".dsh-ig-gallery {",
      "  display: grid !important;",
      "  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));",
      "  gap: 8px;",
      "  align-items: stretch;",
      "  margin: 8px 0;",
      "}",
      ".dsh-ig-gallery > .dsh-ig-span { grid-column: 1 / -1; }",
      ".dsh-ig-gallery > .dsh-ig-pass { display: contents; }",
      ".dsh-ig-gallery > img.dsh-ig-img,",
      ".dsh-ig-gallery > .dsh-ig-pass > img.dsh-ig-img {",
      "  width: 100% !important;",
      "  max-height: 200px !important;",
      "  object-fit: contain;",
      "  background: rgba(127,127,127,0.10);",
      "}",
      "/* -- Image block modes: EXPANDED (default) / THUMBS / HIDDEN ------- */",
      "/* The switches live in ONE place - next to the composer's access-mode",
      "   control - instead of drawing buttons onto every image. They act on",
      "   every image block in the conversation at once.",
      "   Expanded: full-size images.  Thumbs: one horizontal strip of small",
      "   tiles (no vertical bulk).  Hidden: nothing but a slim placeholder. */",
      "/* ── The two global switches (real buttons, injected by JS) ───────── */",
      ".dsh-ig-switch {",
      "  display: inline-flex; align-items: center; gap: 4px;",
      "  height: 26px; padding: 0 8px; margin-left: 6px;",
      "  border: none; border-radius: 13px; cursor: pointer;",
      "  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14));",
      "  color: var(--dsw-alias-label-secondary, #888);",
      "  /* Never let a host overlay swallow the press. */",
      "  pointer-events: auto !important;",
      "  position: relative !important;",
      "  z-index: 5 !important;",
      "  font-size: 12px; font-family: system-ui, sans-serif; line-height: 1;",
      "  white-space: nowrap; transition: background 0.15s, color 0.15s;",
      "}",
      ".dsh-ig-switch:hover {",
      "  background: var(--dsw-alias-state-business-primary, rgba(24,144,255,0.18));",
      "  color: var(--dsw-alias-label-primary, #222);",
      "}",
      ".dsh-ig-switch.dsh-ig-switch-on {",
      "  background: var(--dsw-alias-state-business-primary, rgba(24,144,255,0.22));",
      "  color: var(--dsw-alias-label-primary, #222);",
      "}",
      ".dsh-ig-switch-icon { font-size: 13px; line-height: 1; }",
      "/* Columns-per-row field, sitting between the thumbnail and hide switches. */",
      ".dsh-ig-cols {",
      "  display: inline-flex; align-items: center; gap: 3px;",
      "  margin-left: 6px; height: 26px;",
      "  font-size: 12px; font-family: system-ui, sans-serif;",
      "  color: var(--dsw-alias-label-secondary, #888);",
      "}",
      ".dsh-ig-cols-label { line-height: 1; }",
      ".dsh-ig-cols-input {",
      "  width: 40px; height: 24px; padding: 0 4px;",
      "  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.4));",
      "  border-radius: 6px; background: transparent;",
      "  color: var(--dsw-alias-label-primary, inherit);",
      "  font-size: 12px; font-family: system-ui, sans-serif;",
      "  text-align: center;",
      "}",
      ".dsh-ig-cols-input:focus {",
      "  outline: none;",
      "  border-color: var(--dsw-alias-state-business-primary, rgba(24,144,255,0.8));",
      "}",
      "/* ── Popover holding the four controls ────────────────────────────── */",
      "/* One compact trigger stays in the composer row; the controls slide out.",
      "   Same pattern as dsh-model-fold's side panel. */",
      ".dsh-ig-pop {",
      "  position: fixed; z-index: 2147483000;",
      "  display: flex; flex-direction: column; gap: 6px;",
      "  align-items: stretch !important;",
      "  min-width: 190px; padding: 8px;",
      "  border-radius: 12px;",
      "  background: var(--dsw-specific-input-major, rgba(30,30,32,0.96));",
      "  box-shadow: 0 10px 32px rgba(0,0,0,0.28);",
      "  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25));",
      "  transform: translateY(6px); opacity: 0;",
      "  transition: transform .16s ease, opacity .16s ease;",
      "  pointer-events: none; visibility: hidden;",
      "}",
      ".dsh-ig-pop-open {",
      "  transform: translateY(0); opacity: 1;",
      "  pointer-events: auto; visibility: visible;",
      "}",
      "/* Controls inside the popover: full-width rows, label left, value right. */",
      ".dsh-ig-pop .dsh-ig-switch {",
      "  margin-left: 0 !important;",
      "  width: 100% !important;",
      "  justify-content: flex-start !important;",
      "  height: 30px !important;",
      "  border-radius: 8px !important;",
      "}",
      ".dsh-ig-pop .dsh-ig-cols {",
      "  margin-left: 0 !important;",
      "  justify-content: space-between !important;",
      "  width: 100% !important;",
      "  height: 30px !important;",
      "}",
      ".dsh-ig-pop .dsh-ig-cols-input { width: 56px !important; }",
      ".dsh-ig-trigger-text { font-size: 12px; }",
      "/* Immediate press acknowledgement for the jump button: the action itself",
      "   waits out the multi-press window, but the press must never look lost. */",
      ".dsh-ig-switch.dsh-ig-switch-pulse {",
      "  background: var(--dsw-alias-state-business-primary, rgba(24,144,255,0.35));",
      "  transform: scale(0.94);",
      "}",
      "/* Blocks no longer carry buttons; keep the class inert for stale nodes. */",
      ".dsh-ig-foldmark { position: relative !important; }",
      "/* ── THUMBS: one horizontal row, fixed height, no vertical bulk ──── */",
      ".dsh-ig-thumbs {",
      "  /* Thumbnail GRID with a FIXED column count: auto-fill derives its column",
      "     count from the container width and degenerates to one column whenever",
      "     that width is indefinite, which is exactly what was reported. */",
      "  display: grid !important;",
      "  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;",
      "  gap: 8px !important;",
      "  align-items: start !important;",
      "  white-space: normal !important;",
      "  overflow: visible !important;",
      "  margin: 6px 0 !important;",
      "  /* Width must be definite, or the tracks have nothing to divide. */",
      "  width: 100% !important;",
      "  max-width: 100% !important;",
      "  box-sizing: border-box !important;",
      "}",
      ".dsh-ig-thumbs.dsh-ig-gallery {",
      "  display: grid !important;",
      "  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;",
      "  width: 100% !important;",
      "}",
      ".dsh-ig-thumbs > * {",
      "  display: block !important;",
      "  padding: 0 !important; margin: 0 !important; float: none !important;",
      "  min-width: 0 !important; white-space: normal !important;",
      "}",
      "/* Caption paragraphs span the whole row instead of taking a tile. */",
      ".dsh-ig-thumbs > *:not(:has(img)) { grid-column: 1 / -1 !important; }",
      "/* Tiles inside a wrapper fill it edge to edge. */",
      ".dsh-ig-thumbs img.dsh-ig-img {",
      "  display: block !important;",
      "  height: 110px !important; width: 100% !important;",
      "  max-width: 100% !important; min-width: 0 !important;",
      "  object-fit: cover !important; vertical-align: top !important;",
      "  margin: 0 !important;",
      "  border-radius: 6px;",
      "  -webkit-mask-image: none !important; mask-image: none !important;",
      "}",
      ".dsh-ig-thumbs strong, .dsh-ig-thumbs em, .dsh-ig-thumbs b, .dsh-ig-thumbs i,",
      ".dsh-ig-thumbs span, .dsh-ig-thumbs small {",
      "  display: inline !important; white-space: normal !important;",
      "  max-width: 100% !important; overflow: visible !important;",
      "  font-size: 12px !important; line-height: 1.5 !important;",
      "  vertical-align: middle !important;",
      "}",
      "/* -- HIDDEN: images gone, a slim strip marks where they were -------- */",
      ".dsh-ig-hidden-block img.dsh-ig-img { display: none !important; }",
      ".dsh-ig-hidden-block { min-height: 18px !important; }",
      /* The old collapsed look is retired; keep its class inert so a stale
         class left by a hot-reloaded module cannot reshape anything. */
      ".dsh-ig-collapsed img.dsh-ig-img { max-height: none !important; }",
      /* 未放大看图（lightbox 未开）时，隐藏所有悬浮控件（导航/下载/关闭/计数/标题），
         避免在对话界面留下"切换图片/下载/关图"等按钮，影响布局美观。 */
      ".dsh-ig-backdrop:not(.dsh-ig-open) .dsh-ig-toolbar,",
      ".dsh-ig-backdrop:not(.dsh-ig-open) .dsh-ig-zoombar,",
      ".dsh-ig-backdrop:not(.dsh-ig-open) .dsh-ig-nav,",
      ".dsh-ig-backdrop:not(.dsh-ig-open) .dsh-ig-counter,",
      ".dsh-ig-backdrop:not(.dsh-ig-open) .dsh-ig-caption {",
      "  visibility: hidden !important;",
      "  opacity: 0 !important;",
      "  pointer-events: none !important;",
      "}",
    ].join("\n");

    // ── Lightbox singleton ──────────────────────────────────────────────────

    var backdrop = null;
    var lightboxImg = null;
    var zoomLevelEl = null;
    var toolbarEl = null;
    var zoombarEl = null;
    var prevBtn = null;
    var nextBtn = null;
    var counterEl = null;
    var currentImages = [];

    // Keep the zoom/pad cluster just below the toolbar. The toolbar's height
    // changes when the prev/next arrows toggle, so this is computed at render
    // time rather than hard-coded — otherwise the two overlap. Module-level so
    // `open` (outside ensureLightbox) can call it too.
    function positionZoombar() {
      try {
        if (zoombarEl && toolbarEl && typeof toolbarEl.getBoundingClientRect === "function") {
          var r = toolbarEl.getBoundingClientRect();
          zoombarEl.style.top = (r.bottom + 10) + "px";
        }
      } catch (e) {}
    }

    var currentIndex = 0;
    var lastFocused = null;
    var captionEl = null;
    var zoomScale = 1;
    var panX = 0;
    var panY = 0;

    function makeBtn(className, html, title, handler, ariaLabel) {
      var b = document.createElement("button");
      if (className) b.className = className;
      // The glyph lives in its own span so feedback code can swap it (e.g. show
      // ✓ for a second after "copy path") without touching the button's other
      // content or its layout.
      var icon = document.createElement("span");
      icon.className = "dsh-ig-btn-icon";
      icon.innerHTML = html;
      b.appendChild(icon);
      if (title) b.title = title;
      if (ariaLabel) b.setAttribute("aria-label", ariaLabel);
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        handler(e, b);
      });
      return b;
    }

    // Styles are installed at startup, NOT when the lightbox first opens: the
    // fold badge is a pure-CSS affordance on chat images, so a user who never
    // opened the lightbox would otherwise never see it. Re-installing also
    // drops the stylesheet a previous hot-reloaded module left behind, so old
    // rules can never linger next to the new ones.
    function injectStyles() {
      var existing = document.querySelectorAll("style");
      for (var i = 0; i < existing.length; i++) {
        var text = existing[i].textContent || "";
        if (text.indexOf(".dsh-ig-backdrop") >= 0 || text.indexOf(".dsh-ig-foldmark") >= 0) {
          existing[i].remove();
        }
      }
      var style = document.createElement("style");
      style.setAttribute("data-dsh-ig-css", "1");
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    function ensureLightbox() {
      // A retained backdrop that is no longer in the document (removed by the
      // host, or dropped by a hot-reloaded module) would otherwise make the
      // lightbox permanently unopenable: rebuild instead of trusting the var.
      if (backdrop && typeof backdrop.isConnected === "boolean" && !backdrop.isConnected) {
        backdrop = null;
        lightboxImg = null;
        prevBtn = null;
        nextBtn = null;
        counterEl = null;
        captionEl = null;
      }
      if (backdrop) return;

      // Live patch reload can leave a previous module instance's backdrop
      // orphaned in the DOM; drop stale ones so two toolbars never stack.
      var stale = document.querySelectorAll(".dsh-ig-backdrop");
      for (var i = 0; i < stale.length; i++) stale[i].remove();

      injectStyles();

      backdrop = document.createElement("div");
      backdrop.className = "dsh-ig-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");
      backdrop.setAttribute("aria-label", "图片查看器");
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) close();
      });

      var lightbox = document.createElement("div");
      lightbox.className = "dsh-ig-lightbox";

      lightboxImg = document.createElement("img");
      lightboxImg.decoding = "async";
      lightboxImg.addEventListener("click", function (e) {
        e.stopPropagation();
        // 放大状态下点击图片直接关闭（放大的图会盖住 backdrop，保证一定能关掉）
        if (zoomScale > 1) { close(); return; }
        setZoom(1.6);
      });
      lightboxImg.addEventListener("wheel", function (e) {
        e.preventDefault();
        setZoom(zoomScale + (e.deltaY < 0 ? 0.3 : -0.3));
      }, { passive: false });
      var igDragging = false, igLastX = 0, igLastY = 0;
      lightboxImg.addEventListener("mousedown", function (e) {
        if (zoomScale <= 1) return;
        igDragging = true; igLastX = e.clientX; igLastY = e.clientY;
        lightboxImg.style.cursor = "grabbing";
      });
      window.addEventListener("mousemove", function (e) {
        if (!igDragging) return;
        panX += e.clientX - igLastX; panY += e.clientY - igLastY;
        igLastX = e.clientX; igLastY = e.clientY;
        lightboxImg.style.transform = "scale(" + zoomScale + ") translate(" + panX + "px," + panY + "px)";
      });
      window.addEventListener("mouseup", function () {
        if (igDragging) { igDragging = false; lightboxImg.style.cursor = "zoom-out"; }
      });

      var igTouchX = 0, igTouchY = 0, igTouching = false;
      lightboxImg.addEventListener("touchstart", function (e) {
        if (e.touches.length === 1) {
          igTouching = true; igTouchX = e.touches[0].clientX; igTouchY = e.touches[0].clientY;
        }
      }, { passive: true });
      lightboxImg.addEventListener("touchend", function (e) {
        if (!igTouching) return;
        igTouching = false;
        var t = e.changedTouches[0];
        var dx = t.clientX - igTouchX, dy = t.clientY - igTouchY;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
          navigate(dx < 0 ? 1 : -1);
        }
      }, { passive: true });
      lightbox.appendChild(lightboxImg);

      var toolbar = document.createElement("div");
      toolbar.className = "dsh-ig-toolbar";
      toolbarEl = toolbar;

      // Close + download on the TOP ROW, side by side (two-column grid). The
      // navigation arrows sit under them, then the file actions, then the
      // conversation-wide switches.
      toolbar.appendChild(makeBtn("", "✕", "关闭 (Esc)", function () { close(); }, "关闭"));
      toolbar.appendChild(makeBtn("", "⬇", "下载图片", function () { downloadCurrent(); }, "下载图片"));

      // Navigation arrows (row 2). Hidden when there is only one image.
      prevBtn = makeBtn("dsh-ig-toolbar-nav dsh-ig-hidden", "‹", "上一张", function () { navigate(-1); }, "上一张");
      nextBtn = makeBtn("dsh-ig-toolbar-nav dsh-ig-hidden", "›", "下一张", function () { navigate(1); }, "下一张");
      toolbar.appendChild(prevBtn);
      toolbar.appendChild(nextBtn);

      // Local-file conveniences. Both act on the file behind the picture, so
      // both are "local only" — for a remote URL there is no path to copy or
      // folder to open, and the buttons say so instead of silently doing
      // nothing.
      toolbar.appendChild(makeBtn("", "⧉", "复制图片文件路径", function (e, btn) { copyImagePath(btn); }, "复制路径"));
      toolbar.appendChild(makeBtn("", "📂", "在文件夹中显示", function (e, btn) { revealImageFile(btn); }, "在文件夹中显示"));

      // Same two switches as the composer row, acting conversation-wide: flip
      // every image block, then close the lightbox so the result is visible.
      toolbar.appendChild(makeBtn("", "▦", "全部收成缩略图", function () {
        toggleAllBlocks("thumb");
        close();
      }, "全部收成缩略图"));
      toolbar.appendChild(makeBtn("", "⊘", "全部隐藏", function () {
        toggleAllBlocks("hidden");
        close();
      }, "全部隐藏"));

      // ── Zoom / pan pad ──────────────────────────────────────────────────
      // Explicit controls for what the wheel and drag already do. The mouse
      // gestures stay untouched; these are simply an alternative that does not
      // depend on gesture sensitivity.
      var zoombar = document.createElement("div");
      zoombar.className = "dsh-ig-zoombar";
      zoombarEl = zoombar;

      function padBtn(cls, glyph, title, onPress) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = cls;
        b.textContent = glyph;
        b.title = title;
        b.setAttribute("aria-label", title);
        // Press-and-hold repeats, so moving the view far does not need dozens
        // of clicks.
        var timer = null;
        var start = function (e) {
          e.preventDefault();
          e.stopPropagation();
          onPress();
          if (timer) clearInterval(timer);
          timer = setInterval(onPress, 120);
        };
        var stop = function () {
          if (timer) { clearInterval(timer); timer = null; }
        };
        b.addEventListener("mousedown", start);
        b.addEventListener("mouseup", stop);
        b.addEventListener("mouseleave", stop);
        b.addEventListener("touchstart", start, { passive: false });
        b.addEventListener("touchend", stop);
        b.addEventListener("click", function (e) { e.stopPropagation(); });
        return b;
      }

      zoombar.appendChild(padBtn("dsh-ig-zoom-out", "−", "缩小 [-]",
        function () { setZoom(zoomScale - 0.25); updateZoomLabel(); }));
      zoombar.appendChild(padBtn("dsh-ig-zoom-in", "＋", "放大 [+]",
        function () { setZoom(zoomScale + 0.25); updateZoomLabel(); }));
      zoombar.appendChild(padBtn("dsh-ig-zoom-reset", "1×", "重置缩放到 100%",
        function () { setZoom(1); updateZoomLabel(); }));

      zoombar.appendChild(padBtn("dsh-ig-pan-up", "↑", "上移视角 (Shift+↑)",
        function () { panBy(0, PAN_STEP); }));
      zoombar.appendChild(padBtn("dsh-ig-pan-left", "←", "左移视角 (Shift+←)",
        function () { panBy(PAN_STEP, 0); }));
      zoombar.appendChild(padBtn("dsh-ig-pan-reset", "⟲", "视角居中",
        function () { panX = 0; panY = 0; applyZoom(); }));
      zoombar.appendChild(padBtn("dsh-ig-pan-right", "→", "右移视角 (Shift+→)",
        function () { panBy(-PAN_STEP, 0); }));
      zoombar.appendChild(padBtn("dsh-ig-pan-down", "↓", "下移视角 (Shift+↓)",
        function () { panBy(0, -PAN_STEP); }));

      var zoomLevel = document.createElement("div");
      zoomLevel.className = "dsh-ig-zoom-level";
      zoomLevel.textContent = "100%";
      zoombar.appendChild(zoomLevel);
      zoomLevelEl = zoomLevel;
      updateZoomLabel();

      backdrop.appendChild(lightbox);
      backdrop.appendChild(toolbar);
      backdrop.appendChild(zoombar);

      counterEl = document.createElement("div");
      counterEl.className = "dsh-ig-counter";

      captionEl = document.createElement("div");
      captionEl.className = "dsh-ig-caption";

      backdrop.appendChild(counterEl);
      backdrop.appendChild(captionEl);
      document.body.appendChild(backdrop);

      document.addEventListener("keydown", function (e) {
        if (!backdrop || !backdrop.classList.contains("dsh-ig-open")) return;
        if (e.key === "Escape") { close(); return; }
        // Shift + arrows move the view (same as the pad); plain arrows page.
        if (e.shiftKey) {
          if (e.key === "ArrowUp") { e.preventDefault(); panBy(0, PAN_STEP); }
          else if (e.key === "ArrowDown") { e.preventDefault(); panBy(0, -PAN_STEP); }
          else if (e.key === "ArrowLeft") { e.preventDefault(); panBy(PAN_STEP, 0); }
          else if (e.key === "ArrowRight") { e.preventDefault(); panBy(-PAN_STEP, 0); }
          else if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(zoomScale + 0.25); }
          else if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom(zoomScale - 0.25); }
          return;
        }
        if (e.key === "ArrowLeft") navigate(-1);
        else if (e.key === "ArrowRight") navigate(1);
        else if (e.key === "+" || e.key === "=") setZoom(zoomScale + 0.25);
        else if (e.key === "-" || e.key === "_") setZoom(zoomScale - 0.25);
      });
    }

    function open(images, index) {
      ensureLightbox();
      // Undo close()'s display:none so the CSS flex/opacity take over again.
      backdrop.style.display = "";
      lastFocused = document.activeElement;
      currentImages = images;
      currentIndex = index;
      updateDisplay();
      backdrop.classList.add("dsh-ig-open");
      document.body.style.overflow = "hidden";
      backdrop.setAttribute("tabindex", "-1");
      backdrop.focus();
      // The toolbar is laid out now that the lightbox is visible, so place the
      // zoom cluster below it.
      if (typeof positionZoombar === "function") {
        requestAnimationFrame(positionZoombar);
      }
    }

    function close() {
      if (!backdrop) return;
      backdrop.classList.remove("dsh-ig-open");
      // Electron/Chromium compositing bug: the backdrop-filter toolbar
      // buttons can survive the fade-out as painted-but-unclickable ghosts
      // (the stale composited layer ignores the parent's opacity/visibility,
      // and pointer-events:none makes the ✕ unclickable — only an app
      // reload cleared it). display:none removes the subtree from the
      // render tree, forcing the compositor to drop the layer outright.
      setTimeout(function () {
        if (backdrop && !backdrop.classList.contains("dsh-ig-open")) {
          backdrop.style.display = "none";
        }
      }, 250);
      zoomScale = 1; panX = 0; panY = 0;
      if (lightboxImg) {
        lightboxImg.classList.remove("dsh-ig-zoomed");
        lightboxImg.style.transform = "";
        lightboxImg.style.cursor = "zoom-in";
        // 置空 src 会让部分浏览器把空 src 当作当前页 URL 重新请求，用 removeAttribute
        lightboxImg.removeAttribute("src");
      }
      document.body.style.overflow = "";
      if (lastFocused && lastFocused.focus) { lastFocused.focus(); lastFocused = null; }
    }

    function navigate(delta) {
      if (currentImages.length <= 1) return;
      currentIndex = (currentIndex + delta + currentImages.length) % currentImages.length;
      updateDisplay();
    }

    // ── URL helpers ─────────────────────────────────────────────────────────
    // Keep the full-resolution src (minus any ?w= resize param) so the
    // lightbox and download always operate on the original.
    function stripResizeParam(src) {
      if (!src || src.indexOf("?") < 0) return src || "";
      return src.replace(/([?&])w=\d+(&|$)/, function (m, pre, post) {
        return post === "&" ? pre === "?" ? "?" : "&" : pre === "?" ? "" : "";
      });
    }
    function currentOriginal() {
      var img = currentImages[currentIndex];
      if (!img) return null;
      return stripResizeParam(img.src) || img.src;
    }

    // The absolute path behind the currently shown picture, or null when the
    // image is not a local file served by our own route (remote URL, data URI).
    //
    // Prefers the path recorded at enhance time (survives URL re-signing), then
    // falls back to parsing `?abs=` from the URL.
    function localAbsPath() {
      var img = currentImages[currentIndex];
      if (img && img.dataset && img.dataset.dshIgPath) return img.dataset.dshIgPath;
      return absFromUrl(currentOriginal());
    }

    // Extract an absolute local path from a URL's `abs` query parameter, or null.
    function absFromUrl(src) {
      if (!src) return null;
      var q = src.indexOf("?");
      if (q < 0) return null;
      var abs = null;
      try {
        abs = new URLSearchParams(src.slice(q + 1)).get("abs");
      } catch (e) { return null; }
      if (!abs) return null;
      // Reject anything that is not an absolute Windows or POSIX path, so a
      // hand-written link cannot make us act on a relative path.
      if (!/^[a-zA-Z]:[\\/]/.test(abs) && abs.charAt(0) !== "/") return null;
      return abs;
    }

    // Transient confirmation on a toolbar button: swap the glyph, restore it.
    function flashButton(btn, glyph, label) {
      if (!btn) return;
      var iconEl = btn.querySelector ? btn.querySelector(".dsh-ig-btn-icon") : null;
      var prevIcon = iconEl ? iconEl.textContent : null;
      var prevTitle = btn.title;
      if (iconEl) iconEl.textContent = glyph;
      if (label) btn.title = label;
      setTimeout(function () {
        if (iconEl && prevIcon !== null) iconEl.textContent = prevIcon;
        if (label) btn.title = prevTitle;
      }, 1400);
    }

    // Visible, impossible-to-miss feedback. Title changes are invisible unless
    // the user happens to be hovering the exact button, which was the reported
    // "copy did nothing" confusion. A centered toast appears on every outcome.
    var toastTimer = null;
    function showToast(text) {
      var t = document.querySelector(".dsh-ig-toast");
      if (!t) {
        t = document.createElement("div");
        t.className = "dsh-ig-toast";
        document.body.appendChild(t);
      }
      t.textContent = text;
      // Force reflow so the transition restarts even when text is unchanged.
      void t.offsetWidth;
      t.classList.add("dsh-ig-show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.classList.remove("dsh-ig-show"); }, 3200);
    }

    function copyImagePath(btn) {
      var abs = localAbsPath();
      if (!abs) {
        flashButton(btn, "—", "这张图不是本地文件，没有可复制的路径");
        showToast("这张图不是本地文件，没有可复制的路径");
        return;
      }
      // Multiple copy strategies; keep trying until one sticks.
      function fallbackCopy() {
        try {
          var ta = document.createElement("textarea");
          ta.value = abs;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.top = "0";
          ta.style.left = "0";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          var ok = document.execCommand && document.execCommand("copy");
          document.body.removeChild(ta);
          if (ok) { success(); return true; }
        } catch (e) {}
        return false;
      }
      function success() {
        flashButton(btn, "✓", "已复制：" + abs);
        showToast("已复制路径：\n" + abs);
      }
      function fail() {
        flashButton(btn, "✗", "复制失败，路径：" + abs);
        showToast("复制失败，请手动复制路径：\n" + abs);
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(abs).then(success, function () {
            if (!fallbackCopy()) fail();
          });
        } else if (!fallbackCopy()) {
          fail();
        }
      } catch (e) {
        if (!fallbackCopy()) fail();
      }
    }

    function revealImageFile(btn) {
      var abs = localAbsPath();
      if (!abs) {
        flashButton(btn, "—", "这张图不是本地文件，无法在文件夹中定位");
        showToast("这张图不是本地文件，无法在文件夹中定位");
        return;
      }
      // The host half does the actual explorer.exe call — the browser cannot.
      fetch(GALLERY_REVEAL_URL + "?abs=" + encodeURIComponent(abs))
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (data) {
          if (data && data.ok) {
            flashButton(btn, "✓", "已在文件夹中打开：" + abs);
            showToast("已在文件夹中定位该文件");
          } else {
            flashButton(btn, "✗", "打开失败：" + ((data && data.error) || "未知原因"));
            showToast("在文件夹中打开失败：" + ((data && data.error) || "宿主未响应"));
          }
        })
        .catch(function () {
          flashButton(btn, "✗", "打开失败（宿主未响应）");
          showToast("在文件夹中打开失败：宿主服务未响应（插件是否已重载？）");
        });
    }

    function prefetchNeighbors() {
      if (currentImages.length <= 1) return;
      var prev = currentImages[(currentIndex - 1 + currentImages.length) % currentImages.length];
      var next = currentImages[(currentIndex + 1) % currentImages.length];
      [prev, next].forEach(function (n) {
        if (n && n.src) { var im = new Image(); im.src = n.src; }
      });
    }

    function applyZoom() {
      if (zoomScale <= 1) {
        zoomScale = 1; panX = 0; panY = 0;
        if (lightboxImg) { lightboxImg.classList.remove("dsh-ig-zoomed"); lightboxImg.style.transform = ""; }
      } else if (lightboxImg) {
        lightboxImg.classList.add("dsh-ig-zoomed");
        lightboxImg.style.transform = "scale(" + zoomScale + ") translate(" + panX + "px," + panY + "px)";
      }
    }

    function setZoom(scale) {
      zoomScale = Math.max(1, Math.min(4, scale));
      applyZoom();
      updateZoomLabel();
    }

    function updateZoomLabel() {
      if (zoomLevelEl) zoomLevelEl.textContent = Math.round(zoomScale * 100) + "%";
    }

    // One step of the pan pad. Positive dx moves the image right (the view
    // travels left), matching the sign the drag handler already uses.
    var PAN_STEP = 48;

    function panBy(dx, dy) {
      // Moving the view only means something while zoomed in: at 100% the image
      // already fits, and applyZoom() would zero the offset again anyway.
      if (zoomScale <= 1) return;
      panX += dx;
      panY += dy;
      applyZoom();
    }

    function updateDisplay() {
      if (!lightboxImg || !currentImages[currentIndex]) return;
      var img = currentImages[currentIndex];
      // 直接加载原图（本插件不再改写聊天里的 src，去掉可能的 ?w= 参数即可）
      lightboxImg.src = stripResizeParam(img.src) || img.src;
      zoomScale = 1; panX = 0; panY = 0; applyZoom();
      lightboxImg.alt = img.alt || "";
      prefetchNeighbors();
      var cap = sanitizeName(img.src, img.alt, "") || "image";
      if (captionEl) {
        captionEl.textContent = cap;
        captionEl.classList.toggle("dsh-ig-hidden", !cap);
      }

      var hasMultiple = currentImages.length > 1;
      if (prevBtn) prevBtn.classList.toggle("dsh-ig-hidden", !hasMultiple);
      if (nextBtn) nextBtn.classList.toggle("dsh-ig-hidden", !hasMultiple);
      if (counterEl) counterEl.classList.toggle("dsh-ig-hidden", !hasMultiple);
      if (hasMultiple && counterEl) {
        counterEl.textContent = (currentIndex + 1) + " / " + currentImages.length;
      }
      // Arrows appearing/disappearing changes the toolbar height → reposition
      // the zoom cluster so it never overlaps the toolbar.
      positionZoombar();
    }

    // Sanitize the download name: strip any ?w=/?raw= params and keep the
    // file's true extension (a TIFF served as WebP still downloads as .tiff).
    function sanitizeName(src, alt, mime) {
      var base = (alt || "").trim() || (src || "").split("/").pop() || "image";
      base = base.replace(/[?#].*$/, "").replace(/[\\/:*?"<>|]/g, "_").trim();
      if (!base) base = "image";
      var ext = (base.split(".").pop() || "").toLowerCase();
      var want = (mime || "").split("/")[1] || "";
      var map = { jpeg: "jpg", png: "png", gif: "gif", webp: "webp", bmp: "bmp", svg: "svg", "x-icon": "ico", tiff: "tif" };
      var mapped = map[want] || "";
      if (!ext && mapped) base = base + "." + mapped;
      return base;
    }

    function downloadCurrent() {
      var img = currentImages[currentIndex];
      if (!img) return;
      // Always download the untouched original: for local /images/ files add
      // raw=1 so server-side format conversion (TIFF/HEIC -> WebP) is
      // bypassed and the saved file keeps its original format/quality.
      var originalUrl = currentOriginal() || img.src;
      if (originalUrl.indexOf("/images/") >= 0) {
        originalUrl += (originalUrl.indexOf("?") >= 0 ? "&raw=1" : "?raw=1");
      }
      var fallbackName = sanitizeName(originalUrl, img.alt, "");
      fetch(originalUrl).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.blob();
      }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var name = sanitizeName(originalUrl, img.alt, blob.type) || fallbackName;
        var a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      }).catch(function () {
        window.open(originalUrl, "_blank");
      });
    }

    // ── Chat image enhancement (class-only, ZCode-style) ────────────────────

    // Why an image was rejected, kept for the self-report tooltip. "跳过 2" with
    // no reason is not actionable; "跳过 2（小图 16x16）" tells you instantly
    // that only UI chrome was on the page.
    var lastSkipReason = "";

    function isChatImage(img) {
      lastSkipReason = "";
      if (!img || !img.src) { lastSkipReason = "无src"; return false; }
      if (img.src.indexOf("data:image/svg") === 0) { lastSkipReason = "svg"; return false; }
      if (img.closest && img.closest(".dsh-ig-backdrop")) { lastSkipReason = "灯箱内"; return false; }
      // Skip only images THIS module instance already handled — and that still
      // carry the class. React re-renders can overwrite className while leaving
      // the element (and our dataset stamp) in place; keying the skip on the
      // stamp alone would then strand that image forever, its clicks and mode
      // switches dead. Requiring the class too makes the stamp re-adoptable.
      if (img.dataset.dshIgOwner === OWNER && img.classList.contains("dsh-ig-img")) {
        lastSkipReason = "已处理";
        return false;
      }
      // Filter true UI chrome only. 64px was too aggressive: it also rejected
      // small但 legitimate images, so the threshold is now 32px and the reason
      // is recorded either way.
      if (img.naturalWidth > 0 && (img.naturalWidth < 32 || img.naturalHeight < 32)) {
        lastSkipReason = "小图(" + img.naturalWidth + "x" + img.naturalHeight + ")";
        return false;
      }
      if (img.closest && img.closest("button")) { lastSkipReason = "在按钮内"; return false; }
      return true;
    }

    // Find the nearest "message block" container (read-only heuristic — only
    // used to decide the lightbox navigation group and the nine-grid layout;
    // the DOM is never touched). If the first candidate wraps exactly one
    // image and little else, walk one level up: DSH's markdown renderer often
    // wraps each image in its own <p>, and grouping needs the shared parent.
    function messageContainer(img) {
      var el = img.parentElement;
      var depth = 0;
      while (el && el !== document.body && depth < 12) {
        var cn = el.className || "";
        var tag = el.tagName;
        var pat = /(message|chat|item|bubble|turn|msg|conversation|list-item|row|assistant|user|tool)/i;
        if (typeof cn === "string" && cn.split(" ").some(function (c) { return pat.test(c); })) {
          return el;
        }
        if (tag === "ARTICLE" || tag === "SECTION" || tag === "UL" || tag === "LI") {
          return el;
        }
        if (depth >= 8) return el;
        el = el.parentElement;
        depth++;
      }
      var p = img.parentElement;
      if (p && p !== document.body && p !== document.documentElement &&
          p.children.length === 1 && !hasOwnText(p)) {
        var pp = p.parentElement;
        if (pp && pp !== document.body && pp !== document.documentElement) return pp;
      }
      return p || document.body;
    }

    // Lightbox group is computed from the LIVE DOM at click time: all enhanced
    // images inside the same message container, in document order. No stale
    // snapshots, no cross-message merging.
    function groupFor(img) {
      var mc = messageContainer(img);
      var scope = (mc && mc !== document.body) ? mc : document;
      var nodes = scope.querySelectorAll("img.dsh-ig-img");
      var list = [];
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].isConnected) list.push(nodes[i]);
      }
      var idx = list.indexOf(img);
      if (idx < 0) { list = [img]; idx = 0; }
      return { list: list, index: idx };
    }

    // ── Foldable blocks: EXPANDED by default ────────────────────────────────
    // Images show at full size unless the user folds the block. The fold state
    // lives in a module-level set keyed by image src, NOT on the container:
    // when React re-renders a message it swaps the container node, and a
    // node-bound flag would be lost (the block would snap back to its default
    // state right after the user toggled it).
    //
    // Two click zones inside one block:
    //   * the badge zone in the bottom-right corner toggles the fold state
    //   * anywhere else on the image opens the lightbox (or unfolds first,
    //     when the block is folded)
    //
    // OWNER guards against a hot-reloaded module double-handling a click: the
    // previous module's listeners are still attached to the <img>, but they
    // see a different owner and exit silently.

    // Unique per module instance. A hot reload installs a fresh instance while
    // the previous one's observers and listeners are still attached; the one
    // holding the newest id is the only one allowed to touch the DOM.
    var INSTANCE_ID = "dsh-ig-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    // Per-instance ownership stamp. Listeners check it before acting, so a
    // listener left over from a superseded instance exits silently, and images
    // stamped by that instance are re-adopted by this one.
    var OWNER = INSTANCE_ID;
    // Build marker. When a change "does not work", the first question is always
    // whether the page is even running the new code — the tooltip answers that
    // instead of us guessing across a reload.
    var BUILD = "2026-09-18-E";
    // Host route that opens the OS file manager with a file selected. The
    // browser cannot do this itself, so it asks the host half.
    var GALLERY_REVEAL_URL = "/api/image-gallery/reveal";
    var ownedImages = typeof WeakSet === "function" ? new WeakSet() : null;
    // Per-image display mode: "open" (default) | "thumb" | "hidden", keyed by
    // src so the choice survives a React re-render swapping the container node.
    var modeSrc = Object.create(null);

    function srcKey(img) {
      return img.currentSrc || img.src || "";
    }

    function blockImages(mc) {
      return mc.querySelectorAll("img.dsh-ig-img");
    }

    // A block reports a single mode: "open" unless every image in it agrees.
    function blockMode(mc) {
      var imgs = blockImages(mc);
      if (!imgs.length) return "open";
      var first = modeSrc[srcKey(imgs[0])] || "open";
      for (var i = 1; i < imgs.length; i++) {
        if ((modeSrc[srcKey(imgs[i])] || "open") !== first) return "open";
      }
      return first;
    }

    function setBlockMode(mc, mode) {
      if (!mc) return;
      var imgs = blockImages(mc);
      for (var i = 0; i < imgs.length; i++) {
        var k = srcKey(imgs[i]);
        if (mode === "open") delete modeSrc[k];
        else modeSrc[k] = mode;
      }
      applyBlockMode(mc, mode);
    }

    // Idempotent: never touch a class that already matches. classList writes
    // invalidate style for the element, and this runs for every block on every
    // scan, so needless writes are pure cost.
    function setClass(el, name, on) {
      var has = el.classList.contains(name);
      if (on && !has) el.classList.add(name);
      else if (!on && has) el.classList.remove(name);
    }

    // Flatten the wrapper between the container and each <img> so the tiles can
    // share one flex line. A stylesheet rule is not enough here: the wrapper is
    // a host-rendered node (<p> from the markdown renderer) whose own styling
    // can win on specificity, and a single wrapper left block-level stacks the
    // tiles vertically again. Inline !important outranks everything.
    // Inline-style helpers. A throw here would abort the whole scan and leave
    // the switches looking dead, so every write is guarded: if the element does
    // not expose a real CSSStyleDeclaration we simply fall back to the
    // stylesheet rules.
    function setInline(el, prop, value) {
      try {
        if (el && el.style && typeof el.style.setProperty === "function") {
          el.style.setProperty(prop, value, "important");
          return true;
        }
      } catch (e) {}
      return false;
    }

    function clearInline(el, props) {
      try {
        if (!el || !el.style || typeof el.style.removeProperty !== "function") return;
        for (var i = 0; i < props.length; i++) el.style.removeProperty(props[i]);
      } catch (e) {}
    }

    // ── Thumbnail row: CSS TABLE, not flex ──────────────────────────────────
    // Flex needed every wrapper flattened with display:contents before the
    // tiles would share one line, and that flattening is exactly what kept
    // losing to the host's own styles — the row stayed vertical.
    //
    // A table has no such precondition. `display: table` on the container plus
    // `display: table-cell` on each direct child makes the children cells of one
    // row BY CONSTRUCTION: block-level or not, wrapper or image, they sit
    // side by side. No node is created, moved or reparented — the table is
    // purely a display-mode overlay on the existing elements.
    // ── Thumbnail row: inline-block with an explicit width ─────────────────
    // Tried, in order: flex + display:contents on the wrappers (the wrappers
    // kept winning with their own style, so the row stayed vertical), then a
    // CSS table (correct, but still only as good as the container we picked).
    //
    // This is a GRID, not a single row. The tile row was the wrong reading of
    // the request: forcing everything onto one line meant a caption shared that
    // line and long strips ran off the edge. What is wanted is a thumbnail
    // GRID — auto-filled columns that wrap, so every image is visible at once.
    //
    // grid-template-columns: repeat(auto-fill, minmax(N, 1fr)) gives as many
    // equal columns as fit (≈4 at typical conversation width) and wraps the
    // rest onto new rows automatically. Captions span the full row so they sit
    // above/below the tiles instead of stealing a cell.
    var CELL_PROPS = ["display", "vertical-align", "width", "max-width", "min-width",
      "padding", "margin", "float", "white-space", "overflow", "grid-column"];
    var TILE_PROPS = ["height", "width", "max-width", "min-width", "object-fit", "display",
      "vertical-align", "margin"];
    var TEXT_PROPS = ["white-space", "max-width", "overflow", "text-overflow",
      "font-size", "line-height", "display", "vertical-align", "margin"];
    var ROW_PROPS = ["display", "grid-template-columns", "gap", "column-gap", "row-gap",
      "white-space", "overflow-x", "overflow-y", "align-items", "margin",
      "width", "max-width", "box-sizing"];

    var TILE_COLUMNS = 4;
    var TILE_H = 110;
    var TILE_MIN_W = 120;
    var TILE_GAP = 8;

    // Persisted user preference: how many thumbnails per row. Kept in
    // localStorage so the choice survives a reload without any settings UI.
    var COLUMNS_KEY = "dshIgTileColumns";
    function loadTileColumns() {
      try {
        var v = parseInt(localStorage.getItem(COLUMNS_KEY), 10);
        if (isFinite(v) && v >= 1 && v <= 12) TILE_COLUMNS = v;
      } catch (e) {}
    }
    function setTileColumns(n) {
      TILE_COLUMNS = Math.max(1, Math.min(12, n));
      try { localStorage.setItem(COLUMNS_KEY, String(TILE_COLUMNS)); } catch (e) {}
      // Keep the field showing the committed truth, no matter which path got us
      // here (typing, Enter, blur, or a restore from storage).
      try {
        var inp = document.querySelector(".dsh-ig-cols-input");
        if (inp && inp.value !== String(TILE_COLUMNS)) inp.value = String(TILE_COLUMNS);
      } catch (e) {}
      // Re-apply to every block currently showing thumbnails.
      var blocks = allBlocks();
      for (var i = 0; i < blocks.length; i++) {
        if (blockMode(blocks[i]) === "thumb") applyBlockMode(blocks[i], "thumb");
      }
      syncSwitchState();
    }

    function isCaptionCell(kid) {
      // A child that holds no image is text (a caption/heading paragraph).
      return !(kid.querySelector && kid.querySelector("img"));
    }

    // Which element should actually become the grid?
    //
    // messageContainer() hands back the message node (e.g. `DIV.Tui-W_flowItem`),
    // and that node often wraps its entire content in ONE child. A grid applied
    // there has a single grid item — one column, no matter how many images live
    // inside. The grid has to sit on the level whose DIRECT children are the
    // image wrappers / caption paragraphs.
    //
    // So: descend from the message node, one level at a time, until a level
    // whose direct children number two or more image-bearing nodes.
    function gridHostFor(mc, imgs) {
      if (!mc || !mc.children) return mc;
      var cur = mc;
      for (var depth = 0; depth < 6; depth++) {
        if (!cur || !cur.children) break;
        var direct = 0;
        for (var i = 0; i < cur.children.length; i++) {
          var kid = cur.children[i];
          if (kid.tagName === "IMG") { direct++; continue; }
          if (kid.querySelector && kid.querySelector("img.dsh-ig-img")) direct++;
        }
        if (direct >= 2) return cur;
        if (cur.children.length !== 1) break;   // ambiguous level; stop here
        var next = cur.children[0];
        if (!next || !next.querySelector || !next.querySelector("img.dsh-ig-img")) break;
        cur = next;
      }
      // Nothing better found: if the block's own node is all we have, and it has
      // a single child holding every image, use that child.
      if (imgs && imgs.length > 1 && mc.children && mc.children.length === 1) {
        var only = mc.children[0];
        if (only && only.querySelector && only.querySelector("img.dsh-ig-img")) return only;
      }
      return mc;
    }

    function applyRowLayout(mc, on) {
      var imgs = blockImages(mc);
      if (on) {
        setInline(mc, "display", "grid");
        // FIXED column count, not auto-fill. auto-fill derives the count from
        // the container's width, and when that width is indefinite the result
        // collapses to a single column — the exact symptom being reported.
        // A fixed count cannot degenerate: four tracks are always four tracks.
        setInline(mc, "grid-template-columns", "repeat(" + TILE_COLUMNS + ", minmax(0, 1fr))");
        setInline(mc, "gap", TILE_GAP + "px");
        setInline(mc, "align-items", "start");
        setInline(mc, "white-space", "normal");
        setInline(mc, "overflow-x", "visible");
        setInline(mc, "overflow-y", "visible");
        setInline(mc, "margin", "6px 0");
        // A grid's column count is derived from the container's width. If the
        // host made this node inline, or a flex item sized to its content, the
        // width collapses to one image and auto-fill can only produce ONE
        // column — which is exactly the "still a single column" report. Pin the
        // width so the track calculation has the full row to work with.
        setInline(mc, "width", "100%");
        setInline(mc, "max-width", "100%");
        setInline(mc, "box-sizing", "border-box");
        markStyled(mc, ROW_PROPS);

        var kids = mc.children;
        for (var i = 0; i < kids.length; i++) {
          var kid = kids[i];
          setInline(kid, "display", "block");
          setInline(kid, "width", "auto");
          setInline(kid, "max-width", "none");
          setInline(kid, "min-width", "0");
          setInline(kid, "padding", "0");
          setInline(kid, "margin", "0");
          setInline(kid, "float", "none");
          setInline(kid, "white-space", "normal");
          var props = CELL_PROPS.slice();
          // Captions take a whole row; images take one grid cell each.
          if (isCaptionCell(kid)) {
            setInline(kid, "grid-column", "1 / -1");
            props.push("grid-column");
          }
          markStyled(kid, props);
        }

        for (var j = 0; j < imgs.length; j++) {
          var im = imgs[j];
          setInline(im, "display", "block");
          setInline(im, "height", TILE_H + "px");
          setInline(im, "width", "100%");
          setInline(im, "max-width", "100%");
          setInline(im, "min-width", "0");
          setInline(im, "margin", "0");
          setInline(im, "object-fit", "cover");
          setInline(im, "vertical-align", "top");
          markStyled(im, TILE_PROPS);
        }
      }

      // Captions: keep them small so they read as labels, not as content. They
      // must NOT be nowrap/ellipsis — that is what pushed captions into the
      // scroll strip before.
      var texts = mc.querySelectorAll("strong, em, b, i, span, a, code, small");
      for (var k = 0; k < texts.length; k++) {
        var t = texts[k];
        if (t.classList && t.classList.contains("dsh-ig-switch")) continue;
        if (on) {
          setInline(t, "display", "inline");
          setInline(t, "white-space", "normal");
          setInline(t, "font-size", "12px");
          setInline(t, "line-height", "1.5");
          setInline(t, "vertical-align", "middle");
          markStyled(t, TEXT_PROPS);
        }
      }
    }

    // Every element this module has styled inline, so clearing is exhaustive.
    // Tracking them centrally fixes the bug where a block that had been through
    // the thumbnail layout kept stray inline styles (grid display, fixed tile
    // height) after switching back — which is what made images vanish.
    var styledEls = [];

    function markStyled(el, props) {
      el.__dshStyled = props;
      if (styledEls.indexOf(el) < 0) styledEls.push(el);
    }

    function clearStyled(el) {
      var props = el && el.__dshStyled;
      if (!props) return;
      clearInline(el, props);
      el.__dshStyled = null;
      var at = styledEls.indexOf(el);
      if (at >= 0) styledEls.splice(at, 1);
    }

    // Clear everything this module ever styled, anywhere. Cheap (the list only
    // holds what we touched), exhaustive, and safe to call on every pass.
    function clearAllStyled() {
      for (var i = styledEls.length - 1; i >= 0; i--) {
        var el = styledEls[i];
        var props = el && el.__dshStyled;
        if (props) clearInline(el, props);
        if (el) el.__dshStyled = null;
        styledEls.splice(i, 1);
      }
    }

    // Clear only the inline styles belonging to ONE block's subtree.
    //
    // applyBlockMode runs once per block inside toggleAllBlocks, so a global
    // clear there wiped the layout that the previous block had just been given —
    // leaving only the last block laid out correctly. Same class of bug as the
    // document-wide class sweep this function replaces.
    function clearStyledIn(mc) {
      if (!mc) return;
      for (var i = styledEls.length - 1; i >= 0; i--) {
        var el = styledEls[i];
        if (el !== mc && !(mc.contains && mc.contains(el))) continue;
        var props = el && el.__dshStyled;
        if (props) clearInline(el, props);
        if (el) el.__dshStyled = null;
        styledEls.splice(i, 1);
      }
    }

    function applyBlockMode(mc, mode) {
      var thumbs = mode === "thumb";

      // Clear the layout class from THIS block's subtree only. A document-wide
      // sweep looks safer but breaks batch operations: toggleAllBlocks walks the
      // blocks one by one, so a global clear would wipe the class off every
      // block processed before the current one.
      mc.classList.remove("dsh-ig-thumbs");
      var inTree = mc.querySelectorAll(".dsh-ig-thumbs");
      for (var s = 0; s < inTree.length; s++) inTree[s].classList.remove("dsh-ig-thumbs");

      setClass(mc, "dsh-ig-thumbs", thumbs);
      setClass(mc, "dsh-ig-hidden-block", mode === "hidden");
      setClass(mc, "dsh-ig-collapsed", false);   // retired state

      // Start from a clean slate — for THIS block only — then apply what the new
      // mode needs. A document-wide clear here would strip the layout off every
      // block processed earlier in the same batch, which is why only the last
      // block used to come out right.
      clearStyledIn(mc);
      if (thumbs) {
        // The grid goes on the level whose children are the image wrappers, not
        // on the message node (which typically wraps everything in one child and
        // would therefore yield a single column). The class rides along so the
        // stylesheet rules and the diagnostics look at the same element.
        var host = gridHostFor(mc, blockImages(mc));
        if (host !== mc) setClass(host, "dsh-ig-thumbs", true);
        applyRowLayout(host, true);
      }
    }

    // ── Global switches ─────────────────────────────────────────────────────
    // The two controls live next to the composer's access-mode button, so the
    // conversation itself carries no chrome. Each one flips EVERY image block
    // in the conversation between its mode and full size.

    function allBlocks() {
      var imgs = document.querySelectorAll("img.dsh-ig-img");
      var seen = [];
      var out = [];
      for (var i = 0; i < imgs.length; i++) {
        var mc = messageContainer(imgs[i]);
        if (!mc || mc === document.body) {
          // The heuristic gave up (returned body) — fall back to the image's own
          // wrapper instead of dropping the image entirely. A block the switches
          // cannot see is a switch that appears dead.
          mc = imgs[i].parentElement;
        }
        if (!mc || mc === document.body || seen.indexOf(mc) >= 0) continue;
        if (mc.closest && mc.closest(".dsh-ig-backdrop")) continue;
        seen.push(mc);
        if (blockImages(mc).length) out.push(mc);
      }
      return out;
    }

    function anyBlockIn(mode) {
      var blocks = allBlocks();
      for (var i = 0; i < blocks.length; i++) {
        if (blockMode(blocks[i]) === mode) return true;
      }
      return false;
    }

    // ── Scroll anchoring around a mode switch ───────────────────────────────
    // Switching modes changes the height of the conversation, so a naive switch
    // leaves the reader looking past the image they were watching (expand puts
    // it above the viewport — "I have to scroll back up"). Capture the block
    // nearest the viewport centre before the switch and restore its on-screen
    // position afterwards.

    // Walking the ancestor chain with getComputedStyle forces a style resolve
    // per level per block — expensive enough to be felt, and unnecessary: we
    // only need the nearest scrollable ancestor, and the cached answer stays
    // valid for the lifetime of a conversation view.
    var cachedScrollParent = null;

    function scrollParentOf(el) {
      if (cachedScrollParent && cachedScrollParent.isConnected) return cachedScrollParent;
      cachedScrollParent = null;
      var p = el && el.parentElement;
      var steps = 0;
      while (p && steps++ < 20) {
        // scrollHeight > clientHeight is the cheap, style-free signal that this
        // element actually scrolls.
        if (p.scrollHeight > p.clientHeight + 4) {
          var oy = p.style && p.style.overflowY;
          if (oy === "auto" || oy === "scroll" || oy === "overlay" || !oy) {
            cachedScrollParent = p;
            return p;
          }
        }
        p = p.parentElement;
      }
      return null;
    }

    function captureScrollAnchor() {
      var blocks = allBlocks();
      if (!blocks.length) return null;
      var vh = (typeof window !== "undefined" && window.innerHeight) ? window.innerHeight : 800;
      var best = null;
      var bestDist = Infinity;
      for (var i = 0; i < blocks.length; i++) {
        var r = blocks[i].getBoundingClientRect();
        var mid = r.top + (r.bottom - r.top) / 2;
        var d = Math.abs(mid - vh / 2);
        if (d < bestDist) { bestDist = d; best = { el: blocks[i], top: r.top }; }
      }
      return best;
    }

    // Deferred by one frame and executed at most once per switch: writing
    // scrollTop synchronously inside the same task as the class change is what
    // makes a virtual list thrash (relayout → remount → observer → again).
    var pendingAnchor = null;
    var anchorFrame = 0;

    function restoreScrollAnchor(anchor) {
      if (!anchor || !anchor.el || !anchor.el.isConnected) return;
      pendingAnchor = anchor;
      if (anchorFrame) return;
      var run = function () {
        anchorFrame = 0;
        var a = pendingAnchor;
        pendingAnchor = null;
        if (!a || !a.el || !a.el.isConnected) return;
        var delta = a.el.getBoundingClientRect().top - a.top;
        if (!isFinite(delta) || Math.abs(delta) < 1) return;
        var sc = scrollParentOf(a.el);
        if (sc) sc.scrollTop += delta;
      };
      if (typeof requestAnimationFrame === "function") anchorFrame = requestAnimationFrame(run);
      else anchorFrame = setTimeout(run, 16);
    }

    // Self-healing block lookup.
    //
    // Every switch action depends on image blocks still carrying our classes.
    // Any of these can invalidate that: React re-rendering a message and
    // dropping the classes, a hot reload where the new instance has not
    // re-scanned yet, a virtual list unmounting the visible range. When a
    // button finds nothing to act on, it re-scans first instead of silently
    // doing nothing — a switch that appears to be dead is worse than a slow one.
    function blocksForAction() {
      var blocks = allBlocks();
      if (blocks.length) return blocks;
      try { enhance(document.body); } catch (e) {}
      return allBlocks();
    }

    // Toggle every block: if any block is already in `mode`, go back to full
    // size; otherwise switch them all into `mode`.
    // Whatever the field currently shows is the truth before a layout pass.
    // Belt and braces for the case "typed 5, clicked 缩略图 immediately": the
    // switch's click can be handled before the field's change event lands.
    function syncColumnsFromField() {
      try {
        var inp = document.querySelector(".dsh-ig-cols-input");
        if (!inp) return;
        var v = parseInt(inp.value, 10);
        if (isFinite(v) && v >= 1 && v <= 12 && v !== TILE_COLUMNS) TILE_COLUMNS = v;
      } catch (e) {}
    }

    function toggleAllBlocks(mode) {
      var blocks = blocksForAction();
      if (!blocks.length) return;
      var target = anyBlockIn(mode) ? "open" : mode;
      if (target === "thumb") syncColumnsFromField();
      var anchor = captureScrollAnchor();
      for (var i = 0; i < blocks.length; i++) setBlockMode(blocks[i], target);
      syncSwitchState();
      restoreScrollAnchor(anchor);
    }

    // Scroll the conversation to the nearest image and flash it. Repeated
    // presses walk down the conversation and wrap around at the end, so the
    // button works as "next image" without any extra controls.
    // ── Jump-to-image ───────────────────────────────────────────────────────
    // One button, several gestures:
    //   left click            previous image block (scroll up the conversation)
    //   right click           next image block (scroll down)
    //   left triple-click     the FARTHEST image from the viewport centre
    //   right triple-click    the NEAREST image to the viewport centre
    // A short window separates "three presses" from "three separate presses".

    var jumpBurst = { left: 0, right: 0 };
    var jumpTimer = { left: null, right: null };

    function viewportCenterY() {
      return (typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 800) / 2;
    }

    function scrollToBlock(target) {
      if (!target) return;
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (e) {
        target.scrollIntoView();   // older engines ignore the options object
      }
      target.classList.add("dsh-ig-flash");
      setTimeout(function () { target.classList.remove("dsh-ig-flash"); }, 1200);
    }

    // Blocks ordered by their distance from the viewport centre.
    function blocksByDistance() {
      var vc = viewportCenterY();
      var rows = blocksForAction().map(function (mc, idx) {
        var r = mc.getBoundingClientRect();
        var mid = r.top + (r.bottom - r.top) / 2;
        return { mc: mc, idx: idx, top: r.top, dist: Math.abs(mid - vc) };
      });
      rows.sort(function (a, b) { return a.dist - b.dist; });
      return rows;
    }

    // Step one block up (dir -1) or down (dir 1).
    //
    // Walking is relative to the block we last jumped to, not to the viewport:
    // in a short conversation every image is already on screen, so a
    // viewport-relative search finds nothing below and used to wrap to the
    // first image — pressing "next" jumped backwards, which reads as broken.
    // Now "next" always means the next image in document order, and hitting
    // either end simply stops there.
    var lastJumpIndex = -1;

    function currentAnchorIndex(blocks) {
      // Trust the remembered index while that same block is still the one we
      // are looking at; otherwise fall back to whatever is nearest the middle.
      if (lastJumpIndex >= 0 && lastJumpIndex < blocks.length &&
          blocks[lastJumpIndex].isConnected) {
        var r = blocks[lastJumpIndex].getBoundingClientRect();
        var vh = (typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 800);
        if (r.bottom > 0 && r.top < vh) return lastJumpIndex;
      }
      var vc = viewportCenterY();
      var best = 0;
      var bestDist = Infinity;
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i].getBoundingClientRect();
        var d = Math.abs(b.top + (b.bottom - b.top) / 2 - vc);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      return best;
    }

    function jumpStep(dir) {
      var blocks = blocksForAction();
      if (!blocks.length) return;
      var idx = currentAnchorIndex(blocks) + dir;
      if (idx < 0 || idx >= blocks.length) {
        // Already at the end: stay on the edge image rather than wrapping, so
        // the direction of the button always matches the direction of travel.
        var edge = dir > 0 ? blocks.length - 1 : 0;
        lastJumpIndex = edge;
        scrollToBlock(blocks[edge]);
        return;
      }
      lastJumpIndex = idx;
      scrollToBlock(blocks[idx]);
    }

    function jumpNearest() {
      var rows = blocksByDistance();
      if (rows.length) scrollToBlock(rows[0].mc);
    }

    function jumpFarthest() {
      var rows = blocksByDistance();
      if (rows.length) scrollToBlock(rows[rows.length - 1].mc);
    }

    // Collapse a burst of presses into one gesture. The window is deliberately
    // short: it only has to separate a double/triple press from distinct
    // presses, and every extra millisecond is a millisecond of "did it even
    // register?" feedback delay.
    var JUMP_BURST_MS = 230;

    function onJumpPress(which) {
      // Immediate acknowledgement, so the press never feels ignored while the
      // burst window is still open.
      if (which === "right" && switchJump) {
        switchJump.classList.add("dsh-ig-switch-pulse");
        setTimeout(function () {
          if (switchJump) switchJump.classList.remove("dsh-ig-switch-pulse");
        }, 160);
      }
      jumpBurst[which] += 1;
      if (jumpTimer[which]) clearTimeout(jumpTimer[which]);
      jumpTimer[which] = setTimeout(function () {
        var n = jumpBurst[which];
        jumpBurst[which] = 0;
        jumpTimer[which] = null;
        if (n >= 3) {
          if (which === "right") { jumpNearest(); }
          else { jumpFarthest(); }
          // Remember where we landed so the next single step continues from
          // there instead of re-deriving the position from the viewport.
          var rows = blocksByDistance();
          if (rows.length) {
            var all = allBlocks();
            var targetIdx = which === "right" ? rows[0].mc : rows[rows.length - 1].mc;
            var at = all.indexOf(targetIdx);
            if (at >= 0) lastJumpIndex = at;
          }
        } else {
          jumpStep(which === "right" ? 1 : -1);
        }
      }, JUMP_BURST_MS);
    }

    // ── The two switches next to the composer's access-mode control ─────────
    // Real buttons (not pseudo-elements) so they can live in the composer row.
    // The anchor is matched by aria-label, which the host builds from its own
    // i18n string ("访问模式，当前：…" / "Access mode, current: …"), so this
    // keeps working across CSS-module hash changes.

    var switchThumb = null;
    var switchHide = null;
    var switchJump = null;

    function accessModeButton() {
      var byAria = document.querySelector('button[aria-label*="访问模式"], button[aria-label*="Access mode"]');
      if (byAria) return byAria;
      // Fallback: any button in the composer whose text is a known preset label.
      var labels = ["完全权限", "工作区内修改", "仅可查看", "Full access", "Workspace Write", "Read Only"];
      var buttons = document.querySelectorAll("button");
      for (var i = 0; i < buttons.length; i++) {
        var txt = (buttons[i].textContent || "").trim();
        if (labels.indexOf(txt) >= 0) return buttons[i];
      }
      return null;
    }

    function makeSwitch(icon, label, title, onClick) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "dsh-ig-switch";
      b.title = title;
      b.setAttribute("aria-label", title);
      b.__dshClicks = 0;
      var ic = document.createElement("span");
      ic.className = "dsh-ig-switch-icon";
      ic.textContent = icon;
      var tx = document.createElement("span");
      tx.textContent = label;
      b.appendChild(ic);
      b.appendChild(tx);

      // Two activation paths on purpose.
      //
      // The host decorates the composer area with its own pointer handlers, and
      // a stopPropagation() up the tree can swallow the click before it reaches
      // a listener registered on this button — a button that then looks
      // completely dead. mousedown in the CAPTURE phase fires first, from the
      // outside in, so it cannot be pre-empted the same way.
      //
      // mousedown performs the action; click is only a fallback for the case
      // where no mousedown reached us at all. A time window (not a general
      // debounce) keeps one physical press from running twice without ever
      // Single plain click handler — the form that was verified working.
      // (A mousedown capture path plus a window-level delegate were added later
      // while chasing a failure that turned out to be "no images on screen";
      // they only added ways for the press to go wrong.)
      b.addEventListener("click", function (e) {
        try { e.preventDefault(); } catch (x) {}
        try { e.stopPropagation(); } catch (x) {}
        b.__dshClicks = (b.__dshClicks || 0) + 1;
        try {
          onClick();
        } catch (err) {
          try { console.warn("[image-gallery] switch action failed:", err && err.message); } catch (x) {}
        }
      });
      return b;
    }
    // A switch that throws is a switch that looks dead: the click handler stops
    // mid-way, nothing visible happens, and the user concludes the button is
    // A tiny number field for "how many thumbnails per row", sitting right next
    // to the thumbnail switch. Deliberately its own element with its own
    // listener — the switches' event handling is left completely alone.
    var columnsInput = null;

    function makeColumnsInput() {
      var wrap = document.createElement("span");
      wrap.className = "dsh-ig-cols";

      var lab = document.createElement("span");
      lab.className = "dsh-ig-cols-label";
      lab.textContent = "列";

      var inp = document.createElement("input");
      inp.type = "number";
      inp.min = "1";
      inp.max = "12";
      inp.step = "1";
      inp.className = "dsh-ig-cols-input";
      inp.value = String(TILE_COLUMNS);
      inp.title = "缩略图每行显示几张（1–12），填完按回车或点别处生效";

      var commit = function () {
        var v = parseInt(inp.value, 10);
        if (!isFinite(v)) v = TILE_COLUMNS;
        v = Math.max(1, Math.min(12, v));
        inp.value = String(v);
        if (v !== TILE_COLUMNS) setTileColumns(v);
      };
      inp.addEventListener("change", commit);
      inp.addEventListener("blur", commit);
      // Live update too: typing a new number and then clicking the thumbnail
      // switch straight away used to apply the OLD column count, because
      // `change` only fires on blur and the switch's own click ran first.
      inp.addEventListener("input", function () {
        var v = parseInt(inp.value, 10);
        if (isFinite(v) && v >= 1 && v <= 12 && v !== TILE_COLUMNS) setTileColumns(v);
      });
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { commit(); inp.blur(); }
        e.stopPropagation();          // never let the composer see typing
      });
      inp.addEventListener("mousedown", function (e) { e.stopPropagation(); });
      inp.addEventListener("click", function (e) { e.stopPropagation(); });

      wrap.appendChild(lab);
      wrap.appendChild(inp);
      columnsInput = wrap;
      return wrap;
    }

    // ── Toolbar in a popover ────────────────────────────────────────────────
    // Four controls in the composer row read as clutter. Following the pattern
    // used by dsh-model-fold: one compact trigger stays in the row, and the
    // controls live in a fixed-position panel that slides out on demand.
    //
    // The panel is our own node appended to <body>; the real controls are MOVED
    // into it (not duplicated), so there is still exactly one of each and every
    // existing behaviour keeps working untouched.
    var triggerBtn = null;
    var popover = null;
    var popoverOpen = false;

    function ensurePopover() {
      if (popover && document.body.contains(popover)) return popover;
      popover = document.createElement("div");
      popover.className = "dsh-ig-pop";
      popover.setAttribute("role", "dialog");
      popover.setAttribute("aria-label", "图片工具");
      // NO stopPropagation here. dsh-model-fold can get away with it because its
      // panel holds throwaway mirror elements it re-dispatches from; ours holds
      // the REAL controls, and a capture-phase stopPropagation on the panel
      // would stop every one of them from ever seeing a click. Outside-press
      // dismissal is handled by contains() checks instead (bindPopoverDismiss).
      document.body.appendChild(popover);
      return popover;
    }

    function openPopover() {
      var p = ensurePopover();
      if (!triggerBtn) return;
      // Render hidden first, measure, then place — otherwise the panel flashes
      // at the wrong spot for a frame.
      p.style.visibility = "hidden";
      p.classList.add("dsh-ig-pop-open");
      var r = triggerBtn.getBoundingClientRect();
      var pw = p.offsetWidth || 240;
      var ph = p.offsetHeight || 140;
      var left = Math.round(r.left);
      var top = Math.round(r.top - ph - 8);
      if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
      if (left < 8) left = 8;
      if (top < 8) top = Math.round(r.bottom + 8);      // flip below if no room
      p.style.left = left + "px";
      p.style.top = top + "px";
      p.style.visibility = "";
      popoverOpen = true;
      if (triggerBtn.classList) triggerBtn.classList.add("dsh-ig-switch-on");
    }

    function closePopover() {
      if (!popover) return;
      popover.classList.remove("dsh-ig-pop-open");
      popoverOpen = false;
      if (triggerBtn && triggerBtn.classList) triggerBtn.classList.remove("dsh-ig-switch-on");
    }

    function togglePopover() {
      if (popoverOpen) closePopover();
      else openPopover();
    }

    // Outside press / Escape closes it. Bound once per instance.
    function bindPopoverDismiss() {
      var onDown = function (e) {
        if (!popoverOpen) return;
        var t = e.target;
        if (popover && popover.contains && popover.contains(t)) return;
        if (triggerBtn && (t === triggerBtn || (triggerBtn.contains && triggerBtn.contains(t)))) return;
        closePopover();
      };
      var onKey = function (e) {
        if (popoverOpen && e.key === "Escape") closePopover();
      };
      try { document.addEventListener("mousedown", onDown, true); } catch (x) {}
      try { document.addEventListener("keydown", onKey, true); } catch (x) {}
    }

    function makeTrigger() {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "dsh-ig-switch dsh-ig-trigger";
      b.__dshClicks = 0;
      b.title = "图片工具：缩略图 / 隐藏 / 跳图";
      b.setAttribute("aria-label", b.title);
      var ic = document.createElement("span");
      ic.className = "dsh-ig-switch-icon";
      ic.textContent = "🖼";
      var tx = document.createElement("span");
      tx.className = "dsh-ig-trigger-text";
      tx.textContent = "图片";
      b.appendChild(ic);
      b.appendChild(tx);
      // Its own listener, independent of the switches' handling.
      b.addEventListener("click", function (e) {
        try { e.preventDefault(); } catch (x) {}
        try { e.stopPropagation(); } catch (x) {}
        b.__dshClicks = (b.__dshClicks || 0) + 1;
        togglePopover();
      });
      triggerBtn = b;
      return b;
    }

    // broken. Every action therefore runs inside a guard that reports the
    // failure to the console and then re-scans, so the button recovers by
    // itself instead of silently doing nothing forever.
    function guardAction(name, fn) {
      return function () {
        try {
          fn();
        } catch (err) {
          try {
            console.warn("[image-gallery] " + name + " failed:", err && err.message ? err.message : err);
          } catch (e) {}
          try {
            clearAllStyled();
            enhance(document.body);
          } catch (e2) {}
        }
      };
    }

    function guardedJumpPress(which) {
      try {
        onJumpPress(which);
      } catch (err) {
        try {
          console.warn("[image-gallery] 跳图 failed:", err && err.message ? err.message : err);
        } catch (e) {}
      }
    }

    // Reflect the current conversation-wide state on the switches.
    //
    // Every DOM write here MUST be guarded by a value comparison. Assigning
    // textContent replaces a text node — that is a childList mutation, the
    // observer fires, enhance() calls back into this function, and an unguarded
    // write turns into an endless scan loop that freezes the page.
    function paintSwitch(btn, on, onIcon, offIcon, onLabel, offLabel) {
      if (!btn || btn.__dshPainted === on) return;
      btn.__dshPainted = on;
      btn.classList.toggle("dsh-ig-switch-on", on);
      var ic = btn.querySelector(".dsh-ig-switch-icon");
      if (ic && ic.textContent !== (on ? onIcon : offIcon)) ic.textContent = on ? onIcon : offIcon;
      var tx = btn.lastChild;
      var want = on ? onLabel : offLabel;
      if (tx && tx.textContent !== want) tx.textContent = want;
    }

    function syncSwitchState() {
      var thumbOn = anyBlockIn("thumb");
      var hideOn = anyBlockIn("hidden");
      paintSwitch(switchThumb, thumbOn, "▣", "▦", "展开", "缩略图");
      paintSwitch(switchHide, hideOn, "▣", "⊘", "展开", "隐藏");

      // Self-report in the tooltip. The single most expensive part of debugging
      // this from the outside was not knowing what the page actually saw, and
      // asking the user to open devtools every round. Hovering the button now
      // answers it. Keyed fields, not bare numbers — a run of digits is
      // ambiguous when it is read back to someone else.
      var blocks = allBlocks();
      var n = 0;
      for (var i = 0; i < blocks.length; i++) n += blockImages(blocks[i]).length;
      var firstBlock = "无";
      try {
        var probe = document.querySelector("img.dsh-ig-img");
        if (probe) {
          var mc0 = messageContainer(probe);
          firstBlock = mc0 ? (mc0.tagName + (mc0.className ? "." + String(mc0.className).split(" ")[0] : "")) : "null";
        }
      } catch (e) { firstBlock = "err"; }

      // What the browser actually computed for the thumbnail container. This is
      // the one fact that separates "our inline styles never landed" from "they
      // landed but the layout says otherwise", and it is cheap to read here
      // because this only runs when the tooltip is being rewritten.
      var gridInfo = "无容器";
      try {
        var th = document.querySelector(".dsh-ig-thumbs");
        if (th) {
          var gcs = window.getComputedStyle(th);
          var cols = gcs.gridTemplateColumns || "none";
          var nCols = cols === "none" ? 0 : cols.split(" ").length;
          gridInfo = gcs.display + "/" + nCols + "列/宽" + Math.round(th.clientWidth) +
            "/子" + th.children.length;
        }
      } catch (e) { gridInfo = "err"; }

      var diag = "［构建=" + BUILD +
        " 状态=" + (thumbOn ? "缩略" : hideOn ? "隐藏" : "展开") +
        " 网格=" + gridInfo +
        " 块数=" + blocks.length +
        " 块内图=" + n +
        " 已增强图=" + document.querySelectorAll("img.dsh-ig-img").length +
        " 页内img=" + document.querySelectorAll("img").length +
        " 首块容器=" + firstBlock +
        " 末扫=见" + scanStats.lastImages + "增" + scanStats.lastEnhanced + "跳" + scanStats.lastSkipped +
        (lastSkipReason ? "(" + lastSkipReason + ")" : "") +
        " 点按钮次数=缩" + (switchThumb && switchThumb.__dshClicks || 0) +
        "/隐" + (switchHide && switchHide.__dshClicks || 0) +
        "/跳" + (switchJump && switchJump.__dshClicks || 0) +
        "］";
      if (switchThumb) {
        var tb = switchThumb.title.replace(/［[^］]*］/g, "").trim();
        switchThumb.title = tb + " " + diag;
      }
      if (switchHide) {
        var hb = switchHide.title.replace(/［[^］]*］/g, "").trim();
        switchHide.title = hb + " " + diag;
      }
    }

    // Remove every switch this module ever put in the DOM, except the three
    // handed in. When React rebuilds the anchor node, `previousSibling ===
    // anchor` fails, we insert a fresh trio, and the old trio is still sitting
    // in the DOM — so the composer row grows one full set per re-render. The
    // count check below is what makes that impossible.
    function pruneSwitches(keepA, keepB, keepC) {
      var all = document.querySelectorAll(".dsh-ig-switch");
      var removed = 0;
      for (var i = 0; i < all.length; i++) {
        var s = all[i];
        if (s === keepA || s === keepB || s === keepC) continue;
        if (s.parentNode) { s.remove(); removed++; }
      }
      return removed;
    }

    // Throttle: re-asserting the composer row costs a document-wide query, and
    // the observer can fire dozens of times per second while the host streams a
    // reply. A quarter-second cadence is far faster than any human notices and
    // keeps that query off the hot path.
    var lastSwitchAssert = 0;
    var SWITCH_ASSERT_MS = 250;

    function ensureSwitches() {
      var now = Date.now();
      if (now - lastSwitchAssert < SWITCH_ASSERT_MS) return;
      lastSwitchAssert = now;
      ensureSwitchesNow();
    }

    function ensureSwitchesNow() {
      // A hot reload leaves the previous module instance alive: its
      // MutationObserver keeps firing even though this module now owns the DOM.
      // Without this guard the two instances fight — each one prunes the
      // other's trio and re-inserts its own — and the composer row flickers
      // between three and six buttons. Only the newest instance may act.
      if (typeof window !== "undefined" && window.__dshIgInstance && window.__dshIgInstance !== INSTANCE_ID) return;
      var anchor = accessModeButton();
      var parent = anchor && (anchor.parentNode || anchor.parentElement);
      if (!anchor || !parent) return;

      // The row now carries ONE compact trigger; the four real controls live in
      // the popover. "In place" therefore means: our trigger sits right after
      // the access-mode control, and every control lives inside our popover.
      var pop = ensurePopover();
      var allSwitches = document.querySelectorAll(".dsh-ig-switch");
      var inPlace = triggerBtn && switchThumb && switchHide && switchJump && columnsInput &&
        allSwitches.length === 4 &&
        triggerBtn.parentNode === parent && triggerBtn.previousSibling === anchor &&
        switchThumb.parentNode === pop && columnsInput.parentNode === pop &&
        switchHide.parentNode === pop && switchJump.parentNode === pop;
      if (inPlace) {
        syncSwitchState();
        return;
      }

      // Clear anything stray (stale triggers, stale controls, stale popovers).
      var strays = document.querySelectorAll(".dsh-ig-switch");
      for (var st = 0; st < strays.length; st++) {
        var s = strays[st];
        if (s === triggerBtn || s === switchThumb || s === switchHide || s === switchJump) continue;
        if (s.parentNode) s.remove();
      }
      var strayCols = document.querySelectorAll(".dsh-ig-cols");
      for (var sc = 0; sc < strayCols.length; sc++) {
        if (strayCols[sc] !== columnsInput && strayCols[sc].parentNode) strayCols[sc].remove();
      }
      var strayPops = document.querySelectorAll(".dsh-ig-pop");
      for (var sp = 0; sp < strayPops.length; sp++) {
        if (strayPops[sp] !== pop && strayPops[sp].parentNode) strayPops[sp].remove();
      }

      if (!switchThumb) {
        switchThumb = makeSwitch("▦", "缩略图", "把所有图片收成缩略图", guardAction("缩略图", function () {
          toggleAllBlocks("thumb");
        }));
        switchHide = makeSwitch("⊘", "隐藏", "把所有图片隐藏起来", guardAction("隐藏", function () {
          toggleAllBlocks("hidden");
        }));
        switchJump = makeSwitch("⌖", "跳图", "左键=上一张，右键=下一张；左键三连=最远的一张，右键三连=最近的一张", guardAction("跳图", function () {
          onJumpPress("left");
        }));
        // Right click steps forward instead of opening the context menu.
        switchJump.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          e.stopPropagation();
          guardedJumpPress("right");
        });
        bindPopoverDismiss();
      }
      if (!columnsInput) makeColumnsInput();
      if (!triggerBtn) makeTrigger();

      // Controls live inside the popover, in order. insertBefore MOVES an
      // already-attached node, so this is safe on every pass.
      pop.appendChild(switchThumb);
      pop.appendChild(columnsInput);
      pop.appendChild(switchHide);
      pop.appendChild(switchJump);
      // The single trigger stays in the composer row.
      parent.insertBefore(triggerBtn, anchor.nextSibling);
      syncSwitchState();
    }

    // Same reasoning as the switch assert: this walks every enhanced image in
    // the document, which is cheap once and wasteful at streaming frequency.
    // User-initiated calls pass force=true so a click is never delayed.
    var lastFoldSync = 0;
    var FOLD_SYNC_MS = 200;

    function syncFoldState(force) {
      var now = Date.now();
      if (!force && now - lastFoldSync < FOLD_SYNC_MS) return;
      lastFoldSync = now;
      var blocks = allBlocks();
      for (var i = 0; i < blocks.length; i++) {
        var mc = blocks[i];
        var n = String(blockImages(mc).length);
        if (mc.dataset.dshIgCount !== n) mc.dataset.dshIgCount = n;
        // Re-apply the user's choice onto whatever node React is showing now.
        applyBlockMode(mc, blockMode(mc));
      }
    }

    function bindClick(img) {
      if (ownedImages && ownedImages.has(img)) return;
      if (ownedImages) ownedImages.add(img);

      img.addEventListener("click", function (e) {
        // A listener left over from a previous hot-reloaded module must not
        // act on the same click.
        if (img.dataset.dshIgOwner !== OWNER) return;
        e.preventDefault();
        e.stopPropagation();
        var mc = messageContainer(img);
        // A hidden/thumbnail block returns to full size on the first click; the
        // next click opens the lightbox. An expanded block goes straight there.
        if (mc && blockMode(mc) !== "open") {
          // Expanding one block also changes the conversation height; keep the
          // reader's place so the image does not end up above the viewport.
          var anchor = captureScrollAnchor();
          setBlockMode(mc, "open");
          syncSwitchState();
          restoreScrollAnchor(anchor);
          return;
        }
        var g = groupFor(img);
        open(g.list, g.index);
      });
    }

    // Multi-image messages become a nine-grid: a message block containing
    // >= 2 enhanced images (each in its own wrapper, or as direct children)
    // gets a CSS-grid class. Image-only wrappers get display:contents so
    // their <img> becomes a grid item; every other child (text paragraphs,
    // headings) spans the full grid row, so "caption text + N charts" lays
    // out as text on top, tiles below. Class-only — no nodes are created,
    // moved or removed; if React re-renders and drops the classes, images
    // degrade gracefully to the capped inline style until re-applied.
    function hasOwnText(el) {
      var kids = el.childNodes;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].nodeType === 3 && kids[i].textContent && kids[i].textContent.trim()) return true;
      }
      return false;
    }

    function isImgWrapper(kid) {
      return kid.children && kid.children.length === 1 && kid.children[0].tagName === "IMG" &&
             String(kid.children[0].className).indexOf("dsh-ig-img") >= 0;
    }

    function isGalleryContainer(mc) {
      if (!mc || mc === document.body) return false;
      var kids = mc.children;
      if (!kids || kids.length < 2) return false;
      var imgCount = 0;
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (kid.tagName === "IMG") {
          if (String(kid.className).indexOf("dsh-ig-img") >= 0) { imgCount++; continue; }
          return false;
        }
        if (kid.tagName === "BR") continue;
        if (isImgWrapper(kid)) { imgCount++; continue; }
      }
      return imgCount >= 2;
    }

    function markGallery(mc, marked) {
      var kids = mc.children;
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        if (kid.tagName === "IMG" || kid.tagName === "BR") continue;
        if (isImgWrapper(kid)) {
          if (marked && !kid.__dshPassMarked) { kid.classList.add("dsh-ig-pass"); kid.__dshPassMarked = true; }
          else if (!marked && kid.__dshPassMarked) { kid.classList.remove("dsh-ig-pass"); kid.__dshPassMarked = false; }
        } else if (marked && !kid.__dshSpanMarked) { kid.classList.add("dsh-ig-span"); kid.__dshSpanMarked = true; }
        else if (!marked && kid.__dshSpanMarked) { kid.classList.remove("dsh-ig-span"); kid.__dshSpanMarked = false; }
      }
    }

    function applyGalleries() {
      var imgs = document.querySelectorAll("img.dsh-ig-img");
      var seen = [];
      for (var i = 0; i < imgs.length; i++) {
        var mc = messageContainer(imgs[i]);
        if (!mc || mc === document.body || seen.indexOf(mc) >= 0) continue;
        if (mc.closest && mc.closest(".dsh-ig-backdrop")) continue;
        seen.push(mc);
        if (isGalleryContainer(mc)) {
          if (!mc.__dshGalleryMarked) { mc.classList.add("dsh-ig-gallery"); mc.__dshGalleryMarked = true; }
          markGallery(mc, true);
        } else if (mc.__dshGalleryMarked) {
          markGallery(mc, false);
          mc.classList.remove("dsh-ig-gallery");
          mc.__dshGalleryMarked = false;
        }
      }
    }

    // Scan statistics for the switches' self-report tooltip. Diagnosing this
    // from the outside was guesswork otherwise.
    var scanStats = { lastImages: 0, lastEnhanced: 0, lastSkipped: 0, scans: 0 };

    function enhance(root) {
      if (!root || typeof root.querySelectorAll !== "function") return;
      if (root.closest && root.closest(".dsh-ig-backdrop")) return;
      var nodes;
      if (root instanceof HTMLImageElement) {
        nodes = [root];
      } else {
        nodes = Array.prototype.slice.call(root.querySelectorAll("img"));
      }
      var touched = false;
      var added = 0, skipped = 0;
      for (var i = 0; i < nodes.length; i++) {
        var img = nodes[i];
        if (!(img instanceof HTMLImageElement) || !isChatImage(img)) { skipped++; continue; }
        img.dataset.dshIgEnhanced = "true";
        img.dataset.dshIgOwner = OWNER;
        img.classList.add("dsh-ig-img");
        // Remember the local file behind this image, if there is one. The
        // lightbox copy-path / show-in-folder buttons read this (via
        // localAbsPath) instead of re-parsing the possibly-re-signed URL later.
        var absPath = absFromUrl(img.src);
        if (absPath) img.dataset.dshIgPath = absPath;
        bindClick(img);
        touched = true;
        added++;
      }
      scanStats.lastImages = nodes.length;
      scanStats.lastEnhanced = added;
      scanStats.lastSkipped = skipped;
      scanStats.scans++;
      // Mode syncing must NOT be conditional on `touched`: the conversation is
      // a virtual list, so scrolling (e.g. after a jump) unmounts and remounts
      // message nodes. A remounted <img> is already owned by this module, so
      // isChatImage() skips it and `touched` stays false — yet its block still
      // needs to get the user's chosen mode applied. Only the (cheap) gallery
      // pass is gated on freshly enhanced images.
      if (touched) applyGalleries();
      syncFoldState();
      syncSwitchState();
    }

    // Guards against the observer re-entering itself while we are mid-scan and
    // writing classes of our own.
    var scanning = false;

    // Circuit breaker state: a sliding one-second window of scan counts.
    var scanWindowStart = 0;
    var scanWindowCount = 0;
    var SCAN_BUDGET_PER_SECOND = 60;

    // Returns false when the scan rate is impossible for genuine UI activity —
    // the signal of a feedback loop. Tripping it freezes our own scanning (the
    // page stays usable) and the window recovers on its own a second later.
    function scanBudget() {
      var now = Date.now();
      if (now - scanWindowStart > 1000) {
        scanWindowStart = now;
        scanWindowCount = 0;
      }
      scanWindowCount++;
      if (scanWindowCount > SCAN_BUDGET_PER_SECOND) {
        if (!scanBudgetTripped) {
          scanBudgetTripped = true;
          try {
            console.warn("[image-gallery] scan budget exceeded — pausing image scanning for 1s");
          } catch (e) {}
        }
        return false;
      }
      scanBudgetTripped = false;
      return true;
    }

    var scanBudgetTripped = false;

    function startObserver() {
      // Claim ownership first: any instance that already ran (a previous hot
      // reload) sees a different id from now on and stops touching the DOM.
      try { window.__dshIgInstance = INSTANCE_ID; } catch (e) {}

      // Install the stylesheet up front: the switches and the thumbnail strip
      // are pure CSS, so waiting for the first lightbox open would leave them
      // unstyled for anyone who has not clicked an image yet.
      injectStyles();

      // Restore the user's columns-per-row preference before anything renders.
      loadTileColumns();

      // Sweep away whatever a previous instance left behind, so a reload starts
      // from a clean row instead of stacking a second trio onto the first.
      var stale = document.querySelectorAll(".dsh-ig-switch");
      for (var s = 0; s < stale.length; s++) {
        if (stale[s].parentNode) stale[s].remove();
      }
      switchThumb = switchHide = switchJump = null;

      enhance(document.body);
      ensureSwitches();

      var observer = new MutationObserver(function (mutations) {
        // A superseded instance must not merely stay silent — it must get out of
        // the way entirely. Every extra live observer is called on every DOM
        // mutation forever, and a handful of them is enough to make the client
        // feel sluggish.
        if (window.__dshIgInstance !== INSTANCE_ID) {
          try { observer.disconnect(); } catch (e) {}
          return;
        }
        // Re-entrancy guard: our own DOM writes can queue further mutations, and
        // an unguarded handler would recurse through enhance() forever.
        if (scanning) return;
        // Circuit breaker. Whatever the cause (a feedback loop we have not
        // thought of, a pathological host re-render), a page that scans without
        // end is a frozen page. If scans arrive far faster than any real UI can
        // produce them, stop scanning for a while instead of taking the renderer
        // down with us.
        if (!scanBudget()) return;
        scanning = true;
        try {
          var sawComposer = false;
          var classVictims = [];
          for (var m = 0; m < mutations.length; m++) {
            var mutation = mutations[m];

            // Attribute mutations: React re-rendering a message writes its own
            // className onto the nodes, wiping the class we rely on. Watching
            // childList alone never noticed, so a re-rendered image stayed
            // un-enhanced forever — no block, no switch target, dead buttons.
            if (mutation.type === "attributes" && mutation.target) {
              var tgt = mutation.target;
              if (tgt.tagName === "IMG" && !tgt.classList.contains("dsh-ig-img")) {
                classVictims.push(tgt);
              } else if (tgt.children && tgt.children.length &&
                         !tgt.classList.contains("dsh-ig-thumbs") &&
                         tgt.querySelector && tgt.querySelector("img.dsh-ig-img")) {
                // A container that lost one of our layout classes.
                classVictims.push(tgt);
              }
              continue;
            }

            for (var n = 0; n < mutation.addedNodes.length; n++) {
              var node = mutation.addedNodes[n];
              if (node instanceof HTMLElement) {
                // 只扫新增节点本身，不回扫 parent，避免 React 局部重渲染时反复重标。
                enhance(node);
                // The composer re-renders on its own schedule; re-assert the
                // switches whenever anything new shows up.
                sawComposer = true;
              }
            }
          }

          if (classVictims.length) {
            for (var v = 0; v < classVictims.length; v++) {
              var victim = classVictims[v];
              if (victim.tagName === "IMG") {
                // Re-adopt this image: the stamp alone must not block recovery.
                enhance(victim);
              } else {
                enhance(victim);
              }
            }
            syncFoldState(true);
            sawComposer = true;
          }

          if (sawComposer) ensureSwitches();
        } finally {
          scanning = false;
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        // class changes matter as much as node changes: React owns className on
        // conversation nodes and will happily overwrite what we added.

      });
    }

    // ── display_image tool row (v1.7.0 toolview fix) ────────────────────────
    // DSH renders tool results as plain text — only the built-in read_image
    // tool gets the native image card (imageCardModel rejects every other
    // call name). The display_image tool returns markdown image URLs, which
    // therefore never became <img> nodes in the conversation. Fix: register a
    // keyed `tool.call.toolview` entry for display_image (the official DSH
    // extension point, same mechanism as read-image-toolview) and render the
    // image URLs as real <img> elements. The existing MutationObserver then
    // enhances them automatically (lightbox / thumbnails / hide).

    // React handle: the UMD loader can require("react") (see dsh-font-enhancer).
    var igReact = null;
    try {
      var igReactRaw = require("react");
      igReact = (igReactRaw && igReactRaw.default) || igReactRaw;
    } catch (e) { igReact = null; }
    if (!igReact) { try { igReact = window.React || null; } catch (e) {} }

    // Collect every {type:"text"} string under a tool-result content tree,
    // regardless of nesting depth (tool-result envelope vs flat blocks).
    function igCollectTexts(node, out) {
      if (node === null || node === void 0) return;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) igCollectTexts(node[i], out);
        return;
      }
      if (typeof node === "object") {
        if (node.type === "text" && typeof node.text === "string") out.push(node.text);
        for (var k in node) {
          if (k !== "text" && Object.prototype.hasOwnProperty.call(node, k)) igCollectTexts(node[k], out);
        }
      }
    }

    // Extract markdown image URLs like ![alt](http://...) from one text block.
    function igImageUrls(text) {
      var urls = [];
      var re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
      var m;
      while ((m = re.exec(text)) !== null) urls.push(m[1]);
      return urls;
    }

    function DisplayImageRow(props) {
      if (!igReact || !props || !props.block) return null;
      var texts = [];
      igCollectTexts(props.block.content, texts);
      var urls = [];
      for (var i = 0; i < texts.length; i++) {
        var found = igImageUrls(texts[i]);
        for (var j = 0; j < found.length; j++) urls.push(found[j]);
      }
      if (urls.length === 0) {
        // No markdown images: show the plain text the tool returned so the
        // information is never lost (matches the generic card behaviour).
        return igReact.createElement("div", {
          style: { whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--dsw-alias-label-secondary)", fontSize: "13px", lineHeight: "24px", padding: "8px 0" }
        }, texts.length ? texts.join("\n") : "display_image");
      }
      return igReact.createElement("div",
        { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "8px 0" } },
        urls.map(function (u, idx) {
          return igReact.createElement("img", {
            key: idx,
            src: u,
            alt: "",
            style: { display: "block", maxWidth: "100%", maxHeight: "min(460px, 64vh)", objectFit: "contain", borderRadius: "8px" }
          });
        })
      );
    }

    // ── Plugin entry ─────────────────────────────────────────────────────────

    exports.inject = ["slots"];

    exports.apply = function (ctx) {
      if (typeof document === "undefined") return;
      // Register a dedicated conversation row for display_image results.
      try {
        if (ctx && ctx.slots) {
          ctx.slots.inject("tool.call.toolview", function () {
            return ctx.slots.register({
              name: "tool.call.toolview",
              key: "display_image"
            }, DisplayImageRow);
          });
        }
      } catch (e) { try { console.warn("[image-gallery] toolview register failed", e); } catch (e2) {} }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startObserver, { once: true });
      } else {
        setTimeout(startObserver, 300);
      }
    };

    return module.exports;
  },
});
