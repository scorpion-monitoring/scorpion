# Security policy

## Supported versions

Only the latest release receives security fixes, until version 1.0. Older versions get no fix; update to the latest release.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

1. **Preferred:** use GitHub's private vulnerability reporting. On the repository page, open **Security**, then **Report a vulnerability**.
2. **Fallback:** write to <feser@ipk-gatersleben.de>. Do not put exploit details into an unencrypted mail if you can avoid it: send a short note and ask for a secure channel.

Please include the version or commit, the profile, what you did, what happened, and what you expected. A proof of concept helps. Do not include real personal data.

## What to expect

Scorpion has one maintainer, so these times are working days, not a service level:

- **Acknowledgement** within 5 days.
- **A fix or a decision** within 90 days. The decision says whether the report is accepted, and if it is, when a fix will ship. If the fix needs longer, you hear why before the 90 days are over.
- **Credit** in the release notes if you want it. Tell us how you wish to be named, or that you prefer not to be.
- **Disclosure:** we ask you to keep the report private until a fixed release is out, or until the 90 days have passed, whichever comes first. We publish a GitHub security advisory with the fix.

## Scope

In scope:

- The code in this repository.
- The container images that the project publishes.

Out of scope:

- Instances that other people or organisations run, including their configuration, hosting and data. Report those to the operator.
- Vulnerabilities in third-party dependencies. Report them upstream. If Scorpion uses a dependency in a way that makes the flaw reachable, tell us.
- Social engineering, physical attacks, and denial of service by sending a very large volume of traffic.
- Reports that need access you already have as an administrator of the instance.

## Safe harbour

If you act in good faith, stay within this policy, and do not access or change data that is not yours, we will not take legal action against you for your research.
