# Uncommitted change review, 2026-10-04

Scope: all 39 originally staged files compared with `d8bf7fbef89b4ea3c35d9fd8e951fa2b62fa19fc` on `langsmith-content-tracing`. No untracked files were excluded. The user authorized repair and a local commit of the entire snapshot.

Intent: preserve the eased visual progress bar, extraction prompt and timeout improvements, worker cancellation/recovery, generation budgets and sanitized tracing, copy-only prompt exemptions, and High job-fit additions. Low, Medium and keyword optimization keep their strict acceptance policy.

Mode: interactive with review, repair and commit already authorized by the user.

Reviewers: correctness, testing, maintainability, project standards, agent access, past solutions, security, performance, API contracts, reliability, adversarial cases and frontend timer races. Security inspected private callbacks, capture input and tracing. Performance inspected capture bounds and event-stream recovery. API contracts inspected extraction schemas and persisted outcome messages. Reliability and adversarial passes checked background-job ordering and concurrency. Frontend races inspected progress timers and session transitions. Reviewers ran in a bounded queue and made no project edits. One fixer applied the approved code/test changes; the parent updated documentation.

## Confirmed findings

Locations below identify the reviewed snapshot before repairs.

### P1 -- High

| # | File | Issue | Reviewer | Confidence | Route |
|---|---|---|---|---|---|
| 1 | `agents/section_generation.py:471` | High keyword optimization uses permissive claim audit | correctness, adversarial | 100 | `safe_auto -> review-fixer` |
| 2 | `agents/worker.py:1588` | Delayed started delivery can undo reconciled extraction success | adversarial, reliability | 100 | `safe_auto -> review-fixer` |
| 3 | `backend/app/services/application_manager.py:5271` | Stale recovery can replace fresh job progress | adversarial, reliability | 100 | `safe_auto -> review-fixer` |

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence | Route |
|---|---|---|---|---|---|
| 4 | `agents/generation.py:848` | Legacy High keyword instructions permit unsupported additions | api-contract | 75 | `safe_auto -> review-fixer` |
| 5 | `backend/app/services/application_manager.py:750` | Stale deletion leaves queued extraction work alive | correctness | 100 | `safe_auto -> review-fixer` |
| 6 | `frontend/src/routes/ApplicationDetailPage.tsx:4058` | Persisted declined-page outcomes lose their explanation | api-contract | 100 | `safe_auto -> review-fixer` |
| 7 | `docs/database_schema.md:42` | Expanded extraction contract lacks rollout/retention guidance | project-standards | 100 | `safe_auto -> review-fixer` |
| 8 | `agents/generation.py:244` | High writer still receives strict examples and section guidance | focused verification | 100 | `safe_auto -> review-fixer` |

## Repairs

- #1 and #4: keyword writers and audits use strict source-supported guidance at every aggressiveness level, including the human payload and legacy prompt. Coverage targets still follow the chosen aggressiveness.
- #2: started delivery remains concurrent with capture/model work, but finishes before terminal progress or cache becomes visible. Cache is written before success progress. The backend ignores delayed started callbacks for terminal jobs.
- #3: stale recovery atomically compares the checked progress snapshot before replacing it. Fresh worker/retry progress wins. Only the winner fails the application and notifies.
- #5: stale deletion fences the old job, deletes the row, clears result caches and requests abort. Its terminal Redis progress fence expires after 24 hours and prevents queued work from restarting if abort delivery fails.
- #6: persisted `posting_unavailable` and `no_job_posting` outcomes retain their specific explanations after reload.
- #7: the migration runbook records the JSON diagnostic compatibility, deployment/restart order, retention, rollback limits and verification. No SQL migration or backfill.
- #8: High section instructions and examples agree with the allowed plausible additions. Strict operations keep strict instructions.

The bar smoothly catches up to a higher server update. The earlier assertion that the displayed percentage never lags was inaccurate. The target uses the higher reported value, and the displayed value approaches it in small steps. This is a documentation correction, not a defect requiring the intentional curve to change.

