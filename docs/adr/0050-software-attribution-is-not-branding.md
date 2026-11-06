# ADR-0050: The software's own attribution is not instance branding

- Status: Accepted
- Date: 2026-11-06

## Context

CLAUDE.md rule 9 says "No hard-coded branding. Instance name, product name, sender address, URLs, contact email and legal texts come from settings."
The footer should say that the page is made by Scorpion, with the version and the licence, and the header should show the Scorpion mark until an
operator uploads a logo. Read literally, both break rule 9.

## Decision

1. The rule is about the **instance's** identity. The software's own identity is not branding: the footer carries a fixed "Powered by Scorpion", the version
   (the root package version, read at build time) and a link to the licence, beside the copyright `© year instanceName`, which still comes from the settings.
   No setting changes or removes the attribution, and no `copyrightHolder` setting is added.
2. The Scorpion mark ships as two built-in assets of the web app (light and dark) and is the **fallback** of the two logo slots of the branding settings. An
   upload always wins, and an instance that uploaded one logo never shows the Scorpion mark next to it. The assets are committed build files, not uploads,
   so they are not re-encoded or stored in the blob store.
3. CLAUDE.md rule 9 is amended: "The software's own attribution (name, version, licence link, the default logos) is not instance branding and may be fixed
   in the code."
4. The version shown to anyone departs from ADR-0045, which keeps module versions from visitors; only the product version is shown, not modules or the
   profile.

## Consequences

- A test pins the footer: the instance name in the copyright, the attribution present, and no setting behind it.
