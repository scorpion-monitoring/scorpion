# ADR-0031: Gate 1 passes conditionally while the second pass waits

- Status: Accepted
- Date: 2026-10-09

## Context

Gate 1 requires the second-pass self-review of the four ASVS chapters (`implementation.md` §8.2): a re-check of every `pass` and `n/a`
at least 7 days after the first pass, which the tool enforces (`second_pass.on` is at least 7 days after `assessed_on`). The first pass
was recorded on 2026-10-09, so the second pass cannot be dated before 2026-10-16. Nothing else in the second pass needs code. M6 lists
Gate 1 as a dependency, and a week of waiting would stop the registry work for no technical reason.

## Decision

1. Gate 1 is **conditionally passed on 2026-10-09**: every criterion of the gate holds except the recorded second pass. The 7-day rule
   and the validator stay as they are.
2. M6 may start after release `0.7.0` (M5). Registry code does not touch the scoped paths of the four chapters; if it must, the
   `asvs-impact` rule applies as always.
3. Gate 1 is **cleared on 2026-10-16 or later**, when the maintainer has recorded `second_pass` in the four chapter files and
   `pnpm security:asvs --write` has regenerated the reports and the README badges to `self-assessed`. Until then the badges say
   `in progress`.
4. The `core-only` image is built and published by CI (ADR-0030, CONTRIBUTING.md "Images in the registry"); the maintainer deploys it
   from the registry to a VM as the dev instance. Staging is that VM.

## Consequences

- No claim changes: the badges do not show `self-assessed` before the second pass exists.
- If the second pass finds a gap, the fix goes into the milestone then in progress, and the gate stays open until it is closed.
