# Scorpion: Feature Specification for a Greenfield Rebuild

This document lists every feature of the current Scorpion app (SvelteKit 5 + Drizzle/PostgreSQL, commit `f0c1ba9`). It serves as the requirements baseline for rebuilding the app as a modular system in which components can be plugged in or out for different deployments (for example de.NBI service registry, NFDI onboarding portal, a KPI-only tracker).

It was compiled from the code-review-graph (11 code communities, 27 execution flows, 355 nodes) and a full read of the source under `src/`, `static/` and the deployment files.

**Status legend**

| Mark | Meaning |
|---|---|
| ✅ | Implemented and working |
| ◐ | Partially implemented, or behaves inconsistently |
| ○ | Stubbed, commented out, or only present as a schema or UI placeholder |
| ⚠ | Current behaviour is a defect or security gap. Specify the intended behaviour; do not port the current one |

---

## 1. Domain model

### 1.1 Entities

| Entity | Key fields | Notes |
|---|---|---|
| **User** | id (random base32), username, email, bio, role, approved, icon (data URL) | Roles: `Admin`, `Reviewer`, `User` |
| **AuthenticationMethod** | userId, method (`local` \| `oidc`), details (json) | local: `{passwordHash}` (argon2). oidc: `{provider, subject}` |
| **Session** | id (UUID), userId, createdAt, expiresAt | 7-day TTL. Backs the JWT |
| **AuthCode** | state, provider (json) | Pending OIDC login state |
| **Token** (PAT) | name, hash, created, lastUsed | Linked to its user through `user_to_token` |
| **Provider** | abbreviation (unique), name | Organisation operating services. Users are members of providers |
| **Consortium** | abbreviation (unique), name | Network or centre that services belong to |
| **Category** ("KPI set") | name (unique) | Each service has exactly one category |
| **Indicator** (KPI) | name (unique), description, type (`number` \| `float` \| `text`), thematic category (`Bibliographic` \| `Usage` \| `Technical` \| `Satisfaction`) | |
| **CategoryToIndicator** | categoryId, indicatorId, necessity (`mandatory` \| `recommended` \| `optional`) | Defines what a KPI set requires |
| **Service** | abbreviation (unique slug), name, license (SPDX id), stage (`PROD` \| `DEV` \| `DEMO`), category, icon | |
| **ProviderToService** / **ConsortiumToService** | | In practice one provider per service; many consortia per service |
| **ServiceToIndicator** | serviceId, indicatorId | "Additional" KPIs a service opts into beyond its category |
| **Measurement** | serviceId, indicatorId, date (normalised to month end), value (text) | KPI time series |
| **Evaluation** | categoryId, indicatorId, aggregate (`sum` \| `avg` \| `min` \| `max`) | The headline KPI of each category, used for impact reports |
| **MaturityModel** | name, domain, topic, levels[] | Flat rows. Model, domain and topic are implied by grouping on these strings |
| **ServiceForm** | serviceName, maturityModel, formData (json[]), additionalInfo (json), serviceId? | Onboarding application with a maturity self-assessment |
| **Publication** | doi, title, authors, publicationDate, serviceId | |
| **Announcement** | from (`System` \| `Reviewer`), title, message, date | |
| **Settings** | key (unique), value (json) | Instance config, per-user preferences and the token salt |
| **ApiLog** | method, endpoint, body, query, userId, timestamp | Audit trail of public API calls |

**Views:** `service_view` (a service with its category, provider and consortia as JSON) and `user_view` (a user with provider memberships and their approval state).

### 1.2 Rebuild recommendations for the model
- Make **Model** and **Domain** first-class tables, and give each maturity level a description, which the JSON schema already has but the DB never stores. Use stable IDs so that re-saving a model does not re-create its rows.
- Give **ServiceForm** a status (`submitted` → `under_review` → `approved` / `declined`) and a link to the resulting Service.
- Model **provider membership** as an entity with a state (`requested`, `approved`, `rejected`) instead of a boolean.
- Enforce uniqueness of `(serviceId, indicatorId, date)` on Measurement, and store typed values or at least validate them against the indicator type.
- Make the enums **configurable data** instead of hard-coded pg enums. This applies to stages, indicator thematic categories, announcement sender types and necessity levels, which differ between use cases.
- Keep instance settings, per-user preferences and secrets (token salt, OIDC client secrets, S3 keys) in separate stores. Secrets need encryption at rest.

---

## 2. Target module map (pluggable architecture)

The features below are grouped into the modules a rebuild should expose. **Core** modules are always present. **Plugin** modules can be switched on or off, or swapped out, per deployment.

