---
'scorpion': patch
---

Security: an uploaded SVG file (for example an avatar) with many unclosed `<?xml`, `<!DOCTYPE` or `<!--` openings could block the server for minutes, and a very long log message could slow logging down. Both now take time proportional to the input size. Update if your instance lets users register and upload images.
