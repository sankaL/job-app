# Subscription Tiers and Generation Quotas

**Date:** 2026-05-23 19:31:20 EDT  
**Status:** Completed

## Summary

Added Basic and Pro subscription tiers with admin-configurable monthly resume-writing limits and tier-selected OpenRouter primary/fallback generation models. New and existing users default to Basic, and admins can edit an individual user's tier from user management.

## What Changed

- Added schema for `subscription_tiers`, `profiles.subscription_tier`, and monthly `resume_generation_usage`.
- Seeded Basic and Pro tier defaults.
- Added admin APIs for reading/updating subscription tiers and assigning user tiers.
- Enforced one shared UTC monthly quota across initial generation, full regeneration, and single-section regeneration.
- Hardened quota release so failures before job enqueueing do not consume quota, while successfully queued jobs remain counted for the monthly usage window.
- Replaced the old effective generation-control path for full-regeneration caps with monthly subscription quota enforcement.
- Passed tier-selected primary/fallback generation models to worker jobs through hidden settings, while persisting only safe draft metadata.
- Added an Admin Subscriptions page and tier editing in Admin User Management.
- Added admin/frontend validation for excessive limits, malformed model IDs, matching primary/fallback models, and inactive tier assignment.
- Updated quota-exhausted generation/regeneration errors so users receive clear guidance to contact an administrator or upgrade tier.

## Validation

- Backend admin/application tests cover tier APIs, user tier assignment, quota reservation, release-on-enqueue-failure, and shared consumption across generation actions.
- Worker tests cover job-supplied model/fallback override behavior.
- Frontend subscription-focused tests cover tier settings editing and user tier editing.
