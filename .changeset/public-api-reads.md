---
'scorpion': minor
---

The public API (`/api/v1`) can read providers and services.

- `GET /api/v1/providers`: the providers with `id`, `abbreviation`, `name`, `description`, `website`, `rorId`, `sameAs` and `isMember`. `is_member=true` lists
  the providers the owner of the token is an approved member of, `is_member=false` all the others (a legacy bug returned the wrong set), anything else is 422.
- `GET /api/v1/providers/{id}` returns one provider (the row of the list; 404 for an unknown id or an organisation that is not a provider).
- `GET /api/v1/services`: the services in the legacy shape (`abbreviation`, `name`, `stage`, `license`, `provider`, `consortia` as abbreviations), plus `id`,
  `public`, `providerId` and `consortiaIds`. Each service is one row, `consortia` is filled (`[]` for none), a service that is not public is listed with
  `public: false`. Filters `service`, `provider` (abbreviations, comma-separated), `stage` and `license`; a name that matches nothing is 422.
- `GET /api/v1/services/{id}` returns one service with its description, address and links; `GET /api/v1/services/{id}/schema-org` returns its Schema.org
  profile. The contact point of a provider or a service is never part of the API.
- Lists sort by abbreviation without case, then by id; pages count from 0; `pageSize` defaults to 100 and is at most 100 (a legacy client that asked for
  more now gets 422 instead of a short page); `totalCount` is the size of the filtered set.
- Two new permissions, `registry.organisations.v1.read` and `registry.services.v1.read`, held by the role `user` by default. A token needs the scope as
  well as an owner who holds the permission, so an administrator can withdraw the API from a role without touching the screens. Calls are audited in
  the `api` channel.
- `/api/v1/openapi.json` now describes the four routes; the committed document is the first version of the contract and later changes are additive.
