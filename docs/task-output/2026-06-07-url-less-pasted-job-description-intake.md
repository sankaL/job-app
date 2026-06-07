# URL-less pasted job description intake

**Date:** 2026-06-07 16:12:05 EDT  
**Scope:** Allow users to create applications from pasted job-description text without a source URL while preserving URL-only and URL plus pasted-text intake.

## Summary

- New Application intake now has separate Job link and Paste description modes.
- `POST /api/applications` accepts source-text-only payloads and rejects only requests without a usable URL or pasted description.
- `applications.job_url` is nullable, with a database check that still rejects blank non-null URLs.
- Capture-backed extraction can run with pasted text and no URL, leaving source URL, final URL, origin, and reference ID null unless supported by supplied metadata.
- Source-link UI is hidden or null-safe when no job URL exists.

## Implementation Notes

- Added migration `20260607_000016_allow_nullable_application_job_url.sql`.
- Updated backend/frontend response contracts for nullable application URLs.
- Kept Chrome extension import URL-required because extension import comes from a browser tab.
- Added regressions for source-text-only API creation, empty intake rejection, nullable duplicate URL handling, worker capture context, and frontend paste-only modal submission.

## Verification

- Targeted backend, worker, and frontend tests should cover URL-only, URL plus pasted text, and pasted-description-only creation paths.
