---
'scorpion': minor
---

New command `scorpion docs:export` (run in a checkout) writes the reference data of the modules, the environment variables, the CLI, the public API of each profile, the profiles and the journey steps as JSON, and CI attaches it as `docs-export.zip` to each GitHub release. A module can now list the environment variables it reads in its manifest (`env`); `core.settings` lists `SECRETS_KEY` and `SECRETS_KEY_NEXT`.
