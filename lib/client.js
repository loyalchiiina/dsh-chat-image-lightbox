/**
 * dsh-image-gallery browser half — injects a lightbox overlay into the DSH
 * chat UI that enhances any rendered <img> element with:
 *   - Click to zoom (full-screen lightbox with backdrop)
 *   - Download button (direct download of the image)
 *   - Prev/next navigation when multiple images are present
 *   - Keyboard shortcuts (Escape to close, Arrow keys to navigate)
 *
 * Uses MutationObserver to watch for new <img> elements added to the chat
 * and attaches click handlers. Pure enhancement via DOM observation.
 *
 * @module @loyalchiiina/dsh-image-gallery/client
 */

window.__ModuleLoader__.load({
  id: "@loyalchiiina/dsh-image-gallery",
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
      "  cursor: zoom-out;",
      "}",
      ".dsh-ig-lightbox img.dsh-ig-zoomed {",
      "  cursor: zoom-out;",
      "  max-width: none; max-height: none;",
      "  transform-origin: center center;",
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
      "/* ── Chat image enhancement ───────────────────────────────────────── */",
      ".dsh-ig-enhanced {",
      "  cursor: zoom-in !important;",
      "  transition: box-shadow 0.15s, transform 0.15s;",
      "}",
      ".dsh-ig-enhanced:hover {",
      "  box-shadow: 0 2px 12px rgba(0,0,0,0.25);",
      "  transform: scale(1.01);",
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
      lightboxImg.addEventListener("click", function () { close(); });
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
      document.body.style.overflow = "";
      if (lastFocused && lastFocused.focus) { lastFocused.focus(); lastFocused = null; }
    }

    function navigate(delta) {
      if (currentImages.length <= 1) return;
      currentIndex = (currentIndex + delta + currentImages.length) % currentImages.length;
      updateDisplay();
    }

    function prefetchNeighbors() {
      if (currentImages.length <= 1) return;
      var prev = currentImages[(currentIndex - 1 + currentImages.length) % currentImages.length];
      var next = currentImages[(currentIndex + 1) % currentImages.length];
      [prev, next].forEach(function (n) {
        if (n && n.src) { var im = new Image(); im.src = n.src; }
      });
    }

    function updateDisplay() {
      if (!lightboxImg || !currentImages[currentIndex]) return;
      var img = currentImages[currentIndex];
      lightboxImg.src = img.src;
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
      var fallbackName = sanitizeName(img.src, img.alt, "");
      fetch(img.src).then(function (r) { return r.blob(); }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var name = sanitizeName(img.src, img.alt, blob.type) || fallbackName;
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
        window.open(img.src, "_blank");
      });
    }

    // ── MutationObserver: enhance chat images ────────────────────────────────

    var allImages = [];

    function isChatImage(img) {
      if (img.width < 80 && img.height < 80 && img.naturalWidth < 200) return false;
      if (img.dataset.dshIgEnhanced === "true") return false;
      if (!img.src || img.src.indexOf("data:image/svg") === 0) return false;
      return true;
    }

    function enhanceImage(img) {
      img.dataset.dshIgEnhanced = "true";
      img.classList.add("dsh-ig-enhanced");
      allImages.push(img);

      img.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var group = collectGroup(img);
        var idx = group.indexOf(img);
        open(group, Math.max(0, idx));
      });
    }

    function collectGroup(_img) {
      return allImages.filter(function (el) { return el.isConnected; });
    }

    function scanForImages(root) {
      var imgs = root.querySelectorAll("img");
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (img instanceof HTMLImageElement && isChatImage(img)) {
          enhanceImage(img);
        }
      }
    }

    function startObserver() {
      scanForImages(document.body);

      var observer = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          var mutation = mutations[m];
          for (var n = 0; n < mutation.addedNodes.length; n++) {
            var node = mutation.addedNodes[n];
            if (node instanceof HTMLElement) {
              if (node.tagName === "IMG" && node instanceof HTMLImageElement && isChatImage(node)) {
                enhanceImage(node);
              } else {
                scanForImages(node);
              }
            }
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setInterval(function () {
        scanForImages(document.body);
      }, 3000);
    }

    // ── Plugin entry ─────────────────────────────────────────────────────────

    exports.inject = [];

    exports.apply = function () {
      if (typeof document === "undefined") return;
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startObserver, { once: true });
      } else {
        setTimeout(startObserver, 500);
      }
    };

    return module.exports;
  },
});
