---
'scorpion': minor
---

Operators can take a snapshot of the legacy application for the migration: `pnpm migrate-legacy fetch` reads its REST API with an administrator's key (from `LEGACY_API_KEY`, GET requests only) into a directory with a checked manifest, and `pnpm migrate-legacy discover` summarises it (counts, spellings and what the new rules refuse, without naming any person). The tool is not part of any image. Nothing changes for running instances.
