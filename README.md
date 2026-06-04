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