| Module | Type | Depends on | Main extension points |
|---|---|---|---|
| `core.identity` | Core | none | Auth provider plugins (local, OIDC, SAML, LDAP…), user approval policy, role model |
| `core.authz` | Core | identity | Permission registry: modules register permissions; roles map to permissions |
| `core.settings` | Core | none | Each module registers a settings JSON Schema; the admin UI renders forms from it |
| `core.notifications` | Core | settings | Transport plugins (SMTP, none, webhook) and a template registry per event |
| `core.audit` | Core | identity | Which channels are logged (public API, admin actions) |
| `core.ui-shell` | Core | authz | Navigation registry, dashboard widget registry, theming and branding |
| `registry.organisations` | Plugin | identity | Organisation types (providers, consortia; add more, such as funders) |
| `registry.services` | Plugin | organisations, kpi | Service metadata schema, wizard step definitions, custom field types |
| `kpi.framework` | Plugin | services | Indicator types, value validators, necessity levels |
| `kpi.ingestion` | Plugin | kpi.framework | Ingestion adapters: form, file (CSV/TSV/XLSX), REST API, pull connectors |
| `kpi.analytics` | Plugin | kpi.framework | Dashboard widgets, aggregation functions, scores (for example MAPE), exporters (CSV, PDF) |
| `kpi.impact` | Plugin | kpi.analytics, organisations | Per-consortium impact tables and summary stats |
| `maturity` | Plugin | settings | Model definitions, assessment UI, visualisations (radar) |
| `onboarding` | Plugin | maturity, services | Public application form and review workflow, post-processing hooks (ticket, email, webhook) |
| `bibliometrics` | Plugin | services | Metadata resolvers (DOI/CSL), citation sources (OpenAlex, Crossref…), scheduled refresh |
| `network-graph` | Plugin | services, kpi | Node and edge providers, layout engine |
| `announcements` | Plugin | ui-shell | Audience targeting, sender types |
| `backup` | Plugin | settings | Storage targets (S3, filesystem), encryption keyring, schedule, restore |
| `public-api` | Plugin | identity, audit | Versioned REST resources contributed by each module; OpenAPI aggregation |

---

## 3. Feature list by module

### 3.1 Identity and authentication (`core.identity`)

**Local accounts**
- ✅ Register with username, email, password and a repeated password.
  - Username: 3–31 characters, `[a-z0-9_-]`.
  - Password: 6–255 characters.
  - Password hashed with argon2.
  - Duplicate username or email rejected, but the check covers local accounts only.
- ✅ **Bootstrap rule:** the first user ever registered becomes `Admin` and is auto-approved. Every later user is `User` and needs approval.
- ✅ Log in with username and password. On success the app issues a session.
- ✅ Local accounts can be switched off: the security setting `Local Accounts = yes|no` hides the local form and the register page.
  - ⚠ The register action does not enforce this server-side.
- ⚠ Email format is not validated. The "all fields required" error returns HTTP 200.
- ○ Missing today, needed for a rebuild: password reset, email verification, password change, account deletion.

**OIDC single sign-on**
- ✅ Configure any number of OIDC providers in settings. Each has a Name, Client ID, Client Secret, Specification URL (discovery document) and Display Icon (PNG/SVG).
- ✅ The login page shows one icon button per provider in a grid, falling back to a text button when there is no icon.
- ✅ Authorisation-code flow:
  - reads endpoints from the discovery document;
  - scope `openid profile email`;
  - random 32-byte `state` stored in the DB;
  - token exchange with `client_secret_post`;
  - identity taken from the userinfo endpoint's `sub`.
- ✅ Auto-provisioning on first login:
  - creates the user with username = `preferred_username` or `sub`, plus the email;
  - adds an OIDC auth method `{provider, subject}`;
  - the account starts **pending approval**;
  - sends a welcome email to the user and a registration-request email to admins.
- ✅ Returning users are matched on `(provider, subject)`.
- ⚠ Must be fixed:
  - no PKCE, no nonce, and no id_token validation;
  - an unknown `state` crashes the handler, and states never expire;
  - the full provider config, including its secret, is copied into `auth_codes`;
  - the cookie is set without SameSite or Secure.
- ○ Missing: linking an OIDC identity to an existing account (for example by verified email), and one user holding several identities.

**Sessions**
- ✅ JWT (HS256, `JWT_SECRET`) in the httpOnly cookie `access_token`.
  - Payload: `{sessionId, userId, username}`.
  - 7-day expiry.
  - Each JWT is backed by a `session` row.
- ✅ Logout deletes the session row and the cookie.
- ⚠ Session revocation is not enforced: JWT verification never checks the session row, so a copied token stays valid until it expires.
- ✅ An authenticated user who opens `/login` or `/register` is redirected to home.
- ✅ Unapproved users land on a **Pending Approval** page, `/login/fallback`, which shows their username and email.

**Account approval**
- ✅ Admins approve a pending user and assign a role at the same time. The user gets a "registration approved" email with a sign-in link.
- ✅ Admins reject a pending user. The user, their auth methods and sessions are **hard-deleted**, and a "registration rejected" email with a contact address is sent.

