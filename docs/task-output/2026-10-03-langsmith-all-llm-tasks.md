# LangSmith coverage for every LLM task

Updated 2026-10-03 19:22:53 EDT. Implementation deployed; backend and worker trace ingestion plus native model/token reporting verified in both `applix-dev` and `applix-prod`.

## Delivered

- Ignored local env enables `LANGSMITH_TRACING=true` and selects `LANGSMITH_PROJECT=applix-dev`. Copied the existing Railway key privately; env-file permissions are restricted and no key was printed or committed. Normal backend/worker containers received these settings through `make up`.
- Production backend/worker retain enabled tracing with `applix-prod`. The follow-up adds workspace routing to both services.
- Jev advisory classification has a chain root and one LLM trace per bounded HTTP attempt, with retry/timeout/status/available usage metrics.
- Cleanup retains its workflow chain while its model request and nested entry extraction use the shared import boundary. Traces record correction requests, available input/output token usage, elapsed time, operation/model and fallback selection.
- Worker compatibility calls and section generation preserve fallback metadata. Live standalone evaluations honor merged env-file/shell tracing configuration and tag each case; the Makefile live target no longer overrides tracing off. Offline evaluation and automated-test targets remain off.
- Cached clients use a five-second HTTP timeout. Trace failures carry exception types only; raw SDK exception strings/tracebacks are never forwarded. Existing source validation, provider budgets and prompt text remain unchanged.

## Verification

- Focused backend regression coverage: 91 passed.
- Worker, legacy generation, Resume Judge, section pipeline and evaluator coverage: 163 passed.
- Local environment guards: 15 passed.
- `git diff --check`: passed.
- `make up` and `make health`: passed. The Makefile selected available local ports during refresh.
- Initial bounded fictional smoke calls returned HTTP 403 on ingestion and project reads. A subsequent key replacement did not resolve the issue; the workspace-routing investigation below corrected the credential diagnosis.

## Workspace routing and confirmed delivery

