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

    function ensureLightbox() {
      if (backdrop) return;

      var style = document.createElement("style");
      style.textContent = CSS;
      document.head.appendChild(style);

      backdrop = document.createElement("div");
      backdrop.className = "dsh-ig-backdrop";
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

      var dlBtn = document.createElement("button");
      dlBtn.innerHTML = "⬇";
      dlBtn.title = "下载图片";
      dlBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        downloadCurrent();
      });
      toolbar.appendChild(dlBtn);

      var closeBtn = document.createElement("button");
      closeBtn.innerHTML = "✕";
      closeBtn.title = "关闭 (Esc)";
      closeBtn.addEventListener("click", function () { close(); });
      toolbar.appendChild(closeBtn);

      prevBtn = document.createElement("button");
      prevBtn.className = "dsh-ig-nav dsh-ig-prev dsh-ig-hidden";
      prevBtn.innerHTML = "‹";
      prevBtn.title = "上一张";
      prevBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        navigate(-1);
      });

      nextBtn = document.createElement("button");
      nextBtn.className = "dsh-ig-nav dsh-ig-next dsh-ig-hidden";
      nextBtn.innerHTML = "›";
      nextBtn.title = "下一张";
      nextBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        navigate(1);
      });

      counterEl = document.createElement("div");
      counterEl.className = "dsh-ig-counter dsh-ig-hidden";

      backdrop.appendChild(lightbox);
      backdrop.appendChild(toolbar);
      backdrop.appendChild(prevBtn);
      backdrop.appendChild(nextBtn);
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
      currentImages = images;
      currentIndex = index;
      updateDisplay();
      backdrop.classList.add("dsh-ig-open");
      document.body.style.overflow = "hidden";
    }

    function close() {
      if (!backdrop) return;
      backdrop.classList.remove("dsh-ig-open");
      document.body.style.overflow = "";
    }

    function navigate(delta) {
      if (currentImages.length <= 1) return;
      currentIndex = (currentIndex + delta + currentImages.length) % currentImages.length;
      updateDisplay();
    }

    function updateDisplay() {
      if (!lightboxImg || !currentImages[currentIndex]) return;
      var img = currentImages[currentIndex];
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt || "";

      var hasMultiple = currentImages.length > 1;
      if (prevBtn) prevBtn.classList.toggle("dsh-ig-hidden", !hasMultiple);
      if (nextBtn) nextBtn.classList.toggle("dsh-ig-hidden", !hasMultiple);
      if (counterEl) counterEl.classList.toggle("dsh-ig-hidden", !hasMultiple);
      if (hasMultiple && counterEl) {
        counterEl.textContent = (currentIndex + 1) + " / " + currentImages.length;
      }
    }

    function downloadCurrent() {
      var img = currentImages[currentIndex];
      if (!img) return;
      var filename = img.alt || img.src.split("/").pop() || "image.png";
      // Same-origin blob download forces save-as dialog
      // For cross-origin images, fetch through our own proxy route
      var fetchUrl = img.src;
      try {
        var imgOrigin = new URL(img.src).origin;
        if (imgOrigin !== window.location.origin) {
          // Cross-origin: proxy through /images/ route if possible,
          // otherwise use blob fetch
          fetchUrl = img.src;
        }
      } catch (e) {}
      fetch(fetchUrl).then(function (r) { return r.blob(); }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = filename;
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