**Personal access tokens (API keys)**
- ✅ Users create named tokens on their profile. Names must be unique per user.
  - Format: `PAT_` + 24 base32 characters (120 bits of entropy).
  - The secret is shown **once**, and clicking it copies it to the clipboard.
- ✅ Stored as PBKDF2-SHA512 hashes (100k iterations) with one global salt kept in settings (`token_salt`).
- ✅ The token list shows name, created and last used. Tokens can be revoked.
- ✅ `lastUsed` is updated on every API call.
- ⚠ Must be fixed:
  - an invalid key causes a 500 instead of a 401;
  - there is no ownership check on create or revoke;
  - hashing is expensive on every request (a per-token salt and a lookup prefix would fix this);
  - tokens have no expiry and no scopes.
- ○ Recommended: token expiry, scopes (read or write per module), rotation. The UI already promises rotation.

### 3.2 Authorisation (`core.authz`)
- ✅ Three roles: `Admin`, `Reviewer`, `User`.
- ✅ Page-level checks:
  - `/administration` needs Admin;
  - `/services/evaluate` and `/services/applications` need Reviewer or Admin.
- ✅ **Provider-scoped editing:** only members of a service's provider see the Edit button and can submit KPI data for that service.
- ✅ The public API authenticates with the `X-API-Key` header.
- ✅ Public routes: `/services/onboarding` (page and POST).
- ⚠ **None of the internal `/api/*` endpoints checks a role or ownership.** Any approved user can:
  - change any user's role, including making themselves Admin;
  - approve their own provider membership;
  - approve or reject users;
  - edit KPI sets and maturity models;
  - delete announcements;
  - read the API logs;
  - revoke other users' tokens.

  The rebuild needs a permission check on **every** endpoint, declared by the module that owns it.
- ⚠ The navigation shows "Administration" to every approved user.
- ⚠ Legal pages (privacy, terms) and the API docs require login. They should be public.
- ⚠ The login/register detection in the auth hook relies on `pathname.split('/')[2]`, so it assumes a one-segment base path.

### 3.3 Settings and configuration (`core.settings`)
- ✅ Instance settings are stored as key/JSON rows and edited in Admin → Settings. The forms are **generated from JSON Schema**:
  - a string becomes an input, or a select if the schema has an `enum`;
  - a number becomes a number input;
  - an array of objects becomes repeatable cards with Add and Remove.
- ✅ Save stays disabled until something changes. A missing settings row is initialised from the schema defaults.
- ✅ **General** settings:
  - `Name`: instance branding. When set, the header shows it with a "Powered by Scorpion" badge.
  - `Mail Relay`: SMTP host.
- ✅ **Security** settings:
  - `OIDC Providers[]`;
  - `Local Accounts` (yes/no);
  - `Backup` (S3 endpoint, region, bucket, access key, secret).
- ✅ **Maturity model** setting: `additionalFields[]`, extra free-text questions on the onboarding form.
- ✅ **Per-user preferences**: the default dashboard service, duration and filter.
- ○ The legacy `settings.json` schema describes features that were never wired up. Treat it as a backlog:
  - locale and analytics;
  - maturity-model post-processing (URL, email, ticket template);
  - session timeout;
  - signup mode (open, invite-only, closed);
  - full SMTP config (port, user, password, TLS, from);
  - Jira integration;
  - API enable, default page size, rate limit, CORS allow-list.
- ⚠ Secrets (OIDC client secret, S3 secret) are stored in plain JSON. The settings endpoints are unprotected.
- **Environment configuration** (build- and run-time):
  - `DATABASE_URL`, `JWT_SECRET`, `OPENALEX_API_KEY`;
  - `BASE_PATH` (URL prefix);
  - `ORIGIN` and the proxy headers (`PROTOCOL_HEADER`, `HOST_HEADER`, `PORT_HEADER`, `XFF_DEPTH`);
  - `BACKUP_RSA_{PUBLIC,PRIVATE}_KEY_PATH`;
  - `PUBLIC_GITHUB_REPO`, `PUBLIC_DOCS_URL`, `PUBLIC_CONTACT_EMAIL`, `PUBLIC_IMPRINT_URL`.
- ⚠ Hard-coded values that should be configurable:
  - the sender `noreply@scorpion.bi.denbi.de`;
  - the GitHub repo used for the licence badge;
  - the production server URL in the OpenAPI spec;
  - "NFDI4Biodiversity" in the onboarding title;
  - the "Scorpion" product name in emails.

### 3.4 Organisations (`registry.organisations`)
- ✅ **Service providers:** admins list, add and edit them inline (abbreviation, name). Save posts the whole list, and entries with a duplicate name or abbreviation are skipped.
- ✅ **Consortia:** the same editor and rules as providers.
- ✅ **Membership** (users ↔ providers):
  - A user searches the available providers by name or abbreviation (5 per page, with member counts) and requests membership.
  - The request is **pending** until an admin approves it. Admins are emailed about new requests.
  - Users see their groups marked "Member" or "Pending" and can leave a group.
  - Admins see pending memberships in User Management (a pulsing indicator) and approve or remove them.
