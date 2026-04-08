# AI Agent System

<cite>
**Referenced Files in This Document**
- [AGENTS.md](file://agents/AGENTS.md)
- [assembly.py](file://agents/assembly.py)
- [generation.py](file://agents/generation.py)
- [validation.py](file://agents/validation.py)
- [worker.py](file://agents/worker.py)
- [Dockerfile](file://agents/Dockerfile)
- [pyproject.toml](file://agents/pyproject.toml)
- [workflow-contract.json](file://shared/workflow-contract.json)
- [workflow_contract.py](file://backend/app/core/workflow_contract.py)
- [workflow.py](file://backend/app/services/workflow.py)
- [internal_worker.py](file://backend/app/api/internal_worker.py)
- [main.py](file://backend/app/main.py)
- [test_worker.py](file://agents/tests/test_worker.py)
- [backend/AGENTS.md](file://backend/AGENTS.md)
</cite>

## Update Summary
**Changes Made**
- Enhanced documentation of comprehensive resume generation system with detailed section-based generation capabilities and advanced configuration options
- Added comprehensive coverage of hallucination detection mechanisms with structured finding models and detailed validation rules
- Expanded validation service documentation with ATS-safety compliance features, auto-correction capabilities, and structured error reporting
- Updated worker orchestration capabilities documentation including regeneration workflows with full and single-section regeneration modes
- Added detailed coverage of generation settings including aggressiveness levels (low, medium, high), target page length settings (1_page, 2_page, 3_page), and additional instructions
- Enhanced progress tracking and callback system documentation with comprehensive timeout management and error handling strategies
- Updated backend integration documentation with explicit timeout contracts and retry strategies

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
This document describes the AI agent system built on ARQ for the AI Resume Builder. It covers the agent design patterns for task queue management, progress tracking, error handling, and asynchronous processing. It explains the three main agent types:
- Extraction agents for web scraping and job board parsing
- Generation agents for AI-powered resume creation using section-based generation and prompt engineering
- Validation agents for content validation and ATS optimization

It also documents agent coordination via Redis queues, progress callbacks, LangChain integration, OpenRouter API configuration and model selection, workflow contract integration with the backend state machine, error recovery and retry strategies, and practical examples for configuration, scheduling, and monitoring.

## Project Structure
The AI agent system is implemented in the agents/ package and orchestrated by ARQ workers. The backend exposes internal worker callbacks that receive progress and completion events from agents. Shared workflow-contract.json defines the state machine and mapping rules used by the backend to derive visible statuses.

```mermaid
graph TB
subgraph "Agents Package"
W["worker.py<br/>ARQ worker tasks"]
G["generation.py<br/>Section-based generation"]
V["validation.py<br/>ATS and hallucination validation"]
A["assembly.py<br/>Final resume assembly"]
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
end
subgraph "External Services"
RC["Redis<br/>ARQ queues"]
OR["OpenRouter<br/>ChatOpenAI"]
PW["Playwright<br/>Browser automation"]
end
W --> RC
W --> OR
W --> PW
W --> API
API --> SVC
SVC --> CORE
CORE --> WC
APP --> API
DF --> W
CFG --> W
```

**Diagram sources**
- [worker.py:1-1299](file://agents/worker.py#L1-L1299)
- [generation.py:1-351](file://agents/generation.py#L1-L351)
- [validation.py:1-292](file://agents/validation.py#L1-L292)
- [assembly.py:1-63](file://agents/assembly.py#L1-L63)
- [pyproject.toml:1-26](file://agents/pyproject.toml#L1-L26)
- [Dockerfile:1-14](file://agents/Dockerfile#L1-L14)
- [workflow-contract.json:1-114](file://shared/workflow-contract.json#L1-L114)
- [workflow_contract.py:1-40](file://backend/app/core/workflow_contract.py#L1-L40)
- [workflow.py:1-32](file://backend/app/services/workflow.py#L1-L32)
- [internal_worker.py:1-71](file://backend/app/api/internal_worker.py#L1-L71)
- [main.py:1-36](file://backend/app/main.py#L1-L36)

**Section sources**
- [worker.py:1-1299](file://agents/worker.py#L1-L1299)
- [pyproject.toml:1-26](file://agents/pyproject.toml#L1-L26)
- [Dockerfile:1-14](file://agents/Dockerfile#L1-L14)
- [workflow-contract.json:1-114](file://shared/workflow-contract.json#L1-L114)
- [workflow_contract.py:1-40](file://backend/app/core/workflow_contract.py#L1-L40)
- [workflow.py:1-32](file://backend/app/services/workflow.py#L1-L32)
- [internal_worker.py:1-71](file://backend/app/api/internal_worker.py#L1-L71)
- [main.py:1-36](file://backend/app/main.py#L1-L36)

## Core Components
- ARQ worker tasks: define the extraction, generation, and regeneration jobs and publish progress and results to Redis and backend callbacks.
- Extraction agent: uses Playwright to scrape job postings and LangChain with OpenRouter to extract structured fields.
- Generation agent: performs section-based generation with structured output, fallback models, and progress callbacks.
- Validation agent: validates ATS safety, hallucinations, required sections, and ordering; supports auto-corrections.
- Assembly service: combines personal info header with ordered generated sections into a single Markdown resume.
- Progress tracking: Redis-backed JobProgress records and periodic callbacks to backend.
- Workflow contract: shared contract defining internal states, workflow kinds, failure reasons, and status mapping rules.

**Section sources**
- [worker.py:598-974](file://agents/worker.py#L598-L974)
- [generation.py:159-224](file://agents/generation.py#L159-L224)
- [validation.py:231-292](file://agents/validation.py#L231-L292)
- [assembly.py:12-63](file://agents/assembly.py#L12-L63)
- [workflow-contract.json:1-114](file://shared/workflow-contract.json#L1-L114)

## Architecture Overview
The system integrates ARQ workers with Redis queues, LangChain ChatOpenAI via OpenRouter, Playwright for browser automation, and backend callbacks for progress and completion. The backend derives visible statuses from internal states using the shared workflow contract.

```mermaid
sequenceDiagram
participant Client as "Client"
participant Backend as "Backend API"
participant Worker as "ARQ Worker"
participant Redis as "Redis Queue"
participant OR as "OpenRouter"
participant PW as "Playwright"
participant Callback as "Backend Callbacks"
Client->>Backend : "Schedule extraction/generation/regeneration"
Backend->>Redis : "Enqueue task"
Redis-->>Worker : "Dequeue task"
Worker->>PW : "Scrape page (optional)"
Worker->>OR : "Structured extraction/generation/validation"
Worker->>Callback : "POST progress/state"
Callback-->>Backend : "Update application state"
Worker-->>Redis : "Store JobProgress"
Backend-->>Client : "Poll progress/status"
```

**Diagram sources**
- [worker.py:598-974](file://agents/worker.py#L598-L974)
- [internal_worker.py:19-71](file://backend/app/api/internal_worker.py#L19-L71)
- [workflow-contract.json:1-114](file://shared/workflow-contract.json#L1-L114)

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
- [worker.py:598-739](file://agents/worker.py#L598-L739)
- [worker.py:444-496](file://agents/worker.py#L444-L496)

**Section sources**
- [worker.py:444-496](file://agents/worker.py#L444-L496)
- [worker.py:598-739](file://agents/worker.py#L598-L739)
- [worker.py:444-496](file://agents/worker.py#L444-L496)

### Generation Agent
The generation agent performs section-based generation with:
- Structured output via Pydantic models
- Fallback model retry on primary failure
- Progress callbacks for each section
- Validation gate before assembly

```mermaid
sequenceDiagram
participant Worker as "run_generation_job"
participant Gen as "generate_sections"
participant OR as "OpenRouter"
participant Val as "validate_resume"
participant Asm as "assemble_resume"
participant CB as "BackendCallbackClient"
participant RW as "RedisProgressWriter"
Worker->>RW : "set_progress(generating, 5%)"
Worker->>CB : "post(started, generation)"
Worker->>Gen : "generate_sections(..., on_progress)"
Gen->>OR : "section prompts (primary/fallback)"
OR-->>Gen : "GeneratedSection"
Gen-->>Worker : "sections + model_used"
Worker->>RW : "set_progress(validating, 85%)"
Worker->>Val : "validate_resume(...)"
Val-->>Worker : "valid/errors/auto_corrections"
alt Valid
Worker->>RW : "set_progress(assembling, 95%)"
Worker->>Asm : "assemble_resume(personal_info, sections)"
Worker->>RW : "set_progress(resume_ready, 100%)"
Worker->>CB : "post(succeeded, content)"
else Invalid
Worker->>RW : "set_progress(generation_failed, 100%)"
Worker->>CB : "post(failed, validation_errors)"
end
```

**Diagram sources**
- [worker.py:754-974](file://agents/worker.py#L754-L974)
- [generation.py:159-224](file://agents/generation.py#L159-L224)
- [validation.py:231-292](file://agents/validation.py#L231-L292)
- [assembly.py:12-63](file://agents/assembly.py#L12-L63)

**Section sources**
- [worker.py:754-974](file://agents/worker.py#L754-L974)
- [generation.py:159-224](file://agents/generation.py#L159-L224)
- [validation.py:231-292](file://agents/validation.py#L231-L292)

### Validation Agent
The validation agent enforces:
- Hallucination detection across sections using structured LLM output with detailed finding models
- Required sections presence
- Correct ordering
- ATS safety (no tables/images; auto-correct minor formatting)

```mermaid
flowchart TD
Start(["validate_resume"]) --> Hallu["LLM hallucination check<br/>Structured output with findings"]
Hallu --> Req["Required sections check"]
Req --> Order["Section order check"]
Order --> ATSSafe["ATS safety rules<br/>Auto-corrections"]
ATSSafe --> Merge["Aggregate errors and auto_corrections"]
Merge --> End(["Return {valid, errors, auto_corrections}"])
```

**Diagram sources**
- [validation.py:231-292](file://agents/validation.py#L231-L292)

**Section sources**
- [validation.py:48-116](file://agents/validation.py#L48-L116)
- [validation.py:118-176](file://agents/validation.py#L118-L176)
- [validation.py:178-224](file://agents/validation.py#L178-L224)
- [validation.py:231-292](file://agents/validation.py#L231-L292)

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
- [assembly.py:12-63](file://agents/assembly.py#L12-L63)

**Section sources**
- [assembly.py:12-63](file://agents/assembly.py#L12-L63)

### Progress Tracking and Callbacks
Progress is stored in Redis under a deterministic key and periodically updated during agent runs. Backend callbacks notify the system of state transitions and completion.

```mermaid
classDiagram
class RedisProgressWriter {
+get(application_id) JobProgress?
+set(application_id, progress, ttl_seconds)
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
RedisProgressWriter --> JobProgress : "serializes/deserializes"
BackendCallbackClient -->|"HTTP POST"| BackendCallbackClient : "extraction/generation/regeneration"
```

**Diagram sources**
- [worker.py:344-360](file://agents/worker.py#L344-L360)
- [worker.py:75-85](file://agents/worker.py#L75-L85)
- [worker.py:352-360](file://agents/worker.py#L352-L360)

**Section sources**
- [worker.py:344-360](file://agents/worker.py#L344-L360)
- [worker.py:75-85](file://agents/worker.py#L75-L85)
- [worker.py:352-360](file://agents/worker.py#L352-L360)

### LangChain and OpenRouter Integration
- ChatOpenAI is configured with OpenRouter base URL and API key.
- Structured output is used for extraction and generation to ensure robust parsing.
- Fallback model is attempted automatically when the primary model fails.

**Section sources**
- [worker.py:379-442](file://agents/worker.py#L379-L442)
- [generation.py:117-151](file://agents/generation.py#L117-L151)
- [validation.py:87-115](file://agents/validation.py#L87-L115)

### Workflow Contract Integration
The shared workflow-contract.json defines internal states, workflow kinds, failure reasons, and mapping rules. The backend derives visible statuses from internal states and failure reasons.

```mermaid
graph LR
States["Internal States"] --> Map["Mapping Rules"]
Failures["Failure Reasons"] --> Map
Map --> Status["Visible Statuses"]
```

**Diagram sources**
- [workflow-contract.json:1-114](file://shared/workflow-contract.json#L1-L114)
- [workflow_contract.py:32-39](file://backend/app/core/workflow_contract.py#L32-L39)
- [workflow.py:11-32](file://backend/app/services/workflow.py#L11-L32)

**Section sources**
- [workflow-contract.json:1-114](file://shared/workflow-contract.json#L1-L114)
- [workflow_contract.py:32-39](file://backend/app/core/workflow_contract.py#L32-L39)
- [workflow.py:11-32](file://backend/app/services/workflow.py#L11-L32)

### Generation Settings and Section Management
The generation system supports advanced configuration including:
- Aggressiveness levels (low, medium, high) for tailoring
- Target length guidance (1_page, 2_page, 3_page) for resume sizing
- Section preferences with enabled status and ordering
- Additional instructions for custom generation requirements

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
Prompt --> LLM["OpenRouter LLM Call"]
LLM --> Section["Generated Section"]
```

**Diagram sources**
- [generation.py:159-224](file://agents/generation.py#L159-L224)
- [generation.py:67-114](file://agents/generation.py#L67-L114)

**Section sources**
- [generation.py:159-224](file://agents/generation.py#L159-L224)
- [generation.py:67-114](file://agents/generation.py#L67-L114)

### Regeneration Capabilities
The system supports both full regeneration and single-section regeneration:
- Full regeneration follows the same generation pipeline
- Single-section regeneration allows targeted updates with user instructions
- Automatic validation after regeneration with error recovery

**Section sources**
- [worker.py:981-1292](file://agents/worker.py#L981-L1292)
- [generation.py:280-351](file://agents/generation.py#L280-L351)

### Advanced Validation Features
The validation system implements comprehensive hallucination detection and ATS safety compliance:
- LLM-based hallucination checking with structured output and detailed finding models
- Detection of invented employers, titles, dates, credentials, and institutions
- Cross-section consistency validation
- ATS safety compliance with auto-correction capabilities for formatting issues
- Structured error reporting with section-specific details

**Section sources**
- [validation.py:48-116](file://agents/validation.py#L48-L116)
- [validation.py:231-292](file://agents/validation.py#L231-L292)
- [AGENTS.md:23-31](file://agents/AGENTS.md#L23-L31)

### Error Handling and Timeout Management
The system implements comprehensive error handling and timeout management:
- Extraction timeout: 30 seconds
- Full generation timeout: 300 seconds (wall-clock) with 90 seconds idle timeout
- Single-section regeneration timeout: 45 seconds
- Export timeout: 20 seconds
- Bounded retries: One fallback model retry per LLM call
- Structured error reporting with normalized validation errors
- Terminal error codes for different failure scenarios

**Section sources**
- [worker.py:52-53](file://agents/worker.py#L52-L53)
- [worker.py:816-831](file://agents/worker.py#L816-L831)
- [worker.py:1147-1163](file://agents/worker.py#L1147-L1163)
- [backend/AGENTS.md:38-44](file://backend/AGENTS.md#L38-L44)

## Dependency Analysis
The agents package depends on ARQ for task queueing, LangChain OpenAI for LLM calls, Playwright for browser automation, and Redis for progress storage. The backend consumes agent callbacks and derives application statuses from the shared workflow contract.

```mermaid
graph TB
subgraph "Agents"
ARQ["arq"]
LC["langchain-openai"]
PW["playwright"]
REDIS["redis"]
end
subgraph "Backend"
FAST["fastapi"]
SUP["supabase"]
PG["postgres"]
end
ARQ --> REDIS
LC --> OPENROUTER["openrouter.ai"]
PW --> WEB["web browsers"]
FAST --> SUP
FAST --> PG
```

**Diagram sources**
- [pyproject.toml:10-16](file://agents/pyproject.toml#L10-L16)
- [worker.py:13-19](file://agents/worker.py#L13-L19)
- [main.py:14-36](file://backend/app/main.py#L14-L36)

**Section sources**
- [pyproject.toml:10-16](file://agents/pyproject.toml#L10-L16)
- [worker.py:13-19](file://agents/worker.py#L13-L19)
- [main.py:14-36](file://backend/app/main.py#L14-L36)

## Performance Considerations
- Timeouts: Extraction (30s), generation (90s), single-section regeneration (45s), export (20s).
- Bounded retries: One fallback model retry per LLM call.
- Structured output reduces parsing overhead and improves reliability.
- Headless browser automation minimizes resource usage.
- Progress updates keep UI responsive and enable user feedback.

## Troubleshooting Guide
Common issues and remedies:
- Extraction timeouts: Retry with manual entry; verify network and provider rate limits.
- Blocked pages: Detection returns failure details; guide user to paste content.
- Validation failures: Review validation errors and auto-corrections; adjust generation settings.
- Missing sections or wrong order: Ensure section preferences are enabled and ordered correctly.
- Model failures: Primary/fallback model retry is automatic; confirm API keys and base URLs.
- Hallucination detection failures: Check LLM model availability and retry with fallback model.
- ATS safety violations: Review auto-corrections applied to fix formatting issues.

**Section sources**
- [worker.py:717-739](file://agents/worker.py#L717-L739)
- [worker.py:652-665](file://agents/worker.py#L652-L665)
- [validation.py:255-292](file://agents/validation.py#L255-L292)
- [backend/AGENTS.md:38-44](file://backend/AGENTS.md#L38-L44)

## Conclusion
The ARQ-based agent system provides a robust, asynchronous pipeline for extracting job postings, generating tailored resumes, validating ATS compliance, and assembling final outputs. It integrates tightly with Redis for progress tracking, OpenRouter for reliable LLM calls, and the backend's workflow contract to maintain a clear state machine and visible status mapping. Built-in retry strategies, timeouts, and structured validation ensure resilient operation and predictable user experiences.

## Appendices

### Agent Configuration Examples
- Environment variables for OpenRouter and models:
  - OPENROUTER_API_KEY
  - EXTRACTION_AGENT_MODEL, EXTRACTION_AGENT_FALLBACK_MODEL
  - GENERATION_AGENT_MODEL, GENERATION_AGENT_FALLBACK_MODEL
  - VALIDATION_AGENT_MODEL, VALIDATION_AGENT_FALLBACK_MODEL
  - BACKEND_API_URL, WORKER_CALLBACK_SECRET
  - REDIS_URL
- Example scheduling:
  - Enqueue extraction: include job_url, application_id, user_id, job_id
  - Enqueue generation: include job_title, company_name, job_description, base_resume_content, personal_info, section_preferences, generation_settings
  - Enqueue regeneration: include either full params or section_name + instructions + current_draft_content

**Section sources**
- [worker.py:56-73](file://agents/worker.py#L56-L73)
- [worker.py:598-739](file://agents/worker.py#L598-L739)
- [worker.py:754-974](file://agents/worker.py#L754-L974)
- [worker.py:981-1292](file://agents/worker.py#L981-L1292)

### Monitoring Approaches
- Poll progress: use the polling schema defined in the workflow contract to fetch JobProgress from Redis.
- Backend status mapping: derive visible status from internal state and failure reason.
- Callback verification: ensure X-Worker-Secret is present for internal worker endpoints.

**Section sources**
- [workflow-contract.json:91-114](file://shared/workflow-contract.json#L91-L114)
- [workflow.py:11-32](file://backend/app/services/workflow.py#L11-L32)
- [internal_worker.py:19-71](file://backend/app/api/internal_worker.py#L19-L71)

### Error Recovery and Retry Strategies
- Extraction agent: primary model followed by fallback model; blocked pages trigger manual entry.
- Generation/Validation agents: primary model with fallback; structured output ensures consistent parsing.
- Backend callbacks: on failure, set terminal error code and notify the backend; UI can guide user actions.

**Section sources**
- [worker.py:379-442](file://agents/worker.py#L379-L442)
- [generation.py:117-151](file://agents/generation.py#L117-L151)
- [validation.py:87-115](file://agents/validation.py#L87-L115)
- [worker.py:547-582](file://agents/worker.py#L547-L582)

### Hallucination Detection and Validation Rules
The validation system implements comprehensive hallucination detection:
- LLM-based hallucination checking with structured output and detailed finding models
- Detection of invented employers, titles, dates, credentials, and institutions
- Cross-section consistency validation
- ATS safety compliance with auto-correction capabilities

**Section sources**
- [validation.py:48-116](file://agents/validation.py#L48-L116)
- [validation.py:231-292](file://agents/validation.py#L231-L292)
- [AGENTS.md:23-31](file://agents/AGENTS.md#L23-L31)

### Generation Settings Configuration
Advanced generation settings for resume customization:
- Aggressiveness levels: low (conservative), medium (balanced), high (aggressive tailoring)
- Target length: 1_page (standard), 2_page (extended), 3_page (maximum)
- Additional instructions: optional custom guidance for specific requirements
- Section preferences: enable/disable sections and set generation order

**Section sources**
- [backend/AGENTS.md:46-52](file://backend/AGENTS.md#L46-L52)
- [test_worker.py:131-144](file://agents/tests/test_worker.py#L131-L144)