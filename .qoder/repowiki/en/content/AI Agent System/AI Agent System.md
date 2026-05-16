# AI Agent System

<cite>
**Referenced Files in This Document**
- [worker.py](file://agents/worker.py)
- [generation.py](file://agents/generation.py)
- [validation.py](file://agents/validation.py)
- [experience_contract.py](file://agents/experience_contract.py)
- [resume_judge.py](file://agents/resume_judge.py)
- [workflow-contract.json](file://shared/workflow-contract.json)
- [workflow_contract.py](file://backend/app/core/workflow_contract.py)
- [workflow.py](file://backend/app/services/workflow.py)
- [internal_worker.py](file://backend/app/api/internal_worker.py)
- [main.py](file://backend/app/main.py)
- [application_manager.py](file://backend/app/services/application_manager.py)
- [test_worker.py](file://agents/tests/test_worker.py)
- [test_resume_judge.py](file://agents/tests/test_resume_judge.py)
- [test_experience_contract.py](file://agents/tests/test_experience_contract.py)
- [backend/AGENTS.md](file://backend/AGENTS.md)
- [2026-04-10-deterministic-regeneration-timeouts-and-cap.md](file://docs/task-output/2026-04-10-deterministic-regeneration-timeouts-and-cap.md)
- [2026-04-09-high-aggressiveness-role-title-rewrites.md](file://docs/task-output/2026-04-09-high-aggressiveness-role-title-rewrites.md)
- [2026-04-07-generation-hang-and-cancel-fixes.md](file://docs/task-output/2026-04-07-generation-hang-and-cancel-fixes.md)
- [2026-04-17-resume-judge-agent-and-score-ui.md](file://docs/task-output/2026-04-17-resume-judge-agent-and-score-ui.md)
- [2026-04-18-resume-judge-rerun-cap-and-railway-callback-hardening.md](file://docs/task-output/2026-04-18-resume-judge-rerun-cap-and-railway-callback-hardening.md)
- [2026-04-10-deterministic-regeneration-timeouts-and-cap.sql](file://supabase/migrations/20260410_000011_phase_5_full_regeneration_cap.sql)
</cite>

## Update Summary
**Changes Made**
- Enhanced Professional Experience Contract Service with comprehensive deterministic parsing capabilities
- Strengthened validation logic for professional experience sections with strict structural invariants
- Added comprehensive test coverage improvements for experience contract functionality
- Updated deterministic Professional Experience validation with strict role title constraints
- Enhanced validation agent with comprehensive experience contract enforcement
- Improved error handling and validation diagnostics for experience sections

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document describes the AI agent system built on ARQ for the AI Resume Builder. It covers the agent design patterns for task queue management, progress tracking, error handling, and asynchronous processing. It explains the four main agent types:
- Extraction agents for web scraping and job board parsing
- Generation agents for AI-powered resume creation using section-based generation and prompt engineering
- Validation agents for content validation and ATS optimization
- **NEW** Resume Judge agents for automated resume scoring and evaluation against job descriptions

It also documents agent coordination via Redis queues, progress callbacks, LangChain integration, OpenRouter API configuration and model selection, workflow contract integration with the backend state machine, error recovery and retry strategies, and practical examples for configuration, scheduling, and monitoring.

## Project Structure
The AI agent system is implemented in the agents/ package and orchestrated by ARQ workers. The backend exposes internal worker callbacks that receive progress and completion events from agents. Shared workflow-contract.json defines the state machine and mapping rules used by the backend to derive visible statuses.

```mermaid
graph TB
subgraph "Agents Package"
W["worker.py<br/>ARQ worker tasks"]
G["generation.py<br/>Section-based generation"]
V["validation.py<br/>ATS and hallucination validation"]
EC["experience_contract.py<br/>Deterministic PE handling"]
A["assembly.py<br/>Final resume assembly"]
RJ["resume_judge.py<br/>Automated resume scoring"]
CFG["pyproject.toml<br/>Dependencies"]
DF["Dockerfile<br/>ARQ runtime"]
end
subgraph "Shared Contracts"
WC["workflow-contract.json<br/>Internal states, kinds, mapping rules"]
end
subgraph "Backend"
API["internal_worker.py<br/>Internal callbacks"]
CORE["workflow_contract.py<br/>Load contract"]
SVC["workflow.py<br/>Status derivation"]
APP["main.py<br/>FastAPI app"]
AM["application_manager.py<br/>Progress reconciliation"]
end
subgraph "External Services"
RC["Redis<br/>ARQ queues + generation cache"]
OR["OpenRouter<br/>ChatOpenAI"]
PW["Playwright<br/>Browser automation"]
DB["PostgreSQL<br/>Applications table"]
end
W --> RC
W --> OR
W --> PW
W --> API
API --> SVC
SVC --> CORE
CORE --> WC
APP --> API
AM --> RC
DF --> W
CFG --> W
DB --> APP
```

**Diagram sources**
- [worker.py:1-2445](file://agents/worker.py#L1-L2445)
- [generation.py:1-1539](file://agents/generation.py#L1-L1539)
- [validation.py:1-602](file://agents/validation.py#L1-L602)
- [experience_contract.py:1-536](file://agents/experience_contract.py#L1-L536)
- [assembly.py:1-86](file://agents/assembly.py#L1-L86)
- [resume_judge.py:1-598](file://agents/resume_judge.py#L1-L598)
- [workflow-contract.json:1-122](file://shared/workflow-contract.json#L1-L122)
- [workflow_contract.py:1-40](file://backend/app/core/workflow_contract.py#L1-L40)
- [workflow.py:1-32](file://backend/app/services/workflow.py#L1-L32)
- [internal_worker.py:1-90](file://backend/app/api/internal_worker.py#L1-L90)
- [main.py:1-36](file://backend/app/main.py#L1-L36)
- [application_manager.py:2030-2107](file://backend/app/services/application_manager.py#L2030-L2107)

**Section sources**
- [worker.py:1-2445](file://agents/worker.py#L1-L2445)
- [workflow-contract.json:1-122](file://shared/workflow-contract.json#L1-L122)
- [workflow_contract.py:1-40](file://backend/app/core/workflow_contract.py#L1-L40)
- [workflow.py:1-32](file://backend/app/services/workflow.py#L1-L32)
- [internal_worker.py:1-90](file://backend/app/api/internal_worker.py#L1-L90)
- [main.py:1-36](file://backend/app/main.py#L1-L36)

## Core Components
- ARQ worker tasks: define the extraction, generation, regeneration, and **NEW** resume judge jobs and publish progress and results to Redis and backend callbacks.
- Extraction agent: uses Playwright to scrape job postings and LangChain with OpenRouter to extract structured fields.
- Generation agent: performs section-based generation with structured output, fallback models, progress callbacks, and comprehensive validation.
- Validation agent: validates ATS safety, hallucinations, required sections, and ordering; supports auto-corrections.
- **Enhanced** Experience Contract Service: provides deterministic Professional Experience and Education structure handling with comprehensive parsing logic and validation.
- Assembly service: combines personal info header with ordered generated sections into a single Markdown resume.
- **NEW** Resume Judge Agent: scores generated resumes against job descriptions using six-dimensional evaluation criteria with automated pass/fail determination.
- Progress tracking: Redis-backed JobProgress records and periodic callbacks to backend.
- Workflow contract: shared contract defining internal states, workflow kinds, failure reasons, and status mapping rules.
- Redis generation caching: persistent cache for generation results with reconciliation capabilities.

**Section sources**
- [worker.py:52-53](file://agents/worker.py#L52-L53)
- [worker.py:58-75](file://agents/worker.py#L58-L75)
- [generation.py:56-57](file://agents/generation.py#L56-L57)
- [generation.py:58-59](file://agents/generation.py#L58-L59)
- [validation.py:1-16](file://agents/validation.py#L1-L16)
- [experience_contract.py:1-536](file://agents/experience_contract.py#L1-L536)
- [assembly.py:12-86](file://agents/assembly.py#L12-L86)
- [resume_judge.py:1-598](file://agents/resume_judge.py#L1-L598)
- [workflow-contract.json:1-122](file://shared/workflow-contract.json#L1-L122)

## Architecture Overview
The system integrates ARQ workers with Redis queues, LangChain ChatOpenAI via OpenRouter, Playwright for browser automation, and backend callbacks for progress and completion. The backend derives visible statuses from internal states using the shared workflow contract. Generation workflows include Redis caching for results with reconciliation capabilities. **NEW** Resume Judge Agent provides automated scoring and evaluation capabilities.

```mermaid
sequenceDiagram
participant Client as "Client"
participant Backend as "Backend API"
participant Worker as "ARQ Worker"
participant Redis as "Redis Queue + Cache"
participant OR as "OpenRouter"
participant PW as "Playwright"
participant EC as "Experience Contract"
participant RJ as "Resume Judge"
participant Callback as "Backend Callbacks"
Client->>Backend : "Schedule extraction/generation/regeneration/resume judge"
Backend->>Redis : "Enqueue task"
Redis-->>Worker : "Dequeue task"
Worker->>PW : "Scrape page (optional)"
Worker->>OR : "Structured extraction/generation/validation"
Worker->>EC : "Deterministic PE handling"
Worker->>RJ : "Automated resume scoring"
Worker->>Callback : "POST progress/state (best-effort)"
Callback-->>Backend : "Update application state"
Worker->>Redis : "Store JobProgress + Generation Cache"
Backend->>Redis : "Reconcile progress/cache on startup"
Backend-->>Client : "Poll progress/status"
```

**Diagram sources**
- [worker.py:2246-2399](file://agents/worker.py#L2246-L2399)
- [internal_worker.py:74-90](file://backend/app/api/internal_worker.py#L74-L90)
- [workflow-contract.json:1-122](file://shared/workflow-contract.json#L1-L122)
- [application_manager.py:2030-2107](file://backend/app/services/application_manager.py#L2030-L2107)

## Detailed Component Analysis

### Extraction Agent
The extraction agent scrapes job posting pages and extracts structured fields using a LangChain ChatOpenAI call against OpenRouter. It supports a primary and fallback model with automatic retry.

Key behaviors:
- Playwright-driven scraping with headless Chromium
- Origin normalization and reference ID extraction from URL/text
- Structured extraction with Pydantic model validation
- Blocked-page detection and failure reporting
- Progress updates and success/failure callbacks

```mermaid
sequenceDiagram
participant Worker as "run_extraction_job"
participant PW as "Playwright"
participant Agent as "OpenRouterExtractionAgent"
participant OR as "OpenRouter"
participant CB as "BackendCallbackClient"
participant RW as "RedisProgressWriter"
Worker->>RW : "set_progress(extracting, 10%)"
Worker->>CB : "post(started)"
alt Source capture provided
Worker->>Worker : "build_page_context_from_capture"
else Scrape live page
Worker->>PW : "scrape_page_context"
end
Worker->>Worker : "detect_blocked_page"
Worker->>Agent : "extract(PageContext)"
Agent->>OR : "structured extraction"
OR-->>Agent : "ExtractedJobPosting"
Worker->>Worker : "finalize_extracted_posting"
Worker->>RW : "set_progress(generation_pending, 100%)"
Worker->>CB : "post(succeeded, extracted)"
```

**Diagram sources**
- [worker.py:672-791](file://agents/worker.py#L672-L791)
- [worker.py:485-522](file://agents/worker.py#L485-L522)

**Section sources**
- [worker.py:485-522](file://agents/worker.py#L485-L522)
- [worker.py:672-791](file://agents/worker.py#L672-L791)
- [worker.py:283-322](file://agents/worker.py#L283-L322)

### Generation Agent
The generation agent performs section-based generation with:
- Structured output via Pydantic models
- Fallback model retry on primary failure
- Progress callbacks for each section
- Validation gate before assembly
- Deterministic Professional Experience structure handling
- **Enhanced** Comprehensive timeout management and reliability diagnostics

**Updated** Enhanced with comprehensive generation workflow system and Redis caching

```mermaid
sequenceDiagram
participant Worker as "run_generation_job"
participant Gen as "generate_sections"
participant OR as "OpenRouter"
participant EC as "ExperienceContract"
participant Val as "validate_resume"
participant Asm as "assemble_resume"
participant CB as "BackendCallbackClient"
participant RW as "RedisProgressWriter"
Worker->>RW : "clear_generation_result(app_id)"
Worker->>RW : "set_progress(generating, 5%)"
Worker->>CB : "post(started, generation)"
Worker->>Gen : "generate_sections(..., on_progress)"
Gen->>OR : "section prompts (primary/fallback)"
OR-->>Gen : "GeneratedSection"
Gen->>EC : "normalize_professional_experience"
EC-->>Gen : "Normalized PE section"
Gen-->>Worker : "sections + model_used + anchors"
Worker->>RW : "set_progress(generating, 85%)"
Worker->>Val : "validate_resume(...)"
Val->>EC : "validate_experience_contract"
EC-->>Val : "Contract validation results"
Val-->>Worker : "valid/errors/auto_corrections"
alt Valid
Worker->>RW : "set_progress(generating, 95%)"
Worker->>Asm : "assemble_resume(personal_info, sections)"
Worker->>RW : "set_progress(resume_ready, 100%)"
Worker->>RW : "set_generation_result(cache)"
Worker->>CB : "post(succeeded, content)"
else Invalid
Worker->>RW : "set_progress(generation_failed, 100%)"
Worker->>CB : "post(failed, validation_errors)"
end
```

**Diagram sources**
- [worker.py:961-1149](file://agents/worker.py#L961-L1149)
- [generation.py:898-991](file://agents/generation.py#L898-L991)
- [validation.py:527-602](file://agents/validation.py#L527-L602)
- [assembly.py:12-86](file://agents/assembly.py#L12-L86)

**Section sources**
- [worker.py:961-1149](file://agents/worker.py#L961-L1149)
- [generation.py:898-991](file://agents/generation.py#L898-L991)
- [validation.py:527-602](file://agents/validation.py#L527-L602)

### Regeneration Agent
The regeneration agent provides both full and single-section regeneration capabilities:
- Full regeneration follows the same generation pipeline with deterministic validation
- Single-section regeneration targets specific sections with user instructions
- Both modes support progress callbacks and validation gates
- Redis caching persists generation results for recovery
- **Enhanced** Comprehensive timeout management and slot consumption tracking

**Updated** Comprehensive documentation of regeneration workflow system

```mermaid
sequenceDiagram
participant Worker as "run_regeneration_job"
participant Gen as "generate_sections"
participant RS as "regenerate_single_section"
participant OR as "OpenRouter"
participant EC as "ExperienceContract"
participant Val as "validate_resume"
participant Asm as "assemble_resume"
participant CB as "BackendCallbackClient"
participant RW as "RedisProgressWriter"
alt Full regeneration
Worker->>RW : "clear_generation_result(app_id)"
Worker->>RW : "set_progress(regenerating_full, 5%)"
Worker->>CB : "post(started, regeneration)"
Worker->>Gen : "generate_sections(...)"
Gen->>OR : "full draft generation"
OR-->>Gen : "GeneratedSections"
else Single-section regeneration
Worker->>RW : "set_progress(regenerating_section, 20%)"
Worker->>CB : "post(started, regeneration)"
Worker->>RS : "regenerate_single_section(...)"
RS->>OR : "section-specific generation"
OR-->>RS : "RegeneratedSection"
end
Worker->>RW : "set_progress(regenerating, 85%)"
Worker->>Val : "validate_resume(...)"
Val->>EC : "validate_experience_contract"
EC-->>Val : "Contract validation results"
Val-->>Worker : "valid/errors/auto_corrections"
alt Valid
Worker->>RW : "set_progress(resume_ready, 100%)"
Worker->>RW : "set_generation_result(cache)"
Worker->>CB : "post(succeeded, content)"
else Invalid
Worker->>RW : "set_progress(generation_failed, 100%)"
Worker->>CB : "post(failed, validation_errors)"
end
```

**Diagram sources**
- [worker.py:1226-1613](file://agents/worker.py#L1226-L1613)
- [generation.py:1013-1110](file://agents/generation.py#L1013-L1110)
- [validation.py:527-602](file://agents/validation.py#L527-L602)

**Section sources**
- [worker.py:1226-1613](file://agents/worker.py#L1226-L1613)
- [generation.py:1013-1110](file://agents/generation.py#L1013-L1110)

### Validation Agent
The validation agent enforces:
- Hallucination detection across sections using structured LLM output with detailed finding models
- Required sections presence
- Correct ordering
- ATS safety (no tables/images; auto-correct minor formatting)
- Deterministic Professional Experience structure validation with anchor-based contract enforcement
- **Enhanced** Comprehensive Education section validation and strict structural invariants

**Updated** Enhanced with deterministic Professional Experience validation and stricter role title constraints

```mermaid
flowchart TD
Start(["validate_resume"]) --> Hallu["LLM hallucination check<br/>Structured output with findings"]
Hallu --> Req["Required sections check"]
Req --> Order["Section order check"]
Order --> PE["Professional Experience contract validation<br/>Anchor-based structure enforcement"]
PE --> EDU["Education contract validation<br/>Strict structural rules"]
EDU --> ATSSafe["ATS safety rules<br/>Auto-corrections"]
ATSSafe --> Merge["Aggregate errors and auto_corrections"]
Merge --> End(["Return {valid, errors, auto_corrections}"])
```

**Diagram sources**
- [validation.py:527-602](file://agents/validation.py#L527-L602)
- [experience_contract.py:400-536](file://agents/experience_contract.py#L400-L536)

**Section sources**
- [validation.py:140-174](file://agents/validation.py#L140-L174)
- [validation.py:176-228](file://agents/validation.py#L176-L228)
- [validation.py:230-250](file://agents/validation.py#L230-L250)
- [validation.py:332-395](file://agents/validation.py#L332-L395)
- [validation.py:441-462](file://agents/validation.py#L441-L462)
- [validation.py:464-499](file://agents/validation.py#L464-L499)
- [validation.py:527-602](file://agents/validation.py#L527-L602)

### Experience Contract Service
The experience contract service provides comprehensive deterministic Professional Experience and Education structure handling:
- Anchor extraction from source content with duplicate detection
- Role header parsing with title/company/date validation and seniority preservation
- Deterministic normalization preserving source anchors with configurable aggressiveness
- Contract validation ensuring structural integrity with strict invariants
- **Enhanced** Comprehensive Education section parsing with institution detection and validation
- **Enhanced** Sophisticated title rewriting rules with role family preservation and seniority enforcement

**New** Comprehensive documentation of deterministic Professional Experience handling

```mermaid
flowchart TD
A["extract_professional_experience_anchors"] --> B["Parse role headers<br/>title | company | date_range"]
B --> C["Normalize text for comparison"]
C --> D["Validate date range patterns"]
D --> E["Extract unique anchors"]
E --> F["normalize_professional_experience_section"]
F --> G["Rebuild role headers<br/>preserve source anchors"]
G --> H["validate_professional_experience_contract"]
H --> I["Enforce structural invariants<br/>company, dates, title preservation"]
J["extract_generated_experience_blocks"] --> K["Parse generated blocks<br/>strict header validation"]
K --> L["normalize_education_section<br/>institution detection"]
L --> M["validate_education_contract<br/>structural validation"]
N["is_title_rewrite_allowed"] --> O["Check aggressiveness level"]
O --> P["Validate role family preservation"]
P --> Q["Verify seniority constraints"]
```

**Diagram sources**
- [experience_contract.py:290-324](file://agents/experience_contract.py#L290-L324)
- [experience_contract.py:352-393](file://agents/experience_contract.py#L352-L393)
- [experience_contract.py:395-463](file://agents/experience_contract.py#L395-L463)
- [experience_contract.py:466-536](file://agents/experience_contract.py#L466-L536)
- [experience_contract.py:156-169](file://agents/experience_contract.py#L156-L169)

**Section sources**
- [experience_contract.py:290-324](file://agents/experience_contract.py#L290-L324)
- [experience_contract.py:352-393](file://agents/experience_contract.py#L352-L393)
- [experience_contract.py:395-463](file://agents/experience_contract.py#L395-L463)
- [experience_contract.py:466-536](file://agents/experience_contract.py#L466-L536)
- [experience_contract.py:156-169](file://agents/experience_contract.py#L156-L169)

### Assembly Service
Assembles final Markdown from personal info header and ordered generated sections, ensuring proper formatting and section separation.

```mermaid
flowchart TD
A["assemble_resume(personal_info, generated_sections)"] --> H["Header: name"]
H --> C["Contact line (email, phone, address)"]
C --> S["Iterate sections in order"]
S --> J["Join with blank lines between sections"]
J --> R["Return final Markdown"]
```

**Diagram sources**
- [assembly.py:12-86](file://agents/assembly.py#L12-L86)

**Section sources**
- [assembly.py:12-86](file://agents/assembly.py#L12-L86)

### Resume Judge Agent
**NEW** The Resume Judge Agent provides automated scoring and evaluation of generated resumes against job descriptions using six-dimensional evaluation criteria:

#### Evaluation Dimensions
- **Role Alignment (25%)**: How clearly the draft positions the candidate for the target role and surfaces job description priorities
- **Specificity and Concreteness (20%)**: How specific, grounded, and concrete the claims are instead of generic
- **Voice and Human Quality (20%)**: Natural, human, non-template writing quality and resistance to obvious AI phrasing patterns
- **Grounding Integrity (20%)**: Staying within the facts of the sanitized base resume for the selected aggressiveness
- **ATS Safety and Formatting (10%)**: ATS safety, clean Markdown structure, and absence of forbidden formatting/contact leakage
- **Length and Density (5%)**: Fitting the target length and keeping content dense, purposeful, and not padded

#### Key Features
- Six-dimensional scoring with weighted contributions (0-10 per dimension)
- Automated pass/fail determination (80% threshold)
- Priority dimension identification for targeted regeneration
- Reasoning effort configuration (none, low, medium, high, xhigh)
- Fallback model support for reliability
- Comprehensive diagnostics and attempt tracking
- Deterministic observations for ATS-safety and length-density facts

```mermaid
flowchart TD
Start(["judge_resume"]) --> Sanitize["Sanitize base & generated content"]
Sanitize --> Observe["Determine deterministic observations<br/>word count, contact leaks, formatting issues"]
Observe --> BuildPrompt["Build evaluation prompt<br/>job description, base resume, generated resume"]
BuildPrompt --> Attempt1["Attempt primary model"]
Attempt1 --> Success1{"Success?"}
Success1 --> |Yes| Finalize["Compute weighted score<br/>80% pass threshold"]
Success1 --> |No| CheckReasoning{"Reasoning supported?"}
CheckReasoning --> |Yes| Attempt2["Retry without reasoning"]
Attempt2 --> Success2{"Success?"}
Success2 --> |Yes| Finalize
Success2 --> |No| Fallback["Use fallback model"]
Fallback --> Success3{"Success?"}
Success3 --> |Yes| Finalize
Success3 --> |No| Error["Raise error"]
Finalize --> Pass{"Score ≥ 80%?"}
Pass --> |Yes| Clear["Clear regeneration fields"]
Pass --> |No| SetPriority["Set priority dimensions<br/>top 2 worst areas"]
Clear --> Result["Return pass result"]
SetPriority --> Result
```

**Diagram sources**
- [resume_judge.py:529-598](file://agents/resume_judge.py#L529-L598)
- [resume_judge.py:376-464](file://agents/resume_judge.py#L376-L464)
- [resume_judge.py:489-527](file://agents/resume_judge.py#L489-L527)

**Section sources**
- [resume_judge.py:1-598](file://agents/resume_judge.py#L1-L598)

### Progress Tracking and Callbacks
Progress is stored in Redis under a deterministic key and periodically updated during agent runs. Backend callbacks notify the system of state transitions and completion. Generation workflows include Redis caching for results with best-effort delivery.

```mermaid
classDiagram
class RedisProgressWriter {
+get(application_id) JobProgress?
+set(application_id, progress, ttl_seconds)
+set_generation_result(application_id, job_id, workflow_kind, generated, ttl_seconds)
+clear_generation_result(application_id)
}
class JobProgress {
+string job_id
+string workflow_kind
+string state
+string message
+int percent_complete
+string created_at
+string updated_at
+string completed_at?
+string terminal_error_code?
}
class BackendCallbackClient {
+post(payload, path)
}
class BestEffortCallback {
+post_callback_best_effort(callback, payload, path, app_id, job_id, stage)
}
RedisProgressWriter --> JobProgress : "serializes/deserializes"
BackendCallbackClient -->|"HTTP POST"| BackendCallbackClient : "extraction/generation/regeneration/resume_judge"
BestEffortCallback --> BackendCallbackClient : "wraps with retry/backoff"
```

**Diagram sources**
- [worker.py:356-372](file://agents/worker.py#L356-L372)
- [worker.py:77-87](file://agents/worker.py#L77-L87)
- [worker.py:374-403](file://agents/worker.py#L374-L403)
- [worker.py:722-766](file://agents/worker.py#L722-L766)

**Section sources**
- [worker.py:356-372](file://agents/worker.py#L356-L372)
- [worker.py:77-87](file://agents/worker.py#L77-L87)
- [worker.py:374-403](file://agents/worker.py#L374-L403)
- [worker.py:722-766](file://agents/worker.py#L722-L766)

### Redis Generation Caching
Generation results are cached in Redis with TTL expiration for recovery purposes. The backend can reconcile progress and cached results on startup or when callbacks fail to deliver.

**New** Comprehensive documentation of Redis caching for generation results

```mermaid
sequenceDiagram
participant Worker as "Generation Job"
participant Redis as "Redis Cache"
participant Backend as "Backend Service"
Worker->>Redis : "set_generation_result(app_id, payload)"
Redis-->>Worker : "acknowledge cache"
Backend->>Redis : "get_generation_result(app_id)"
Redis-->>Backend : "cached payload"
alt Cache valid
Backend->>Backend : "upsert_draft from cache"
Backend->>Redis : "clear_generation_result(app_id)"
else Cache invalid/expired
Backend->>Backend : "continue with normal reconciliation"
end
```

**Diagram sources**
- [worker.py:406-425](file://agents/worker.py#L406-L425)
- [application_manager.py:992-1191](file://backend/app/services/application_manager.py#L992-L1191)

**Section sources**
- [worker.py:406-425](file://agents/worker.py#L406-L425)
- [application_manager.py:992-1191](file://backend/app/services/application_manager.py#L992-L1191)

### LangChain and OpenRouter Integration
- ChatOpenAI is configured with OpenRouter base URL and API key.
- Structured output is used for extraction and generation to ensure robust parsing.
- Fallback model is attempted automatically when the primary model fails.
- Higher-quality slower models are used as defaults for improved output quality.
- **Enhanced** Reasoning effort configuration with automatic reasoning exclusion for non-supporting models.

**Updated** Enhanced with higher-quality model defaults and improved timeout handling

**Section sources**
- [worker.py:405-483](file://agents/worker.py#L405-L483)
- [generation.py:642-660](file://agents/generation.py#L642-L660)
- [validation.py:1-16](file://agents/validation.py#L1-L16)
- [resume_judge.py:220-238](file://agents/resume_judge.py#L220-L238)

### Workflow Contract Integration
The shared workflow-contract.json defines internal states, workflow kinds, failure reasons, and mapping rules. The backend derives visible statuses from internal states and failure reasons.

```mermaid
graph LR
States["Internal States"] --> Map["Mapping Rules"]
Failures["Failure Reasons"] --> Map
Map --> Status["Visible Statuses"]
```

**Diagram sources**
- [workflow-contract.json:1-122](file://shared/workflow-contract.json#L1-L122)
- [workflow_contract.py:32-39](file://backend/app/core/workflow_contract.py#L32-L39)
- [workflow.py:11-32](file://backend/app/services/workflow.py#L11-L32)

**Section sources**
- [workflow-contract.json:1-122](file://shared/workflow-contract.json#L1-L122)
- [workflow_contract.py:32-39](file://backend/app/core/workflow_contract.py#L32-L39)
- [workflow.py:11-32](file://backend/app/services/workflow.py#L11-L32)

### Generation Settings and Section Management
The generation system supports advanced configuration including:
- Aggressiveness levels (low, medium, high) for tailoring
- Target length guidance (1_page, 2_page, 3_page) for resume sizing
- Section preferences with enabled status and ordering
- Additional instructions for custom generation requirements
- Deterministic Professional Experience structure handling
- **Enhanced** Comprehensive timeout management with operation-specific limits

**Updated** Enhanced with deterministic Professional Experience handling and stricter role title constraints

```mermaid
flowchart TD
Settings["Generation Settings"] --> Agg["Aggressiveness<br/>low/medium/high"]
Settings --> Length["Target Length<br/>1_page/2_page/3_page"]
Settings --> Instructions["Additional Instructions"]
Settings --> Sections["Section Preferences<br/>Enabled + Order"]
Agg --> Prompt["Section Prompt"]
Length --> Prompt
Instructions --> Prompt
Sections --> Prompt
Prompt --> EC["Experience Contract<br/>Anchor extraction & validation"]
EC --> LLM["OpenRouter LLM Call"]
LLM --> Section["Generated Section"]
```

**Diagram sources**
- [generation.py:898-991](file://agents/generation.py#L898-L991)
- [generation.py:499-560](file://agents/generation.py#L499-L560)
- [experience_contract.py:86-122](file://agents/experience_contract.py#L86-L122)

**Section sources**
- [generation.py:898-991](file://agents/generation.py#L898-L991)
- [generation.py:499-560](file://agents/generation.py#L499-L560)

### Regeneration Capabilities
The system supports both full regeneration and single-section regeneration with strict enforcement:
- Full regeneration follows the same generation pipeline with deterministic Professional Experience handling
- Single-section regeneration allows targeted updates with user instructions
- Non-admin users are limited to 3 full regenerations per application
- Admin users have bypass capability for unlimited full regenerations
- Automatic validation after regeneration with error recovery
- Slot consumption occurs only on successful queue submission
- **Enhanced** Comprehensive timeout management with operation-specific limits

**Updated** Enhanced with regeneration cap enforcement and deterministic handling

**Section sources**
- [worker.py:1062-1414](file://agents/worker.py#L1062-L1414)
- [generation.py:1110-1110](file://agents/generation.py#L1110-L1110)
- [2026-04-10-deterministic-regeneration-timeouts-and-cap.md:25-31](file://docs/task-output/2026-04-10-deterministic-regeneration-timeouts-and-cap.md#L25-L31)

### Advanced Validation Features
The validation system implements comprehensive hallucination detection and ATS safety compliance:
- LLM-based hallucination checking with structured output and detailed finding models
- Detection of invented employers, titles, dates, credentials, and institutions
- Cross-section consistency validation
- ATS safety compliance with auto-correction capabilities for formatting issues
- Deterministic Professional Experience structure validation with anchor-based contract enforcement
- **Enhanced** Comprehensive Education section validation with strict structural rules
- Structured error reporting with section-specific details

**Updated** Enhanced with deterministic Professional Experience validation and stricter constraints

**Section sources**
- [validation.py:140-174](file://agents/validation.py#L140-L174)
- [validation.py:527-602](file://agents/validation.py#L527-L602)
- [experience_contract.py:400-536](file://agents/experience_contract.py#L400-L536)

### Error Handling and Timeout Management
The system implements comprehensive error handling and timeout management:
- Extraction timeout: 30 seconds
- Full generation timeout: 540 seconds (increased from previous 240s)
- Full regeneration timeout: 540 seconds (increased from previous 240s)
- Single-section regeneration timeout: 280 seconds (increased from previous 120s)
- **NEW** Resume Judge timeout: 60 seconds with comprehensive diagnostics
- Section regeneration LLM timeout: 120 seconds (increased from previous 45s)
- Export timeout: 20 seconds
- Bounded retries: One fallback model retry per LLM call
- Structured error reporting with normalized validation errors
- Terminal error codes for different failure scenarios
- Deterministic regeneration with strict timeout profiles
- Best-effort callback delivery with exponential backoff
- **Enhanced** Comprehensive timeout management for all operations

**Updated** Enhanced with increased timeouts and deterministic handling

**Section sources**
- [worker.py:52-53](file://agents/worker.py#L52-L53)
- [worker.py:889-904](file://agents/worker.py#L889-L904)
- [worker.py:1132-1147](file://agents/worker.py#L1132-L1147)
- [worker.py:1252-1269](file://agents/worker.py#L1252-L1269)
- [worker.py:76](file://agents/worker.py#L76)
- [generation.py:56-57](file://agents/generation.py#L56-L57)
- [generation.py:58-59](file://agents/generation.py#L58-L59)
- [2026-04-07-generation-hang-and-cancel-fixes.md:110-118](file://docs/task-output/2026-04-07-generation-hang-and-cancel-fixes.md#L110-L118)

### Strict Prompt Constraints for Role Title Rewrites
The system enforces strict constraints for role title rewrites:
- Low and medium aggressiveness: Preserve source role titles exactly as written
- High aggressiveness: May retitle Professional Experience roles only when the new title is a truthful reframing of the same source role
- Strict guardrails: Preserve employer and dates exactly when role titles are rewritten
- Seniority inflation and invented scope are explicitly forbidden
- Deterministic validation ensures high-aggressiveness rewrites don't fail as unsupported claims
- **Enhanced** Sophisticated title validation with role family preservation and seniority enforcement

**New** Comprehensive documentation of strict role title rewrite constraints

**Section sources**
- [generation.py:105-115](file://agents/generation.py#L105-L115)
- [generation.py:122-133](file://agents/generation.py#L122-L133)
- [generation.py:422-432](file://agents/generation.py#L422-L432)
- [experience_contract.py:156-169](file://agents/experience_contract.py#L156-L169)
- [2026-04-09-high-aggressiveness-role-title-rewrites.md:62-71](file://docs/task-output/2026-04-09-high-aggressiveness-role-title-rewrites.md#L62-L71)

### Best-Effort Callback Delivery
Generation workflows implement best-effort callback delivery with retry logic and exponential backoff to ensure resilience against transient failures.

**New** Comprehensive documentation of best-effort callback mechanisms

```mermaid
flowchart TD
Start(["post_callback_best_effort"]) --> Try["Attempt callback delivery"]
Try --> Success{"HTTP 2xx?"}
Success --> |Yes| End(["Return successfully"])
Success --> |No| Retry{"Retry attempts left?"}
Retry --> |Yes| Backoff["Exponential backoff"]
Backoff --> Wait["Wait 1s, 2s, 4s, 8s..."]
Wait --> Try
Retry --> |No| Log["Log warning & continue"]
Log --> End
```

**Diagram sources**
- [worker.py:722-766](file://agents/worker.py#L722-L766)

**Section sources**
- [worker.py:722-766](file://agents/worker.py#L722-L766)

## Dependency Analysis
The agents package depends on ARQ for task queueing, LangChain OpenAI for LLM calls, Playwright for browser automation, and Redis for progress storage and generation caching. The backend consumes agent callbacks and derives application statuses from the shared workflow contract.

```mermaid
graph TB
subgraph "Agents"
ARQ["arq"]
LC["langchain-openai"]
PW["playwright"]
REDIS["redis"]
EC["experience_contract"]
RJ["resume_judge"]
end
subgraph "Backend"
FAST["fastapi"]
SUP["supabase"]
PG["postgres"]
DB["applications.full_regeneration_count"]
AM["application_manager<br/>progress reconciliation"]
end
ARQ --> REDIS
LC --> OPENROUTER["openrouter.ai"]
PW --> WEB["web browsers"]
FAST --> SUP
FAST --> PG
DB --> PG
EC --> FAST
RJ --> FAST
AM --> REDIS
```

**Diagram sources**
- [pyproject.toml:10-16](file://agents/pyproject.toml#L10-L16)
- [worker.py:13-19](file://agents/worker.py#L13-L19)
- [main.py:14-36](file://backend/app/main.py#L14-L36)
- [2026-04-10-deterministic-regeneration-timeouts-and-cap.sql:3-4](file://supabase/migrations/20260410_000011_phase_5_full_regeneration_cap.sql#L3-L4)
- [application_manager.py:992-1191](file://backend/app/services/application_manager.py#L992-L1191)

**Section sources**
- [pyproject.toml:10-16](file://agents/pyproject.toml#L10-L16)
- [worker.py:13-19](file://agents/worker.py#L13-L19)
- [main.py:14-36](file://backend/app/main.py#L14-L36)

## Performance Considerations
- Timeouts: Extraction (30s), generation (540s), regeneration (540s), single-section regeneration (280s), **NEW** Resume Judge (60s), export (20s).
- Increased timeouts for complex generation tasks with deterministic validation
- Bounded retries: One fallback model retry per LLM call.
- Structured output reduces parsing overhead and improves reliability.
- Headless browser automation minimizes resource usage.
- Progress updates keep UI responsive and enable user feedback.
- Deterministic Professional Experience handling reduces validation failures and rework cycles.
- Redis caching reduces callback dependency and enables recovery from delivery failures.
- Best-effort callback delivery with exponential backoff ensures resilience.
- **Enhanced** Comprehensive timeout management and reliability diagnostics across all agents.

## Troubleshooting Guide
Common issues and remedies:
- Extraction timeouts: Retry with manual entry; verify network and provider rate limits.
- Blocked pages: Detection returns failure details; guide user to paste content.
- Validation failures: Review validation errors and auto-corrections; adjust generation settings.
- Missing sections or wrong order: Ensure section preferences are enabled and ordered correctly.
- Model failures: Primary/fallback model retry is automatic; confirm API keys and base URLs.
- Hallucination detection failures: Check LLM model availability and retry with fallback model.
- ATS safety violations: Review auto-corrections applied to fix formatting issues.
- Regeneration cap exceeded: Non-admin users receive conflict guidance; admins can bypass with appropriate permissions.
- Professional Experience structure violations: Review deterministic validation errors and ensure source anchors are preserved.
- Generation cache misses: Backend automatically reconciles from progress when cache is unavailable.
- Callback delivery failures: Best-effort delivery continues without interrupting workflow execution.
- **NEW** Resume Judge scoring failures: Check reasoning effort configuration and model availability; review attempt diagnostics for detailed failure analysis.
- **NEW** Timeout issues: Review operation-specific timeout configurations and adjust model selection for reliability.

**Updated** Enhanced troubleshooting with regeneration cap, Professional Experience validation, Redis caching, and Resume Judge scoring issues

**Section sources**
- [worker.py:791-813](file://agents/worker.py#L791-L813)
- [worker.py:672-791](file://agents/worker.py#L672-L791)
- [validation.py:527-602](file://agents/validation.py#L527-L602)
- [2026-04-10-deterministic-regeneration-timeouts-and-cap.md:25-31](file://docs/task-output/2026-04-10-deterministic-regeneration-timeouts-and-cap.md#L25-L31)

## Conclusion
The ARQ-based agent system provides a robust, asynchronous pipeline for extracting job postings, generating tailored resumes, validating ATS compliance, and assembling final outputs. **NEW** The Resume Judge Agent adds automated scoring and evaluation capabilities with six-dimensional assessment criteria. It integrates tightly with Redis for progress tracking and generation caching, OpenRouter for reliable LLM calls, and the backend's workflow contract to maintain a clear state machine and visible status mapping. Built-in retry strategies, timeouts, and structured validation ensure resilient operation and predictable user experiences. The enhanced deterministic Professional Experience handling, comprehensive generation workflow system, Redis caching with reconciliation, best-effort callback delivery, and automated scoring capabilities provide additional reliability and control for complex generation workflows.

## Appendices

### Agent Configuration Examples
- Environment variables for OpenRouter and models:
  - OPENROUTER_API_KEY
  - EXTRACTION_AGENT_MODEL, EXTRACTION_AGENT_FALLBACK_MODEL
  - GENERATION_AGENT_MODEL, GENERATION_AGENT_FALLBACK_MODEL
  - GENERATION_AGENT_REASONING_EFFORT
  - VALIDATION_AGENT_MODEL, VALIDATION_AGENT_FALLBACK_MODEL
  - **NEW** RESUME_JUDGE_AGENT_MODEL, RESUME_JUDGE_AGENT_FALLBACK_MODEL, RESUME_JUDGE_AGENT_REASONING_EFFORT
  - BACKEND_API_URL, WORKER_CALLBACK_SECRET
  - REDIS_URL
- Example scheduling:
  - Enqueue extraction: include job_url, application_id, user_id, job_id
  - Enqueue generation: include job_title, company_name, job_description, base_resume_content, personal_info, section_preferences, generation_settings
  - Enqueue regeneration: include either full params or section_name + instructions + current_draft_content
  - **NEW** Enqueue resume judge: include job_title, company_name, job_description, base_resume_content, generated_resume_content, generation_settings, evaluated_draft_updated_at
  - Full regeneration cap enforcement: non-admin users limited to 3 full regenerations per application

**Updated** Enhanced with regeneration cap configuration and Resume Judge Agent setup

**Section sources**
- [worker.py:58-75](file://agents/worker.py#L58-L75)
- [worker.py:672-791](file://agents/worker.py#L672-L791)
- [worker.py:961-1149](file://agents/worker.py#L961-L1149)
- [worker.py:1226-1613](file://agents/worker.py#L1226-L1613)
- [worker.py:2246-2399](file://agents/worker.py#L2246-L2399)

### Monitoring Approaches
- Poll progress: use the polling schema defined in the workflow contract to fetch JobProgress from Redis.
- Backend status mapping: derive visible status from internal state and failure reason.
- Callback verification: ensure X-Worker-Secret is present for internal worker endpoints.
- Regeneration cap monitoring: track applications.full_regeneration_count for non-admin users.
- Deterministic validation monitoring: verify Professional Experience structure compliance.
- Generation cache monitoring: verify Redis caching and reconciliation capabilities.
- **NEW** Resume Judge monitoring: track scoring attempts, pass/fail rates, and priority dimension identification.
- **NEW** Diagnostics monitoring: review attempt diagnostics for detailed failure analysis and model performance tracking.

**Updated** Enhanced with regeneration cap, deterministic validation, Redis caching, and Resume Judge monitoring

**Section sources**
- [workflow-contract.json:91-122](file://shared/workflow-contract.json#L91-L122)
- [workflow.py:11-32](file://backend/app/services/workflow.py#L11-L32)
- [internal_worker.py:74-90](file://backend/app/api/internal_worker.py#L74-L90)

### Error Recovery and Retry Strategies
- Extraction agent: primary model followed by fallback model; blocked pages trigger manual entry.
- Generation/Validation agents: primary model with fallback; structured output ensures consistent parsing.
- Backend callbacks: on failure, set terminal error code and notify the backend; UI can guide user actions.
- Regeneration cap enforcement: non-admin users receive conflict guidance; admin bypass available.
- Deterministic Professional Experience handling: strict validation prevents structural violations.
- Redis caching: automatic recovery from callback failures using cached generation results.
- Best-effort callback delivery: exponential backoff retry mechanism for transient failures.
- **NEW** Resume Judge error handling: comprehensive diagnostics with reasoning effort fallback and detailed failure analysis.

**Updated** Enhanced with regeneration cap, deterministic handling, Redis caching, best-effort callback strategies, and Resume Judge error handling

**Section sources**
- [worker.py:405-483](file://agents/worker.py#L405-L483)
- [generation.py:642-660](file://agents/generation.py#L642-L660)
- [validation.py:1-16](file://agents/validation.py#L1-L16)
- [worker.py:1226-1613](file://agents/worker.py#L1226-L1613)
- [2026-04-10-deterministic-regeneration-timeouts-and-cap.md:25-31](file://docs/task-output/2026-04-10-deterministic-regeneration-timeouts-and-cap.md#L25-L31)

### Hallucination Detection and Validation Rules
The validation system implements comprehensive hallucination detection:
- LLM-based hallucination checking with structured output and detailed finding models
- Detection of invented employers, titles, dates, credentials, and institutions
- Cross-section consistency validation
- ATS safety compliance with auto-correction capabilities
- Deterministic Professional Experience structure validation with anchor-based contract enforcement
- **Enhanced** Comprehensive Education section validation with strict structural rules

**Updated** Enhanced with deterministic Professional Experience validation

**Section sources**
- [validation.py:140-174](file://agents/validation.py#L140-L174)
- [validation.py:527-602](file://agents/validation.py#L527-L602)
- [experience_contract.py:400-536](file://agents/experience_contract.py#L400-L536)

### Generation Settings Configuration
Advanced generation settings for resume customization:
- Aggressiveness levels: low (conservative), medium (balanced), high (aggressive tailoring)
- Target length: 1_page (standard), 2_page (extended), 3_page (maximum)
- Additional instructions: optional custom guidance for specific requirements
- Section preferences: enable/disable sections and set generation order
- Deterministic Professional Experience handling: strict anchor-based structure preservation
- **Enhanced** Comprehensive timeout management with operation-specific limits

**Updated** Enhanced with deterministic Professional Experience handling

**Section sources**
- [backend/AGENTS.md:46-52](file://backend/AGENTS.md#L46-L52)
- [test_worker.py:131-144](file://agents/tests/test_worker.py#L131-L144)
- [generation.py:105-115](file://agents/generation.py#L105-L115)
- [generation.py:122-133](file://agents/generation.py#L122-L133)

### Regeneration Cap Implementation
The system enforces a non-admin full regeneration cap of 3 per application:
- Applications table receives full_regeneration_count column with non-negative constraint
- Non-admin users are blocked at 3 full regenerations with user-safe guidance
- Admin users have bypass capability via profile.is_admin
- Slot consumption occurs only on successful queue submission
- Queue failures do not consume regeneration slots

**New** Comprehensive documentation of regeneration cap implementation

**Section sources**
- [2026-04-10-deterministic-regeneration-timeouts-and-cap.md:25-31](file://docs/task-output/2026-04-10-deterministic-regeneration-timeouts-and-cap.md#L25-L31)
- [2026-04-10-deterministic-regeneration-timeouts-and-cap.sql:3-11](file://supabase/migrations/20260410_000011_phase_5_full_regeneration_cap.sql#L3-L11)
- [2026-04-10-deterministic-regeneration-timeouts-and-cap.md:40-43](file://docs/task-output/2026-04-10-deterministic-regeneration-timeouts-and-cap.md#L40-L43)

### Admin Bypass Support
The system provides admin bypass functionality for regeneration caps:
- Admin users can bypass the 3-full-regeneration cap per application
- Admin bypass is determined by profile.is_admin flag
- Admin users can perform unlimited full regenerations
- Non-admin users are strictly limited to 3 full regenerations per application
- User-safe conflict guidance is provided when cap is reached

**New** Comprehensive documentation of admin bypass support

**Section sources**
- [2026-04-10-deterministic-regeneration-timeouts-and-cap.md:25-31](file://docs/task-output/2026-04-10-deterministic-regeneration-timeouts-and-cap.md#L25-L31)
- [2026-04-10-deterministic-regeneration-timeouts-and-cap.sql:3-11](file://supabase/migrations/20260410_000011_phase_5_full_regeneration_cap.sql#L3-L11)

### Redis Generation Cache Reconciliation
The backend automatically reconciles generation results from Redis cache when callback delivery fails or progress indicates completion without callback receipt.

**New** Comprehensive documentation of Redis cache reconciliation process

```mermaid
flowchart TD
Start(["Backend Startup/Progress Poll"]) --> Check["Check JobProgress state"]
Check --> Terminal{"Terminal state?"}
Terminal --> |No| Continue["Continue normal operation"]
Terminal --> |Yes| Cache["Check Redis generation cache"]
Cache --> HasCache{"Cache exists & matches?"}
HasCache --> |No| Continue
HasCache --> |Yes| Validate["Validate cached payload"]
Validate --> Valid{"Valid payload?"}
Valid --> |No| Continue
Valid --> |Yes| Upsert["Upsert draft from cache"]
Upsert --> Clear["Clear cache"]
Clear --> Notify["Send success notifications"]
Notify --> Continue
```

**Diagram sources**
- [application_manager.py:992-1191](file://backend/app/services/application_manager.py#L992-L1191)

**Section sources**
- [application_manager.py:992-1191](file://backend/app/services/application_manager.py#L992-L1191)

### Resume Judge Agent Configuration and Usage
**NEW** The Resume Judge Agent provides automated scoring and evaluation capabilities:

#### Configuration Options
- RESUME_JUDGE_AGENT_MODEL: Primary model for resume scoring (default: openai/gpt-5.4-mini)
- RESUME_JUDGE_AGENT_FALLBACK_MODEL: Fallback model for reliability (default: openai/gpt-5-mini)
- RESUME_JUDGE_AGENT_REASONING_EFFORT: Reasoning configuration (none, low, medium, high, xhigh)
- RESUME_JUDGE_TIMEOUT_SECONDS: Operation timeout (default: 60 seconds)

#### Evaluation Process
1. **Input Processing**: Sanitizes base and generated resume content
2. **Deterministic Observations**: Analyzes word count, contact leaks, formatting issues
3. **Dimension Scoring**: Evaluates six criteria with weighted contributions
4. **Result Finalization**: Computes final score, pass/fail determination, and priority dimensions
5. **Callback Delivery**: Posts results to backend with comprehensive diagnostics

#### Scoring Criteria
- **Role Alignment**: 0-10 (25% weight)
- **Specificity and Concreteness**: 0-10 (20% weight)
- **Voice and Human Quality**: 0-10 (20% weight)
- **Grounding Integrity**: 0-10 (20% weight)
- **ATS Safety and Formatting**: 0-10 (10% weight)
- **Length and Density**: 0-10 (5% weight)

#### Pass/Fail Threshold
- **Pass**: ≥ 80% (final score)
- **Warn**: 60-79% (final score)
- **Fail**: < 60% (final score)

**Section sources**
- [resume_judge.py:1-598](file://agents/resume_judge.py#L1-L598)
- [worker.py:2246-2399](file://agents/worker.py#L2246-L2399)
- [internal_worker.py:74-90](file://backend/app/api/internal_worker.py#L74-L90)
- [application_manager.py:2030-2107](file://backend/app/services/application_manager.py#L2030-L2107)

### Enhanced Professional Experience Contract Testing
The experience contract service includes comprehensive test coverage demonstrating:

#### Test Coverage Areas
- **Anchor Extraction**: Validates role order preservation and source field extraction
- **Normalization**: Tests low/medium/high aggressiveness title preservation
- **Validation**: Ensures structural invariants and strict title constraints
- **Error Handling**: Covers malformed headers and missing role blocks
- **Integration**: Validates end-to-end experience contract validation

#### Key Test Scenarios
- **Low Aggressiveness**: Preserves source titles exactly as written
- **Medium Aggressiveness**: Allows grounded title rewrites with seniority preservation
- **High Aggressiveness**: Permits truth-based role title rewrites only
- **Structural Validation**: Enforces company, date, and location preservation
- **Error Detection**: Identifies malformed experience entries and missing blocks

**New** Comprehensive documentation of enhanced experience contract testing framework

**Section sources**
- [test_experience_contract.py:1-254](file://agents/tests/test_experience_contract.py#L1-L254)
- [experience_contract.py:290-536](file://agents/experience_contract.py#L290-L536)
- [validation.py:498-533](file://agents/validation.py#L498-L533)