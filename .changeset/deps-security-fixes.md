---
'scorpion': patch
---

Updates 18 npm dependencies (including `zod` 4.6.7, `nodemailer` 10.1.2, `pg-boss` 12.38, `@sveltejs/kit` 3.1, `dompurify` 3.4.17), the Node base image to 24.22.0-slim and three GitHub Actions. This also closes two Dependabot alerts: `@ai-sdk/provider-utils` (now 4.0.33) and `esbuild` below 0.25.0 in the development-only `drizzle-kit` loader. The account menu button now names the signed-in user in its accessible label ("Account menu: name"), so the visible text is part of the name.
