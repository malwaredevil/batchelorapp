---
name: Screenshot tool mislays position:fixed elements on tall pages
description: app_preview screenshots lay out fixed-position elements against full document scrollHeight, not the real viewport, on pages taller than the viewport — a capture-tool artifact, not an app bug.
---

On any page where `document.scrollHeight` > `window.innerHeight`, the `app_preview` screenshot tool renders `position: fixed` elements (e.g. floating chat widgets, fixed toolbars) positioned relative to the full document height instead of the visible viewport — pushing them far below the visible crop even though the CSS is completely correct.

Proof pattern: instrument the element with `getBoundingClientRect()` + `window.innerHeight` + `document.scrollHeight`. If `rect.top` (or `bottom`) exactly equals `scrollHeight` (or scrollHeight minus a small fixed offset) regardless of `innerHeight`, and the full ancestor chain from the element to `<html>` all computes `position: static`/`transform: none`/`filter: none`/`contain: none` (i.e. no real containing-block override anywhere), this is the capture artifact, not a CSS bug. Confirmed by testing multiple pages of the same app at different scrollHeights — short pages (scrollHeight ≈ innerHeight) show the element in the correct visible position, tall pages push it out, even though the component code is identical.

**Why:** Wastes significant debugging time chasing a phantom "missing fixed widget" bug across CSS/layout/ancestor chains when the real component is fine. It is almost certainly `captureBeyondViewport`/full-page-capture behavior in the underlying browser automation, which sets layout viewport height to the full document height for the screenshot but doesn't reflect that in `window.innerHeight` as reported to JS.

**How to apply:** Before concluding a `position:fixed` element is "not rendering" or "not visible" based on an `app_preview` screenshot on a page taller than one viewport, add a temporary rect/ancestor-chain console log and compare across a short page and a tall page of the same app. If the numbers match this pattern, the app is fine — don't chase a CSS fix. Real end users browsing in an actual (non-full-page-capture) browser viewport will see it correctly.
