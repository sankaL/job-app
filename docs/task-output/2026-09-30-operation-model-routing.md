# Operation-based model routing and writing requests

Completed locally on 2026-09-30, reviewed before commit on branch `v1.2`.

Full writing uses Sonnet 5.5 with GPT 6.1 Sol fallback. Section/job writing, keyword optimization, extraction, factual audits, repairs and requested quality scoring use Gemini 3.8 Flash with GPT 6 Luna fallback. All use provider-default reasoning and native JSON-schema output. Jev classification is enabled by default with preserved local parsing on failure. Local parsing, contact handling, validation, comparison, formatting and export remain deterministic.

Basic/Pro control monthly writing requests only: 10/60, adjustable by administrators. Migration 021 preserves existing usage counters and deprecated model metadata for rollback. Current APIs, reservations and workers ignore subscription model/effort overrides, including older queued jobs. The admin page accepts only whole-number allowances and retains unsaved edits during refresh. Internal calls do not add quota usage; failed operations refund the reserved action.

Standalone generative import cleanup and automatic post-generation quality scoring are removed. Ambiguous nested extraction remains optional, uses Tier 2 and preserves source text on failure. Resume Judge remains available on request. Existing flat resumes, user edits and draft source snapshots were not automatically rewritten.

## Code review and fixes

Reviewed operation routing, legacy compatibility, output transport, bounded fallback, quota failure handling, privacy, user scoping, admin refresh state and migration rollout.

- Historical Markdown repair jobs could reuse the expensive writing pair. They now use Tier 2.
- Repairs previously received a rule code without the rejected wording, allowing repeated unsupported claims. Typed, privacy-masked rejected candidates now accompany targeted feedback; final repair switches to the Tier 2 fallback after repeated rejection. Invalid-shaped candidates are omitted.
- Rejected keyword optimization kept the previous draft but could retain the request charge. Callback and cached-success recovery paths now refund that reservation; regression coverage checks that unrelated usage remains charged.
- Success callbacks and cached-result recovery could launch redundant Resume Judge jobs. These are removed; manual scoring coverage remains.
- Model authentication/billing rejection could trigger futile fallback. Current adapters now stop it.
- Admin refresh could show stale allowances or overwrite edits. Pristine values refresh; edited values remain. State updater logic remains pure for React Strict Mode, and overlapping saves are disabled.

No unresolved blocking findings remain in the reviewed change. A broader resume-quality/reliability evaluation remains necessary before estimating a production success rate.

## Verification

- Makefile local Docker checks: 391 backend tests, 223 worker/evaluator tests, 197 frontend tests and 15 local environment guards passed; TypeScript and production frontend build passed.
- Mocked actual OpenRouter transport verifies all four current models use native JSON output, default reasoning, no forced output tools, bounded typed correction and strict local validation. Import tests cover both Tier 2 models and exact source preservation.
- Controlled recovery tests verify Tier 1 fallback, Tier 2 audit/repair routing, rejected-output feedback and switching writer after repeated semantic rejection.
- Live synthetic protocol probes passed for all four generative models. Jev classified fictional Skills/Education blocks correctly.
- Live full-low generation, individual-job regeneration and keyword optimization passed. An initial aggressive full-generation run failed closed on unsupported summary scope despite two repairs. After adding repair context and final Tier 2 failover, a fresh aggressive run passed with one writer call and one factual audit. That fresh result required no repair and therefore is not evidence, by itself, that the recovery change caused the pass; controlled tests establish the routing and feedback behavior.
- Recorded workflow evaluations used 15 HTTP requests in total, with $0.19300200 provider-reported cost, including the initial rejected aggressive run. Tiny protocol/classifier probes are additional and excluded from this workflow total. The sample is synthetic and too small to estimate failure rates or writing quality.
- Migration 021 applied only to local Postgres. Local API reports Basic 10 / Pro 60; API and worker use configured credentials and the requested model pairs. Worker heartbeat and API/frontend health passed. Queue was empty when runtime configuration was restored.

No production deployment was performed. Saved synthetic evaluation metrics remain local under `/tmp/operation-routing-evals/`.