## Documentation changed during review

| File | Reason |
|---|---|
| `docs/resume_builder_PRD_v3.md` | Describe smooth catch-up accurately, recovery snapshot fencing, stale-deletion retention and persisted outcome explanations. |
| `frontend/AGENTS.md` | Match the eased target/display distinction. |
| `docs/prompts.md` | Document strict keyword audit/payload and operation-aware writer guidance; synchronize the High legacy prompt sample; clarify that fallback/correction may consume the paired-call allowance and unavailable audits fail closed. |
| `docs/backend-database-migration-runbook.md` | Add the missing contract/retention/compatibility and rollout/verification note. |
| `docs/build-plan.md` | Correct prior progress wording and record review completion/validation. |
| `docs/decisions-made/decisions-made-1.md` | Correct prior progress wording and record the major cross-stack recovery decision. |
| `docs/task-output/2026-10-04-uncommitted-code-review.md` | Record this major review and its evidence. |

The original staged documentation changes were also reviewed and included: root/backend/agents/frontend `AGENTS.md`, `docs/database_schema.md`, PRD, prompts, build plan, decision log, and `docs/task-output/2026-10-03-main-production-verification.md`.

## Pre-existing failures

| File | Failure | Evidence |
|---|---|---|
| `frontend/src/test/applications.test.tsx:4145` | Compare expects immersive shell, receives default. | Reproduces on an isolated `git archive HEAD` with the same Makefile frontend test target. |
| `frontend/src/test/applications.test.tsx:4212` | Breakpoint transition replaces the editor and loses unsaved text. | Reproduces on the same isolated baseline. |

These failures are unrelated to the reviewed changes and are not counted as regressions from this snapshot. They remain unresolved.

## Learnings and coverage

`docs/solutions/` is absent. Related records include `docs/task-output/2026-09-30-section-resume-reliability.md` for cache ordering and shared audit budgets, and `docs/task-output/2026-04-09-application-delete-and-extraction-stop.md` for job-ID fencing. The October 3 review records an earlier shell fix; the pristine baseline reproductions establish the current failures directly.

All 12 selected reviewers returned results. No malformed returns or timeouts. One testing finding was excluded because it proposed changing the intentional smooth catch-up behavior. Duplicate keyword/callback/stale-recovery findings were merged. There were no agent-access gaps or additional confirmed security/performance defects. The user had already authorized fixes, so no new routing approval or ticket flow was required.

Initial verification through the Makefile local stack: backend 507 passed; agents 291 passed; frontend 285 passed and two baseline failures; TypeScript/Vite build passed. Provider keys were test-only and tracing was disabled. The isolated baseline frontend network/volumes were removed after reproduction.

Final validation passed through Makefile local targets (2026-10-04 03:43:51 EDT): backend 518 passed, agents 296 passed, frontend 287 passed with the same two pristine-baseline failures, and TypeScript/Vite production build passed. Total: 1,101 passing tests, two pre-existing failures. The backend includes an actual Redis Lua comparison/expiry test. New regression coverage also checks fresh same-job, replacement-job and other-workflow progress, concurrent recovery, stalled deletion with unavailable abort, cancellation despite cleanup failure, delayed started delivery before success/failure visibility, cache-before-ready ordering, strict keyword prompts/audits and persisted outcome messages. `git diff --check` passes.

Seven code findings and the missing runbook note are resolved. The independent focused re-review and the fixer's re-review found no remaining defects in the repaired scope. The requested commit includes the original staged files and all review fixes/tests/docs on the existing branch; no push or deployment is part of this task.

Browser animation feel and real-model extraction outcome accuracy remain unverified. A local browser run and representative posting evaluation would improve confidence. These limits do not invalidate the deterministic regression evidence.

---

> **Verdict:** Ready with fixes, all scoped actionable findings resolved.
>
> **Confidence:** 95% in the reviewed fixes. Browser/model evidence would improve confidence in presentation and prompt quality. The two baseline shell failures remain separately documented.
