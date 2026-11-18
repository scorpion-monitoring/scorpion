---
'scorpion': minor
---

Profile pictures now show beside a person's name: in the account menu in the header, in the user and pending-account tables of the administration, in the audit log, and in the membership lists of an organisation (for its managers, for Admins, and for members while the member list is visible to them). Without a picture, or when the file does not load, the usual person icon stands in.

The internal API answers gained an `avatarHash` field (`userAvatarHash` on an audit entry) next to the username in `GET /auth/me`, `GET /users`, `GET /users/{id}`, `GET /users/pending`, `GET /audit`, `GET /audit/{id}`, `GET /organisations/{id}/members` and the membership routes. It is the SHA-256 the file is served under at `/api/internal/files/{hash}`, or `null`. The public API v1 is unchanged.
