# Phase 3 & 4 — Generation, Validation, Assembly, Editing, Regeneration, and PDF Export

**Date:** 2026-04-07  
**Status:** Implemented  
**Phases:** Phase 3 (Generation, Validation, Assembly, Notifications, Workspace) and Phase 4 (Editing, Regeneration, PDF Export)

> Note: The original multi-call generation and validator architecture documented here was later hardened and partially superseded by [2026-04-08-single-call-generation-privacy-hardening.md](./2026-04-08-single-call-generation-privacy-hardening.md).

## Phase 3 — Generation, Validation, Assembly

### Worker (agents/)

- **`agents/generation.py`** — Section-based LLM generation. Each enabled resume section (summary, experience, education, skills, etc.) is generated as an independent LLM call using LangChain `ChatOpenAI` pointed at the OpenRouter API base. Supports primary model with automatic fallback to a secondary model on failure. Configured via `GENERATION_AGENT_MODEL` and `GENERATION_AGENT_FALLBACK_MODEL` environment variables.
- **`agents/validation.py`** — Validation pipeline with three layers:
  - Hallucination detection: LLM-based comparison of generated content against the source resume to flag invented employers, titles, dates, credentials, or education history.
  - ATS-safety: Rule-based checks ensuring no tables, no images, and clean Markdown output.
  - Required sections and ordering: Validates all enabled sections are present and correctly ordered per user preferences.
- **`agents/assembly.py`** — Assembles the final Markdown resume by injecting the user's personal information (name, email, phone, address from profile) as a header, followed by the generated sections in the user's preferred order.
- **`agents/worker.py`** — Added `run_generation_job` and `run_regeneration_job` ARQ job functions that orchestrate the generation → validation → assembly pipeline and call back to the backend with results.

### Backend

- Generation trigger endpoint accepts generation parameters and queues the ARQ job.
- Internal worker callback endpoint receives generation results and persists the draft.
- `DraftRepository` for `resume_drafts` table CRUD operations.
- `GenerationJobQueue` for enqueueing generation and regeneration jobs.
- Generation email notifications for success, failure, and attention states.
- Status transitions: `generation_pending` → `generating` → `resume_ready` (success) or `generation_failed` (failure).

### Frontend

- Generate button with precondition checks (base resume selected, job info extracted, no unresolved duplicates).
- Generation progress polling with status indicators.
- Markdown preview of the generated draft using `react-markdown` with `remark-gfm`.
- Validation failure display showing structured error messages from `generation_failure_details`.

### Migration

- `supabase/migrations/20260407_000005_phase_3_generation.sql` — Adds `generation_failure_details jsonb` column to the `applications` table for storing generation and validation failure diagnostics.

## Phase 4 — Editing, Regeneration, PDF Export

### Backend

- Draft save endpoint for persisting manual Markdown edits.
- Section regeneration endpoint: accepts a section identifier and required instructions, regenerates only that section, validates, and updates the draft.
- Full regeneration endpoint: reuses prior generation params (with optional overrides), regenerates all sections, and overwrites the current draft.
- Regeneration callback endpoint for processing worker results.
- **`backend/app/services/pdf_export.py`** — On-demand PDF export service:
  - Converts Markdown → HTML → PDF using WeasyPrint.
  - ATS-safe CSS styling (clean fonts, no complex layouts).
  - Runs in a thread pool executor with a 20-second timeout.
  - Deferred WeasyPrint import to avoid breaking dev environments without native libraries.
  - No persistent PDF storage per PRD — generated fresh from latest draft on each export request.

### Frontend

- Edit/preview toggle in the draft card for switching between Markdown editing and rendered preview.
- Inline Markdown editor with save functionality.
- Section regeneration dialog: select a section, provide required instructions, and regenerate.
- Full regeneration with prefilled prior settings and optional instruction overrides.
- PDF export button that triggers download of the generated PDF.

### Dependencies Added

- **Backend:** `weasyprint`, `markdown`
- **Frontend:** `react-markdown`, `remark-gfm`

## Key Decisions

- **Section-based generation**: One LLM call per section enables targeted section regeneration without re-generating the entire resume.
- **Model fallback**: Primary model → fallback model on failure, configured via environment variables per agent.
- **LangChain + OpenRouter**: `ChatOpenAI` from `langchain-openai` pointed at the OpenRouter API base for model flexibility.
- **Hallucination detection via LLM**: Separate validation LLM call compares generated content against the source resume.
- **ATS-safety via rules**: Rule-based checks complement LLM validation for deterministic ATS compliance.
- **WeasyPrint for PDF**: Chosen for ATS-safe PDF output with clean rendering. Deferred import pattern for dev environment compatibility.
- **On-demand PDF only**: No persistent PDF storage per PRD. Fresh PDF generated from latest draft content on each export.
- **react-markdown + remark-gfm**: For frontend Markdown preview with GitHub Flavored Markdown support.
- **Status transitions**: Export → `complete`; edit or regeneration post-export → `in_progress`. `applied` flag remains independently user-controlled throughout.
