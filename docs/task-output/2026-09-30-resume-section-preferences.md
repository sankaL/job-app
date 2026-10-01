# Resume-owned section inclusion and order

Completed 2026-09-30 20:53:36 EDT. Changes are local and uncommitted. The coordinating chat owns the final combined review and commit. No push or deployment was performed.

## Delivered behavior

Profile no longer controls sections. Its personal information remains intact, and saving Profile does not overwrite the retained legacy section JSON. Users choose inclusion/order in each workbench, including custom sections.

Initial writing follows populated enabled sections of the saved reviewed base document. Draft saves keep stable nested IDs, retain excluded content and atomically synchronize the enabled-ID snapshot under owner/revision checks. Default full regeneration uses the frozen source and saved draft structure. It preserves headings, exclusions, fixed/local sections, changed section types and sections with added/removed/reordered entries. Individual roles can still regenerate; whole-section regeneration rejects changed entry structure before provider calls.

`use_latest_base=true` deliberately resets content/layout from the linked reviewed base and stores a fresh source snapshot only on success. Legacy drafts without trustworthy source links require this explicit action for new regeneration. Their reads, manual edits and exports remain available. Missing/malformed snapshots and unreviewed re-included sources fail before quota reservation. The old draft survives failures.

Writer source context includes only reviewed sections enabled in the base/current draft. Requested current context excludes unrelated manual and disabled sections. Audit context retains cited included source facts, including cross-section Summary citations. Grounding, privacy, Tier 1/Tier 2 routing, reasoning defaults and request allowances are preserved.

Comparison uses frozen content for re-included sections through a temporary view; it does not rewrite the source snapshot. PDF/DOCX initiation renders the latest saved document so stale Markdown projections cannot override its inclusion/order. No PDF persistence or SQL migration was added.

## Plan and review

The recorded plan removed the Profile conflict, moved generation/regeneration authority to documents, defined compatibility and then verified schema, comparison and export behavior. Local review fixed four additional issues: whole-section actions restoring role structure, missing full-operation context at the worker validator boundary, exports reading stale projections, and comparison labeling re-included source sections as new. Invalid snapshot metadata now blocks rather than silently binding to today's base.

## Files owned by this task

- `agents/section_generation.py`, `agents/worker.py`, `agents/tests/test_section_generation.py`
- `backend/app/api/applications.py`, `backend/app/services/application_manager.py`, `backend/app/db/resume_drafts.py`
- `backend/tests/test_phase1_applications.py`, `backend/tests/test_resume_document_database.py`
- `frontend/src/routes/ProfilePage.tsx`, `frontend/src/routes/ApplicationDetailPage.tsx`
- `frontend/src/lib/api.ts`, `frontend/src/lib/resume-document.ts`, `frontend/src/components/diff/CompareWorkspace.tsx`
- `frontend/src/test/applications.test.tsx`, `frontend/src/test/resume-section-workbench.test.tsx`
- Shared workbench integration touches `frontend/src/components/resume/ResumeSectionWorkbench.tsx` and `DraftSectionWorkbench.tsx`. Preserve the parallel task's redesign, CSS and base editor changes.
- Product/schema/runbook/prompt docs, directory `AGENTS.md` files, `docs/build-plan.md`, the latest decision log and this report.

The parallel task is also modifying import parsing and the duplicated resume-document contracts. Those edits were preserved; they are not authored by this task.

## Verification

All executed regression checks used the Makefile-managed local Docker stack, fake provider keys and disabled tracing. No hosted production Auth/database services or live LLM requests were used.

| Check | Result |
|---|---|
| Full backend suite | 402 passed |
| Full worker/agent suite | 231 passed |
| Full frontend suite | 200 passed at the integrated UI checkpoint |
| Final workbench/comparison regression file | 29 passed after the final comparison change |
| Local environment/cleanup guards | 15 passed |
| Final frontend TypeScript and production build | Passed |
| Diff whitespace review | Passed |

The first frontend build encountered the parallel task's CSS import before its stylesheet existed; the later integrated build passed. An existing full-regeneration test expectation was corrected through the handler's optional argument semantics, and its full suite subsequently passed. Earlier quota fixtures now choose an explicit legacy reset or use reviewed structured source links.

## Limits

No fresh browser walkthrough or live provider quality sample was run for this task. Parallel changes may continue after these checkpoints; rerun combined checks after both tasks finish before committing. Fixed/local or structurally edited sections deliberately retain their content during default full regeneration. To replace them from new reviewed source content, select the explicit latest-base reset.

Confidence is 95% for this task's behavior. A final combined check and browser/provider walkthrough would increase confidence in the integrated release.
