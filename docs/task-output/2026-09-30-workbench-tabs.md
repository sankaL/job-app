# Resume workbench tabs, scrolling and names

Completed 2026-09-30 21:43:32 EDT.

The source workspace sits beneath its name and banners and uses the available page width. Source and generated resumes show Contact information first, then resume sections in their saved order. Original extracted text is a distinct reference tab. Tab changes replace the active panel and preserve the parent document’s edits. Keyboard arrows, Home and End activate tabs; the selected tab is the only tab stop. Contact and section IDs use separate namespaces.

The page owns vertical scrolling. Shell clipping no longer creates implicit vertical scroll containers, the section rail has no independent scrollbar, generated drafts no longer inherit the settings column’s fixed height, and long text editors grow. An in-flow sticky source save bar replaces the portal and nine-rem bottom reserve.

Saved resume names drive headers and cached breadcrumbs, including after renames. Migration 022 enforces case-insensitive, space-trimmed uniqueness per user. It keeps the oldest historical duplicate, picks unused numeric suffixes for the others, and advances row/document revisions without changing content or references. Duplicate writes return a recoverable conflict through the existing API mapping.

## Review fixes

- Separate profile/reference tab identifiers from persisted section IDs; regression-tested a section named `contact`.
- Keep re-upload available on the reference tab even when an upload response has no stored original text.
- Keep inactive panel shells hidden so ARIA controls resolve without rendering inactive content.
- Match tab orientation to the responsive rail and clean up its media-query listener.
- Fence migration renames with matching row/document revision changes. Bound migration locks/execution and tolerate index replay after an interrupted ledger write.
- Remove redundant list invalidation on editor reads. Update the detail cache on writes so breadcrumbs reflect saved names.

## Verification

- Makefile local Docker frontend suite: 214 tests passed.
- Makefile local Docker backend suite: 421 tests passed, including per-user names, concurrent duplicate creates, rename rollback and migration suffix collisions.
- Final focused tab/editor suite: 42 tests passed after review fixes.
- Final database persistence/migration suite: 5 tests passed, including matching JSON and row revisions after duplicate-label backfill.
- Frontend TypeScript and production build passed.
- Migration applied through the Makefile local migration runner; its final transaction was also replayed in rollback-only regression coverage.
- Browser source checks at measured desktop and phone viewports showed one visible panel, no nested vertical scroll regions and no horizontal page overflow. Generated resume checks showed one visible panel and no nested vertical scroll regions. Temporary viewport changes were reset.

Verification used the existing local development session and fixture, without saving changes to the inspected resume or triggering AI work. Production rollout and other browser engines were not exercised. Existing malformed import content remains governed by the previous import/review rules; this task changes layout and naming.
