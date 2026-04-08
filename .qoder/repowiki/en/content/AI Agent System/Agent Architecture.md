# Agent Architecture

<cite>
**Referenced Files in This Document**
- [worker.py](file://agents/worker.py)
- [generation.py](file://agents/generation.py)
- [privacy.py](file://agents/privacy.py)
- [validation.py](file://agents/validation.py)
- [assembly.py](file://agents/assembly.py)
- [pyproject.toml](file://agents/pyproject.toml)
- [Dockerfile](file://agents/Dockerfile)
- [docker-compose.yml](file://docker-compose.yml)
- [workflow_contract.py](file://backend/app/core/workflow_contract.py)
- [workflow-contract.json](file://shared/workflow-contract.json)
- [jobs.py](file://backend/app/services/jobs.py)
- [test_worker.py](file://agents/tests/test_worker.py)
- [test_generation_pipeline.py](file://agents/tests/test_generation_pipeline.py)
- [decisions-made-1.md](file://docs/decisions-made/decisions-made-1.md)
- [2026-04-08-single-call-generation-privacy-hardening.md](file://docs/task-output/2026-04-08-single-call-generation-privacy-hardening.md)
</cite>

## Update Summary
**Changes Made**
- Updated generation workflow to reflect single-call structured JSON generation architecture
- Added comprehensive privacy sanitization and integrated security features
- Enhanced validation pipeline with deterministic local validation rules
- Updated architecture diagrams to show unified prompt system and privacy controls
- Revised generation workflow to show privacy sanitization and local validation steps

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
This document explains the ARQ-based agent architecture for extracting job postings, generating tailored resumes, and validating outputs. The architecture has been modernized to use a single-call generation approach with integrated privacy sanitization and comprehensive validation rules. It covers task queue management via Redis, asynchronous processing workflows, progress tracking, configuration management, structured LLM outputs using LangChain, OpenRouter API access, Playwright-based web scraping, and integration with the backend's workflow contract and state machine. It also documents agent lifecycle, callback mechanisms, error handling, and monitoring approaches.

## Project Structure
The agents subsystem is organized around five Python modules plus packaging and containerization:
- worker.py: Agent orchestration, scraping, extraction, progress tracking, callbacks, and job runners
- generation.py: Single-call structured JSON generation with unified prompt system and privacy sanitization
- privacy.py: Integrated privacy sanitization removing PII and contact information before LLM calls
- validation.py: Comprehensive deterministic validation rules for ATS-safety, grounding, and security
- assembly.py: Final resume assembly from personal info header and ordered sections
- pyproject.toml: Dependencies and build configuration
- Dockerfile: Container image definition and ARQ worker command
- docker-compose.yml: Environment variables and service wiring for agents, Redis, and backend

```mermaid
graph TB
subgraph "Agents"
W["worker.py"]
G["generation.py"]
PVT["privacy.py"]
V["validation.py"]
A["assembly.py"]
P["pyproject.toml"]
D["Dockerfile"]
end
subgraph "Backend"
J["jobs.py"]
WC["workflow_contract.py"]
CJ["workflow-contract.json"]
end
R["Redis"]:::ext
OR["OpenRouter API"]:::ext
B["Backend API"]:::ext
J --> R
W --> R
W --> B
W --> OR
G --> OR
PVT --> G
V --> A
W --> G
G --> A
classDef ext fill:#fff,stroke:#333,stroke-width:1px;
```

**Diagram sources**
- [worker.py:1-1338](file://agents/worker.py#L1-L1338)
- [generation.py:1-596](file://agents/generation.py#L1-L596)
- [privacy.py:1-173](file://agents/privacy.py#L1-L173)
- [validation.py:1-511](file://agents/validation.py#L1-L511)
- [assembly.py:1-71](file://agents/assembly.py#L1-L71)
- [pyproject.toml:1-26](file://agents/pyproject.toml#L1-L26)
- [Dockerfile:1-14](file://agents/Dockerfile#L1-L14)
- [docker-compose.yml:54-83](file://docker-compose.yml#L54-L83)
- [jobs.py:1-85](file://backend/app/services/jobs.py#L1-L85)
- [workflow_contract.py:1-40](file://backend/app/core/workflow_contract.py#L1-L40)
- [workflow-contract.json:1-112](file://shared/workflow-contract.json#L1-L112)

**Section sources**
- [pyproject.toml:1-26](file://agents/pyproject.toml#L1-L26)
- [Dockerfile:1-14](file://agents/Dockerfile#L1-L14)
- [docker-compose.yml:54-83](file://docker-compose.yml#L54-L83)

## Core Components
- WorkerSettingsEnv: Centralized configuration loader for Redis, backend API, secrets, OpenRouter, and model names
- RedisProgressWriter: Asynchronous Redis-backed progress persistence keyed by application_id
- BackendCallbackClient: Async HTTP client to notify backend of job events and outcomes
- OpenRouterExtractionAgent: Structured extraction using LangChain with primary/fallback model fallback
- Playwright scraping: Chromium-based page capture with metadata and JSON-LD extraction
- Single-call Generation Pipeline: Unified structured JSON generation with privacy sanitization and fallback logic
- Integrated Privacy Sanitization: Comprehensive PII removal before LLM calls with header preservation
- Deterministic Validation Pipeline: Local schema and rule validation replacing separate LLM validation
- Assembly: Final Markdown resume composition from personal info and ordered sections
- Job queues: Backend enqueues ARQ jobs for extraction and generation

**Section sources**
- [worker.py:56-73](file://agents/worker.py#L56-L73)
- [worker.py:344-360](file://agents/worker.py#L344-L360)
- [worker.py:362-391](file://agents/worker.py#L362-L391)
- [worker.py:393-457](file://agents/worker.py#L393-L457)
- [worker.py:459-496](file://agents/worker.py#L459-L496)
- [generation.py:1-596](file://agents/generation.py#L1-L596)
- [privacy.py:118-160](file://agents/privacy.py#L118-L160)
- [validation.py:445-511](file://agents/validation.py#L445-L511)
- [assembly.py:20-71](file://agents/assembly.py#L20-L71)
- [jobs.py:12-43](file://backend/app/services/jobs.py#L12-L43)
- [jobs.py:45-85](file://backend/app/services/jobs.py#L45-L85)

## Architecture Overview
The agents subsystem runs as an ARQ worker container with a streamlined single-call generation architecture. Jobs are enqueued by the backend into Redis and processed asynchronously. Agents report progress to Redis and notify the backend via authenticated callbacks. LLM interactions leverage OpenRouter through LangChain with single structured JSON calls. Privacy sanitization removes PII before external calls, and deterministic validation ensures security compliance locally.

```mermaid
sequenceDiagram
participant BE as "Backend"
participant Q as "Redis Queue"
participant ARQ as "ARQ Worker"
participant Scraper as "Playwright"
participant LLM as "OpenRouter"
participant Sanitizer as "Privacy Sanitizer"
participant Validator as "Local Validator"
participant Store as "Redis Progress"
participant CB as "Backend Callback"
BE->>Q : "Enqueue extraction job"
Q-->>ARQ : "Dequeue run_extraction_job"
ARQ->>Store : "Set initial progress"
ARQ->>CB : "Notify started"
ARQ->>Scraper : "Scrape page context"
Scraper-->>ARQ : "PageContext"
ARQ->>LLM : "Structured extraction"
LLM-->>ARQ : "ExtractedJobPosting"
ARQ->>Store : "Set extracting -> generation_pending"
ARQ->>CB : "Notify succeeded"
BE->>Q : "Enqueue generation job"
Q-->>ARQ : "Dequeue run_generation_job"
ARQ->>Store : "Set generating progress"
ARQ->>Sanitizer : "Remove PII from base resume"
Sanitizer-->>ARQ : "Sanitized content"
ARQ->>LLM : "Single structured JSON generation"
LLM-->>ARQ : "Generated sections JSON"
ARQ->>Validator : "Local validation (order, ATS, PII)"
Validator-->>ARQ : "Validation result"
ARQ->>Store : "Set validated state"
ARQ->>CB : "Notify completed"
```

**Diagram sources**
- [jobs.py:16-42](file://backend/app/services/jobs.py#L16-L42)
- [jobs.py:49-84](file://backend/app/services/jobs.py#L49-L84)
- [worker.py:624-765](file://agents/worker.py#L624-L765)
- [worker.py:780-1006](file://agents/worker.py#L780-L1006)
- [worker.py:362-391](file://agents/worker.py#L362-L391)
- [generation.py:454-518](file://agents/generation.py#L454-L518)
- [privacy.py:118-160](file://agents/privacy.py#L118-L160)
- [validation.py:445-511](file://agents/validation.py#L445-L511)

## Detailed Component Analysis

### Configuration Management via WorkerSettingsEnv
- Loads environment variables for Redis URL, backend API URL, worker callback secret, shared contract path, OpenRouter keys and base URL, and model names for extraction, generation, and validation agents
- Validates presence of required keys before invoking LLMs or callbacks

```mermaid
classDiagram
class WorkerSettingsEnv {
+string app_env
+bool app_dev_mode
+string redis_url
+string backend_api_url
+string worker_callback_secret
+string shared_contract_path
+string openrouter_api_key
+string openrouter_base_url
+string extraction_agent_model
+string extraction_agent_fallback_model
+string generation_agent_model
+string generation_agent_fallback_model
+string validation_agent_model
+string validation_agent_fallback_model
}
```

**Diagram sources**
- [worker.py:56-73](file://agents/worker.py#L56-L73)

**Section sources**
- [worker.py:56-73](file://agents/worker.py#L56-L73)
- [docker-compose.yml:58-71](file://docker-compose.yml#L58-L71)

### Task Queue Management Through Redis and ARQ
- Backend enqueues jobs into Redis using ARQ connection settings
- Extraction job enqueues run_extraction_job with application_id, user_id, job_url, optional source_capture, and job_id
- Generation job enqueues run_generation_job with application-specific parameters

```mermaid
flowchart TD
Start(["Backend starts"]) --> EnqExt["Enqueue extraction job"]
EnqExt --> DeqExt["ARQ dequeues run_extraction_job"]
DeqExt --> ExtFlow["Run extraction workflow"]
ExtFlow --> EnqGen["Enqueue generation job"]
EnqGen --> DeqGen["ARQ dequeues run_generation_job"]
DeqGen --> GenFlow["Run single-call generation workflow"]
GenFlow --> End(["Completed"])
```

**Diagram sources**
- [jobs.py:16-42](file://backend/app/services/jobs.py#L16-L42)
- [jobs.py:49-84](file://backend/app/services/jobs.py#L49-L84)
- [worker.py:624-765](file://agents/worker.py#L624-L765)
- [worker.py:780-1006](file://agents/worker.py#L780-L1006)

**Section sources**
- [jobs.py:12-43](file://backend/app/services/jobs.py#L12-L43)
- [jobs.py:45-85](file://backend/app/services/jobs.py#L45-L85)

### Asynchronous Processing Workflows

#### Extraction Workflow
- Initializes progress, notifies backend "started"
- Scrapes page via Playwright or loads SourceCapture
- Detects blocked sources and reports failures
- Runs structured extraction via OpenRouterExtractionAgent
- Validates final extraction and transitions to generation_pending
- Notifies backend "succeeded"

```mermaid
sequenceDiagram
participant ARQ as "ARQ Worker"
participant PW as "Playwright"
participant LLM as "OpenRouter"
participant RW as "RedisProgressWriter"
participant BC as "BackendCallbackClient"
ARQ->>RW : "Set extracting (10%)"
ARQ->>BC : "started"
alt "Source capture provided"
ARQ->>ARQ : "Build PageContext from SourceCapture"
ARQ->>RW : "Set extracting (35%)"
else "Scrape live page"
ARQ->>PW : "Load page"
PW-->>ARQ : "PageContext"
ARQ->>RW : "Set extracting (40%)"
end
ARQ->>ARQ : "Detect blocked page"
ARQ->>RW : "Set manual_entry_required (100%)"
ARQ->>BC : "failed"
ARQ->>LLM : "Extract (structured)"
LLM-->>ARQ : "ExtractedJobPosting"
ARQ->>RW : "Set generation_pending (100%)"
ARQ->>BC : "succeeded"
```

**Diagram sources**
- [worker.py:624-765](file://agents/worker.py#L624-L765)
- [worker.py:393-457](file://agents/worker.py#L393-L457)
- [worker.py:459-496](file://agents/worker.py#L459-L496)
- [worker.py:271-310](file://agents/worker.py#L271-L310)

**Section sources**
- [worker.py:624-765](file://agents/worker.py#L624-L765)

#### Single-Call Generation Workflow
- Validates model configuration and initializes progress
- Sanitizes base resume content to remove PII and contact information
- Generates all sections in a single structured JSON call with unified prompt system
- Performs comprehensive local validation for order, ATS-safety, and security
- Assembles final resume with preserved personal information
- Reports completion to backend

**Updated** Streamlined from multiple LLM calls to a single structured JSON generation with integrated privacy controls

```mermaid
sequenceDiagram
participant ARQ as "ARQ Worker"
participant Sanitizer as "Privacy Sanitizer"
participant LLM as "OpenRouter"
participant Validator as "Local Validator"
participant RW as "RedisProgressWriter"
participant BC as "BackendCallbackClient"
ARQ->>RW : "Set generating (5%)"
ARQ->>BC : "started"
ARQ->>Sanitizer : "sanitize_resume_markdown()"
Sanitizer-->>ARQ : "Sanitized content"
ARQ->>LLM : "Single structured JSON generation"
LLM-->>ARQ : "Generated sections JSON"
ARQ->>Validator : "validate_resume()"
Validator-->>ARQ : "Validation result"
alt "Validation failed"
ARQ->>RW : "Set generation_failed (100%)"
ARQ->>BC : "failed"
else "Validation passed"
ARQ->>RW : "Set generating (85%)"
ARQ->>ARQ : "assemble_resume()"
ARQ->>RW : "Set resume_ready (100%)"
ARQ->>BC : "succeeded"
end
```

**Diagram sources**
- [worker.py:780-1006](file://agents/worker.py#L780-L1006)
- [generation.py:454-518](file://agents/generation.py#L454-L518)
- [privacy.py:118-160](file://agents/privacy.py#L118-L160)
- [validation.py:445-511](file://agents/validation.py#L445-L511)
- [assembly.py:20-71](file://agents/assembly.py#L20-L71)

**Section sources**
- [worker.py:780-1006](file://agents/worker.py#L780-L1006)
- [generation.py:454-518](file://agents/generation.py#L454-L518)
- [privacy.py:118-160](file://agents/privacy.py#L118-L160)
- [validation.py:445-511](file://agents/validation.py#L445-L511)
- [assembly.py:20-71](file://agents/assembly.py#L20-L71)

### Privacy Sanitization and Security Controls
- Comprehensive PII removal including emails, phone numbers, URLs, and contact markers
- Header preservation to maintain personal information outside LLM context
- Contact line detection and removal from both header and body sections
- Name detection and validation to prevent personal information leakage
- Integration with generation pipeline to sanitize base resume content before LLM calls

**Updated** Integrated privacy sanitization as a core component of the generation workflow

```mermaid
flowchart TD
A["Base Resume Content"] --> B["Header Detection"]
B --> C{"Contains contact info?"}
C --> |Yes| D["Extract header lines"]
D --> E["Remove contact lines from body"]
C --> |No| F["Process body only"]
E --> G["Sanitized Content"]
F --> G
G --> H["Send to LLM"]
H --> I["Restore header locally"]
I --> J["Final Resume"]
```

**Diagram sources**
- [privacy.py:118-160](file://agents/privacy.py#L118-L160)
- [generation.py:481-483](file://agents/generation.py#L481-L483)

**Section sources**
- [privacy.py:118-160](file://agents/privacy.py#L118-L160)
- [generation.py:481-483](file://agents/generation.py#L481-L483)

### Deterministic Validation Pipeline
- Comprehensive validation rules replacing separate LLM validation
- Section order validation and duplicate detection
- ATS-safety checks (no tables, images, HTML, code fences)
- Contact leakage prevention and PII detection
- Grounding validation for claims and supporting snippets
- Date token validation and unsupported date drift detection
- Length guidance validation based on target page length

**Updated** Replaced LLM-based validation with deterministic local validation for security and reliability

```mermaid
flowchart TD
A["Generated Sections"] --> B["Unknown/Duplicate Sections"]
B --> C["Required Sections Check"]
C --> D["Section Order Validation"]
D --> E["Heading Contract Check"]
E --> F["Supporting Snippets Validation"]
F --> G["Claim Grounding Check"]
G --> H["Contact Leakage Check"]
H --> I["Date Token Validation"]
I --> J["ATS Safety Check"]
J --> K["Length Guidance Check"]
K --> L{"All validations pass?"}
L --> |Yes| M["Valid"]
L --> |No| N["Invalid with errors"]
```

**Diagram sources**
- [validation.py:445-511](file://agents/validation.py#L445-L511)
- [validation.py:148-222](file://agents/validation.py#L148-L222)
- [validation.py:256-394](file://agents/validation.py#L256-L394)

**Section sources**
- [validation.py:445-511](file://agents/validation.py#L445-L511)
- [validation.py:148-222](file://agents/validation.py#L148-L222)
- [validation.py:256-394](file://agents/validation.py#L256-L394)

### Progress Tracking Mechanisms
- RedisProgressWriter stores JobProgress keyed by application_id with TTL
- set_progress builds JobProgress with timestamps and percent_complete, then persists
- report_failure sets terminal state and posts failure details to backend

```mermaid
flowchart TD
S(["Start"]) --> Get["Get existing progress"]
Get --> Build["Build JobProgress"]
Build --> Set["Write to Redis"]
Set --> Cb["Optionally notify backend"]
Cb --> E(["End"])
```

**Diagram sources**
- [worker.py:535-562](file://agents/worker.py#L535-L562)
- [worker.py:344-360](file://agents/worker.py#L344-L360)

**Section sources**
- [worker.py:535-562](file://agents/worker.py#L535-L562)
- [worker.py:344-360](file://agents/worker.py#L344-L360)
- [worker.py:573-608](file://agents/worker.py#L573-L608)

### Callback Mechanisms to Backend API
- BackendCallbackClient posts events to backend with X-Worker-Secret header
- Paths include extraction-callback and generation-callback
- Used to signal started, succeeded, and failed events

```mermaid
sequenceDiagram
participant ARQ as "ARQ Worker"
participant BC as "BackendCallbackClient"
participant API as "Backend API"
ARQ->>BC : "post({event : started})"
BC->>API : "HTTP POST /api/internal/worker/extraction-callback"
API-->>BC : "200 OK"
ARQ->>BC : "post({event : succeeded, extracted})"
BC->>API : "HTTP POST /api/internal/worker/extraction-callback"
API-->>BC : "200 OK"
```

**Diagram sources**
- [worker.py:362-391](file://agents/worker.py#L362-L391)
- [worker.py:646-653](file://agents/worker.py#L646-L653)
- [worker.py:830-838](file://agents/worker.py#L830-L838)

**Section sources**
- [worker.py:362-391](file://agents/worker.py#L362-L391)
- [worker.py:646-653](file://agents/worker.py#L646-L653)
- [worker.py:830-838](file://agents/worker.py#L830-L838)

### Integration with LangChain and OpenRouter
- Structured outputs via ChatOpenAI.with_structured_output
- Single-call generation with unified prompt system
- Extraction agent validates presence of required keys and models
- Generation and validation agents use fallback models for resilience

**Updated** Generation now uses single structured JSON calls instead of section-by-section processing

```mermaid
classDiagram
class OpenRouterExtractionAgent {
+extract(context) ExtractedJobPosting
-_extract_with_model(model_name, context) ExtractedJobPosting
}
class GenerationPipeline {
+generate_sections(...)
+_call_json_with_fallback(...)
+_build_shared_system_prompt(...)
}
class ValidationPipeline {
+validate_resume(...)
-_check_required_sections(...)
-_check_ats_safety(...)
}
OpenRouterExtractionAgent --> "uses" ChatOpenAI
GenerationPipeline --> "uses" ChatOpenAI
ValidationPipeline --> "uses" Pydantic Validation
```

**Diagram sources**
- [worker.py:393-457](file://agents/worker.py#L393-L457)
- [generation.py:388-441](file://agents/generation.py#L388-L441)
- [validation.py:445-511](file://agents/validation.py#L445-L511)

**Section sources**
- [worker.py:393-457](file://agents/worker.py#L393-L457)
- [generation.py:388-441](file://agents/generation.py#L388-L441)
- [validation.py:445-511](file://agents/validation.py#L445-L511)

### Playwright-Based Web Scraping
- Launches headless Chromium, navigates to job URL, waits for DOM/network idle
- Captures page title, final URL, visible text, meta tags, and JSON-LD
- Builds PageContext for downstream extraction and normalization

```mermaid
flowchart TD
A["Launch browser"] --> B["Open job URL"]
B --> C["Wait for domcontentloaded"]
C --> D["Wait for networkidle"]
D --> E["Extract title, url, text"]
E --> F["Collect meta pairs"]
F --> G["Collect JSON-LD scripts"]
G --> H["Build PageContext"]
```

**Diagram sources**
- [worker.py:459-496](file://agents/worker.py#L459-L496)

**Section sources**
- [worker.py:459-496](file://agents/worker.py#L459-L496)

### Workflow Contract Integration and State Machine Participation
- Agents load the shared workflow contract to align internal states and workflow kinds
- Backend maps internal states to visible statuses via mapping rules
- Agents set internal states and notify backend; backend translates to UI-visible statuses

```mermaid
graph LR
AC["Agent Internal State"] --> MAP["Mapping Rules"]
MAP --> VS["Visible Status"]
AC --> |"set_progress"| R["Redis Progress"]
R --> |"poll"| FE["Frontend"]
```

**Diagram sources**
- [worker.py:312-318](file://agents/worker.py#L312-L318)
- [workflow_contract.py:32-39](file://backend/app/core/workflow_contract.py#L32-L39)
- [workflow-contract.json:9-87](file://shared/workflow-contract.json#L9-L87)

**Section sources**
- [workflow-contract.json:1-112](file://shared/workflow-contract.json#L1-L112)
- [workflow_contract.py:22-39](file://backend/app/core/workflow_contract.py#L22-L39)
- [worker.py:610-622](file://agents/worker.py#L610-L622)

### Agent Lifecycle: From Initialization to Completion
- Container starts ARQ worker with WorkerSettings
- WorkerSettingsEnv loads environment variables
- Jobs run extraction or generation workflows
- Progress is persisted and callbacks are sent
- Terminal states are reported with optional failure details

**Updated** Generation workflow now uses single-call architecture with integrated privacy and validation

```mermaid
stateDiagram-v2
[*] --> Bootstrapped
Bootstrapped --> Ready : "report_bootstrap_progress"
Ready --> Extracting : "run_extraction_job"
Extracting --> GenerationPending : "extraction succeeded"
Extracting --> ManualEntryRequired : "blocked or insufficient text"
GenerationPending --> Generating : "run_generation_job"
Generating --> Validated : "validation passed"
Generating --> GenerationFailed : "validation failed"
Validated --> [*]
ManualEntryRequired --> [*]
GenerationFailed --> [*]
```

**Diagram sources**
- [worker.py:610-622](file://agents/worker.py#L610-L622)
- [worker.py:624-765](file://agents/worker.py#L624-L765)
- [worker.py:780-1006](file://agents/worker.py#L780-L1006)
- [workflow-contract.json:9-19](file://shared/workflow-contract.json#L9-L19)

**Section sources**
- [Dockerfile:13-13](file://agents/Dockerfile#L13-L13)
- [worker.py:610-622](file://agents/worker.py#L610-L622)
- [worker.py:624-765](file://agents/worker.py#L624-L765)
- [worker.py:780-1006](file://agents/worker.py#L780-L1006)

## Dependency Analysis
- Runtime dependencies include ARQ, httpx, langchain-openai, playwright, pydantic-settings
- Container installs Playwright Chromium dependencies and runs ARQ worker with WorkerSettings
- Backend enqueues jobs into Redis; agents consume and publish progress and callbacks

```mermaid
graph TB
subgraph "Runtime"
ARQ["arq"]
HTTPX["httpx"]
LC["langchain-openai"]
PW["playwright"]
PS["pydantic-settings"]
end
P["pyproject.toml"] --> ARQ
P --> HTTPX
P --> LC
P --> PW
P --> PS
```

**Diagram sources**
- [pyproject.toml:10-16](file://agents/pyproject.toml#L10-L16)

**Section sources**
- [pyproject.toml:1-26](file://agents/pyproject.toml#L1-L26)
- [Dockerfile:10-11](file://agents/Dockerfile#L10-L11)
- [docker-compose.yml:58-71](file://docker-compose.yml#L58-L71)

## Performance Considerations
- Use fallback models for LLM calls to reduce single-point-of-failure risk
- Apply timeouts for LLM invocations and Playwright operations
- Persist progress periodically to avoid losing state during long-running jobs
- Keep page scraping minimal by limiting text and meta extraction sizes
- Monitor Redis TTL and cleanup strategies for progress keys
- Single-call generation reduces LLM costs and improves response times
- Privacy sanitization prevents data leakage and reduces model context size

## Troubleshooting Guide
Common issues and strategies:
- Missing configuration: Ensure WorkerSettingsEnv variables are set; extraction and generation require API keys and model names
- Blocked pages: detect_blocked_page returns failure details; agents transition to manual_entry_required
- Insufficient source text: If captured text is too short, fail early with extraction_failed
- LLM timeouts: Generation and validation enforce timeouts; adjust settings if needed
- Backend callback failures: Verify WORKER_CALLBACK_SECRET and backend connectivity
- Privacy violations: Check that sanitization removes all PII before LLM calls
- Validation failures: Review validation error messages for specific rule violations

**Section sources**
- [worker.py:398-414](file://agents/worker.py#L398-L414)
- [worker.py:678-690](file://agents/worker.py#L678-L690)
- [worker.py:743-764](file://agents/worker.py#L743-L764)
- [worker.py:367-368](file://agents/worker.py#L367-L368)
- [validation.py:445-511](file://agents/validation.py#L445-L511)

## Conclusion
The ARQ-based agent architecture provides a robust, asynchronous pipeline for job posting extraction and resume generation with enhanced privacy and security. The single-call generation architecture streamlines the process, reduces costs, and improves reliability while integrated privacy sanitization ensures PII protection. Deterministic validation replaces LLM-based validation for better security and faster performance. It leverages Redis for reliable task queuing, LangChain with OpenRouter for structured LLM outputs, Playwright for resilient scraping, and a shared workflow contract to integrate with the backend's state machine. Progress tracking and callback mechanisms keep the UI informed, while fallback strategies and comprehensive validation improve reliability and quality.

## Appendices

### Example Agent Configuration
- Environment variables for agents are defined in docker-compose and consumed by WorkerSettingsEnv
- Required keys include Redis URL, backend API URL, worker callback secret, OpenRouter API key and base URL, and model names for extraction, generation, and validation

**Section sources**
- [docker-compose.yml:58-71](file://docker-compose.yml#L58-L71)
- [worker.py:56-73](file://agents/worker.py#L56-L73)

### Task Scheduling Patterns
- Backend enqueues jobs with unique job_id and passes application/user identifiers
- ARQ worker processes jobs asynchronously; agents set periodic progress updates
- Single-call generation reduces job complexity and improves throughput

**Section sources**
- [jobs.py:16-42](file://backend/app/services/jobs.py#L16-L42)
- [jobs.py:49-84](file://backend/app/services/jobs.py#L49-L84)
- [worker.py:624-765](file://agents/worker.py#L624-L765)

### Monitoring Approaches
- Poll Redis progress keys for application_id to observe state and percent_complete
- Observe backend-visible status via mapping rules derived from internal states
- Log and alert on terminal_error_code values
- Monitor validation error patterns for quality improvements

**Section sources**
- [worker.py:535-562](file://agents/worker.py#L535-L562)
- [workflow-contract.json:89-110](file://shared/workflow-contract.json#L89-L110)

### Error Handling Strategies
- Primary/fallback model selection for LLM calls
- Early exit on blocked pages or insufficient text
- Terminal state reporting with failure details and error codes
- Comprehensive validation-driven feedback loops to improve outputs
- Privacy sanitization prevents PII exposure in error messages

**Section sources**
- [worker.py:405-414](file://agents/worker.py#L405-L414)
- [worker.py:678-690](file://agents/worker.py#L678-L690)
- [worker.py:573-608](file://agents/worker.py#L573-L608)
- [validation.py:445-511](file://agents/validation.py#L445-L511)

### Privacy and Security Features
- Integrated privacy sanitization removes PII before LLM calls
- Header preservation maintains personal information outside model context
- Comprehensive contact detection and removal
- Deterministic validation prevents security vulnerabilities
- Stale-job fencing prevents late callback overwrites

**Section sources**
- [privacy.py:118-160](file://agents/privacy.py#L118-L160)
- [validation.py:352-394](file://agents/validation.py#L352-L394)
- [worker.py:564-571](file://agents/worker.py#L564-L571)