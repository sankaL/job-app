# Task Output — Env Contract Simplification and Resend Email Gate

**Date:** 2026-04-07 12:06:48 EDT  
**Scope:** Reduce the local env surface, disable local Supabase Auth email delivery, and add the backend app-email feature flag for Resend.

## Summary

- Rewrote `.env.compose.example` as the canonical root env with concise grouped comments and a reduced user-edited variable surface.
- Removed user-facing SMTP and Mailpit configuration from the local stack and disabled local GoTrue email delivery in dev mode.
- Collapsed duplicated frontend, backend, and worker runtime toggles into shared root env values that Compose maps into each service.
- Added backend email settings validation plus a Resend-backed sender abstraction that no-ops when `EMAIL_NOTIFICATIONS_ENABLED=false`.
- Reduced the per-app `.env.example` files to direct-run overrides instead of duplicating the full root contract.

## Delivered Outcomes

- Local Compose no longer depends on SMTP-style env variables for auth boot.
- App email configuration is limited to `EMAIL_NOTIFICATIONS_ENABLED`, `RESEND_API_KEY`, and `EMAIL_FROM`.
- Backend startup now fails closed if app email sending is enabled without the required Resend settings.
- Focused backend tests cover disabled mode, missing-config rejection, and the Resend request payload.

## Deliberate Limits

- Local invite and password-recovery email delivery remain out of scope in dev mode.
- No application workflow currently sends notification emails yet; this task adds the config and sender baseline only.
