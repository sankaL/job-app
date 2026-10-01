# Base resume review workbench and job import repair

Completed 2026-09-30 21:06 EDT. Changes remain uncommitted for the coordinating task's combined review and commit.

## Delivered behavior

Both base and application workbenches open in read-only preview. A section's accessible Edit button or double-click opens only its editor; opening another section returns the former to preview while retaining unsaved content. Preview does not save or mark facts reviewed. Generation/saving locks prevent Edit and double-click changes, while available role regeneration actions remain usable from preview. Markdown previews suppress remote images to avoid automatic third-party requests. The base resume uses one document surface with section-focused navigation. Desktop navigation shows section buttons; phones use a section selector. Switching sections retains edits and stable section/entry/bullet IDs. Roles have independent facts, bullets and collapse controls. Secondary section settings and profile/source reference details use disclosures. Contact suggestions keep the reference open for review. Include/order controls and draft regeneration callbacks remain available.

The floating save dock is rendered into the document body, beyond the app shell's overflow and transition containers. Its submit button explicitly targets the edit form. The dock reports unsaved/saving/saved state and pending source review, remains accessible during long edits, and respects phone safe-area padding. Saving does not mark facts reviewed. Revision conflicts retain local edits.

Local import recognizes complete single-row and two-row job headers even when PDF extraction removes blank lines. Wrapped bullets and ordinary achievement years stay prose. Unrecognized dated headers preserve the whole section as Markdown instead of appending another job into a prior bullet. Suspicious partial parses with more recognizable dated headers than entries also qualify for optional bounded Tier 2 extraction. The partial projection is discarded before assistance; original source text remains available on failure.

Nested extraction still requires exact source excerpts, complete word/number coverage, contact removal and explicit user review. Recognizable source date ranges now require sufficient entries and matching extracted date ranges in source order, rejecting merged and reordered jobs even when word coverage is complete. Jev and Tier 2 routing, deadline/correction/fallback limits and input/output shapes remain unchanged. The backend document adapter is mirrored byte-for-byte into the worker.

## Scope and files

- `frontend/src/routes/BaseResumeEditorPage.tsx`: upload/review hierarchy, reference disclosure, save dock and saved-state tracking.
- `frontend/src/components/resume/ResumeSectionWorkbench.tsx`, `ResumeSectionPreview.tsx`, `DraftSectionWorkbench.tsx` and `resume-workbench.css`: shared document/entry layout, section focus, phone selector, long prose resizing and controls.
- `frontend/src/test/base-resume-workbench.test.tsx` and `resume-section-workbench.test.tsx`: form submission from the dock, revision conflicts, offscreen edits, review gates, section switching and independent role editing.
- `backend/app/services/resume_document.py`, mirrored in `agents/resume_document.py`: conservative entry boundaries and suspicious-parse detection.
- `backend/app/services/resume_parser.py`, `backend/tests/test_resume_document.py` and `test_resume_parser.py`: bounded extraction eligibility, date guards and import regressions.
- PRD, prompts, build plan and decision log updated in place. No schema change, migration or backfill belongs to this task.

The shared checkout already contained the separate resume-owned preferences implementation. Its edits were preserved, including stable-ID inclusion/order logic, draft-source behavior and documentation. No messages were sent to that task and no service was restarted.

## Verification

All execution tests used Makefile-managed local Docker entrypoints with test environment guards. No hosted services or live AI requests were used.

| Check | Result |
| --- | --- |
| Focused backend resume document/parser/base service tests | 76 passed |
| Full frontend suite before the final phone/reference refinements | 203 passed |
| Final workbench and base save-dock regressions | 33 passed across two files |
| Worker suite | 231 passed |
| Frontend production type check/build after final UI edits | Passed |
| Whitespace/diff check | Passed |

Static fixtures rendered from the actual React components were inspected at 1440×900, 1024×768, 768×600, 390×844 and 320×568. The final secondary-reference disclosure and CSS were reflected in the fixture. Measurements found no page/control overflow and verified that Save remains in view at both the document top and bottom. Desktop and phone images were visually inspected. Temporary fixture-export tests were removed from the repository.

Live-origin browser verification was blocked by a saved browser preference reported by the coordinating chat. That origin was not accessed; browser rendering used a local static file with all non-file requests blocked. Static checks do not establish live browser interaction or real-device virtual-keyboard behavior. Component regressions establish section/role editing, saving and conflict recovery.

## Review fixes and limitations

Review fixed the date-first-header case where a wrapped bullet sentence could be mistaken for an employer. The complete-source date guard rejects reordered extraction output. The save dock uses a portal because sticky positioning inside the shell's overflow containers could leave Save reachable only near the document bottom. A dedicated regression verifies its form association and saves offscreen section edits.

Existing saved merged imports are not silently reparsed or marked reviewed. A fresh import after the backend reloads, or manual restructuring against the retained source, is required. The user's live backend/worker processes were left running; tests used separate one-off containers. The actual reported PDF and live provider extraction were not available for verification. Unfamiliar or undated formats can still require manual source review. Date/word guards do not prove arbitrary semantic role bindings.

Confidence is 90%. The actual failing PDF, permitted live browser verification and a real phone keyboard check would increase confidence.

## Preview-by-default follow-up

The user requested read-only entry for both workbenches after the initial redesign. Implemented a shared section preview for Markdown and structured facts/bullets. A single section editor opens through Edit or double-click, closes through Preview or choosing another editor, and never resets content. Newly added sections/roles open their editor as part of that explicit add action. The base name field remains a metadata control. Regression tests now enter editing explicitly and cover initial preview for source/draft, one-editor behavior, retained edits, keyboard-accessible Edit, double-click, lock enforcement and preview regeneration. Application tests verify preview on route entry and regeneration refresh, then open the relevant editor before testing edit locks. No backend, extraction, prompt, schema or runtime changes belong to this follow-up.

Final follow-up verification on 2026-09-30 21:17 EDT passed all 210 frontend tests across 17 files and the production type check/build. Final read-only preview fixtures passed the same five width/height combinations with no page overflow and the save dock visible at the document top and bottom. These remain static file checks, with non-file requests blocked and no access to the denied live origin. The temporary fixture-export test was removed. Review fixed automatic Markdown image loading by rendering alt text without an image element, with a regression that also preserves safe text/links and excludes links from double-click editing. No required scoped findings remain. Changes remain uncommitted for the coordinator.
