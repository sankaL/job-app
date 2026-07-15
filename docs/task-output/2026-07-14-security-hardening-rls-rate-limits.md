# Security Hardening Audit — 2026-07-14

## Scope

Audited the backend, worker, frontend, Chrome extension, database migrations, production configuration, and dependency manifests. The work focused on database isolation, API abuse controls, SSRF, authentication/session behavior, upload handling, browser permissions, unsafe logging, response headers, and known dependency vulnerabilities. Fallow 3.5.0 was run in full, security, and changed-file audit modes.

## Identified and fixed

| Severity | Finding | Resolution |
|---|---|---|
| Critical | The PRD required RLS, but all 11 application tables explicitly relied on backend ownership predicates alone. | Added migration `20260714_000018_enable_row_level_security.sql`; it creates a non-login `NOBYPASSRLS` runtime role, forces RLS, defines per-table policies, and makes every repository transaction establish exactly one user or service context. Explicit `user_id` predicates remain in place as the first isolation layer. |
| High | API instances had no shared rate limiter, leaving login, invite, upload, extension, callback, and expensive AI/export routes open to abuse. | Added atomic Redis fixed-window middleware with a 600/min network ceiling, per-route buckets, validated signed-token identities, network-scoped pre-authentication buckets that cannot be diluted with forged headers, validated proxy-hop handling, 429 retry metadata, bounded Redis timeouts, and production fail-closed configuration. |
| High | URL extraction navigated a user-supplied URL with Playwright and did not reject local/private network destinations or redirect/subresource pivots. | Added bounded HTTP(S)/DNS validation before queueing and in the worker, rejected credentials and all non-global IP space, and installed a Playwright route guard for redirects and subresources. |
| High | `npm audit` reported vulnerable React Router production packages and vulnerable Vite, Vitest, PostCSS, `ws`/jsdom development packages. | Upgraded `react-router-dom` to 7.18.1, Vite to 6.4.3, Vitest to 3.2.7, PostCSS to 8.5.19, and jsdom to 28.1.0. Final full and production-only npm audits report zero vulnerabilities. |
| High | Chrome extension content code ran on every visited URL and requested `<all_urls>` plus `tabs`. | Removed broad host and tabs permissions. Arbitrary-page capture now uses `activeTab` plus on-demand script injection after the user opens the popup; the persistent bridge is limited to exact localhost and `applix.ca` origins. |
| Medium | Refresh-token rotation revoked and inserted in separate operations, leaving a replay race where the same token could be refreshed concurrently. | Replaced it with a conditional revoke-and-insert transaction. A losing replay revokes the user's token family, clears the cookie, and returns 401. |
| Medium | PDF upload validation trusted extension/content type and could read or parse oversized/overly complex content without sufficient bounds. | Added an 11 MB route-body ceiling before multipart parsing, then enforced a 10 MB PDF read cap, PDF magic bytes, filename/name limits, 50-page maximum, 200,000-character cap, and parsing in a killable subprocess with a 15-second deadline. Markdown create/update payloads are also capped. |
| Medium | Refresh failure branches attempted to clear the cookie on FastAPI's injected response and then raised an exception, so the deletion header could be discarded. | Refresh failures now return the actual cookie-clearing error response, with regression coverage for replay rejection. |
| Medium | Refresh throttling or a temporary Redis outage was cached by the browser as a permanent session failure, and CORS hid retry metadata. | Only 401/403 refresh failures are now session-terminal; 429/503 remain retryable, and `Retry-After` plus rate-limit headers are exposed to trusted browser origins. |
| Medium | Temporary DNS failures were reported as invalid job URLs. | Added a distinct fail-closed resolver-unavailable error mapped to 503 with `Retry-After`, while malformed, unresolvable, and non-public URLs remain 400 errors. |
| Medium | Production could expose broad CORS/OpenAPI behavior, run with dev mode, disable throttling, or accidentally use the repository's known local signing key. | Restricted CORS methods/headers and exact extension origins, disabled API docs outside development, validated dev mode hosts, required fail-closed rate limiting in production, and reject the local-development JWT public-key fingerprint in production. |
| Medium | Responses lacked a consistent browser security-header baseline. | Added `nosniff`, frame denial, no-referrer, restrictive permissions policy, API `no-store`, and production HSTS. |
| Medium | Worker-secret comparison was not constant-time, and some cleanup/rate-limit errors could log provider payloads or connection details. | Switched the worker secret to constant-time comparison and removed raw provider responses, exception strings, and Redis tracebacks from these logs. |

## Fallow 3.5.0 results