- ○ Missing: deleting a provider or consortium, organisation detail pages, consortium membership for users.

### 3.5 Service registry (`registry.services`)

**Service catalogue (`/services`)**
- ✅ A paginated table of all services (10, 20 or 50 per page). Columns:
  - icon, name and provider abbreviation;
  - category;
  - consortia shown as badges.
- ✅ Clicking a row opens the service detail page.
- ✅ **Faceted search** with checkbox facets and counts:
  - Category (missing shows as "Uncategorized");
  - Consortia;
  - Stage (Developmental, Demonstration, Operational);
  - License (missing shows as "Unknown").
- ✅ Facet logic is OR within a facet and AND across facets. Active filters are shown as badges.
- ◐ Facet counts are computed over all services, not the filtered set. Filtering does not reset the page. Filter badges cannot be removed by clicking. Columns are flagged sortable, but sorting is not implemented.
- ⚠ The `service_view` SQL never joins `consortium_to_service` to `service`, so every service appears in every consortium. Services with no consortium link drop out of the view entirely. This breaks the catalogue, the facets, the consortium filters and the impact stats.

**Service creation wizard (`/services/new`)**
- ✅ A multi-step questionnaire **defined declaratively** in `static/steps.json`. Each step has a title, optional paragraphs of text, and fields and/or an embedded component. Each field has a `type`, a `label`, an `explanation` and a `mapping.jsonPath` into the service object.
- ✅ Field types:

  | Type | Behaviour |
  |---|---|
  | `text` | Plain input |
  | `select` | Static options |
  | `license` | Searchable SPDX list, fetched live, with OSI-approved and deprecated badges |
  | `provider` | The user's own providers |
  | `multi-select` | Options from an endpoint or a static list; items are `{identifier, name}` |
  | `image` | PNG, JPEG or SVG stored as a data URL, with preview and remove |

- ✅ Component `kpi-set`:
  - pick the category;
  - its mandatory, recommended and optional KPIs are shown locked;
  - add or remove extra KPIs from all remaining indicators.
- ✅ Current steps:
  1. basics: icon, slug, name, license, lifecycle stage;
  2. provision: provider, consortia ("Service Center");
  3. KPI set.
- ✅ Two-way synced **JSON console**. The wizard and a raw JSON textarea edit the same object. Shown on localhost only.
- ✅ Default objects are generated from the JSON Schemas (`service_schema.json`, `organization_schema.json`).
- ✅ On finish the app validates that the provider, category, consortia and KPIs exist, creates the service and its links, then redirects to the service page.
- ⚠ The steps have no client-side validation. The creation writes are not transactional. The schema is missing `icon`, and `metadata.stage` is added by hand.

**Service detail and editing (`/services/{abbreviation}`)**
- ✅ View mode shows:
  - icon, name and abbreviation;
  - lifecycle stage;
  - provider;
  - consortia;
  - category;
  - the KPI set with each indicator's necessity;
  - publications.
- ✅ Members of the owning provider can switch to **edit mode**. Save appears only when something has changed. In edit mode they can:
  - change icon, name and abbreviation (renaming the slug is allowed and the page redirects);
  - change the stage;
  - change the provider, limited to their own providers;
  - toggle consortia;
  - change the category, which **replaces** the KPI set with the new category's KPIs;
  - add or remove "additional" KPIs. KPIs that come from the category cannot be removed.
- ⚠ The edit endpoint does not check ownership. Additional KPIs are add-only on the server, so removals are ignored. An unknown category or provider causes a 500.

**Lifecycle stages:** DEV (Development), DEMO (Demonstrator), PROD (Production).
- ⚠ The impact stats also count a `TERM` (Terminated) stage that the enum does not contain. The labels also differ between screens: "Demonstration" versus "Demonstrator" versus "Prototyped".

### 3.6 KPI framework (`kpi.framework`)
- ✅ **Indicators:** admins create them with:
  - name;
  - description;
  - value type (`number` integer, `float`, `text`);
  - thematic category (Bibliographic, Usage, Technical, Satisfaction);
  - optionally, a necessity in each existing KPI set.
- ✅ **KPI sets (categories):**
  - create a set with a necessity per indicator (Mandatory, Recommended, Optional, or Unused);
  - edit a set: add indicators from a paginated list and change necessities; Unused removes the link;
  - the main table lists each set with its indicators as badges coloured by necessity, 5 sets per page.
- ✅ **Evaluation configuration:**
  - For each KPI set, choose one headline indicator and an aggregate function (Sum, Average, Min, Max).
  - Saving replaces the whole configuration.
