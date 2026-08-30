/**
 * dsh-image-gallery browser half — injects a lightbox overlay AND an
 * auto-collapsing thumbnail grid into the DSH chat UI.
 *
 * Features:
 *   - Multi-image messages collapse into a thumbnail grid (small thumbnails,
 *     ~160px, several per row) so the chat does not blow up with huge images.
 *   - Click any thumbnail -> full-screen lightbox with backdrop.
 *   - Prev/next navigation (+ touch swipe) across the same group.
 *   - Zoom / pan, download button, keyboard shortcuts.
 *   - Single images still get click-to-zoom enhancement.
 *
 * Pure enhancement via DOM observation — never restructures the chat DOM,
 * only toggles CSS classes on the IMGs, so DSH's own virtual list stays intact.
 *
 * @module @loyalchiiina/dsh-chat-image-lightbox/client
 */

window.__ModuleLoader__.load({
  id: "@loyalchiiina/dsh-chat-image-lightbox",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    // ── CSS (injected once) ──────────────────────────────────────────────────
    // Thumbnail grid: within one message container, consecutive chat images
    // collapse into a small multi-row grid (thumbnails), NEVER full-width.

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
      "/* ── Counter ──────────────────────────────────────────────────────── */",
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
      "/* ── Caption ──────────────────────────────────────────────────────── */",
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
      "/* ── Chat image: thumbnail grid (multi-image message) ──────────────── */",
      /* We PHYSICALLY move the group of images into our own CSS Grid container
         so they ALWAYS line up in an even, tidy grid — a fixed set of columns
         (2/3/4 per row) with equal sized, aligned tiles. The lightbox shows the
         full-resolution original for zoom. */
      ".dsh-ig-grid {",
      "  display: grid;",
      "  grid-template-columns: repeat(3, 1fr);",
      "  gap: 8px;",
      "  align-items: stretch;",
      "  justify-content: start;",
      "  padding: 4px 0; margin: 4px 0;",
      "  max-width: 100%;",
      "}",
      ".dsh-ig-grid > img, .dsh-ig-grid > p, .dsh-ig-grid > div {",
      "  min-width: 0; min-height: 0;",
      "  width: 100%; margin: 0; padding: 0;",
      "  box-sizing: border-box;",
      "}",
      ".dsh-ig-grid > img, .dsh-ig-grid > * img {",
      "  display: block !important;",
      "  width: 100% !important; height: 140px !important;",
      "  min-width: 100% !important; max-width: 100% !important;",
      "  object-fit: cover; object-position: center;",
      "  border-radius: 8px; margin: 0 auto;",
      "  box-sizing: border-box; cursor: zoom-in !important;",
      "}",
      ".dsh-ig-grid > * img:not(.dsh-ig-grid-img-link):hover { box-shadow: 0 4px 16px rgba(0,0,0,0.25); }",
      "/* Single image (same message has only one image): keep click-to-zoom but cap width */",
      ".dsh-ig-enhanced {",
      "  cursor: zoom-in !important;",
      "  transition: box-shadow 0.15s, transform 0.15s;",
      "  max-width: 100%; height: auto;",
      "}",
      ".dsh-ig-enhanced:hover {",
      "  box-shadow: 0 2px 12px rgba(0,0,0,0.25);",
      "  transform: scale(1.01);",
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
      counterEl.className = "dsh-ig-counter dsh-ig-hidden";

      captionEl = document.createElement("div");
      captionEl.className = "dsh-ig-caption dsh-ig-hidden";

      backdrop.appendChild(counterEl);
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
      zoomScale = 1; panX = 0; panY = 0;
      if (lightboxImg) {
        lightboxImg.classList.remove("dsh-ig-zoomed");
        lightboxImg.style.transform = "";
        lightboxImg.style.cursor = "zoom-in";
        lightboxImg.src = "";
      }
      document.body.style.overflow = "";
      if (lastFocused && lastFocused.focus) { lastFocused.focus(); lastFocused = null; }
    }

    function navigate(delta) {
      if (currentImages.length <= 1) return;
      currentIndex = (currentIndex + delta + currentImages.length) % currentImages.length;
      updateDisplay();
    }

    // ── URL helpers for the thumbnail <-> original toggle ─────────────────
    // The grid renders a fast `?w=` compressed URL. Each img keeps its
    // full-resolution src (minus the resize param) so the lightbox can switch.
    function stripResizeParam(src) {
      if (!src || src.indexOf("?") < 0) return src || "";
      return src.replace(/([?&])w=\d+(&|$)/, function (m, pre, post) {
        return post === "&" ? pre === "?" ? "?" : "&" : pre === "?" ? "" : "";
      });
    }
    function isLocalImagePath(src) {
      return src && src.indexOf("/images/") >= 0;
    }
    // Current image's original (full-res) URL, if known.
    function currentOriginal() {
      var img = currentImages[currentIndex];
      if (!img) return null;
      if (img.dataset && img.dataset.dshOrigSrc) return img.dataset.dshOrigSrc;
      return stripResizeParam(img.src) || img.src;
    }
    // Fast thumbnail URL for /images/* (used only as the grid display src if
    // the chat supplied a big un-resized one — keeps idle display snappy).
    function thumbnailSrcFor(src) {
      if (!isLocalImagePath(src)) return src;
      if (/[?&]w=/.test(src)) return src;
      return src + (src.indexOf("?") >= 0 ? "&w=600" : "?w=600");
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
      // 直接加载高清原图：优先用折叠时固化的原图 URL（dataset.dshOrigSrc，已去 ?w=），
      // 打开就是原图，放大也是原图。
      var orig = (img.dataset && img.dataset.dshOrigSrc) || currentOriginal();
      var finalSrc = (orig && orig !== img.src) ? orig : img.src;
      lightboxImg.src = finalSrc;
      zoomScale = 1; panX = 0; panY = 0; applyZoom();
      lightboxImg.alt = img.alt || "";
      prefetchNeighbors();
      var cap = sanitizeName(img.src, img.alt, "") || "image";
      if (captionEl) {
        captionEl.textContent = cap;
        captionEl.classList.remove("dsh-ig-hidden");
      }

      var hasMultiple = currentImages.length > 1;
      if (prevBtn) prevBtn.classList.toggle("dsh-ig-hidden", !hasMultiple);
      if (nextBtn) nextBtn.classList.toggle("dsh-ig-hidden", !hasMultiple);
      if (counterEl) counterEl.classList.toggle("dsh-ig-hidden", !hasMultiple);
      if (hasMultiple && counterEl) {
        counterEl.textContent = (currentIndex + 1) + " / " + currentImages.length;
      }
    }

    function sanitizeName(src, alt, mime) {
      var base = (alt || "").trim() || (src || "").split("/").pop() || "image";
      base = base.replace(/[?#].*$/, "").replace(/[\\/:*?"<>|]/g, "_").trim();
      if (!base) base = "image";
      var ext = (base.split(".").pop() || "").toLowerCase();
      var want = (mime || "").split("/")[1] || "";
      var map = { jpeg: "jpg", png: "png", gif: "gif", webp: "webp", bmp: "bmp", svg: "svg", "x-icon": "ico" };
      var mapped = map[want] || "";
      if (!ext && mapped) base = base + "." + mapped;
      return base;
    }

    function downloadCurrent() {
      var img = currentImages[currentIndex];
      if (!img) return;
      // Always download the full-resolution original (strip the ?w= thumbnail
      // param), so the saved file is the original format/quality, not a webp
      // compressed thumbnail.
      var originalUrl = currentOriginal() || img.src;
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

    // ── MutationObserver: enhance chat images into thumbnail grids ──────────

    var allImages = [];

    function isChatImage(img) {
      // 本地 /images/ 图（由本插件服务的）总是增强，不因"图片还没加载完（naturalWidth=0）
      // 或布局宽度暂小"而跳过——否则 grid 会被延迟成"先一列、加载完才 3×3"。
      // 仅对未知外部 URL 用尺寸做小图标过滤，避免误增强头像等。
      if (!img.src) return false;
      if (img.src.indexOf("data:image/svg") === 0) return false;
      if (img.dataset.dshIgEnhanced === "true") return false;
      var local = img.src.indexOf("/images/") >= 0;
      if (!local) {
        if (img.width < 80 && img.height < 80 && img.naturalWidth < 200) return false;
      }
      return true;
    }

    // Find the nearest "message block" container: walk up from the image until
    // we hit a block-level ancestor that plausibly delimits a single chat
    // message. We do NOT rely on DSH class names — we use the heuristic that a
    // message block is the nearest ancestor that contains this image and whose
    // own parent already contains text/other structures of the same message, OR
    // simply the nearest block ancestor that is a direct child of a container
    // that also wraps other messages. In practice the safest stop is the
    // nearest element whose width is bounded and that is a direct candidate to
    // wrap "one user/assistant bubble".
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
      return p && p !== document.body && p !== document.documentElement ? p : document.body;
    }

    // Return true when `a`'s wrapper can be reached from `b`'s wrapper by walking
    // siblings (so they visually run consecutively in one message), regardless
    // of how the host wraps each markdown image.
    function areAdjacent(imgA, imgB) {
      if (!imgA || !imgB) return false;
      var pa = imgA.parentElement, pb = imgB.parentElement;
      if (!pa || !pb || pa === pb) return pa === pb;
      // walk siblings from pa: if we reach pb at all, they belong to the same
      // consecutive run (thin wrappers / separate <p> per image all count).
      var node = pa;
      while ((node = node.nextElementSibling)) {
        if (node === pb) return true;
      }
      return false;
    }

    // Group images by consecutive sibling runs. Two images belong to one group
    // when they are adjacent in the DOM (see areAdjacent) — regardless of how
    // the host wraps each markdown image. This is robust to DSH rendering each
    // image in its own <p>/<div>.
    function runGroups(imgs) {
      // order by document order
      imgs.sort(function (a, b) {
        if (a === b) return 0;
        return (a.compareDocumentPosition && b.compareDocumentPosition) ? (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1) : a.src < b.src ? -1 : 1;
      });
      var groups = [];
      var cur = [];
      var prev = null;
      imgs.forEach(function (img) {
        if (prev && areAdjacent(prev, img)) {
          cur.push(img);
        } else {
          if (cur.length) groups.push(cur);
          cur = [img];
        }
        prev = img;
      });
      if (cur.length) groups.push(cur);
      return groups;
    }

    // Physically rebuild a group into our own flex container so the thumbnails
    // ALWAYS flow horizontally, independent of how the host wraps each image.
    function rebuildGrid(group) {
      var first = group[0];
      var refNode = first.parentElement || first;
      var parent = refNode.parentNode || (refNode.parentElement || document.body);
      var grid = document.createElement("div");
      grid.className = "dsh-ig-grid";
      grid.__dshOrigParent = parent;
      grid.__dshAnchor = refNode;
      parent.insertBefore(grid, refNode);
      // 2) move each img (or its sole-child wrapper) into the grid.
      group.forEach(function (img) {
        var wrap = img.parentElement;
        var solo = wrap && wrap !== document.body && wrap !== document.documentElement &&
                   wrap.childNodes && Array.prototype.filter.call(wrap.childNodes, function (n) { return n.nodeType === 1; }).length === 1;
        if (solo) {
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
          grid.appendChild(wrap);
        } else {
          if (img.parentNode) img.parentNode.removeChild(img);
          grid.appendChild(img);
        }
      });
      // 3) drop residual empty wrappers that are no longer in the grid.
      group.forEach(function (img) {
        img.__dshGridEl = grid;
        // 记录原图 URL（去掉任何 ?w=），lightbox 打开直接用它加载高清原图
        img.dataset.dshOrigSrc = stripResizeParam(img.src) || img.src;
        // 网格显示用适度缩略图（快+清晰），避免把 8MB 原图压成小格子（视觉压缩/模糊/慢）
        var gridSrc = thumbnailSrcFor(img.src);
        if (gridSrc && gridSrc !== img.src) img.src = gridSrc;
        var w = img.parentElement;
        if (w && w !== grid && w.childNodes && w.childNodes.length === 0 && w.tagName !== "BODY" && w.parentNode) {
          w.parentNode.removeChild(w);
        }
      });
      return grid;
    }

    // Enhance a set of images into horizontally-flowing thumbnail grids.
    // Handles two real shapes the host can render:
    //   (a) multiple imgs in one <p>  (b) each img in its own adjacent <p>/<div>
    // Single-frame groups just get click-to-zoom.
    // 分批命中：若本批次图片紧邻某个已折叠的旧 grid（同一消息分批渲染），
    // 先把该 grid 拆开，与本批次合并后统一重建，保证最终只有一个 3×3 网格。
    function enhanceGroup(imgs) {
      imgs.forEach(function (img) { img.dataset.dshIgEnhanced = "true"; allImages.push(img); });

      // 分批命中：新到达的图片若与已存在的 grid 属于同一消息（紧邻兄弟），
      // 直接把它们并入该 grid 尾部并更新列数，避免散成多个 grid。
      var merged = [];
      imgs.forEach(function (img) {
        var g = adjacentGridOf(img);
        if (g) {
          merged.push(img);
          appendToGrid(g, img);
        }
      });
      // 未并入已有 grid 的剩余图片正常分组折叠
      var fresh = imgs.filter(function (im) { return merged.indexOf(im) < 0; });
      if (fresh.length) {
        var runs = runGroups(fresh);
        runs.forEach(function (group) {
          buildGroupGrid(group);
        });
      }
    }

    // 新图所在容器的相邻兄弟里是否存在已折叠的 grid
    function adjacentGridOf(img) {
      var wrap = img.parentElement;
      if (!wrap) return null;
      var sib = wrap;
      while (sib) {
        if (sib.tagName === "DIV" && String(sib.className || "").indexOf("dsh-ig-grid") >= 0 && sib !== wrap) return sib;
        sib = sib.previousElementSibling;
      }
      return null;
    }

    // 把一张新图（连同其 solo wrapper）追加进已有 grid 尾部
    function appendToGrid(grid, img) {
      var wrap = img.parentElement;
      var solo = wrap && wrap !== document.body && wrap !== document.documentElement &&
                 wrap.childNodes && Array.prototype.filter.call(wrap.childNodes, function (n) { return n.nodeType === 1; }).length === 1;
      if (solo) { grid.appendChild(wrap); }
      else { grid.appendChild(img); }
      img.classList.remove("dsh-ig-enhanced");
      img.classList.add("dsh-ig-grid-img");
      img.__dshGridEl = grid;
      img.dataset.dshOrigSrc = stripResizeParam(img.src) || img.src;
      var gridSrc = thumbnailSrcFor(img.src);
      if (gridSrc && gridSrc !== img.src) img.src = gridSrc;
      rebindClick(img);
      grid.style.gridTemplateColumns = "repeat(" + Math.max(1, Math.min(3, gridImgCount(grid))) + ", 1fr)";
    }

    function gridImgCount(grid) {
      var n = 0;
      (function walk(el) { (el.children || []).forEach(function (ch) { if (ch.tagName === "IMG") n++; else walk(ch); }); })(grid);
      return n;
    }

    function rebindClick(img) {
      // 防止重复绑定
      img.__dshRebound = true;
      img.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var grid = img.__dshGridEl;
        var live = [];
        if (grid) {
          (function walk(el) { (el.children || []).forEach(function (ch) { if (ch.tagName === "IMG") live.push(ch); else walk(ch); }); })(grid);
        }
        var idx = live.indexOf(img);
        open(live.length ? live : [img], Math.max(0, idx));
      });
    }

    // 把一组图折叠成 grid（组内 ≥2 张才折叠；否则单图增强）。
    function buildGroupGrid(group) {
      var list = group.filter(function (el) { return el.isConnected; });
      if (list.length === 0) return;

      if (list.length >= 2) {
        var bound = list.slice();
        list.forEach(function (img) { img.__dshGridEl = null; rebindClickToList(img, bound); });
        var grid = rebuildGrid(list);
        var cols = Math.max(1, Math.min(3, list.length));
        grid.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
      } else {
        list[0].classList.add("dsh-ig-enhanced");
        list[0].addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          open([list[0]], 0);
        });
      }
    }

    // grid 内图片的点击绑定（bound 是创建时的组快照，用于在组内切换）
    function rebindClickToList(img, bound) {
      img.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var live = bound.filter(function (el) { return el.isConnected; });
        var idx = live.indexOf(img);
        open(live.length ? live : [img], Math.max(0, idx));
      });
    }

    // Stable identity for a DOM node (avoid object-as-key pitfalls).
    function keyId(node) {
      if (!node.__dshIgKey) {
        node.__dshIgKey = "n" + (allImages.length + 1000) + "_" + (Math.random() * 1e9 | 0).toString(36);
      }
      return node.__dshIgKey;
    }

    function collectGroup(_img) {
      return allImages.filter(function (el) { return el.isConnected; });
    }

    // 收集（不立即分组）候选图片，用 debounce 统一折叠，保证同一条消息的
    // 多张图一次成型（成完整的 3×3 网格），避免"先一张一张/先一列、再慢慢变 3×3"。
    var pendingImgs = [];
    var pendingTimer = null;

    function collectImages(root) {
      if (!root || typeof root.querySelectorAll !== "function") return;
      var nodes = root.querySelectorAll("img");
      for (var i = 0; i < nodes.length; i++) {
        var img = nodes[i];
        if (img instanceof HTMLImageElement && isChatImage(img)) {
          pendingImgs.push(img);
        }
      }
    }

    function flushPending() {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      if (!pendingImgs.length) return;
      var batch = pendingImgs.filter(function (el) { return el.isConnected; });
      pendingImgs = [];
      if (batch.length) enhanceGroup(batch);
    }

    function enqueue(root, afterImmediate) {
      collectImages(root);
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(flushPending, afterImmediate === false ? 0 : 600);
    }

    function scanForImages(root) {
      enqueue(root);
    }

    function startObserver() {
      enqueue(document.body, false);

      var observer = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          var mutation = mutations[m];
          for (var n = 0; n < mutation.addedNodes.length; n++) {
            var node = mutation.addedNodes[n];
            if (node instanceof HTMLElement) {
              if (node.tagName === "IMG" && node instanceof HTMLImageElement) {
                collectImages(node.parentElement || node);
              } else {
                collectImages(node);
              }
            }
          }
        }
        // 同批变化统一 debounce 一次成型
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(flushPending, 600);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setInterval(function () {
        enqueue(document.body, false);
      }, 2000);
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
