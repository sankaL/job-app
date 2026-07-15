# Railway Backend Recovery

**Completed:** 2026-06-30

## Outcome

- Diagnosed authenticated application reads failing with PostgreSQL `UndefinedColumn` because Railway production had not applied `20260615_000017_application_job_keywords.sql`.
- Applied the idempotent additive migration and recorded it in `app_meta.schema_migrations`; no backfill was needed.
- Diagnosed a Railway network split: the public edge required an IPv4 listener while the frontend proxy reached `backend.railway.internal` over IPv6.
- Added explicit IPv4 and IPv6 Uvicorn listeners on Railway's injected `PORT`, preserving both the public health surface and private frontend-to-backend API traffic.
- Split backend dependency installation from source-package installation so source-only deployments can reuse Railway's cached dependency layer.

## Verification

- Confirm the production migration ledger contains `20260615_000017_application_job_keywords.sql`.
- Confirm the deployed backend returns `200` from `/healthz` through its public Railway domain.
- Confirm authenticated application list requests no longer emit missing-column errors.