- ✅ **Effective KPI set of a service** = the category's indicators (with their necessity) plus the service's additional indicators.
- ○ Missing: deleting or editing indicators, renaming or deleting KPI sets, units, value ranges.
- ⚠ The writes are not transactional. Setting a necessity of `''` on a new association inserts an invalid enum value. Category names in URLs are not URL-decoded.

### 3.7 KPI data ingestion (`kpi.ingestion`)
The "Data Submission" page lists only the services of providers the user belongs to. It has two modes, toggled at the top.

**Manual form**
- ✅ Pick a service, then a month (month picker, or month and year dropdowns when the browser lacks one).
- ✅ Inputs are grouped as Mandatory, Recommended and Optional and typed by indicator type (float uses step 0.01; minimum is 0).
- ✅ Submit stays disabled until every mandatory KPI has a value. The form resets after a successful submit.

**File upload**
- ✅ Pick a service, then drag and drop or browse for a **CSV or TSV** file, detected by extension or MIME type. The first row is the header.
- ✅ A preview table with a **column mapping row**: each column maps to Unmapped, Date or an indicator, and each target can be used only once.
- ✅ Cells are validated against the mapped indicator's type (integer or float) and invalid ones are highlighted.
  - ◐ Invalid cells are only highlighted; they do not block the submit.
- ✅ Submit is enabled once Date and every mandatory KPI are mapped. Each row becomes one monthly submission.
- ○ XLSX is not supported, and no import template can be downloaded.

**Storage semantics**
- ✅ Every measurement date is normalised to the **last day of its month**.
- ⚠ The internal submit endpoint always inserts, so re-submitting creates duplicates. It also does not validate against the service's allowed KPIs. The public API upserts and validates, and the rebuild should use one path for both.

**API ingestion:** see 3.16 (`POST /api/v1/measurements`).

### 3.8 KPI analytics dashboard (`kpi.analytics`, home page `/`)
- ✅ Header: "Home – {service}". Controls:
  - time range: 3 months, 6 months, 1 year, 2 years, all;
  - service selector;
  - thematic filter: All, Bibliographic, Usage, Technical, Satisfaction.
- ✅ The dashboard reloads whenever a control changes.
- ✅ **KPI cards**, 4 per page:
  - latest value, locale-formatted (for text values, the first number in the string is formatted);
  - percent change from the oldest to the newest value in the window, with ▲ in green or ▼ in red;
  - an SVG sparkline.
- ✅ **Trends chart** (Plotly), one line per KPI. Per-trace controls:
  - cumulative mode;
  - hide;
  - move to a secondary y-axis.

  Below the chart, a carousel of per-KPI averages.
- ✅ **MAPE / volatility scores:** a per-KPI mean absolute percentage deviation from the mean, shown as progress bars (green below 0.4, amber below 0.8, red above) with an explanatory tooltip.
- ✅ Values in `HH-MM-SS` form are converted to seconds for charting.
- ✅ **Announcements widget** (see 3.13) and **Quick actions**: create report, settings.
- ✅ **User dashboard defaults**, set in a modal: default service, duration and category.
  - ◐ The modal offers "User Experience" instead of Technical and Satisfaction, and has no "all" range.
- ✅ **CSV export:** one row per KPI with the dates as columns.
  - ⚠ Values are not escaped, and every KPI is assumed to share the first KPI's dates.
- ✅ **PDF report (beta):**
  - page 1 has a title and a card grid (average, change, MAPE);
  - then one page per KPI with a rendered chart and a date/value table.
  - ◐ Long tables overflow the page, and the axis titles are placeholders.
- ⚠ With no duration there is no date filter. With no service it takes an arbitrary first service. The chart grid colours are not theme-aware.

### 3.9 Impact evaluation (`kpi.impact`, `/services/evaluate`, Reviewer or Admin)
- ✅ Select a consortium. It shows **summary stat tiles**:
  - total services;
  - open-source services (licence is an OSI-approved SPDX id, checked against the SPDX list fetched live);
  - services by stage: developmental, prototyped, operational, terminated.
- ✅ **Per-service monthly table** for a chosen year (the last 10 years are selectable):
  - one row per service showing its category's headline indicator (from the evaluation configuration);
  - columns Jan–Dec;
  - a yearly aggregate using the configured function.
- ✅ Row states cover no data, no evaluation indicator configured, and errors.
- ⚠ The SPDX list is fetched on every request with no cache. The consortium view bug (3.5) inflates the counts.

### 3.10 Maturity models (`maturity`)
- ✅ **Model editor** (Admin):
  - create a model with its first domain;
  - add or delete domains, each a collapsible section;
  - add, rename or delete topics (auto-named "Topic N");
  - per topic, an ordered list of level labels: add, edit, delete, move up or down.
  - Save replaces all rows of the model.