The configured organization-scoped keys can read their LangSmith organization but cannot access workspace resources without a workspace selector. The organization API returned one workspace; project reads with its `X-Tenant-Id` succeeded. See the [LangSmith organization API guide](https://docs.langchain.com/langsmith/manage-organization-by-api).

- Added `LANGSMITH_WORKSPACE_ID` to both ignored local env files, with permissions `0600`, while preserving the user's key. Compose forwards it to backend and worker. Backend import settings, worker trace settings and live evaluation env-file settings pass it to the SDK. Client caches distinguish workspace selectors.
- Added the selector to environment examples, the PRD, prompt tracing contract and evaluation documentation. Added `make dev-runtime` to refresh only the local source-mounted backend and worker; ran it successfully.
- Follow-up regression checks: 93 backend tests, 46 worker/evaluation tests and 15 local environment guards passed. Coverage includes explicit workspace forwarding, client-cache separation, Compose settings and live evaluation env-file routing. Local health and `git diff --check` passed.
- Local fictional provider calls successfully exercised classification, import extraction and worker structured generation. Read back four backend and two worker runs in `applix-dev`. All six had the expected project ID; serialized stored runs contained neither the private input sentinel nor either API key.
- Local backend root: `01a103db-f66e-7ef3-97bd-ff8de40e83cc`; worker root: `01a103db-f665-7ab0-919b-057bcd58c4e1`.
- Configured the same workspace selector in both Railway services, retaining their keys and `applix-prod`. Redeployed their existing releases without a new source upload. Production queue and active-job counts were zero before the refresh.
- Workspace refresh deployments: backend `c4235848-6ac2-4f59-936f-21dc12effe97`, worker `5e38ee1f-4dfd-4384-ae4a-e2652b431f6f`; both succeeded. The deployed SDK honors the workspace environment selector.
- Production fictional provider calls produced four backend and two worker runs in `applix-prod`, with the same stored-run privacy checks passing. Backend root: `01a103de-a244-7010-8207-db526a375136`; worker root: `01a103de-e5af-7e31-be1b-61a2c3ad7387`.
- Production health returns HTTP 200; unauthenticated application access returns HTTP 401. The smoke calls use fictional input only and perform no application database reads or writes. A new full resume generation through the UI remains a useful end-to-end confirmation.

## Native model and token display

The user's real section-regeneration run had two successful model children. Both recorded `google/gemini-3.8-flash`; generation reported 7,551 input/1,602 output tokens, and grounding reported 4,742 input/928 output tokens. The native counters were zero because these values were only generic metadata/output fields. The selected root was a chain summary, with completion rather than generated content. Prompt/response absence matched the approved counts-only policy.

- Shared backend/worker trace scopes now add `ls_provider=openrouter`, `ls_model_name` with the configured model ID and `ls_model_type=chat` to model children. Compatibility run configuration includes the same fields. Chain roots retain their existing summary metadata.
- Shared completion helpers publish available usage in top-level output `usage_metadata`, with a summed total when both counts are present. They reject invalid/negative/bool counts, preserve missing usage and do not mutate caller output dictionaries. Telemetry failures remain best-effort.
- Regression coverage includes native model metadata, chain separation, positive/zero/partial/unknown usage, caller-data preservation and existing disabled/privacy/failure behavior. Passed 44 backend, 52 worker/evaluation and 15 environment-guard checks. Local health and diff checks passed.
- `make dev-runtime` now recreates only backend and worker, ensuring source changes load into the worker without changing ports or rebuilding the frontend. Both services were refreshed.
- New local smoke roots: backend `01a10411-823c-79c1-8845-057fda23beaf`, worker `01a10411-8261-7623-b208-f0c3972eaacc`. Read back six traces; native token totals across model children were 193 and 203 respectively. Model fields and native counters matched recorded counts; private sentinel and credentials remained absent.
- Overlaid only `backend/app/core/tracing.py` and `agents/langsmith_tracing.py` onto the existing isolated release snapshot, preserving unrelated working-tree changes. Production queue/active jobs were zero before upload. Backend deployment `b4bb4bc2-cd7b-4c99-8f69-cdf1a9706bbe` and worker deployment `22732f9a-1c98-44e6-a1d0-d08dae712e60` succeeded. Remote helper hashes match the reviewed files; health returns 200 and unauthenticated application access returns 401.
- New production smoke roots: backend `01a10413-732d-7b52-add5-0ac7f30d16d4`, worker `01a10413-738f-7c71-bfe1-a9699993882d`. Read back six traces; native token totals across model children were 203 and 222 respectively, with model fields, counts and stored-run privacy checks passing.
- No historical traces were rewritten. The counts-only content policy remains unchanged. Automatic price calculation depends on the LangSmith provider/model catalog; no costs are invented. See [LangSmith's manual LLM instrumentation contract](https://docs.langchain.com/langsmith/log-llm-trace).

## Isolated production release

The source snapshot starts at deployed commit `f7bdf82eda5219b05a0670f36055f47527e6d3f1` and overlays only the eight tracing-related backend/worker source files. Confirmed those files matched the production baseline before applying this task's changes. Private env files, unrelated frontend/API/activity changes, dependency edits and migration 023 are absent from the overlay. No migration or frontend deployment is part of this release.

Production queue inspection before upload found zero queued and zero active ARQ jobs.

- Backend deployment: `b10c4f0d-d487-4369-bb65-0b1f013abb00`.
- Worker deployment: `8461ff0b-1e1d-4357-8b17-012cba417e2f`.

Both initial deployments succeeded and were verified at 2026-10-03 17:57:17 EDT. Remote SHA-256 checks matched all eight reviewed source files. Both running services reported `LANGSMITH_TRACING=true` and `LANGSMITH_PROJECT=applix-prod`. Backend `/healthz` returned HTTP 200, unauthenticated `/api/applications` returned HTTP 401, and the worker's Redis ping succeeded with zero queued jobs. Initial delivery was blocked by missing workspace routing; the follow-up above verifies successful production ingestion.

The source changes remain in the workspace for review. No commit or push was requested or performed. The isolated CLI deployment keeps the production frontend, unrelated local product changes and schema unchanged.
