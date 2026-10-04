# Merged main production verification

Verified 2026-10-03 22:29 EDT. Deployment and migrations are complete. A replacement production LangSmith key remains pending user input; the existing key was verified successfully and retained.

## Running release

Railway project `job-app-prod`, production environment, runs merged main `bfa54bc855aa5922715397192031959f2638c2ff`, PR #18. The [GitHub deployment workflow](https://github.com/sankaL/job-app/actions/runs/37170630942) completed successfully. Each service reports a successful deployment with the corresponding main commit in its release message.

| Service | Deployment |
| --- | --- |
| Frontend | `61d4304f-4f50-4f47-86ce-1085c5727802` |
| Backend | `f5a84a9e-48e1-4fff-8903-f82132b49133` |
| Agents | `ae563a36-ee8d-4b2b-8fd4-a884bbef8683` |

No additional deployment was needed. Remote SHA-256 hashes match main for backend tracing and application routes plus worker orchestration and tracing.

## Database

Production initially lacked `20261003_000023_applications_user_created_at_index.sql` and its index. Applied the committed index operation and migration-ledger insertion within one transaction. Database connection timeout was twenty seconds, lock timeout five seconds and statement timeout sixty seconds. Verified the committed ledger entry and `applications (user_id, created_at DESC)` index definition afterward. No row backfill or application content change was required.

Historical migrations 013–015 were absent from the ledger, but their schema effects were already present. Verified subscription and usage columns/defaults, validated constraints, profile and usage foreign keys, composite usage primary key, usage-period index, update triggers and the final DeepSeek model/reasoning constraints. Added only their missing ledger records atomically. Replaying their older seeds/model assignments would overwrite later configuration, so those updates were not replayed.

Final readback contains exactly the 24 SQL migration filenames in the repository. Basic/Pro allowances remain 10/60. All 11 protected tables retain enabled and forced row-level security. Usage counters and user documents were not modified.

## Runtime and tracing

- Custom domain and Railway frontend return HTTP 200 using curl; backend `/healthz` returns HTTP 200 with `status=ok`.
- Backend unauthenticated `/api/applications` returns HTTP 401.
- Browser inspection confirms the current production interface and Profile navigation.
- Agents deployment is running; startup logs confirm the six-function worker started and connected to Redis. Redis ping succeeds and the queue contains zero jobs at verification. No tracebacks or connection errors appeared in the bounded startup-log sample.
- Backend and agents have `APP_DEV_MODE=false`, `LANGSMITH_TRACING=true`, `LANGSMITH_PROJECT=applix-prod`, a workspace selector and a nonblank API key. No secrets were printed or changed.
- Both deployed shared trace helpers emitted metadata-only verification chain traces. Readback confirms the expected project, completion and absence of the configured credential in each serialized trace. No LLM calls, private resume/job inputs or application writes were used for these probes.

| Service | Verification run |
| --- | --- |
| Backend | `01a104ba-9190-7a93-afe7-1ef58cacffbb` |
| Agents | `01a104ba-95ef-7c80-9334-df38dec1805e` |

These checks establish deployment identity, database prerequisites and trace delivery. They do not exercise a complete new resume-generation workflow or establish provider reliability.

## Credential handoff

The user confirmed `applix-prod`. A new key can be saved in a private file outside the repository with permissions `0600`, and its path shared in chat. Read it without printing it; pass its value to Railway through `railway variable set LANGSMITH_API_KEY --stdin --skip-deploys` for backend and agents, retaining the confirmed project and appropriate workspace selector. Verify both service settings before redeploying, then read back new verification traces. Alternatively, the user may enter the key directly in Railway. A replacement has not been supplied or installed during this verification.
