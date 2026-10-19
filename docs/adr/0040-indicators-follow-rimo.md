# ADR-0040: the indicator model follows RIMO

- Status: Accepted
- Date: 2026-10-14

## Context

M9 adds `kpi.framework` ([m9-sprint-plan.md](../m9-sprint-plan.md)). The old application stored an indicator as a name, a description, a
type and a thematic category, and a "category" as a free list of indicators. Since then the BioHackathon Europe 2025 METRICS team
published the **Research Infrastructure Metrics Ontology (RIMO)**, which describes the same things for research infrastructures and life
science services. de.NBI and NFDI exchange indicators, so an indicator that RIMO can express should be expressible from this system
without a translation table in somebody's head.

RIMO is small (125 lines of Turtle, version 0.2.0, licence CC BY 4.0) and regular. The question is how much of it the data model adopts,
how a stable identifier is minted for a thing RIMO has no instance for, and how a newer version enters the repository.

## Decision

### 1. The mapping (the structure of the module)

| RIMO                                               | Scorpion                                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rimo:KPI`                                         | an **indicator** (`kpif_indicator`)                                                                                                                                                                                            |
| `rimo:KPIName`, `KPIDescription`, `KPIExample`     | `name`, `description`, `example` (plain text, bounded)                                                                                                                                                                         |
| `rimo:isQualitativeIndicator`                      | `qualitative` (boolean). A qualitative indicator has the value type `text`; a `text` indicator may be qualitative or not; a quantitative one may be any                                                                        |
| `rimo:hasValue` → `rimo:KPIValue`                  | the value an indicator takes: its type, unit and bounds. The values themselves are M10's; the RDF read gives each indicator one `rimo:KPIValue` node that carries the unit                                                     |
| `rimo:hasUnit` (range Units Ontology)              | `unit`: a term of the vocabulary `kpi.unit`. A seeded term has its UO IRI and symbol (`config/units.ts`); an administrator's own term has neither and is exported with a minted IRI                                            |
| `rimo:measuredBy` → `rimo:MeasurementMeans`        | zero or more terms of the vocabulary `kpi.measured-by` (`kpif_indicator_means`)                                                                                                                                                |
| `rimo:canBeAutomatedBy` → `rimo:AutomationTool`    | zero or more terms of the vocabulary `kpi.automation-tool` (`kpif_indicator_tool`)                                                                                                                                             |
| `rimo:ServiceCategory`                             | the seeded vocabulary `kpi.service-category` (16 terms, each with its `w3id.org/RIMO#` IRI from `config/rimo-seed.json`); **a KPI set optionally names one** as `rimo_category`                                                |
| `rimo:appliedTo`, `mandatoryFor`, `recommendedFor` | a row of a KPI set (`kpif_kpi_set_indicator`) with a `necessity` term. `mandatory` → `mandatoryFor`, `recommended` → `recommendedFor`, `optional` → `appliedTo`. RIMO has no "optional" subproperty; the base property is used |
| (no RIMO term)                                     | `thematic` (Bibliographic, Usage, Technical, Satisfaction): the legacy vocabulary `thematic-category`; the RDF read gives it as the literal `scorpion:thematicCategory`                                                        |

A **KPI set** is the old "category": named freely by an administrator and assigned to services. `rimo_category` is its optional mapping to
RIMO. A set without a mapping is exported as a `rimo:ServiceCategory` that this instance mints. A fixed list of the 16 RIMO categories
was rejected because instances differ; a one-to-one replacement was rejected because the old data has sets that no RIMO category names.

The ontology's own words stay in the RDF read only. Tables, API fields and screens keep Scorpion's words (`name`, `unit`, `necessity`);
the read maps them. RIMO's `rimo:hasValue` points at a node, so the read writes one node per indicator (`<indicator IRI>#value`), which
M10's real values will reuse.

### 2. Identifiers

Every indicator, KPI set, unit, means of measurement and automation tool has an IRI

```text
<base>/kpi/<kind>/<slug>        kind ∈ indicator | set | unit | means | tool
```

- `<base>` is the setting `kpi.iriBase` (an absolute `http(s)` URL, or empty). Empty means the origin and base path of the request; that
  is right for one deployment and wrong for an IRI that has to survive a move, so the README tells an operator to set it.
- The slug of an indicator or a set is its `slug` (the rules of a service slug); the slug of a unit, a means or a tool is its vocabulary
  term key, which never changes. A slug never changes, so the IRI never changes.
