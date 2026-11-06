---
'scorpion': minor
---

Polish (M12a, sprint 1). The public pages and records move from `/public/...` to `/catalog/...` (services, organisations and the RIMO files; there is no redirect), and `/catalog/services` is a new public, searchable list of published services. Access tokens are chosen from a tree of permissions, and the new-token box no longer breaks the token letter by letter on a phone. The sidebar highlights one entry and shows nested entries under their parent. The footer shows "Powered by Scorpion" with the version and the licence, and the header shows the Scorpion logo until an instance uploads its own. The icons come from Tabler (the settings button is a gear), and the service catalogue filters use the full width. Developers get `pnpm db:studio` and `pnpm icons:generate`.
