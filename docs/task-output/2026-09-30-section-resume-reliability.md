# Section resume reliability upgrade

Implemented versioned resume sections across import, storage, generation, editing, regeneration and comparison. Markdown content and export compatibility remain. Contact suggestions are parsed locally; profile data remains authoritative for the assembled header.

The API persists stable IDs, reviewed entry facts, optimistic revisions and source snapshots. Pydantic AI provides typed output correction; full generation retains valid sections and repairs only failed sections under shared budgets. Frozen facts remain local. The workbench supports custom sections, ordering, inline entry edits and role actions; comparison uses source IDs and bullet provenance.

Additive migrations: `20260930_000019_resume_section_documents.sql` and `20260930_000020_resume_contact_suggestions.sql`. Apply before deploying API/workers; see the migration runbook for compatibility and rollback.

Verification completed on the Makefile-managed local Docker stack:

- Backend: 374 tests passed, including actual Postgres isolation, JSONB revisions and immutable snapshots.
- Worker: 198 tests passed, including Pydantic AI mock transport correction/budgets, semantic-audit repairs, minimal keyword patches and cache-before-ready recovery.
- Frontend: full suite of 187 tests passed; the final contact-heading alignment passed all 21 workbench tests.
- Frontend production build, local Docker image builds, migrations 019/020 and `git diff --check` passed.
- Local test configuration rejected hosted database lookalikes in four explicit guard cases.

Independent backend and frontend reviews checked the other implementation areas. Findings were fixed before commit: contact-heading/privacy gaps; nested ID collisions; signed/decimal/currency/technology fact preservation; source snapshot and revision mismatch; keyword patches overwriting edits; unrelated role preservation; hard-cap enforcement for fixed-only documents; imported text loss on first entry creation; recovery cache ordering; and missing per-model trace spans. The final review reported no outstanding blockers. Child traces contain counts, model/operation metadata and usage, without prompt or output content.

The initial implementation checks used no live provider requests or hosted production services. The later [verification follow-up](2026-09-30-section-generation-evaluation-plan.md) completed a local browser walkthrough, actual PDF/DOCX byte checks and a bounded four-case synthetic provider sample. Jev remains configurable and opt-in pending a representative import evaluation. The checks verify contracts and recovery behavior; they do not measure live failure rates, classifier calibration or semantic accuracy.

Completed: 2026-09-30 16:30:39 EDT.