- ✅ **Radar visualisation:** one radar chart per domain, where the axes are topics and r = chosen level / number of levels. Beside it, a level-description table that highlights the selected level and cycles through topics.
- ⚠ Deleting a domain or topic is not scoped to the model, so it removes same-named rows in other models. Level descriptions are not stored.
- ○ Missing: renaming or deleting a whole model, renaming a domain, save feedback, model versioning.

### 3.11 Onboarding and application review (`onboarding`)
- ✅ **Public application form** (`/services/onboarding`, no login, no navigation):
  - pick a maturity model;
  - then one wizard step per domain, where each topic is a radio choice of "Not applicable" or one of its levels;
  - the final step asks for the service name plus the configurable additional fields;
  - the answers are stored as an application (`service_form`).
- ✅ **Review screen** (`/services/applications`, Reviewer or Admin):
  - pick an application;
  - see its maturity radar per domain;
  - fields for service abbreviation, provider and category;
  - Approve and Decline buttons.
- ○ Approve and Decline **do nothing yet**. They only clear the selection. There is no application status, no conversion into a Service, and no notification to the applicant. The page is not linked in the sidebar.
- ○ Planned in the settings schema: post-processing on submission (webhook URL, email, ticket template, Jira).
- ⚠ The public submission accepts arbitrary JSON with no validation, no rate limit, no CAPTCHA and no applicant contact, and it shows no success message.

### 3.12 Publications and citations (`bibliometrics`)
- ✅ When editing a service, add a publication by DOI. A `doi.org/` URL prefix is stripped.
- ✅ Metadata is resolved through DOI content negotiation (`application/vnd.citationstyles.csl+json`): title, authors, date.
- ✅ The publication list is sorted by date, paginated 5 per page, and links to doi.org.
- ✅ **Check citations:** queries OpenAlex `/works` in bulk (up to 100 DOIs per request, optional API key, exponential backoff on 429) and shows the total `cited_by_count`.
- ○ A scheduled citation refresh per service exists only as commented-out code. Citation counts are not stored, and there is no history.
- ○ Missing: removing a publication, duplicate-DOI detection, turning citations automatically into a Bibliographic KPI measurement (the obvious integration).

### 3.13 Announcements (`announcements`)
- ✅ Admins create announcements with sender type (System or Reviewer), title and message, all required. The date is set by the server. Admins can delete announcements.
- ✅ The dashboard widget shows them newest first, 2 per page, with a sender avatar (System and Reviewer images, otherwise an initial) and a relative time ("3 days ago").
- ○ Missing: editing, expiry, audience targeting by role, provider or consortium, Markdown formatting, read state.

### 3.14 Network visualisation (`network-graph`, `/services/network`)
- ✅ A force-directed graph (Cytoscape with the cola layout) of every service, category, provider, consortium and indicator.
- ✅ Each node type has its own shape and colour. The edges are:
  - category → service;
  - service → provider;
  - service → consortium;
  - service → indicator;
  - category → indicator (dashed).
- ✅ Separate light and dark palettes that switch live with the OS setting.
- ✅ A floating control menu: zoom in, zoom out, fit, re-run layout.
- ○ Missing: node filtering, search, click-through to detail pages, a legend. `graphology` and `sigma` are dependencies but are not used.

### 3.15 Notifications (`core.notifications`)
- ✅ Email over SMTP (nodemailer). The relay host comes from settings, on port 25 with no auth. Templates are Svelte components rendered to HTML with a shared layout.

  | Event | Recipient | Template |
  |---|---|---|
  | User registered (local, or first OIDC login) | New user | Welcome ("pending review, 1–2 business days") |
  | User registered | All admins | Registration request (name, email) |
  | User approved | User | Registration approved (sign-in button) |
  | User rejected | User | Registration rejected (contact email) |
  | Provider membership requested | All admins | Provider request (user, providers) |

- ⚠ Sends are fire-and-forget. Errors are only logged. The transporter is cached, so a relay change needs a restart.
- ○ Missing: an email when a membership is approved, when an onboarding application is submitted or decided, or when a KPI reporting deadline passes; in-app notifications; user notification preferences.

### 3.16 Public REST API and documentation (`public-api`)
- ✅ Versioned under `/api/v1`. Authentication is the `X-API-Key` header with a personal access token. CORS is open (`*`) and preflight is answered.
- ✅ **Every call is audit-logged**: method, endpoint, query, body, user and time.
- ✅ Standard pagination (`page`, 0-based, and `pageSize`, default 1000). Envelope: `{metadata:{currentPage,pageSize,totalCount,totalPages}, result:[…]}`.

  | Endpoint | Function |
  |---|---|
  | `GET /api/v1/categories` | List KPI-set names |
  | `GET /api/v1/indicators?category=&service=` | Indicators with a `selected` flag and category necessities |
  | `GET /api/v1/providers?is_member=` | All providers, or those the caller is an approved member of |
  | `GET /api/v1/services?service=&provider=` | Services filtered by abbreviations |
  | `GET /api/v1/measurements?service=&indicators=&start=&stop=` | Time series `{kpi,value,date}` |
  | `POST /api/v1/measurements?service=` | Upsert `[{kpi,value,date}]`. Only KPIs allowed for the service are accepted, values are type-checked, and `YYYY-MM` becomes month end |

