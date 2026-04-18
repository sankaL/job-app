# 2026-04-16 — Application Detail Compare Mode and Inline Draft Diff

**Scope:** Replace the generated draft review-flags panel with a compare-driven review workflow and add a shell-owned immersive layout mode so the generated draft and generation-time base resume can be reviewed side by side.

## What changed

- Added a shell layout context with `default` and `immersive` modes so routed pages can hide the desktop sidebar, remove the desktop content offset, and suppress the mobile sidebar toggle without route-local DOM mutation.
- Updated the application detail workspace to manage compare state, preserve left-rail form/editor state while compare is open, suspend left-column height syncing during compare, and restore the shell layout on close or unmount.
- Loaded the compare baseline from `draft.generation_params.base_resume_id` first, with `detail.base_resume_id` as the fallback only when the draft does not carry its own generation-time baseline id.
- Replaced the single generated preview card with a compare-capable workspace: normal mode keeps the existing generated preview or edit flow, and compare mode renders generated draft on the left and the base resume on the right on `lg+` screens, stacking vertically below `lg`.
- Kept generated edit mode available inside compare mode, including draft save and cancel behavior.
- Removed the generated-workspace `Review Flagged Additions` card entirely.
- Kept `MarkdownPreview` as the plain `ReactMarkdown` path for both generated and base-resume preview surfaces in compare mode so headings, bullets, spacing, and link rendering stay consistent across both panes.
- Removed compare-mode diff rendering and highlight styling entirely after the inline highlighting proved confusing and error-prone for reordered or structurally different resume sections.
- Added regression coverage for compare mode entry and exit, immersive shell behavior, generation-time baseline resolution, clean base-resume list rendering, and failure-closed compare behavior when the baseline resume cannot be loaded.
- Confirmed the remaining “missing bullets” issue in some base resumes is upstream of preview rendering: the compare view can only render list markers that already exist in the stored `content_md`, and the current PDF parser preserves bullets only when extraction retains bullet or numbering markers.

## Verification

- `frontend/npm run build`
- `frontend/npm run test -- --run src/test/markdown-preview.test.tsx`
- `frontend/npm run test -- --run src/test/applications.test.tsx -t "removes the review-flags panel|opens compare mode|renders base-resume headings|switches the shell into immersive mode|uses the generation-time base resume id|keeps normal preview usable"`

## Notes

- The targeted frontend test file still has one unrelated pre-existing failure: `renders top-aligned application table cells for the compact list layout` expects `align-top`, but the current table cell class remains `align-middle`.
- The targeted test file also still emits existing `recharts` zero-size warnings in jsdom for dashboard chart tests, but those tests pass.
