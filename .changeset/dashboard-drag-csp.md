---
'scorpion': patch
---

Dashboard: dragging a tile with the pointer works again on built (deployed) instances. The page's Content-Security-Policy now lets the drag library's styles in by the page's nonce (`style-src 'self' 'nonce-…'`, still no `'unsafe-inline'`), so the tile follows the pointer instead of staying put.
