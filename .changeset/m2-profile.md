---
'scorpion': minor
---

Signed-in people can read and edit their own profile: new session-only routes `GET /api/internal/account/profile` and `PATCH /api/internal/account/profile` (display name, bio and email address; permissions `core.identity.profile.read` and `core.identity.profile.update`; new event `identity.profile.updated@1`, which lists the changed field names and never their values). The bio is plain text (at most 2000 characters). A new email address replaces the old one only after its owner opens the link mailed to it; until then the old address stays and the profile shows the new one as `pendingEmail`. Asking for the confirmation mail is limited to five address changes an hour per person, and `POST /api/internal/account/email/verification` answers 429 after five requests an hour. New migration (`display_name` and `bio` columns of `identity_user`). There is no avatar upload yet (needs the blob store of M3).
