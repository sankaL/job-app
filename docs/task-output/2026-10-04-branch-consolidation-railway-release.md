# Branch consolidation and Railway release

Preflight verified 2026-10-04 18:58 EDT. The owner authorized merging current work into main and deploying production. PR #19 is the existing release PR; no additional PR is needed.

## Branch inventory before merge

| Branch or group | State relative to main `bfa54bc` | Action |
| --- | --- | --- |
| `generation-speed-robustness` | 21 commits ahead, zero behind, at `29ca8aa` | Merge through PR #19 after deployment-gate hardening |
| `langsmith-content-tracing` | Two commits ahead, already contained in the generation branch | Included by the same PR |
| `codex/kewords` | One ancestry-only extra commit; its patch is equivalent to a main commit | Preserve branch; no replay needed |
| `ui-changes-qoder` | One unique April UI/analytics prototype, 139 commits behind | Owner chose to leave unmerged; old analytics lacks current RLS context |
| `astryx-ui`, `auth`, `codex/responsiveness`, `codex/resume-format`, `codex/resume-length`, `codex/security-hardening-rls-rate-limits`, `codex/subscription`, `fallow`, `fix/section-regeneration`, `landing-page`, `ui-changes`, `v1.2` | All already ancestors of main | Preserve local branches; no merge needed |

Fetching with prune removed stale remote-tracking references; no local or remote branch was deleted by this task. Current remote feature branches are generation-speed-robustness and langsmith-content-tracing, alongside main and v1.2.

## Deployment prerequisites

Production initially runs the previous CLI release `d8bf7fb`. No new SQL migration appears in the consolidated branch. Role-based `shared/model-config.json` and its backend/worker copies replace model environment settings. Production retains provider credentials, Redis/database configuration and enabled LangSmith tracing/content capture in `applix-prod`. Seven obsolete model variable assignments currently remain; leaving them set is compatible because the new code does not read them. Interim `JEV_AUDIT_*` settings are absent.

The backend must accept optional `generation_notice` before new worker callbacks. The frontend must render notices and partial previews before worker rollout. Extended the workflow to wait for both changed services. Added a committed script that confirms the expected main commit, successful deployment and active running instances, rather than accepting build completion. Deadline: ten minutes; individual CLI calls: at most thirty seconds; three consecutive CLI/API errors stop verification without exposing stderr. Unchanged services may be skipped; failed or superseded API/UI releases block worker upload. Added the script path to deployment change filters.

## Preflight validation

- Makefile-managed local backend: 525 tests passed.
- Makefile-managed local agents: 352 tests passed.
- Local environment guards: 16 passed.
- Frontend: 298 passed, two known failures in immersive comparison and breakpoint state preservation. Earlier review evidence reproduces both on pristine main. No new auth timing failure occurred in this run.
- TypeScript/Vite production build: passed.
- Deployment verification unit tests: six passed, covering old release exclusion, running-instance gating, terminal failure, supersession, timeout and bounded sanitized CLI failures.
- Live read-only check confirms the script recognizes the current active backend deployment using Railway's actual status JSON.

No live user content or provider requests were used for these tests. Final deployment identities and runtime verification will be recorded after merge.
