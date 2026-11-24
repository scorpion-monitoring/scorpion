---
'scorpion': minor
---

New module `matomo` (in the `full` profile, off by default): usage statistics of the instance with your own Matomo. Set the Matomo address and site id at `/admin/settings/matomo` and turn it on. Every page view is sent as the page's pattern (`/services/:slug`), never with ids, query or fragment. By default no cookie is set and Do Not Track and Global Privacy Control are honoured. To count signed-in people exactly over weeks and months, turn on `pseudonymousUserId` and set the secret `matomo.user-id-key`. While tracking is on, the pages' Content-Security-Policy allows the Matomo origin. Update your privacy policy before you turn it on; the module README has a checklist.
