# Main merge and Railway release preparation

**Checked:** 2026-09-30 23:50:39 EDT
**Status:** Production prerequisites applied and verified; deployment in progress.

Merged `origin/main` at `e0473d2` into `v1.2` at `21b326d` without conflicts. Pushed `v1.2` to origin. Local main can fast-forward to the verified merge. Remote main remains unchanged because its push workflow automatically deploys backend, frontend and agents.

## Validation

`make test-stack` built local service images. `make test-local-guards test` passed 440 backend, 231 agents, 227 frontend and 15 local-environment checks plus the TypeScript/Vite production build. `git diff --check origin/main..HEAD` passed. Tests used local Docker services and fake provider credentials.

## Production prerequisites

Railway CLI is authenticated and linked to `job-app-prod`, production. Read-only SQL through the existing backend confirms the migration ledger stops at `20260714_000018_enable_row_level_security.sql`. None of these release migrations are recorded:

- `20260930_000019_resume_section_documents.sql`
- `20260930_000020_resume_contact_suggestions.sql`
- `20260930_000021_subscription_request_allowances.sql`
- `20260930_000022_unique_resume_names.sql`

Schema inspection independently confirms no new document/source/contact columns, no `base_resumes_user_name_unique` index, and Basic/Pro allowances of 40/100. The user stated they will handle migrations and new environment variables. No production data or environment configuration was changed.

The agents Tier 1/Tier 2 variables and backend Tier 2/import-classification variables are absent, but committed code has defaults. Review those defaults or configure overrides before rollout. Do not print provider credentials or database URLs.

## Remaining release steps

After the user applies the migrations, verify the ledger/schema and configuration, follow the runbook's queued-job drain guidance, push the prepared main branch and monitor all three deployments. The existing GitHub Actions workflow invokes Railway CLI from the pushed main commit. Confirm successful deployment identities and public frontend/backend health before reporting the release complete.

## CLI rollout

The user subsequently authorized handling production prerequisites through the CLI. Backed up resume labels privately outside the repository; the duplicate-label count was zero. Applied migrations 019–022 via the production backend database connection with connection, lock and statement timeouts. Each migration and its ledger insert committed in the same transaction. Verified ledger entries, document/contact/source columns, the unique name index, and Basic/Pro allowances of 10/60.

Set explicit Tier 1/Tier 2 pairs on agents and Tier 2 plus Jev import configuration on backend using `--skip-deploys`. No provider secrets were printed or changed. Production queue checks found zero queued and zero active jobs before rollout. Push main to deploy the validated code through the existing Railway CLI workflow.
