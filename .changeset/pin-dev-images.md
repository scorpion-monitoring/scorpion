---
'scorpion': patch
---

The development stack and the integration tests now use pinned images (PostgreSQL 16.15 and Mailpit v1.31.3), so local and CI environments are reproducible. Pull requests that change only documentation no longer need a changeset. Nothing changes for running instances.
