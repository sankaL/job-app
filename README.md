# Applix — AI-Powered Resume Builder

**Owner:** SankaL

[![License](https://img.shields.io/badge/license-Proprietary-red)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](https://github.com/sankal/job-app)
[![Built with](https://img.shields.io/badge/built%20with-React%20%2B%20FastAPI-green)](https://github.com/sankal/job-app)

**Land your dream job faster with AI-crafted, ATS-optimized resumes tailored to each opportunity.**

---

## 🎯 What is Applix?

Applix is a private, AI-powered resume builder that helps job seekers create perfectly tailored resumes for every job application. Instead of manually rewriting your resume for each position, Applix uses advanced AI to analyze job postings, extract key requirements, and generate customized resumes that highlight your relevant experience.

**The Problem:** Job seekers waste hours adapting their resumes for each application, often missing critical keywords or failing to align their experience with what employers want.

**The Solution:** Applix automates the heavy lifting while keeping you in control. Upload your base resume once, paste a job URL, and let AI do the rest.

---

## ✨ Key Features

### 🔍 Smart Job Extraction
- **URL-Based Intake:** Paste any job posting URL from LinkedIn, Indeed, Glassdoor, Company websites, and more
- **Automatic Extraction:** AI analyzes the posting and extracts job title, company, description, compensation, and location
- **Chrome Extension:** Capture job postings directly from your browser with one click
- **Smart Recovery:** Blocked pages? Paste the job text manually or retry — Applix handles anti-bot protections gracefully

### 🤖 AI-Powered Resume Generation
- **Single-Call Generation:** Get a complete, tailored resume in seconds with one AI request
- **Three Aggressiveness Levels:**
  - **Low:** Light polishing, keeps your original voice
  - **Medium:** Stronger alignment with the job description
  - **High:** Aggressive reframing for maximum relevance (with careful review)
- **ATS-Safe Output:** Standard headings, clean formatting, no tables or images — optimized for Applicant Tracking Systems
- **Grounded Content:** AI never invents credentials, employers, or experience — stays true to your source resume

### 📝 Flexible Editing & Regeneration
- **Markdown Editor:** Edit your resume directly in a beautiful, syntax-highlighted editor
- **Live Preview:** Toggle between edit mode and rendered preview to see exactly how it will look
- **Section Regeneration:** Need to tweak just the Summary or Professional Experience? Regenerate individual sections with custom instructions
- **Full Regeneration:** Update generation settings and regenerate the entire resume with one click

### 📊 Application Dashboard
- **Visual Status Tracking:** See all your applications with color-coded status badges (Draft, Needs Action, In Progress, Complete)
- **Applied Flag:** Track which jobs you've actually submitted applications for
- **Search & Filter:** Find applications by company, job title, or status
- **Duplicate Detection:** Automatically identify similar applications to avoid duplicate efforts
- **Analytics:** Monthly activity charts, job source breakdowns, and top companies

### 📄 Professional PDF Export
- **On-Demand Generation:** Always exports from your latest draft — no stale PDFs
- **ATS-Safe Format:** Single-column, standard fonts, clean spacing
- **Smart Pagination:** Optimized for 1-page, 2-page, or 3-page targets
- **Custom Naming:** `{your_name}_resume_{date}.pdf`

### 🔔 Smart Notifications
- **In-App Alerts:** Real-time updates on extraction, generation, and export status
- **Email Notifications:** Critical updates delivered to your inbox
- **Action Required Flags:** Never miss a step — see exactly what needs your attention

---

## 🎨 Screenshots

### Login Screen
Beautiful, branded login experience with illustration-led design

![Login Screen](/docs/design/01-login-page.png)

### Applications Dashboard
Track all your job applications with status badges, search, and analytics

![Applications Dashboard](/docs/design/02-applications-dashboard.png)

### Applications List
Search, filter, and manage your job applications with inline status badges and action buttons

![Applications List](/docs/design/03-applications-list.png)

---

## 🚀 Who Is This For?

**Applix is built for:**

- **Active Job Seekers** applying to multiple positions simultaneously
- **Career Changers** who need to reframe their experience for new industries
- **Tech Professionals** targeting ATS-heavy companies
- **Freelancers** managing multiple client proposals
- **Recent Graduates** learning to tailor applications effectively

**Perfect if you:**
- Spend more than 30 minutes per job application
- Struggle to match your experience to job descriptions
- Want to apply to more jobs without sacrificing quality
- Need resumes that pass through ATS filters

---

## 🛠️ Tech Stack

Built with modern, reliable technologies:

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 + Vite + Tailwind CSS + shadcn/ui |
| **Backend** | FastAPI (Python) |
| **Database & Auth** | Supabase (PostgreSQL + Row Level Security) |
| **AI Orchestration** | LangChain + OpenRouter (model-agnostic) |
| **Web Scraping** | Playwright (headless browser) |
| **Email** | Resend |
| **PDF Generation** | WeasyPrint (ATS-optimized) |
| **Extensions** | Chrome Manifest V3 |

---

## 📦 Quick Start

### Prerequisites

- Docker and Docker Compose
- Make (for development orchestration)
- Git

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/sankal/job-app.git
   cd job-app
   ```

2. **Configure environment**
   ```bash
   cp .env.compose.example .env.compose
   # Edit .env.compose with your configuration
   ```

3. **Start the local stack**
   ```bash
   make up
   ```

4. **Create your first user** (dev mode only)
   ```bash
   make seed-local-user
   ```

5. **Access the application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:8000

### Running Tests

```bash
# Frontend tests
cd frontend && npm test

# Backend tests
cd backend && pytest
```

### Production Deployment

Applix is designed for deployment on [Railway](https://railway.app) with Supabase for database and authentication.

---

## 📖 User Journey

1. **Sign In** → Secure email/password authentication (invite-only)
2. **Create Application** → Paste a job URL or use Chrome extension
3. **Automatic Extraction** → AI analyzes the posting and extracts key details
4. **Select Base Resume** → Choose from your saved resumes
5. **Configure Settings** → Set target length and aggressiveness
6. **Generate Resume** → AI creates a tailored draft in seconds
7. **Review & Edit** → Preview in Markdown, edit as needed
8. **Export PDF** → Download ATS-safe PDF ready for submission
9. **Track Progress** → Mark as applied and monitor your pipeline

---

## 🔒 Security & Privacy

- **Invite-Only Access:** No public signup — controlled user provisioning
- **Per-User Isolation:** Supabase Row Level Security ensures your data stays private
- **No Token Storage:** Authentication tokens never stored in localStorage
- **Grounded AI:** Your personal information is never sent to external AI providers
- **No Persistent PDFs:** PDFs generated on-demand, never stored on servers
- **Sanitized Logging:** No sensitive data in application logs

---

## 📂 Project Structure

```
job-app/
├── frontend/              # React application (Vite + Tailwind)
│   ├── src/
│   │   ├── routes/        # Page components (Dashboard, Applications, etc.)
│   │   ├── components/    # Reusable UI components
│   │   └── lib/           # Utilities and API clients
│   └── public/            # Static assets and Chrome extension
├── backend/               # FastAPI backend
│   ├── app/
│   │   ├── api/           # REST API endpoints
│   │   ├── services/      # Business logic
│   │   └── db/            # Database repositories
│   └── tests/             # Backend test suite
├── agents/                # AI orchestration and prompt logic
│   ├── generation.py      # Resume generation pipeline
│   ├── validation.py      # Output validation
│   └── assembly.py        # Resume assembly
├── supabase/              # Database migrations and config
│   └── migrations/        # Versioned schema changes
├── docs/                  # Product requirements and documentation
│   ├── resume_builder_PRD_v3.md
│   └── build-plan.md
└── scripts/               # DevOps and utility scripts
```

---

## 🎯 Product Philosophy

### Grounded, Not Invented
Applix never invents credentials, employers, or experience. All generated content stays true to your source resume while strategically aligning with job requirements.

### User Control
You're always in control. Edit any section, regenerate with different settings, or manually override AI suggestions. Applix is a tool, not a replacement for your judgment.

### ATS-First
Every resume is optimized for Applicant Tracking Systems — clean formatting, standard headings, keyword relevance, and zero decorative elements.

### Privacy by Design
Your personal information never touches external AI providers. Contact details are stripped before generation and reattached locally during assembly.

---

## 📄 Documentation

- [Product Requirements Document](docs/resume_builder_PRD_v3.md)
- [Database Schema](docs/database_schema.md)
- [Build Plan & Roadmap](docs/build-plan.md)
- [Decision Log](docs/decisions-made/)
- [Migration Runbook](docs/backend-database-migration-runbook.md)

---

## 🤝 Contributing

This is a private, invite-only application. For development inquiries, please contact the project maintainer.

---

## 📝 License

Proprietary — All rights reserved.

---

## 💡 Roadmap

**Implemented (v0.1):**
- ✅ Application intake from URLs and Chrome extension
- ✅ AI-powered resume generation with three aggressiveness levels
- ✅ Markdown editor with live preview
- ✅ Section and full resume regeneration
- ✅ PDF export with ATS-safe formatting
- ✅ Dashboard with analytics and duplicate detection
- ✅ In-app and email notifications

**Coming Soon:**
- 🔄 Multiple PDF templates
- 🔄 Cover letter generation
- 🔄 Resume version history
- 🔄 Team/collaborative workflows
- 🔄 Advanced analytics

---

## 📬 Support

For support, feature requests, or bug reports, please open an issue in the repository or contact the development team.

---

**Built with ❤️ for job seekers who deserve better tools.**

*Applix — Where your experience meets the right opportunity.*
