# Changelog

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