- A seeded RIMO service category keeps `http://w3id.org/RIMO#<Name>`; a unit with a UO IRI is exported with that IRI.
- IRIs identify; they do not promise a page. Nothing dereferences them in M9 (the public RDF reads of sprint 4 serve definitions at fixed
  paths, not at the IRIs).
- No free text becomes an IRI. The slug alphabet is fixed by a check constraint and the base is validated when saved, so the one function
  that joins them (`service/iri.ts`) refuses anything that is not a plain `http(s)` IRI without a space or one of `<>"{}|^` and a backtick.

### 3. RIMO terms the model does not use, and why

| Term                                                                                                                                | Why not                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `rimo:requestedBy` (range `foaf:Agent`)                                                                                             | needs `registry.organisations` as a dependency and a usage check; deferred ([backlog.md](../backlog.md))               |
| `rdfs:subClassOf sosa:Procedure`, `schema:SoftwareApplication`, `skos:closeMatch`, `dct:relation`, `rdfs:seeAlso` (EDAM, bio.tools) | alignments of the ontology to other vocabularies; the read does not repeat them                                        |
| `voaf:Vocabulary`, `owl:Ontology` header                                                                                            | describes RIMO itself; the seed keeps only its IRI and `owl:versionInfo`                                               |
| Instances of `rimo:MeasurementMeans` and `rimo:AutomationTool`                                                                      | RIMO names the classes and ships no instances; the two vocabularies are declared empty and an administrator fills them |
| `rdfs:comment` of a category, in German                                                                                             | RIMO has English only; the seed carries `en`, and an administrator may add `de` labels                                 |

### 4. The version, and how a new one is adopted

- The repository holds the file **as published** (`modules/kpi-framework/config/rimo/RIMO.ttl`, CC BY 4.0, attribution in the module
  README) and the commit it was taken from. This ADR follows **RIMO 0.2.0**, commit `5ead6c6fce43708be2f9cbb0258139b1f8b390df` of
  `JKoblitz/BH25-metrics` (2025-11-19), which is also the head of `main` on 2026-10-14. RIMO 0.2.0 is treated as stable (the maintainer,
  2026-10-14).
- The seed `config/rimo-seed.json` is **generated** from that file by `scripts/rimo-seed.ts`, our own small extractor with no parser
  dependency. It knows the shapes this file uses and **fails loudly on any other**, so a new file that changes a shape cannot pass quietly.
  A drift test regenerates the seed and compares it with the committed one.
- **Adopting a new version:** replace `RIMO.ttl`, change the commit and version in the README and in this ADR's addendum, run
  `pnpm --filter @scorpion/kpi-framework rimo:seed`, and read the diff of the seed. A category that disappeared or a changed IRI is a
  migration for sets that name it (the key of a term in use is never deleted, only deactivated) and needs its own ADR; an added category is
  seeded at the next start without one. The RDF reads name the version they follow.
- Nothing fetches RIMO at run time or in CI.
- **Units without a UO term.** The Units Ontology has `count unit`, `percent`, `second` and `byte`. It has no term for a request, a user,
  a publication or a citation (checked against `uo.owl`, 2026-10-14). The four seeded units of that kind map to `count unit`, because each
  is a count of a kind of thing, and carry no symbol; no UO IRI is invented. The unit keeps its own key and its own minted IRI, so the
  distinction survives in this system.
- **The seed has 16 categories**, not the 17 the first draft of the plan said: the file has 16 `rimo:ServiceCategory` instances. The plan
  and `implementation.md` were corrected; the file is the source.

### 5. The prototype of the RDF read

Before the tables, the plan required a proof that Turtle and JSON-LD can be written by hand and still be valid. A throwaway script outside
the repository (not committed, with `n3` and `jsonld` installed in a scratch directory) rendered one fixture indicator and two KPI sets
(one mapped, one not) in both formats and loaded them:

