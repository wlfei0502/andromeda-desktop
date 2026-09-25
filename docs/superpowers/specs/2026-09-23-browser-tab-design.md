# Browser Tab Design

Date: 2026-09-23

## Goal

Right-panel **浏览器** tabs match Cursor-style browser chrome: nav controls, address bar, Recents start page, and real in-window Tauri child WebViews for page content.

## Layout

1. **Toolbar (React)** — back, forward, reload, bookmark (visual); address field placeholder “Search or enter URL”; trailing overflow placeholders.
2. **Content** — empty URL → Recents list; navigated URL → child WebView filling the content host below the toolbar.

## Behavior

- Enter / Recents click → normalize input → push local history → show WebView at that URL.
- Back / forward use a per-tab history stack (JS). Reload recreates the WebView at the current URL (Tauri child WebView JS API has no navigate/reload).
- Multiple browser tabs = independent WebView labels `browser-{tabId}`.
- Closing a tab closes its WebView.
- While the tab “+” menu is open, hide active browser WebViews (same as map) so the HTML menu is not covered.

## Recents

- Persisted in `localStorage` (max ~20 entries: url, optional title).
- Shared across browser tabs.

## Out of scope

- Real search engine UX polish, bookmark management UI, find-in-page, DevTools.