- Full scan: 14 static dead-code/API findings (1 unused file, 10 unused exports, 3 unused types), 26 clone groups covering 1,194 of 16,610 analyzed lines (7.19%), and 45 complexity findings (12 critical, 10 high, 23 moderate). Average maintainability was 91.1.
- Highest maintainability hotspot: `frontend/src/routes/ApplicationDetailPage.tsx` at 3,082 lines, cyclomatic complexity 241, and cognitive complexity 334.
- Security scan: 9 SSRF candidates, all dynamic browser `fetch` destinations in `frontend/src/lib/auth.tsx`, `frontend/src/lib/api.ts`, and the Chrome extension popup. Manual verification found these are browser-side requests rooted in the configured API origin or the popup's explicit trusted-origin set, not server-side arbitrary outbound requests. They remain recorded as verified false positives rather than suppressed globally.
- Important coverage limit: Fallow analyzes TypeScript/JavaScript and did not see the Python Playwright SSRF path. The manual security review found and fixed that issue.
- Changed-file audit against `origin/main`: zero changed-file dead-code, complexity, or duplication findings.

The initial security commit kept these maintainability findings separate from the isolation rollout. The follow-up remediation on the same branch now clears all 14 static issues and all 26 clone groups, reduces critical complexity findings from 12 to 7 and high findings from 10 to 4, and preserves all 153 frontend tests. See `docs/task-output/2026-07-14-fallow-remediation.md` for the complete before/after report and remaining route-decomposition backlog.

## Verification performed

- Local migration runner applied all migrations successfully through `20260714_000018_enable_row_level_security.sql`; the final idempotent migration replay also passed with bounded lock and statement timeouts.
- PostgreSQL catalog check confirmed all 11 application tables have both `relrowsecurity` and `relforcerowsecurity`, and each has explicit policies.
- Live transaction test inserted two synthetic users inside a rollback-only transaction: user A saw exactly its row, user B saw exactly its row, and explicit service context saw both.
- Makefile local stack health and seed preparation passed; local login returned 200 with an HttpOnly refresh cookie, rate-limit headers, and the security-header baseline.
- Backend: 301 tests passed.
- Agents: 147 tests passed, including redirect/subresource guard behavior and validated-host caching.
- Frontend: 153 tests passed after extension, transient-refresh, and security regression coverage was added; production build passed.
- Python dependency audit: no known vulnerabilities in backend or agent resolved environments.
- npm full and production-only audits: zero vulnerabilities after upgrades.
- Fallow full, security, and changed-file audit modes completed with 3.5.0.
- Targeted tracked-secret pattern scan found only the documented local-development key and test fixtures; no likely production credential was identified in tracked files.

## Deferred / residual risk

1. The database currently connects with the migration-owner credential and switches to `app_runtime` per transaction. This protects against omitted ownership predicates, but separately credentialed least-privilege user and service login roles would better contain a compromised database credential or SQL injection.
2. Application-level DNS checks reduce SSRF substantially but cannot replace network enforcement. Block metadata/private ranges at the worker network boundary or route Playwright through an egress proxy to close DNS time-of-check/time-of-use and browser-resolver gaps.
3. Redis rate limiting begins at the application edge. A CDN/WAF or platform gateway should enforce coarse IP/body/concurrency limits before requests consume application connections.
4. Fallow's dead code and duplication are now cleared. The remaining maintainability risk is concentrated in `ApplicationDetailPage`, `ApplicationsListPage`, and `BaseResumeEditorPage`; further decomposition should remain incremental and test-led.
5. PDF parsing now runs in a killable subprocess with a 15-second hard deadline, page/text caps, and sanitized diagnostic codes. A separately sandboxed container with OS-level CPU, memory, syscall, and filesystem limits would provide stronger hostile-document isolation.
6. Refresh-token family revocation intentionally treats reuse as a possible theft signal. Two near-simultaneous legitimate refresh requests can therefore invalidate the winning replacement token; introducing a short replay grace period would improve multi-tab behavior but weakens immediate theft containment and needs a product/security decision.
7. DNS lookup timeouts stop request progress but cannot cancel an already-running operating-system resolver thread. Network egress enforcement remains the containment layer for resolver stalls and DNS rebinding.
8. `/healthz` is intentionally a process-liveness check and does not prove Redis, database, `app_runtime`, or RLS readiness. Production should add an internal or authenticated readiness probe rather than exposing an unrestricted public dependency-amplification endpoint.

## Input / production decisions needed

1. Confirm the production proxy topology and set `TRUSTED_PROXY_HOPS` to the exact trusted hop count. A wrong value can aggregate all clients under the proxy or trust a spoofable forwarded address.
2. Confirm the production Chrome extension ID/origin before enabling extension CORS. `CHROME_EXTENSION_ORIGINS` must contain exact `chrome-extension://<32-character-id>` values; the web bridge already trusts only exact localhost and `applix.ca` origins.
3. Confirm the migration runner can create/alter/grant roles and choose either a traffic-drained RLS migration/deployment window or a separate bootstrap release followed by policy activation. A normal migration-first rolling deploy is incompatible because old instances lack the RLS context. Stage the full login/admin/invite/worker/export smoke suite before production.
4. Decide whether to fund the stronger database-credential split, network-level worker egress control, and gateway/WAF controls now or track them as post-MVP hardening.
