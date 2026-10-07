# Pinned ASVS source

`OWASP_ASVS_5.0.0_en.json` is the official English JSON export of the OWASP Application Security Verification Standard 5.0.0. It is the only
source of requirement ids and texts for `pnpm security:asvs`: the tool reads the chapters V6, V7, V8 and V10 from this file and fails if the file
changes without this record changing.

- Origin: asset `OWASP_Application_Security_Verification_Standard_5.0.0_en.json` of the release
  [`v5.0.0_release`](https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release) in the repository `OWASP/ASVS` (tag commit `5cf9b032440be53ce345ab3c130fda46ba1ce7a2`, released 2025-05-30).
- Fetched: 2026-10-06.

SHA-256: `bcdbec214d70abcfad9284a31d4f9e5134305831d628aad3aa85d7e26626cb35`

Check it by hand with `shasum -a 256 OWASP_ASVS_5.0.0_en.json`. To pin another version, replace the file, update the hash and the origin here, run
`pnpm security:asvs`, and say why in an ADR: the requirement ids are what the assessments are checked against.

## Licence and attribution

The ASVS is © the OWASP Foundation and its contributors, licensed under
[Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/).
The file is included unchanged. The generated reports in `docs/security/asvs/*.md` quote requirement texts from it and are shared under the same licence. OWASP does not certify projects and does not endorse this one.
