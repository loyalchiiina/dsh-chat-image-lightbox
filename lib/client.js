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
      ".dsh-ig-toolbar {",
      "  position: fixed; top: 20px; right: 20px; z-index: 10001;",
      "  display: flex; gap: 8px;",
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
      "}",
      ".dsh-ig-toolbar button:hover {",
      "  background: rgba(255,255,255,0.3);",
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
      /* 未放大看图（lightbox 未开）时，隐藏所有悬浮控件（导航/下载/关闭/计数/标题），
         避免在对话界面留下"切换图片/下载/关图"等按钮，影响布局美观。 */
      ".dsh-ig-backdrop:not(.dsh-ig-open) .dsh-ig-toolbar,",
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
    var prevBtn = null;
    var nextBtn = null;
    var counterEl = null;
    var currentImages = [];
    var currentIndex = 0;
    var lastFocused = null;
    var captionEl = null;
    var zoomScale = 1;
    var panX = 0;
    var panY = 0;

    function makeBtn(className, html, title, handler, ariaLabel) {
      var b = document.createElement("button");
      if (className) b.className = className;
      b.innerHTML = html;
      if (title) b.title = title;
      if (ariaLabel) b.setAttribute("aria-label", ariaLabel);
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        handler(e);
      });
      return b;
    }

    function ensureLightbox() {
      if (backdrop) return;

      // Live patch reload can leave a previous module instance's backdrop
      // orphaned in the DOM; drop stale ones so two toolbars never stack.
      var stale = document.querySelectorAll(".dsh-ig-backdrop");
      for (var i = 0; i < stale.length; i++) stale[i].remove();

      var style = document.createElement("style");
      style.textContent = CSS;
      document.head.appendChild(style);

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

      toolbar.appendChild(makeBtn("", "⬇", "下载图片", function () { downloadCurrent(); }, "下载图片"));
      toolbar.appendChild(makeBtn("", "✕", "关闭 (Esc)", function () { close(); }, "关闭"));

      prevBtn = makeBtn("dsh-ig-nav dsh-ig-prev dsh-ig-hidden", "‹", "上一张", function () { navigate(-1); }, "上一张");
      nextBtn = makeBtn("dsh-ig-nav dsh-ig-next dsh-ig-hidden", "›", "下一张", function () { navigate(1); }, "下一张");

      backdrop.appendChild(lightbox);
      backdrop.appendChild(toolbar);
      backdrop.appendChild(prevBtn);
      backdrop.appendChild(nextBtn);

      counterEl = document.createElement("div");
      counterEl.className = "dsh-ig-counter";

      captionEl = document.createElement("div");
      captionEl.className = "dsh-ig-caption";

      backdrop.appendChild(counterEl);
      backdrop.appendChild(captionEl);
      document.body.appendChild(backdrop);

      document.addEventListener("keydown", function (e) {
        if (!backdrop || !backdrop.classList.contains("dsh-ig-open")) return;
        if (e.key === "Escape") close();
        else if (e.key === "ArrowLeft") navigate(-1);
        else if (e.key === "ArrowRight") navigate(1);
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

    function isChatImage(img) {
      if (!img || !img.src) return false;
      if (img.src.indexOf("data:image/svg") === 0) return false;
      if (img.closest && img.closest(".dsh-ig-backdrop")) return false;
      if (img.dataset.dshIgEnhanced === "true") return false;
      // 可测量时过滤掉小图标/头像；还没加载完（naturalWidth=0）的图照常增强，
      // 避免因为"扫描时还没加载"而永久漏掉。
      if (img.naturalWidth > 0 && (img.naturalWidth < 64 || img.naturalHeight < 64)) return false;
      if (img.closest && img.closest("button")) return false;
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

    function bindClick(img) {
      if (img.__dshClickBound) return;
      img.__dshClickBound = true;
      img.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
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
      for (var i = 0; i < nodes.length; i++) {
        var img = nodes[i];
        if (!(img instanceof HTMLImageElement) || !isChatImage(img)) continue;
        img.dataset.dshIgEnhanced = "true";
        img.classList.add("dsh-ig-img");
        bindClick(img);
        touched = true;
      }
      if (touched) applyGalleries();
    }

    function startObserver() {
      enhance(document.body);

      var observer = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          var mutation = mutations[m];
          for (var n = 0; n < mutation.addedNodes.length; n++) {
            var node = mutation.addedNodes[n];
            if (node instanceof HTMLElement) {
              // 只扫新增节点本身，不回扫 parent，避免 React 局部重渲染时反复重标。
              enhance(node);
            }
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    // ── Plugin entry ─────────────────────────────────────────────────────────

    exports.inject = [];

    exports.apply = function () {
      if (typeof document === "undefined") return;
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startObserver, { once: true });
      } else {
        setTimeout(startObserver, 300);
      }
    };

    return module.exports;
  },
});
