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
