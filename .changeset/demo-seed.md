---
'scorpion': minor
---

New command `scorpion seed --demo` fills an instance with fictional, non-personal demo data for the modules of its profile: two demo accounts (`demo-admin`, `demo-user`; set `SCORPION_DEMO_PASSWORD`, or a random password is shown once), three organisations and a consortium, four services (two public), five indicators with a KPI set, and six months of measurements. It is safe to run twice. It refuses a database that holds a non-demo account, and a production build on a public address, unless you pass `--allow-production`. Modules can contribute a seed with the new manifest field `demoSeed`.
