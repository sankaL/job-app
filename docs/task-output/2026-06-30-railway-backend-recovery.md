# Railway Backend Recovery

**Completed:** 2026-06-30

## Outcome

- Diagnosed authenticated application reads failing with PostgreSQL `UndefinedColumn` because Railway production had not applied `20260615_000017_application_job_keywords.sql`.
- Applied the idempotent additive migration and recorded it in `app_meta.schema_migrations`; no backfill was needed.
- Diagnosed public backend requests failing at the Railway edge because Uvicorn listened only on IPv6 while the public proxy required an IPv4 listener.
- Changed the backend container command to bind to `0.0.0.0` on Railway's injected `PORT` and added a regression test for that startup contract.
- Split backend dependency installation from source-package installation so source-only deployments can reuse Railway's cached dependency layer.

## Verification

- Confirm the production migration ledger contains `20260615_000017_application_job_keywords.sql`.
- Confirm the deployed backend returns `200` from `/healthz` through its public Railway domain.
- Confirm authenticated application list requests no longer emit missing-column errors.
