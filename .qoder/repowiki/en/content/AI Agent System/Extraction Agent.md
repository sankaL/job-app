# Extraction Agent

<cite>
**Referenced Files in This Document**
- [worker.py](file://agents/worker.py)
- [test_worker.py](file://agents/tests/test_worker.py)
- [workflow-contract.json](file://shared/workflow-contract.json)
- [internal_worker.py](file://backend/app/api/internal_worker.py)
- [application_manager.py](file://backend/app/services/application_manager.py)
- [AGENTS.md](file://agents/AGENTS.md)
</cite>

## Update Summary
**Changes Made**
- Enhanced extraction callback resilience with best-effort started callback delivery
- Improved error handling for transient network failures
- Added comprehensive logging and structured context for debugging
- Updated progress tracking to continue even when callback delivery fails
- Enhanced backend reconciliation logic for callback synchronization failures

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
This document describes the Extraction Agent responsible for automatically extracting job postings from URLs. It covers the web scraping pipeline using Playwright, page context capture, metadata extraction, content normalization, job board parsing for multiple platforms, blocked URL detection, reference ID extraction, origin normalization, structured extraction via OpenRouter LLMs with schema validation, and integration with the progress tracking system. It also documents enhanced error handling for transient network failures, callback resilience mechanisms, and comprehensive logging for debugging purposes.

## Project Structure
The extraction agent lives in the agents module and coordinates with the backend via internal callbacks. The shared workflow contract defines the internal states and transitions used by the progress tracking system.

```mermaid
graph TB
subgraph "Agents"
W["worker.py<br/>Extraction Agent + Progress + Callbacks"]
T["test_worker.py<br/>Unit tests"]
end
subgraph "Shared"
C["workflow-contract.json<br/>Internal states & transitions"]
end
subgraph "Backend"
API["internal_worker.py<br/>Internal worker endpoints"]
SVC["application_manager.py<br/>Application state machine<br/>+ Callback Reconciliation"]
end
W --> API
API --> SVC
W --> C
T --> W
```

**Diagram sources**
- [worker.py:1-1430](file://agents/worker.py#L1-L1430)
- [workflow-contract.json:1-112](file://shared/workflow-contract.json#L1-L112)
- [internal_worker.py:1-71](file://backend/app/api/internal_worker.py#L1-L71)
- [application_manager.py:477-511](file://backend/app/services/application_manager.py#L477-L511)

**Section sources**
- [worker.py:1-1430](file://agents/worker.py#L1-L1430)
- [workflow-contract.json:1-112](file://shared/workflow-contract.json#L1-L112)
- [internal_worker.py:1-71](file://backend/app/api/internal_worker.py#L1-L71)
- [application_manager.py:477-511](file://backend/app/services/application_manager.py#L477-L511)

## Core Components
- Web scraping and page context capture using Playwright
- Metadata extraction (title, meta tags, JSON-LD, visible text)
- Content normalization and origin detection
- Reference ID extraction from URLs and content
- Blocked URL detection and reporting
- Structured extraction using OpenRouter LLMs with ExtractedJobPosting schema validation
- **Enhanced progress tracking via Redis with best-effort callback delivery**
- **Improved error handling for transient network failures**
- **Comprehensive logging and structured context for debugging**
- Fallback and retry strategies for extraction failures

**Section sources**
- [worker.py:372-424](file://agents/worker.py#L372-L424)
- [worker.py:162-174](file://agents/worker.py#L162-L174)
- [worker.py:177-196](file://agents/worker.py#L177-L196)
- [worker.py:199-237](file://agents/worker.py#L199-L237)
- [worker.py:307-370](file://agents/worker.py#L307-L370)
- [worker.py:448-472](file://agents/worker.py#L448-L472)
- [worker.py:475-509](file://agents/worker.py#L475-L509)

## Architecture Overview
The extraction agent orchestrates a deterministic pipeline with enhanced callback resilience:
- Initialize settings and clients
- Capture page context (Playwright) or accept a pre-captured source
- Detect blocked sources
- **Best-effort started callback delivery with comprehensive error handling**
- Run structured extraction via OpenRouter LLM
- Finalize and validate the extracted job posting
- **Continue progress tracking even if callback delivery fails**
- Report completion/failure to backend with enhanced error context

```mermaid
sequenceDiagram
participant Client as "Caller"
participant Worker as "run_extraction_job"
participant PW as "Playwright"
participant Agent as "OpenRouterExtractionAgent"
participant Redis as "RedisProgressWriter"
participant Backend as "BackendCallbackClient"
Client->>Worker : "run_extraction_job(application_id, user_id, job_url, job_id, source_capture?)"
Worker->>Redis : "set_progress(extracting, 10%)"
Worker->>Backend : "post(started)"
alt "started callback succeeds"
Worker->>Worker : "continue with extraction"
else "started callback fails"
Worker->>Worker : "log exception with structured context"
Worker->>Worker : "continue with progress-only tracking"
end
alt "source_capture provided"
Worker->>Worker : "build_page_context_from_capture()"
Worker->>Redis : "set_progress(extracting, 35%)"
else "no source_capture"
Worker->>PW : "scrape_page_context(job_url)"
PW-->>Worker : "PageContext"
Worker->>Redis : "set_progress(extracting, 40%)"
end
Worker->>Worker : "detect_blocked_page(context)"
alt "blocked"
Worker->>Redis : "set_progress(manual_entry_required, 100%)"
Worker->>Backend : "post(failed with blocked_source)"
Worker-->>Client : "blocked_source details"
else "not blocked"
Worker->>Agent : "extract(context)"
Agent-->>Worker : "ExtractedJobPosting"
Worker->>Worker : "finalize_extracted_posting()"
Worker->>Worker : "ExtractedJobPosting.model_validate()"
Worker->>Redis : "set_progress(generation_pending, 100%)"
Worker->>Backend : "post(succeeded with extracted)"
Worker-->>Client : "finalized extracted"
end
```

**Diagram sources**
- [worker.py:674-821](file://agents/worker.py#L674-L821)
- [worker.py:372-409](file://agents/worker.py#L372-L409)
- [worker.py:307-370](file://agents/worker.py#L307-L370)
- [worker.py:448-472](file://agents/worker.py#L448-L472)
- [worker.py:475-509](file://agents/worker.py#L475-L509)

## Detailed Component Analysis

### Web Scraping and Page Context Capture
- Uses Playwright to launch a Chromium browser, navigate to the job URL, wait for DOM and network idle, and collect:
  - Page title
  - Final URL
  - Visible text from the body element
  - Meta tags (property/name and content)
  - JSON-LD script blocks
- Limits collected metadata to reasonable sizes to keep prompts manageable.
- Builds a PageContext object with detected origin and extracted reference ID.

```mermaid
flowchart TD
Start(["scrape_page_context(job_url)"]) --> Launch["Launch headless Chromium"]
Launch --> Navigate["Go to job_url<br/>wait_until='domcontentloaded'"]
Navigate --> WaitIdle["Wait for 'networkidle'<br/>timeout=10s"]
WaitIdle --> CollectTitle["Collect page title"]
CollectTitle --> CollectURL["Collect final URL"]
CollectURL --> CollectText["Collect body inner_text<br/>limit visible_text"]
CollectText --> CollectMeta["Collect meta tags<br/>property/name/content"]
CollectMeta --> CollectJSONLD["Collect JSON-LD scripts"]
CollectJSONLD --> BuildContext["Build PageContext<br/>detected_origin, extracted_reference_id"]
BuildContext --> End(["Return PageContext"])
```

**Diagram sources**
- [worker.py:487-524](file://agents/worker.py#L487-L524)

**Section sources**
- [worker.py:487-524](file://agents/worker.py#L487-L524)

### Metadata Extraction and Content Normalization
- Normalizes origin from final URL using a predefined mapping for LinkedIn, Indeed, Google Jobs, Glassdoor, ZipRecruiter, Monster, Dice, and treats other domains as company_website.
- Extracts reference IDs from:
  - Query parameters (jobid, job_id, currentjobid, gh_jid, jk, reqid, requisitionid)
  - Patterns in URL path (job IDs and job views)
- Truncates visible text and meta to constrain prompt size.

**Section sources**
- [worker.py:248-261](file://agents/worker.py#L248-L261)
- [worker.py:263-282](file://agents/worker.py#L263-L282)
- [worker.py:513-524](file://agents/worker.py#L513-L524)

### Blocked URL Detection System
- Combines page title, final URL, meta keys/values, and a snippet of visible text.
- Detects providers by markers:
  - Indeed: support.indeed.com or "you have been blocked"
  - Cloudflare: "cloudflare", "ray id", "cf-chl"
- Extracts a provider-specific reference ID (e.g., Ray ID) when present.
- Returns an ExtractionFailureDetails object with kind, provider, reference_id, blocked_url, and detected_at.

**Section sources**
- [worker.py:285-324](file://agents/worker.py#L285-L324)

### Structured Extraction Using OpenRouter LLMs
- Uses a dedicated extraction agent class that:
  - Requires OPENROUTER_API_KEY, EXTRACTION_AGENT_MODEL, and EXTRACTION_AGENT_FALLBACK_MODEL
  - Iterates through primary and fallback models, raising a runtime error if both fail
- The prompt instructs extraction of:
  - job_title and job_description (required)
  - company (optional)
  - job_posting_origin (normalized)
  - job_posting_origin_other_text (only when origin is other)
  - extracted_reference_id (optional)
- The agent's system prompt enforces normalized origins and disallows invented facts.

```mermaid
classDiagram
class OpenRouterExtractionAgent {
+extract(context) ExtractedJobPosting
-_extract_with_model(model_name, context) ExtractedJobPosting
-_settings WorkerSettingsEnv
}
class ExtractedJobPosting {
+string job_title
+string job_description
+string? company
+string? job_posting_origin
+string? job_posting_origin_other_text
+string? extracted_reference_id
}
OpenRouterExtractionAgent --> ExtractedJobPosting : "returns"
```

**Diagram sources**
- [worker.py:407-484](file://agents/worker.py#L407-L484)
- [worker.py:127-172](file://agents/worker.py#L127-L172)

**Section sources**
- [worker.py:407-484](file://agents/worker.py#L407-L484)
- [worker.py:127-172](file://agents/worker.py#L127-L172)

### Origin Normalization and Reference ID Finalization
- finalize_extracted_posting merges:
  - Extracted origin and reference ID with detected values from PageContext
  - Enforces that job_posting_origin_other_text is cleared unless origin is other
  - Ensures extracted_reference_id falls back to context when not provided

**Section sources**
- [worker.py:542-562](file://agents/worker.py#L542-L562)

### Enhanced Progress Tracking and Callback Resilience
**Updated** Enhanced with best-effort callback delivery and comprehensive error handling

- Progress is written to Redis under a key derived from application_id.
- The worker posts lifecycle events to backend endpoints:
  - Extraction callback: started, succeeded, failed
  - Generation and regeneration callbacks: started, succeeded, failed
- **Best-effort started callback delivery**: Attempts to send the "started" callback, but continues execution even if it fails
- **Comprehensive logging**: Structured logging with application ID and job ID context for debugging
- **Progress-only continuation**: Extraction continues regardless of callback delivery status
- **Backend reconciliation**: Backend service detects callback synchronization failures and handles them gracefully

```mermaid
sequenceDiagram
participant Worker as "Worker"
participant Redis as "RedisProgressWriter"
participant Backend as "BackendCallbackClient"
Worker->>Redis : "set(progress)"
Worker->>Backend : "post({event : started})"
alt "callback succeeds"
Backend-->>Worker : "acknowledged"
Worker->>Worker : "continue with extraction"
else "callback fails"
Backend-->>Worker : "exception"
Worker->>Worker : "log structured exception"
Worker->>Worker : "continue with progress-only tracking"
end
Worker->>Backend : "post({event : succeeded|failed, ...})"
```

**Diagram sources**
- [worker.py:696-710](file://agents/worker.py#L696-L710)
- [worker.py:448-472](file://agents/worker.py#L448-L472)
- [worker.py:475-509](file://agents/worker.py#L475-L509)

**Section sources**
- [worker.py:696-710](file://agents/worker.py#L696-L710)
- [worker.py:448-472](file://agents/worker.py#L448-L472)
- [worker.py:475-509](file://agents/worker.py#L475-L509)

### Schema Validation and Error Handling
- After extraction, the worker validates the final ExtractedJobPosting using Pydantic model validation.
- Timeouts:
  - Playwright navigation waits up to 30s to load and 10s for network idle
  - Extraction agent calls are wrapped with a timeout and fallback model retry
- Failure modes:
  - blocked_source: reports manual entry required with failure details
  - extraction_failed: reports manual entry required with generic failure
  - TimeoutError: reports manual entry required with timeout message
- **Enhanced error handling**: Comprehensive exception logging with structured context for debugging

**Section sources**
- [worker.py:799-821](file://agents/worker.py#L799-L821)
- [worker.py:285-324](file://agents/worker.py#L285-L324)
- [worker.py:705-710](file://agents/worker.py#L705-L710)

### Fallback Mechanisms and Retry Strategies
- Extraction agent retries once using a fallback model if the primary fails.
- **Enhanced callback resilience**: Started callback delivery uses exponential backoff with retries
- **Backend reconciliation**: Backend service handles callback synchronization failures gracefully
- The worker sets a terminal error code and posts failure details to the backend for recovery and manual entry.

**Section sources**
- [worker.py:419-428](file://agents/worker.py#L419-L428)
- [worker.py:384-404](file://agents/worker.py#L384-L404)
- [worker.py:475-509](file://agents/worker.py#L475-L509)

### Examples of Extraction Workflows
- Successful extraction:
  - Scrape page context or use source_capture
  - Detect blocked sources (if any)
  - **Best-effort started callback delivery**
  - Run structured extraction with OpenRouter
  - Validate schema and finalize
  - **Continue progress tracking regardless of callback status**
  - Report success to backend and update progress to generation_pending
- Blocked source:
  - Detect blocked page and report failure with blocked_source
  - Transition to manual_entry_required
- **Callback failure scenarios**:
  - Started callback fails due to network issues
  - Extraction completes successfully despite callback failure
  - Backend service detects and handles callback synchronization failure
- Insufficient source text:
  - If source_capture is provided and visible_text is too short, report extraction_failed

**Section sources**
- [worker.py:674-821](file://agents/worker.py#L674-L821)
- [test_worker.py:273-337](file://agents/tests/test_worker.py#L273-L337)

## Dependency Analysis
- External libraries:
  - Playwright for browser automation
  - LangChain OpenAI for structured LLM calls
  - Redis client for progress persistence
  - HTTPX for backend callbacks with retry logic
- Internal dependencies:
  - Assembly and validation modules for downstream generation
  - Shared workflow contract for state machine semantics
  - **Enhanced backend service with callback reconciliation**

```mermaid
graph LR
Worker["worker.py"] --> Playwright["playwright"]
Worker --> LangChain["langchain_openai"]
Worker --> Redis["redis"]
Worker --> Httpx["httpx (retry logic)"]
Worker --> Assembly["assembly.py"]
Worker --> Validation["validation.py"]
Worker --> Contract["workflow-contract.json"]
Backend["application_manager.py"] --> Reconciliation["Callback Reconciliation Logic"]
```

**Diagram sources**
- [worker.py:1-25](file://agents/worker.py#L1-L25)
- [workflow-contract.json:1-112](file://shared/workflow-contract.json#L1-L112)
- [application_manager.py:63-65](file://backend/app/services/application_manager.py#L63-L65)

**Section sources**
- [worker.py:1-25](file://agents/worker.py#L1-L25)
- [workflow-contract.json:1-112](file://shared/workflow-contract.json#L1-L112)

## Performance Considerations
- Prompt size limits:
  - Visible text and meta are truncated to constrain LLM context.
- Browser timeouts:
  - Navigation and idle waits are bounded to prevent long hangs.
- Model retries:
  - Extraction agent attempts a fallback model once to improve reliability.
- Progress granularity:
  - Percent-complete increments are used to provide user feedback during long-running steps.
- **Enhanced callback performance**:
  - Best-effort callback delivery prevents blocking extraction on transient network failures.
  - Exponential backoff reduces server load during callback retries.

## Troubleshooting Guide
Common issues and resolutions:
- Extraction timed out:
  - Indicates slow network or blocked page. The worker reports manual entry required.
- Blocked source detected:
  - The worker extracts provider and reference ID (e.g., Ray ID) and transitions to manual entry.
- **Callback synchronization failure**:
  - **Started callback fails due to network issues but extraction continues**
  - **Backend service detects callback delivery failure and handles gracefully**
  - **Check worker logs for structured exception context with app_id and job_id**
- Insufficient source text:
  - When using source_capture, if visible text is too short, the worker requests manual entry.
- Validation failed:
  - The extracted fields must pass Pydantic validation; ensure required fields job_title and job_description are present.
- Missing configuration:
  - OPENROUTER_API_KEY, EXTRACTION_AGENT_MODEL, EXTRACTION_AGENT_FALLBACK_MODEL must be set.
- **Transient network failures**:
  - **Started callback delivery uses retry logic with exponential backoff**
  - **Extraction continues even if callback fails**
  - **Backend service provides reconciliation for callback synchronization issues**

**Section sources**
- [worker.py:799-821](file://agents/worker.py#L799-L821)
- [worker.py:285-324](file://agents/worker.py#L285-L324)
- [worker.py:705-710](file://agents/worker.py#L705-L710)
- [worker.py:384-404](file://agents/worker.py#L384-L404)

## Conclusion
The Extraction Agent provides a robust, deterministic pipeline for extracting job postings from URLs with enhanced resilience against network failures. It combines reliable browser automation, careful metadata capture, structured LLM extraction with schema validation, and resilient progress tracking with best-effort callback delivery. The system gracefully handles blocked sources, timeouts, insufficient content, and transient network failures by continuing execution, providing comprehensive logging, and enabling backend reconciliation for callback synchronization issues.

## Appendices

### Integration with Backend and Workflow States
- The worker posts lifecycle events to backend endpoints with a shared secret.
- **Enhanced backend service updates application records and transitions internal states according to the shared workflow contract.**
- **Backend service includes reconciliation logic for callback synchronization failures.**

**Section sources**
- [internal_worker.py:19-34](file://backend/app/api/internal_worker.py#L19-L34)
- [application_manager.py:905-929](file://backend/app/services/application_manager.py#L905-L929)
- [workflow-contract.json:9-26](file://shared/workflow-contract.json#L9-L26)

### Enhanced Callback Resilience Testing
- **Tests cover best-effort started callback delivery when backend is temporarily unreachable**
- **Verification that extraction continues despite callback failures**
- **Progress tracking maintains state even when callbacks fail**
- **Backend reconciliation logic handles callback synchronization failures gracefully**

**Section sources**
- [test_worker.py:273-337](file://agents/tests/test_worker.py#L273-L337)