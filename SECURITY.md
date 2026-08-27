# Security policy

## Reporting a vulnerability

Send reports to **security@thel.email**. A PGP key is available on request.

Please include enough detail to reproduce the issue: affected version or commit, the steps involved, and what an attacker gains. If you have a proof of concept, include it.

We aim to acknowledge a report within three working days and to keep you updated as we work on a fix. Please give us a reasonable opportunity to release one before disclosing publicly.

Do not test against other people's accounts or mailboxes. Register your own account for testing.

## Scope

This repository is the browser client. Findings that are in scope here include:

- Anything that causes plaintext, private keys, or the vault passphrase to leave the browser
- Weaknesses in key generation, key derivation, or vault wrapping
- Failures in directory key verification or transparency log proof checking that would let a substituted key be accepted
- Cross-site scripting, particularly in the rendering of received mail
- Authentication and session handling flaws, including the OPAQUE exchange as implemented on the client

Server-side issues belong to the backend rather than this repository, but report them to the same address and we will route them.

## Out of scope

- Missing security headers with no demonstrated impact
- Automated scanner output without a working proof of concept
- Denial of service through volume alone
- Social engineering, and physical attacks
- Vulnerabilities in dependencies with no demonstrated path to exploitation here