- both outputs parse with `n3` (Turtle, N-Quads from `jsonld`'s `toRDF`) and give **the same 20 triples**;
- a hostile name (`"`, `\`, a newline, a control character, `<b>`, an umlaut and an emoji) round-trips byte for byte through the Turtle
  literal escaping;
- an IRI with a space, `>`, `"` or a scheme other than `http(s)` is refused by the IRI function;
- a literal with NUL, a lone surrogate and U+2028 still parses (the escape function writes `\u` sequences).

The rules are therefore: escape `\`, `"`, `\n`, `\r`, `\t` and every other control character in a Turtle literal; replace a lone surrogate
with U+FFFD; refuse an IRI that is not a plain `http(s)` IRI; let `JSON.stringify` escape JSON-LD. The read itself is sprint 4; no parser
joins the repository's dependencies (not even for tests: the round-trip tests of sprint 4 check structure and escaping with fixtures, and
the prototype's result is recorded here).

## Consequences

- Indicators and sets can be handed to a RIMO consumer without a mapping sheet, and a RIMO-shaped file can be diffed against ours.
- Two small pieces of our own code (the seed extractor and the RDF writer) replace a parser dependency. Both fail loudly, both are
  table-tested, and a new RIMO shape is a visible change in review.
- The model carries two more vocabularies that start empty (`kpi.measured-by`, `kpi.automation-tool`); an operator has to fill them
  before an indicator can name a means or a tool.
- Units and the RIMO category IRI live in code and in the seed, not on the vocabulary term; an administrator's own unit has no IRI of its
  own. Metadata on vocabulary terms is a backlog item.
- A later RIMO version is an ordinary change with a visible diff; it is not adopted by accident.

## Addendum (M9 sprint 3): how a module takes part in the service wizard and the service page

Sprint 3 links a service to its KPI set and has to put a wizard step, a field and a section into pages that `registry.services` owns, from a
module it does not depend on. Four decisions, each the smallest change that works and each additive:

1. **The fourth export of a `ui` entry: `wizardExtensions: { widgets, applies, sections }`.** The shell forwards it once per process
   (`apps/web/src/lib/wizard-extensions.ts`, called from the root layout; the generated `ui.ts` reads it with `wizardExtensionsOf(entry)`,
   so a module without one is `undefined`) to a registry in **`@scorpion/ui-kit`** (`wizard-extensions.ts`), and the pages of
   `registry.services` read it back (`registerFieldWidget`, `registerStepApplies`, `registerServiceSection` live there; the file in
   `registry.services/ui` re-exports them). The registry is in the kit, not in `registry.services`, because the shell would otherwise import a
   module that a profile (`core-only`) leaves out. `sections` is the one addition to the plan's `{ widgets, applies }`: the service page had
   no extension point, and a section is a component like a widget, forwarded the same way. A fixture of a page test uses the same forwarding.
2. **The storage `module` and a `store` function on the field type.** The plan said the wizard value lands through the field type "so the
   existing create transaction writes it" and, in the same sprint, that the link lives in this module's own tables (Decision 6), not in
   `svc_field_value`. Both hold only if the create transaction can call the module. A field with `storage: { kind: 'module' }` has a type with
   `store(tx, { serviceId, value, config, actorId })`, which `create` calls after the service row and before its event; a failure of any
   part (a KPI table, the event) takes the service back. A patch of such a field is 422: the module has its own route. The plan also said the
   module _consumes_ `registry.service.created@1`; the outbox delivers after the commit, so that could not be one transaction and it is not
   used. Nothing about validation changed beyond the field config: `check` still answers on the field, and `body.ts` skips what the form hides.
3. **`showIf` on a field and on a contributed step**, `{ path, equals }` or `{ path, oneOf }`, a deep comparison on the form as sent. The
   server asks it (`service/body.ts`): a hidden field is not required and its value is dropped. The browser asks the same question of the same
   data. A step's JSON Schema leaves a field with a condition out of `required` (the browser is looser than the server there, the allowed
   direction). The start refuses a condition that asks about a pointer no field has. `applies` stays a browser-only function. This closes the
   two backlog items "a step that `applies` hides cannot have a required field" and "field-level conditions".
4. **A facet may add a field to the v1 service row.** `v1: { field: 'category', valuesOf, keysOf }` on a `service.facet` entry adds
   `category` to the rows of `GET /api/v1/services` and a `category` filter (names, without case). `field` is an allow-list with one value,
   so a module cannot add an arbitrary key to a public row. Without such a facet `category` is `null` and the filter is 422. The change to
   the v1 document is additive (the diff job checks it).

A fifth, small one: **`isProviderManagerAsSystem(userId, serviceId)`** on `registry.services/public` answers the question that the policy
`service.member` (ADR-0036) answers for `service.edit-identity` (an approved manager of the provider), so `kpi.framework` can contribute its own `authz.resourcePolicy` entry for
`kpi.framework.service.kpis.edit` (scope `service`) without a second copy of the rule. The policy still decides at every call and caches
nothing; a removal is seen at the next one.

**Names.** The event is `kpi.serviceSet.changed@1`, not the `kpi.service-set.changed@1` of the plan: the kernel's event names are
camel-case segments (`registry.service.slugChanged@1`) and refuse a hyphen. The facet and the field type are `kpi-set`; the filter of the
catalogue is `?kpi-set=<id>`.

**Consequences.** The wizard of the `full` profile has four steps (the KPIs are last) and its end-to-end tests changed with it. The service
page makes one call more (`GET /kpi/services/{id}/kpis`) and the wizard none until a set is chosen; the numbers are measured in sprint 4.
A profile without `kpi.framework` has the wizard and the page it had.

## Addendum (M9 sprint 4): the RDF reads, and a parser for the tests

Sprint 4 writes the RDF. Seven decisions, each recorded because it departs from the text above or from the plan.

1. **Two dev dependencies, for the tests only.** Section 5 above said that no parser joins the repository's dependencies, "not even for tests", and that
   the round-trip tests would check structure and escaping with fixtures. The sprint's task replaced that with a requirement of the maintainer: round-trip the hostile names
   through a real parser. `n3` (Turtle and N-Quads) and `jsonld` (JSON-LD to N-Quads), with their `@types`, are **devDependencies of
   `@scorpion/kpi-framework`**: no runtime dependency changed, nothing imports them outside `*.test.ts`, and the image does not contain them. They
   already found a defect (an IRI such as `https:///a`, which the WHATWG parser repairs and the writer would have written as it is; `assertIri` now
   checks the text, not the parsed URL). The decision of section 5 against a _runtime_ parser stands (nothing reads RDF at run time).
2. **One graph, two renderers.** Turtle and JSON-LD are rendered from one list of nodes (`graphOf`), so the two formats carry the same triples by
   construction, and a test compares them with the two parsers. The model has no field for a service, a person or a measurement; the public
   pair cannot say one, whatever a later change does to a query.
3. **A set that maps to a RIMO category is that category.** The plan's wording ("the RIMO IRI when mapped") makes the category node the RIMO one. The
   consequences are written down: two sets that map to the same category merge, an indicator keeps the strongest relation (mandatory, recommended,
   then `appliedTo`) so that it never asserts both, and the name of a mapped set is not in the export (RIMO defines the words of its own
   categories; this instance does not redefine them). The v1 `categories` read keeps the set names.
4. **The `rimo:KPIValue` node also names the unit this instance minted** (`scorpion:unit`). Several seeded units share the UO term `count unit`
   (section 4); `rimo:hasUnit` gives the UO term, `scorpion:unit` keeps `request`, `user`, `publication` and `citation` apart. The minted unit node
   carries `skos:closeMatch` to the UO term. The value node also carries the value type and the bounds (`xsd:decimal`), because the §3 table lists
   them as part of what an indicator's value is.
5. **The public pair is on the internal surface**, at `/public/kpi/rimo.ttl` and `.jsonld` like `/public/services/{ref}`, not under
   `/api/v1`: v1 never has a public route except the specification (ADR-0037), and a public read does not belong to the versioned contract. So the
   two public routes are **not in the v1 document** and are not listed on the landing page `/docs`, which draws that document; the
   description of the v1 pair names them, the README and `docs/security/authorization.md` list them, and the table of every route (generated) has
   them as `public`. A query string is 422 on all four routes, so junk parameters cannot fragment a shared cache. The `max-age` is 300 seconds (a
   definition changes rarely, unlike the unpublish of a service, whose 60 seconds the public service reads use); the ETag is strong, the hash of
   the bytes, and `If-None-Match` in any usual form (strong, weak, a list, `*`) gets 304.
6. **No switch for the public pair.** The public service reads can be switched off (`service.allowPublic`); the public KPI pair cannot. The
   definitions are the shared vocabulary of an instance and hold nothing about who runs what, so the plan did not ask for one; an operator who
   wants none removes `kpi.framework` from the profile. Backlog: a setting, if an instance asks.

7. **IRIs of deleted indicators are not reserved.** The sprint 2 backlog asked for a decision before the reads were public. An indicator or a set
   that something uses cannot be deleted (409), and the slug of a deleted row is free again, so a later indicator of the same name gets the same
   IRI. A tombstone table that reserves every slug ever published would be the only complete answer; it adds a table, a rule on every create and a
   way to release a slug, for a case (delete an unused indicator that was published, then create another one with the same name and a different
   meaning) that an administrator can avoid by renaming. So M9 documents the rule (the README of the module and the backlog) and does not build the
   reservation. If a consumer ever stores these IRIs as keys, the reservation is the first thing to add.

**Consequences.** The writer is about 370 lines and its tests are the safety argument; a new RIMO shape or a new field of the model is a visible
change to one file. The model builder reads in one read-only repeatable-read transaction, so a concurrent edit never gives a category that
an indicator list lacks. M10 reuses the `rimo:KPIValue` node: its measurements per period become triples on that node (or on nodes that point to
it) and stay out of the shared model, so the public pair keeps saying definitions only.
