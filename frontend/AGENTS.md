# Frontend — Agent Guidance

Keep this file focused on durable frontend rules for the AI Resume Builder. Do not add setup commands, ports, env-var instructions, or speculative component maps.

## Source of Truth
- Product behavior and UX contract: `docs/resume_builder_PRD_v3.md`

## Frontend Commitments
- Follow the committed frontend stack: React, Vite, Tailwind CSS, and `shadcn`.
- Treat the frontend as responsible for the authenticated user experience across:
  - login
  - applications dashboard
  - new application flow
  - application detail workspace
  - base resume management
  - profile and section preferences
  - notifications
  - PDF export initiation
- Keep client-side status labels and attention indicators aligned with the PRD's visible status model.

## UX Rules
- Use skeleton loading states for async page and list fetches.
- Provide meaningful progress messaging during extraction, generation, regeneration, and export flows. A spinner alone is not sufficient.
- Show clear transient success and error feedback.
- Surface action-required states prominently on dashboard and detail views.
- Keep preview mode and Markdown edit mode visually distinct and easy to switch between.
- Use optimistic UI only where the operation is low-risk and can be rolled back cleanly, such as toggling the `applied` flag.
- Preserve clear empty states and next-step calls to action for first use and failure recovery.

## Frontend Data and State Rules
- Reflect the four primary statuses exactly: `Draft`, `Needs Action`, `In Progress`, and `Complete`.
- Treat `applied` as a separate boolean flag, not a replacement for the primary status.
- Show duplicate-review attention before generation when unresolved.
- After editing or regenerating a previously exported draft, the UI must reflect the status return to `In Progress`.
- Resume preview should render the latest Markdown draft; edit mode should operate on the same underlying Markdown content.
- Preference changes for enabled sections and section order apply to future generations unless the user explicitly regenerates.

## Frontend Security Rules
- Do not store auth tokens in `localStorage`.
- Treat all fetched job, resume, and notification data as private to the authenticated user.
- Do not expose hidden internal processing details as substitutes for the user-facing status model.
- Fail safely when auth expires or required data is missing, and route the user toward re-authentication or recovery instead of masking the issue.