- ⚠ Measurements GET uses the key `data` instead of `result` and has unstable ordering across pages. `is_member=false` is broken. Services always return empty `consortia`. The indicators `totalCount` ignores filters. There is no permission check on POST: anyone with a key can write to any service.
- ✅ **OpenAPI 3** spec generated at build time from `@swagger` JSDoc blocks plus shared component schemas. **Swagger UI** at `/docs`, with dark mode, a server URL set to the current origin, and a fallback spec.
- Internal JSON API (cookie auth) used by the UI. There are about 30 endpoints across announcements, categories (and evaluation), consortia (and evaluation), indicators, logout, logs, maturity model, measurements (and dashboard), providers, publications, services (by id, citations, onboarding, search), settings, and users (by id, approval, settings, tokens). In a rebuild each module should own its routes and declare them in one contract (for example typed routes plus a generated OpenAPI spec), so the internal and public APIs don't drift apart.

### 3.17 Audit logs (`core.audit`)
- ✅ The admin log viewer lists public-API calls, newest first:
  - timestamp;
  - method, as a colour-coded badge;
  - endpoint;
  - user.
- ✅ Clicking a row expands its query string and JSON body. Pagination offers 10, 20 or 50 per page, with manual refresh.
- ○ Missing: filters (method, user, endpoint, date range), export, retention policy, logging of internal or admin actions.

### 3.18 Backup (`backup`)
- ✅ `backupDatabase()`:
  - dumps every table as JSON;
  - encrypts it with the AWS Encryption SDK using a raw RSA keyring (RSA-3072, generated on first use if the key files are missing), with an encryption context of stage, purpose, origin and timestamp;
  - uploads to an S3-compatible bucket (path-style, so MinIO and Ceph work) as `backup-{timestamp}/{table}.json`;
  - takes its S3 credentials from security settings.
- ○ Not scheduled: the cron job is commented out. There is no UI trigger, no restore or decrypt function, no retention policy and no status reporting.

### 3.19 UI shell, branding and static pages (`core.ui-shell`)
- ✅ **Top header**:
  - a hamburger drawer with Portfolio (`/services`) and Administration;
  - the brand: the instance name plus "Powered by", or the Scorpion logo;
  - an avatar menu with Profile, API Documentation and Logout.
- ✅ **Section sidebars**, collapsible to an icon rail with tooltips:
  - Services: Service Management, Data Submission, Service Evaluation, Network Visualization;
  - Admin: Users, Groups, KPI Framework, Maturity Model, Announcements, Settings, Logs.
- ✅ **Footer**: GitHub, Docs, Terms, Privacy and Contact links; copyright, the licence SPDX id (fetched live from GitHub) and Imprint.
- ✅ **Theming**: DaisyUI themes `scorpionlight` and `scorpiondark` that follow `prefers-color-scheme`. The favicon, logos and login backgrounds swap with the theme.
  - ○ There is no manual theme toggle.
- ✅ **Profile page**:
  - avatar upload (PNG, JPEG or SVG as a data URL) and remove;
  - edit name, email and bio;
  - role badge;
  - group membership (see 3.4);
  - API tokens (see 3.1).
- ✅ **Legal pages**: Privacy and Terms rendered from Markdown files, in a Shadow DOM.
  - ⚠ The HTML is not sanitised, and the pages sit behind login.
- ✅ **Error page**: status, message and a "Go home" button.
- ✅ **Base-path support**: the whole app can be served under a URL prefix.
  - ◐ Some fetches use absolute paths.
- ○ Missing: i18n (the settings schema lists a locale), accessibility audit, navigation filtered by role.

### 3.20 Deployment and operations
- ✅ Node adapter. A multi-stage Docker image: node:22 build, node:22-slim runtime on port 80.
- ✅ An example docker-compose file with the web app plus Postgres, reverse-proxy header settings and a persistent volume.
- ✅ Drizzle-kit scripts: push, generate, migrate, studio, pull.
  - ○ Migrations do not run on startup, and there is no seed data (default categories, indicators, admin).
- ○ Missing: a health endpoint, structured logging, metrics, a test suite (the repo has none), CI.

---

## 4. Cross-cutting requirements for the rebuild

