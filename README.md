# Applix: AI-Powered Resume Builder

[![License](https://img.shields.io/badge/license-Proprietary-red)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/sankal/job-app)
[![Built with](https://img.shields.io/badge/built%20with-React%20%2B%20FastAPI-green)](https://github.com/sankal/job-app)

Applix is an invite-only web application that automates the process of tailoring resumes for job applications. By analyzing job descriptions, extracting key keywords, and restructuring your existing experience, Applix helps you generate ATS-optimized resumes in seconds.

***

## Key Benefits

*   **Fast Optimization:** Tailor your resume to any job description within seconds.
*   **ATS Compliance:** Generate clean, single-column documents designed to pass Applicant Tracking Systems.
*   **Data Integrity:** Restructure and rephrase existing history without inventing credentials or experience.
*   **Interactive Control:** Refine specific sections or edit the markdown directly with side-by-side live previewing.

***

## Feature Tour

### Dashboard
Monitor your application pipeline with color-coded status badges, search, and activity analytics.

![Applications Dashboard](/docs/design/02-applications-dashboard.png)

### In-App Editor
Edit markdown content directly on the left while previewing the rendered PDF output on the right.

![Applications List](/docs/design/03-applications-list.png)

***

## How It Works

1.  **Capture:** Save a job description using the Chrome extension or by pasting the posting URL.
2.  **Extract:** The AI engine automatically parses the job title, company, location, and key requirements.
3.  **Align:** Select a base resume and choose an alignment level to generate a customized draft.
4.  **Refine:** Edit the draft manually or prompt the AI to regenerate individual sections.
5.  **Export:** Download an ATS-compliant PDF.

***

## Repository Resources

For detailed architecture, schema designs, and setup workflows, consult the following:

*   [Product Requirements](docs/resume_builder_PRD_v3.md)
*   [Database Schema](docs/database_schema.md)
*   [Development Build Plan](docs/build-plan.md)
*   [Technical Decisions Log](docs/decisions-made/)
*   [Database Migration Runbook](docs/backend-database-migration-runbook.md)

***

## Local Development

### Prerequisites
*   Docker and Docker Compose
*   Make

### Quick Start
1.  Initialize environment configuration:
    ```bash
    cp .env.compose.example .env.compose
    ```
2.  Start the services:
    ```bash
    make up
    ```
3.  Access the applications:
    *   Frontend: `http://localhost:5173`
    *   Backend API: `http://localhost:8000`

### Resume generation pipeline

Initial generation and full regeneration run in the worker (`agents/section_generation.py`):

1. **Write in parallel.** Professional Experience and the other writable sections are written by two concurrent `resume_writer` calls (Haiku 5.5 for Low/Medium, Sonnet 5.5 for High). The shared source and job prompt sits behind a cache breakpoint.
2. **Check locally.** Schema, citations, numbers, employers/credentials, title rules and contact detection, with no model.
3. **Audit claims with Jev.** Each bullet, Summary sentence, Skills group and retitled role title is a Decisions question, answered in about 0.2-1s. Confident results are final; only uncertain claims go to the `audit_escalation` LLM audit.
4. **Repair only what failed** with `repair_writer`, within a 10-request, 64k-token, 240s budget.
5. **Keep originals instead of failing.** A section that still can't be verified keeps its original text and shows "Kept your original wording."
6. **Stream verified sections** into the generation preview as `partial_sections` while the rest finish.

Measured on a real resume (2026-10-04): Medium about 15s and High about 12-17s end to end, down from 33-78s; about $0.06 per generation. Sections become visible at about 12-14s. Details: `docs/task-output/2026-10-04-generation-speed-robustness.md`; prompts and rules: `docs/prompts.md`.

### Model configuration

Models are chosen by **role** in `shared/model-config.json`, not environment variables. Example roles are `resume_writer`, `section_writer`, `repair_writer`, `claim_audit`, `audit_escalation`, `job_extraction` and `resume_import`. Each model has a profile in the same file: output mode, reasoning bound and provider routing. Writer and audit roles may override their model per aggressiveness level with `by_aggressiveness`. Every request denies provider data collection and sorts by latency. To change a model, edit the shared file, copy it to `agents/model-config.json` and `backend/app/core/model-config.json` (tests fail if they differ), and deploy both services. Services refuse to start if a role names a model without a profile. API keys stay in `.env.compose` / Railway.

### LangSmith tracing

Configure `LANGSMITH_TRACING=true`, `LANGSMITH_PROJECT=applix-dev`, and `LANGSMITH_API_KEY` in the ignored `.env.compose` file, then refresh the stack with `make up`. Compose forwards the same settings to the backend and worker. For Railway, configure both services with the desired project, currently `applix-prod`. Changing `LANGSMITH_PROJECT` separates this app's traces from other projects without code changes. Organization-scoped service keys and keys covering multiple workspaces also require `LANGSMITH_WORKSPACE_ID`, available in LangSmith workspace settings. Compose forwards the workspace to both services; shared trace clients and live evaluations use the same workspace. After changing local runtime settings, run `make dev-runtime` to refresh only the API and worker without reassigning ports or rebuilding the frontend.

Workflow roots summarize settings, counts and completion. Select a nested model run to inspect its model, primary/fallback choice, outcome, usage and request settings (output mode, temperature, token cap, reasoning mode). Model identity and available token counts use LangSmith's native metadata format. Prompt/response bodies are excluded by default; set `LANGSMITH_TRACE_CONTENT=true` on both backend and worker to add redacted prompt messages and parsed outputs to model runs. New formatting applies to new runs; earlier traces retain their original fields.

Tracing covers import classification and entry extraction, job/keyword extraction, writing and regeneration, repairs, grounding audits (an `applix.section_grounding_audit` chain with `applix.jev_audit.decisions` children and any LLM escalation), and requested Resume Judge scoring. Model runs also record the serving provider (`served_provider`), provider-reported cost and cached prompt tokens. Traces contain operation/model metadata, counts, usage and outcomes rather than private resume/job bodies or provider error payloads. Missing project/key values block enabled configuration; telemetry outages do not fail LLM workflows.

`make eval-resumes` honors these settings for live fictional evaluations and tags each model run with its case. Automated tests and offline evaluations always disable tracing. New installations default to tracing off until configured; keys never belong in committed env examples.

***

## Security & Privacy

*   **Invite-Only Access:** System registration is restricted to authorized accounts.
*   **Data Isolation:** All operations enforce database-level user isolation.
*   **Token Security:** Credentials are never stored in the browser's localStorage.
*   **Privacy-Safe AI:** Personal details are removed before language model processing.
*   **Ephemeral PDFs:** Documents are compiled on demand and never stored on servers.

***

## Tech Stack

*   **Frontend:** React 19, Vite, Tailwind CSS, shadcn/ui
*   **Backend:** FastAPI (Python), WeasyPrint, Playwright
*   **Database:** PostgreSQL
*   **AI:** LangChain, OpenRouter
