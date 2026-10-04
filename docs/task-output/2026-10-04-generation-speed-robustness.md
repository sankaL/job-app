# Generation speed and robustness (2026-10-04)

**Branch:** `generation-speed-robustness`, one commit per phase.
**Priorities (user):** speed, then quality/robustness, then cost.

## What changed
1. **Bounded reasoning and citation rules.**
   - Per-family reasoning: Anthropic capped at 2,000 tokens, Google at medium effort, OpenAI at its default.
   - Output limits: 16k per call, 64k per workflow.
   - Summary implicitly cites its own source; Summary and Skills may cite Experience bullets.
2. **Provider routing.**
   - Every request denies provider data collection and sorts by latency.
   - Gemini is pinned to Google AI Studio.
   - The serving provider and its cost are recorded.
3. **Jev evaluation.** 684 labelled claims; both gates passed. See `2026-10-04-jev-audit-evaluation.md`.
4. **Jev first-pass audit.** Claim-level decisions; only uncertain claims escalate to the Sonnet LLM audit (Gemini fallback). Jev outages fall back to the full LLM audit.
5. **Parallel writing.**
   - Two concurrent writer groups (Experience / everything else), each audited as soon as it is written.
   - Sonnet repairs; 10-request allowance.
   - Prompt caching: system prompt plus a stable payload prefix.
   - Summary/Experience overlap recorded as a diagnostic only.
6. **Keep-original fallback.** Unverifiable sections keep their original text with `generation_notice: kept_original_unverified` instead of failing the generation. The worker's recheck uses the same fallback. The UI shows a notice that clears on edit.
7. **Progressive display.**
   - Verified sections stream as `partial_sections` on progress; the worker now publishes progress on the event channel.
   - The preview replaces skeleton blocks as sections arrive.
8. **Fixes found during live verification.**
   - The contact-URL pattern treated a sentence ending in "portfolio." as a profile link, forcing two repair rounds every run. Fixed in the agents and backend copies.
   - Contact checks now report specific codes.

## Live end-to-end benchmark (same real resume and job description, sequential runs)

| Flow | Medium median (max) | High median (max) | LLM calls | Cost/generation |
|---|---|---|---|---|
| Old (`925d4d9`) | 77.6s (101.3s) | 33.1s (33.4s) | 2–4 | ~$0.12–0.16 (key usage delta, noisy) |
| New | **15.3s (15.6s)** | **22.9s (23.1s)** | 3 | **~$0.06** (provider-reported) |

- First verified sections reach the UI at about 12–14s.
- All 6 new runs were clean on the first try: no repairs, no kept-original fallbacks.
- High includes one Sonnet audit (~5s), because retitled roles always use the LLM audit.
- Prompt caching read 10.5k cached tokens per writer call on warm runs.
- LangSmith (`applix-dev`) shows the served provider, the routing, the reasoning cap, Jev decision runs and escalations.

## Verification
- **Agents:** 331 passed. **Backend:** 522 passed. **Local guards:** OK. **Frontend build:** OK.
- **Frontend tests:** 293 passed. 3 failures are unrelated:
  - 2 shell-layout tests that also fail on `bfa54bc`
  - 1 auth-shell test that passes in isolation 3/3 (timing flake under full-suite load)
- **Local stack:** restarted with `make dev-runtime`; `make health` OK.

## Rollout
Backend and frontend first (they accept `generation_notice` and `partial_sections`), then the worker. Railway needs no new variables; the `JEV_AUDIT_*` defaults apply. See `docs/backend-database-migration-runbook.md`.

## Known limits
- **Benchmark scope:** one real resume (QA engineering), 3 runs per level. Times will vary by resume length and provider load.
- **Jev thresholds:** tuned on synthetic plus one real resume. Watch escalation rates in LangSmith.
- **Cache benefit:** the two round-0 writer calls start together, so caching mainly helps repairs, regenerations and back-to-back generations.