1. **Authorisation on every route.** Each module declares its permissions, and handlers enforce them server-side. Resource ownership (a provider's services, a user's own tokens and settings) is checked in one place.
2. **One domain-service layer.** The UI, the internal API and the public API call the same services. Today measurement ingestion has two diverging code paths.
3. **Transactions** around every multi-row write: service create/update, KPI set update, evaluation config, indicator create, maturity model save.
4. **Schema-validated input** on every endpoint (for example Zod or JSON Schema). The JSON Schemas already used for forms can be shared between client and server.
5. **Declarative, pluggable UI configuration.** Keep and generalise the existing declarative pieces: wizard steps (`steps.json`), settings forms from JSON Schema, and facet definitions. Field types, wizard components, dashboard widgets, exporters and navigation entries should all be registries that plugins add to.
6. **Configurable vocabularies**: stages, thematic categories, necessity levels, sender types and aggregate functions.
7. **Scheduled jobs framework** for backup, citation refresh, reminders and log retention, with status visible in the admin UI.
8. **External-service adapters** with caching and timeouts: SPDX licence list, DOI resolver, OpenAlex, GitHub licence badge.
9. **Security baseline**:
  - OIDC with PKCE, nonce and id_token validation;
  - server-side session revocation;
  - Secure/SameSite cookies;
  - secrets encrypted at rest;
  - size limits and sanitisation for uploaded images (SVG is an XSS vector);
  - rate limiting on public endpoints;
  - sanitised Markdown.
10. **Multi-tenancy readiness**: branding (name, logos, sender address, product name, legal texts) should come from settings, not from code.
11. **Tests**: unit tests for aggregation and scoring (MAPE, change %, month-end normalisation, yearly aggregates) and contract tests for the public API.

---

## 5. Known defects in the current code (do not port)

| # | Area | Defect |
|---|---|---|
| 1 | AuthZ | Internal `/api/*` endpoints have no role or ownership checks, so any approved user can escalate to Admin |
| 2 | DB view | `service_view` is missing its `consortium_to_service.serviceId = service.id` join |
| 3 | Tokens | `verifyToken` indexes `db_token[0]` before its length check, so an invalid key gives a 500 |
| 4 | Sessions | JWT validity ignores the session table, so logout does not revoke the token |
| 5 | OIDC | No PKCE, nonce or id_token validation; an unknown state crashes; the secret is copied into `auth_codes` |
| 6 | Measurements | The internal POST inserts duplicates; the v1 GET orders only within a page |
| 7 | Maturity | Deleting a domain or topic is not scoped to the model |
| 8 | Onboarding review | Approve and Decline are no-ops |
| 9 | Stages | `TERM` is counted but is not in the enum; stage labels differ between screens |
| 10 | Dashboard | No duration means no date filter; the settings-modal categories don't match the dashboard filters |
| 11 | Hook | Login/register detection assumes a one-segment `BASE_PATH` |
| 12 | Page loads | Loaders *return* `Response(400)` instead of throwing, when the token is missing |
| 13 | Registration | `Local Accounts = no` is not enforced server-side; email is not validated |
| 14 | Service edit | Removing additional KPIs is ignored; unknown references cause a 500 |
| 15 | v1 API | `is_member=false` is broken; `consortia` is always empty; envelope keys are inconsistent |

---

## 6. Appendix: pluggability matrix

| Plugin point | Current (hard-coded) implementation | Alternatives to support |
|---|---|---|
| Auth provider | Local argon2 and generic OIDC | SAML, LDAP, LifeScience AAI, magic link |
| User approval policy | Manual admin approval; first user becomes Admin | Auto-approve by email domain or IdP claim, invite-only |
| Service metadata schema | `service_schema.json` + `steps.json` | Per-deployment schemas (for example EDAM topics, bio.tools id, FAIRsharing link) |
| Wizard field types | text, select, license, provider, multi-select, image | ORCID, ROR, EDAM, URL, date, rich text |
| Indicator value types | number, float, text | Duration, percentage, boolean, enum |
| Ingestion adapter | Form, CSV/TSV, REST | XLSX, Matomo/Plausible pull, GitHub stats, Prometheus |
| Analytics widgets | Cards, trend chart, MAPE, averages | Forecasts, targets and thresholds, benchmarks across services |
| Exporter | CSV, PDF (pdf-lib + Plotly) | XLSX, JSON-LD, scheduled report emails |
| Maturity visualisation | Plotly radar per domain | Heatmap, bar, progress over time |
| Onboarding post-processing | None (planned: URL, email, Jira) | Webhook, GitHub issue, Jira, email |
| Citation source | OpenAlex | Crossref, Europe PMC, Dimensions |
| Graph renderer | Cytoscape + cola | Sigma/graphology (already dependencies), D3 |
| Notification transport | SMTP port 25, no auth | Authenticated SMTP, SendGrid, Matrix/Slack webhook |
| Backup target | S3 + AWS Encryption SDK RSA keyring | Filesystem, pg_dump, KMS keyring |
| Theme and branding | Two DaisyUI themes, fixed logos | Theme and logo uploads per instance |
