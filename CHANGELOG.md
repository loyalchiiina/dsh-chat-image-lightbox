# Changelog

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
