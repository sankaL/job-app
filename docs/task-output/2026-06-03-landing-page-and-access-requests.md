# Task Output - Landing Page and Beta Access Requests

**Scope:** Add a public Applix landing page, informational pricing, and an email-only beta access-request flow while keeping account creation invite-only.

## Summary

- Added a public root landing page with feature cards, pricing cards, beta copy, login/sign-up navigation, and a realistic mock application workspace.
- Kept tokenized invite onboarding unchanged for `/signup?token=...`.
- Added no-token `/signup` as a public access-request form.
- Added `POST /api/public/access-requests`, which validates requester details and sends sanitized Resend email to configured admins.
- Kept admin approval manual through the existing invite workflow.

## Validation

- Frontend build passed.
- Focused frontend tests passed: `npm run test -- src/test/auth.test.tsx src/test/signup.test.tsx`.
- Focused backend tests passed: `python3 -m pytest backend/tests/test_access_requests_api.py`.

## Notes

- No schema changes or migrations were added because access requests are email-only and not persisted.
- Public access requests fail closed when admin recipients or email delivery are unavailable.
