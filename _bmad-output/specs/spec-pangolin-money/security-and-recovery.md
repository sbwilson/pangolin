# Security model

Pangolin will be public on our own domain behind Nginx Proxy Manager, so the login page is the front line.

- NPM terminates TLS with Let's Encrypt and forwards to the app on the LAN.
- The app trusts `X-Forwarded-*` headers only from the proxy's IP, and listens only on the internal network.
- A Tailscale-only install is a stricter option, deferred to the next version.

## Threats and mitigations

| Threat | Mitigations |
| --- | --- |
| Someone on the internet guesses or phishes a login | Passkeys first, password + TOTP as fallback. Registration closes after both of us exist. Login rate limiting and lockout in the app, plus rate limits and an optional Australia-only access rule in NPM. Re-authentication for exports, token changes and deletes |
| Session theft or cross-site attacks | `HttpOnly`, `Secure`, `SameSite=Strict` cookies. Origin check on writes. Strict Content-Security-Policy (no inline scripts). React escaping, no raw HTML rendering. Idle timeout |
| Server disk or backup copy is stolen | Full-disk encryption on the host. restic backups encrypted with a key that is never stored on the backup target. LLM API keys and receipts encrypted at the application level with a key file outside the database |
| Malicious npm package (supply chain) | Pinned lockfile; install scripts allowed only for an explicit list; Renovate waits 7 days before adopting new releases. Few dependencies. Non-root, read-only container. **Outbound network allowlist** at the firewall, so even compromised code cannot send data anywhere unexpected |
| One partner sees the other's private details | Redaction enforced server-side in one function, including search, exports and the audit log. Covered by tests that attempt cross-user reads and check that privacy lifts after 12 months |
| Secrets leak through logs or errors | Structured logging with redaction of tokens, amounts and descriptions by default. No third-party error tracking |
| LLM misuse or prompt injection | Local model by default. Cloud providers are opt-in, receive minimal fields and never private transactions. No tools that act, schema-constrained output, and suggestions never auto-apply tax data |
| Exported CSV executes formulas in Excel | Cells starting with `=`, `+`, `-` or `@` are prefixed on export |
| Silent data loss | Nightly encrypted backups to an append-only restic server on TrueNAS, so a compromised app host cannot delete them. A monthly restore test, and an audit log of every change |

## Account recovery (both methods)

- **Recovery codes:** 10 one-time codes generated at enrolment and stored hashed. Using one forces enrolment of a new passkey.
- **Partner-assisted:** the other partner, re-authenticated with their passkey, issues a one-time re-enrolment link.
  - It expires in 24 hours and is logged.
  - Accepted residual risk: the issuing partner holds the link and could redeem it themselves.
  - The affected person is notified in the app. Email notification is deferred to the next version.
  - It never reveals the other person's private accounts or hidden transaction names.
- **Both of us locked out:** `pangolin reset-user` on the server console, which requires shell access to the VM.
- **Server lost:** `install.sh` produces a recovery bundle (application key, auth secret, restic password) to store offline. CI restores onto a clean host from the bundle alone on every release.
- **Trust boundary:** whoever administers the VM can read everything; privacy between partners holds inside the app.

The database file itself is protected by disk encryption, not SQLCipher. SQLCipher would add a second key to manage and break standard SQLite tooling, for little gain on a single encrypted host. This can be revisited if the app ever moves to shared hosting.
