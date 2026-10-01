# Resume upload and processing UI — 2026-09-30

The initial PDF upload now uses the full available resume workspace width. A paper preview introduces section review beside the form on desktop; narrow layouts stack. Submitting replaces the preview with import feedback describing PDF reading, section identification, separate roles and source checks. The AI opt-out gets accurate local parsing copy. Inputs are disabled while importing and remain available with the selected file/name after recoverable failure.

Generation uses the same processing component in the resume content area, explaining source/job preparation, writing, validation and assembly. It shows backend messages and reported percentages; an indeterminate bar covers the request before progress arrives. A cleaned-up timer tracks elapsed time, status updates use a polite live region, reduced-motion preferences disable animation, and active jobs retain cancellation. Full regeneration keeps the prior draft available below the panel with editing locked.

## Review and fixes

- Restored read-only current draft visibility during full regeneration after existing application tests caught missing section tabs.
- Ignore stale terminal progress while a new optimistic request starts; it must not display the previous job's completed state or stop its timer.
- Keep the live status outside `aria-busy` regions so announcements are not suppressed.
- Prevent numbered steps from wrapping or shrinking beside longer descriptions.
- Removed the old simulated percentage increments, rotating generic copy and spinner overlay. Session changes and unmount clean up elapsed-time timers.

## Validation

- Makefile-managed local Docker frontend tests: 17 files, 223 tests passed.
- Makefile-managed production frontend build: TypeScript and Vite passed.
- Regression coverage includes pending upload, successful transition into section review, AI opt-out, failure retry preservation, unknown/reported progress, stale previous job progress, cancellation and timer cleanup/session reset.
- Browser checked the authenticated desktop upload page and rendered production processing components with synthetic progress. Processing panels were also checked at a 390px iframe viewport; they stack without horizontal overflow. Temporary preview files were removed after verification.

No live provider request was needed for this presentation-only change. Tests exercise mocked upload/generation states; a fresh live generation on the user's device would add confidence in timing and transitions under a real queue. No schema, migration, AI prompt or model change.
