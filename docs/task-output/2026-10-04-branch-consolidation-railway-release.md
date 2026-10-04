# Branch consolidation and Railway release

Completed 2026-10-04 19:05 EDT. The owner authorized merging current work into main and deploying production. [PR #19](https://github.com/sankaL/job-app/pull/19) was merged as `a2b1a415966cabdb59d63ae624fa1bd8fb11abbc`. The [ordered deployment workflow](https://github.com/sankaL/job-app/actions/runs/37242088169) succeeded. Local main was fast-forwarded to the merged release.

## Production result

| Service | Active successful deployment |
| --- | --- |
| Backend | `2bfc8167-0173-4216-80d3-520fb111af2f` |
| Frontend | `bd91c67e-6368-4f95-9b05-233eb0e517ce` |
| Agents | `2e8b992c-7380-47fa-b052-40d423945024` |

The frontend job completed at 23:00:51 UTC and backend at 23:01:02 UTC. The worker job started at 23:01:04 UTC, after both running-release gates passed. All application deployments identify merged main `a2b1a41`.

The merge also triggered Railway's independent repository integration, which bypassed the workflow and started worker deployment `e13cf784-ff87-4fe7-9830-7c89071c1d6f`. Cancelled that unmanaged release and disconnected repository sources for all three application services. Existing root directories, Dockerfiles and active service configuration remain available to the CLI workflow. The ordered workflow completed with the deployments above. Current service sources report null repository/image; future main pushes use GitHub Actions rather than duplicate Railway triggers.

Production had zero queued/active ARQ jobs before merge. No SQL migrations differ from the previous release. Provider credentials, database/Redis settings and LangSmith settings were retained. Seven obsolete tier/classification model assignments were left in place because deletion is optional; the new runtime ignores them. Interim Jev audit overrides were absent.

Runtime checks confirm:

- Backend and worker accept `generation_notice` in the strict section schema.
- Both model-config files match canonical SHA-256 `da518ccffba5728714b56bcae1f133e1750b9edfcc2ea6f79b540950ea551de3`; model loaders and relevant code hashes match merged main.
- Loaded role routes use Sonnet/Sol for full writing/repair, Gemini/Luna for section/extraction/import/scoring, and Jev for claim audit/classification. Provider defaults deny data collection and sort by latency.
- Production dev mode is off. Backend and worker retain enabled tracing and content capture in `applix-prod`.
- Worker reports `max_jobs=20` and four browser slots. Startup logs confirm worker startup and Redis connection, without tracebacks or connection errors in the bounded sample.
- Custom domain and backend health return HTTP 200; unauthenticated application API returns HTTP 401.

No new private user content or provider call was used in these production checks. A new full production generation remains needed to exercise the complete writing/audit/partial-preview/keep-original flow on the deployed release. The two pre-existing frontend shell failures remain documented and were not changed by this rollout.

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

No live user content or provider requests were used for these tests. Final deployment identities and runtime verification are recorded above. Completion bookkeeping changes documentation only and does not require a new application deployment.
