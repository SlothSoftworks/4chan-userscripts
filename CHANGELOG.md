# Changelog

Each script has its own `@namespace`/`@version` and updates independently. When you
change a script:

1. Bump its `@version` in the script's own `==UserScript==` header (Tampermonkey
   uses this to detect updates — if you forget, installed copies won't update).
2. Add a dated entry below, under that script's section.

## 4chan Captcha Assistant

### 1.2.0 — 2026-08-04
- Added a Get Captcha button to the widget itself, forwarding to the real
  (hidden) reload button so its disabled/cooldown state is respected for
  free — brings this script in line with
  4chan-captcha-helper-4chanx-injector.user.js and
  4chan-fully-integrated-captcha-assistant.user.js, which already had one.
  Previously this was the one sibling that still required hunting for
  4chan's own tiny reload icon.

### 1.1.0 — 2026-08-02
- Removed the per-candidate Send button — double-click a candidate, or
  navigate to it and press Enter/Space, to submit it directly.
- Click and keyboard navigation now share one "current candidate" indicator
  (single green highlight) instead of click and keyboard nav showing two
  different, unsynced colors.
- Keyboard navigation: Up/Down or W/S move the current candidate, Enter/Space
  submits it. Only active while the widget is open and you're not typing in
  a text field.
- Added a hint line in the widget noting the double-click/keyboard shortcuts.

### 1.0.0 — 2026-07-31
- Initial standalone release.

## 4chan Fully Integrated Captcha Assistant

### 1.1.0 — 2026-08-02
- Removed the per-candidate Send button — double-click a candidate, or
  navigate to it and press Enter/Space, to submit it directly.
- Click and keyboard navigation now share one "current candidate" indicator
  (single green highlight) instead of click and keyboard nav showing two
  different, unsynced colors.
- Keyboard navigation: Up/Down or W/S move the current candidate, Enter/Space
  submits it. Only active while the panel is open and you're not typing in
  the name/comment fields.
- Added a hint line in the captcha section noting the double-click/keyboard
  shortcuts.

### 1.0.0 — 2026-07-31
- Initial standalone release.

## Captcha Helper 4chanx Injector

### 1.1.0 — 2026-08-02
- Removed the per-candidate Send button — double-click a candidate, or
  navigate to it and press Enter/Space, to submit it directly.
- Click and keyboard navigation now share one "current candidate" indicator
  (single green highlight) instead of click and keyboard nav showing two
  different, unsynced colors.
- Keyboard navigation: Up/Down or W/S move the current candidate, Enter/Space
  submits it. Only active while the widget is anchored in 4chan X's live QR
  dialog and you're not typing in a text field.
- Added a hint line in the widget noting the double-click/keyboard shortcuts.

### 1.0.1 — 2026-08-02
- Widget title updated.

### 1.0.0 — 2026-07-31
- Initial standalone release.
