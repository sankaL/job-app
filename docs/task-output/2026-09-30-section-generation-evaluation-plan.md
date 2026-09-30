# Section generation verification

The follow-up uses fictional resumes through the production section pipeline and Pydantic AI runtime. Its model selection uses worker environment defaults, without subscription-tier overrides; this sample does not measure the live Basic/Pro model pairs. The evaluator never connects to application data, hosted auth/database services, Redis or application callbacks. Tracing is disabled. Run instructions and the case contract are in `agents/evals/README.md`.

The live cases cover low and high aggressiveness, one-role regeneration with unrelated manual edits, and minimal keyword optimization. Offline cases also inject malformed output, a changed metric and an unsupported technology to check typed correction and targeted repair. Deterministic checks have explicit factual and preservation labels. The pipeline's semantic audit is part of the evaluated system; passing it is not independent evidence of factual truth.

## Live findings

The first sample used eight requests, 37,866 input tokens and 5,384 output tokens in 53.8 seconds. OpenRouter reported $0.02763392. Full generation and role regeneration failed with `unexpected_section_id` before any audit or draft output. Keyword optimization was inconclusive because the evaluation request allowance was exhausted.

The writer's provider-facing schema exposed section items as arbitrary dictionaries. The fix supplies complete nested rewrite and keyword-patch schemas, while retaining independent strict local item validation and sibling repair. Prompts include output skeletons and request-specific section/entry ID allowlists. Safe output-shape diagnostics contain counts and predefined tokens, without model text or arbitrary IDs.

After that change, full low-mode generation and one-role regeneration passed through the fallback model, using eight requests and $0.00615256 of reported cost. The primary provider rejected the nested schema with HTTP 400. Explicitly disabling native strict-tool enforcement did not resolve the rejection. A one-request diagnostic extracted only redacted error messages and returned "Request contains an invalid argument." The Google transport profile now retains only documented function-schema attributes after the SDK inlines definitions and resolves nullable unions. Nested types, properties, IDs and required fields remain visible; omitted bounds and extra-key rules remain strict local checks. A subsequent one-request probe returned HTTP 200. This isolates the unsupported attribute set, not one particular keyword.

Fresh end-to-end samples then passed all four cases:

| Case | Requests | Latency | Result |
| --- | ---: | ---: | --- |
| Full low mode | 2 | 8.9 seconds | Fixed facts and section order preserved |
| Full high mode | 4 | 20.4 seconds | Passed after one targeted repair |
| Role regeneration | 2 | 7.2 seconds | Other roles, manual sections and order preserved |
| Keyword optimization | 2 | 8.4 seconds | Supported missing phrase added; matched phrases and unrelated edits preserved |

All ten HTTP requests succeeded. The primary model wrote each initial candidate; the fallback model performed the grounding audits and the high-mode repair. No typed correction was needed in this fresh sample. Totals were 40,743 input tokens, 6,155 output tokens and $0.03746250 of provider-reported cost. Human inspection found no unsupported facts in the final fictional outputs. Low mode was conservative. High mode dropped the source's useful 35% latency metric, which is allowed but illustrates why factual acceptance and writing quality need separate labels.

Every live run has explicit request, reserved-output-token and time limits. The reported-cost threshold stops later requests; the final in-flight request can cross it. Missing cost metadata on successful responses stops further calls. Error responses may omit usage, so totals describe known provider-reported costs. These small diagnostic samples cannot establish a generation failure rate.

## Browser and export checks

A dedicated fictional user on the Makefile-managed local stack created and reviewed Experience, Education and a custom Community work section. Reordering and saving preserved those sections on reload. Editing populated fields exposed a JSONB property-order issue; semantic field order now stays stable across saves, with four regression cases.

A manually seeded draft was edited and saved through the inline workbench. Comparison showed the changed bullet under its original role and kept source revision 2 after the base resume moved to revision 3. Education remained directly editable with regeneration disabled. The role regeneration dialog required instructions and targeted the selected role. The walkthrough did not dispatch an AI job.

Actual local HTTP exports verified a 14,052-byte PDF and a 37,169-byte DOCX against the latest saved bullet, Education and profile header. Both retained the draft's source snapshot. The in-app browser did not capture the Blob download event, so browser file delivery remains unverified. Seed verification proved application and draft insertion atomic, then rolled it back without changing existing edits.

## Local test safeguards

Browser startup rejects hosted API/app endpoints, effective shell overrides, running workers and unknown worker state. It starts only the API/frontend with a test provider key, email and tracing disabled. Database guards reject connection-host overrides. Seed/export operations have bounded database and HTTP timeouts and close their temporary login session. Tests use the Makefile-managed Docker stack; no production database or auth service was used.

The offline evaluator passed all seven cases with 19 mocked HTTP requests, one typed correction and two targeted repairs. Synthetic mock usage and timing do not predict live cost or latency. The complete worker suite passed 224 tests. Frontend verification passed 199 tests and the production build. Local environment and cleanup guards passed 15 tests. The complete backend suite passed 383 tests after applying the same scoped transport subset to import calls. Mocked Google and non-Google requests verify the nested fields object and strict local string-map/source corrections. Independent reviews closed without outstanding findings.

Jev classification and live import parsing remain outside this evaluation. They need a separately labeled upload set for section boundaries, contact removal, field extraction and review decisions. Jev remains opt-in. The representative provider-quality benchmark is also still outstanding.

Verified: 2026-09-30 17:44:02 EDT.
