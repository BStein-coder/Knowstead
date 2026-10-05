# Security policy

*[Deutsche Fassung](SECURITY.de.md)*

## Supported versions

Security fixes are provided for the **latest published version**. Older versions – including
installations from the time when Knowstead was still called "Doku" (up to 1.9) – can be updated without
losing data: [docs/INSTALLATION.en.md → Updates and moving](docs/INSTALLATION.en.md#11-updates-and-moving).

## Reporting a vulnerability

Please do **not** open a public issue. Report it privately via
**[Security → Report a vulnerability](https://github.com/BStein-coder/Knowstead/security/advisories/new)**
(GitHub Security Advisories) in this repository – or by e-mail to <info@steintecdev.com>.

Helpful details:

- the affected version and how Knowstead is run (Windows, Linux, Docker),
- a description with steps to reproduce or a proof of concept,
- the impact (e.g. privilege escalation, data disclosure, account takeover),
- whether the vulnerability is already publicly known.

We acknowledge your report within **5 business days**, agree on a timeline for the fix with you and, if
you wish, credit you in the release notes.

## Security features at a glance

- Passwords hashed with scrypt, session cookies `HttpOnly`/`SameSite=Lax`, CSRF protection through a
  dedicated header, lockout after failed sign-in attempts, rate limiting on sign-in, SSO and AI routes
- Single sign-on: OIDC with PKCE, `state` and `nonce`; SAML with signed assertions and validation of
  issuer, audience and `InResponseTo`; every sign-in flow is bound to the browser; Windows sign-in only
  through registered proxy addresses and an optional shared secret
- Permissions are checked centrally for spaces, pages, attachments, search, exports and live connections
- HTML sanitisation for all content, Content Security Policy and further security headers
- Credentials (SMTP, LDAP, AI, SSO, connectors) are stored encrypted with AES-256-GCM
- Uploads with size and extension limits, protection against ZIP bombs and path traversal during import
- API tokens with scopes (`read`, `write`, `admin`), signed webhooks
- Audit log for security-relevant events

Recommendations for operation are in the production checklist
([docs/ADMINISTRATION.md](docs/ADMINISTRATION.md#checkliste-für-den-produktivbetrieb), German).
