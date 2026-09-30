---
'scorpion': minor
---

Each profile image now contains only that profile's modules and their dependencies: nothing from other profiles, no tests and no dev tools, so images are smaller and a plugin that is not in the profile cannot run. The Docker build takes optional build arguments `PROFILE_FILE` and `MODULE_ROOTS` for profiles outside `profiles/`. CI checks every image for stray modules.
