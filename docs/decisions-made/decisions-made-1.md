# Decisions Made

## 2026-06-05 00:16:09 EDT - Make high-aggressiveness role title rewrites active but bounded

- Status: Accepted
- Context: High aggressiveness was documented as allowing Professional Experience title rewrites, but generated drafts could still keep source titles because the prompt contract made `jobs[].title` changes optional and the payload did not give a mode-specific title policy.
- Decision:
  1. Add a mode-specific `title_rewrite_policy` to the Professional Experience structure contract sent to the resume-writing agent.
  2. In high aggressiveness, instruct the agent to use a target-aligned truthful `jobs[].title` when demonstrated responsibilities support adjacent role framing, especially for the most recent eligible role.
  3. Preserve source titles when no truthful adjacent title is supported, and keep low source-exact plus medium lightly grounded.
  4. Treat manager, supervisor, and director wording as seniority-bearing so high-mode retitles cannot imply unsupported promotion or people-management scope.
- Consequences: High mode becomes more likely to produce visible title tailoring while company, dates, role order, seniority, and grounding remain fail-closed.

## 2026-06-03 17:48:26 EDT - Protect public beta access requests without persisting requester records

- Status: Accepted
- Context: The public landing-page follow-on review found that beta access requests could be abused to trigger duplicate or excessive Resend sends, while the PRD still requires those requests to remain email-only and non-persistent.
- Decision:
  1. Keep access requests non-persistent to preserve the committed invite-only contract and avoid creating a new requester data store.
  2. Add backend rate limiting and short-window duplicate suppression in front of the public access-request email path.
  3. Tighten email validation and fail closed when the provider does not return a delivery receipt.
  4. Add bounded retry behavior for transient Resend delivery failures instead of silently dropping the request on the first transport error.
- Consequences: The public beta form is harder to abuse, avoids duplicate admin emails during rapid resubmission, preserves the no-persistence product rule, and keeps email delivery behavior aligned with the app's broader fail-closed reliability guardrails.

## 2026-06-03 11:03:48 EDT - Keep beta access requests email-only while preserving invite-only accounts

- Status: Accepted
- Context: The product needed a public business landing page with Sign up CTAs, but the MVP access model remains private and invite-only.
- Decision:
  1. Show a public landing page at `/` with feature and informational pricing copy.
  2. Treat public `/signup` without an invite token as a beta access-request form, not account creation.
  3. Send access requests to configured admins through Resend without persisting requester records.
  4. Keep account creation and approval manual through the existing admin invite flow.
- Consequences: The app can present a business-facing entry point and collect early-access interest while preserving the hard auth boundary, avoiding a new database contract, and keeping admin acceptance in the existing invite workflow.

## 2026-05-25 18:49:35 EDT — Use semantic JSON as the resume-writing agent contract

- Status: Accepted
- Context: Section-level Markdown strings from resume-writing agents still left too much formatting probability in the LLM path, creating validation and rendering fragility around headings, bullets, row layout, and optional sections.
- Decision:
  1. Require full generation, full regeneration, section regeneration, and validation repair to return strict semantic JSON section objects with `id`, `heading`, `content`, and grounded `supporting_snippets`.
  2. Render persisted Markdown locally from section-specific semantic content schemas for Summary, Professional Experience, Education, Skills, Projects, and Certifications.
  3. Generate only the intersection of user-enabled sections and sections detected in the sanitized base resume, with Summary allowed for substantive non-contact source content.
  4. Store Resume Judge regeneration guidance as section-keyed JSON arrays and convert it to bounded instructions only when triggering judge-feedback regeneration.
  5. Keep job extraction and upload cleanup on explicit JSON contracts with stricter prompt wording and local type/key validation where applicable.
- Consequences: Resume output formatting is deterministic at the application layer, validation has a structured object to inspect before Markdown rendering, optional source-absent sections no longer become required by preference alone, and saved drafts remain Markdown-compatible for preview, editing, and export.

## 2026-05-25 17:55:00 EDT — Apply code review refactoring fixes across backend and frontend layers

- Status: Accepted
- Context: An interactive code review identified opportunities to remove duplication, add robust defensive guards, prevent silent parsing failures, and clean up debugging statements before production release.
- Decision:
  1. Extract ISO timestamp parsing and duration calculations into safe, centralized static helpers `_parse_iso_timestamp` and `_calculate_duration_ms` on `ApplicationService`.
  2. Consolidate Resume Judge recommendation retrieval into a centralized helper `_get_judge_instructions` wrapped with defensive `isinstance(dict)` type guards.
  3. Add logger warnings inside duration-parsing bare except blocks to prevent silent validation/formatting failures.
  4. Use the new duration calculator in the extraction success callback and regeneration callback handlers consistently.
  5. Remove ad-hoc `console.info` / `console.warn` logging statements and their helper utilities from all production paths in frontend `api.ts`.
- Consequences: Improved codebase maintainability, DRY utility patterns, enhanced telemetry for timestamp errors, defensive state guards against database drift, and a production-compliant console output.

## 2026-05-25 17:10:00 EDT — Differentiate regeneration with judge feedback and enrich activity log with models, duration, and instructions

- Status: Accepted
- Context: Users needed to clearly differentiate "Regeneration with Judge Feedback" from standard full regeneration in the application timeline (Activity Log). Additionally, to provide proper diagnostic visibility for both extractions and generations/regenerations, the Activity Log needed to capture and show the AI model used, job durations, user instructions, and specific judge recommendations.
- Decision:
  1. Add `use_judge_feedback` to full regeneration request payloads and persist it in the draft's `generation_params` to statelessly identify judge-feedback-driven runs in callbacks.
  2. Map custom timeline titles ("Regeneration with Judge Feedback started/completed") and summaries at runtime in `handle_regeneration_callback()` when `use_judge_feedback` is active.
  3. Enrich the extraction success callback payload with `model_used` and compute accurate duration (`duration_ms`) before writing to timeline events.
  4. Persist user instructions (`additional_instructions` for full, `instructions` for section) and judge feedback recommendations (`regeneration_instructions`) inside start and completed activity event metadata.
  5. Update `ApplicationActivityPanel` to render `Specific Instructions` and `Judge Recommendations` in elegant timeline detail blocks, and dynamically expand them when present.
- Consequences: The Activity Log timeline is highly detailed and informative, judge-specific flows are visually highlighted and traceable, and operator diagnostics are persisted cleanly without breaking retro-compatibility.

## 2026-05-24 13:20:00 EDT — Add DeepSeek V4 Flash to curated generation model choices

- Status: Accepted
- Context: Administrators needed another fast, lower-cost generation option in the subscription-tier model picker while preserving model-aware reasoning validation across the frontend, backend, database, and worker.
- Decision:
  1. Add `deepseek/deepseek-v4-flash` to the curated admin-selectable OpenRouter generation models.
  2. Allow DeepSeek V4 Flash reasoning values `none`, `high`, and `xhigh`, matching OpenRouter's supported high/max reasoning modes while retaining `none` for no explicit reasoning request.
  3. Keep unsupported DeepSeek reasoning values such as `low` and `medium` rejected at every validation layer before jobs reach the provider.
- Consequences: Admins can choose DeepSeek V4 Flash as a primary or fallback tier model without a deploy-time environment change, and generation jobs remain fail-closed if model or reasoning settings drift out of the curated contract.

## 2026-05-23 19:31:20 EDT — Use subscription tiers for monthly resume-writing quota and generation model selection

- Status: Accepted
- Context: The app needed Basic and Pro subscription tiers so administrators can control both how many resume-writing operations a user can run each month and which OpenRouter generation models those operations use. The previous non-admin full-regeneration cap controlled only one operation type and could not express tiered access or model policy.
- Decision:
  1. Add durable `basic` and `pro` subscription tiers with admin-editable monthly resume-writing limits, primary generation model IDs, and fallback generation model IDs.
  2. Default all existing and newly invited users to Basic, while allowing admins to move individual users between Basic and Pro.
  3. Count initial generation, full regeneration, and single-section regeneration against the same per-user UTC calendar-month quota.
  4. Reserve quota atomically before enqueueing worker jobs and release the reservation if enqueueing fails.
  5. Pass tier-selected primary/fallback model IDs as hidden worker settings, persist only safe summary metadata on drafts, and keep environment generation model settings as compatibility fallback for older queued jobs.
- Consequences: Resume-writing limits are now user-tier based instead of application-specific, admins can tune quota and model access without deploys, and model selection becomes a product-configurable policy while preserving fail-closed worker behavior and older job compatibility.

## 2026-05-16 17:42:00 EDT — Treat resume page length as a source-aware content target

- Status: Accepted
- Context: Selecting 2 pages could produce a draft that was effectively one page with a tiny spillover because the generator treated length mostly as prompt guidance, deterministic validation only enforced upper caps, and export only ensured the PDF fit within the requested page count. A real user sample showed a 2-page export with about 440 generated words from a 734-word base resume.
- Decision:
  1. Keep page length as a content target rather than a visual whitespace-fill command.
  2. For 2-page and 3-page targets, require underfilled drafts to meet a source-aware minimum: `min(target_min, floor(sanitized_base_resume_word_count * 0.80))`.
  3. Run the existing validation repair pass for drafts below that source-aware minimum, instructing repair to expand only by restoring grounded source-resume material.
  4. Approve drafts below the nominal target range but above the source-aware minimum with a `source_limited_length` warning instead of padding or inventing facts.
  5. Keep PDF/DOCX export as max-page fitting, while Resume Judge caps length scores and prioritizes length feedback for under-target drafts that are not source-limited.
- Consequences: Multi-page settings now produce stronger pressure to preserve grounded source content, users get a clear warning when source material limits length, and the system avoids artificial page filling or unsupported resume claims.

## 2026-04-19 13:30:00 EDT — Use one semantic render model to normalize and render Experience and Education across preview, PDF, and DOCX

- Status: Accepted
- Context: Generated drafts, manual edits, and export formatting were allowing layout drift in `Professional Experience` and `Education`. The product needed consistent placement for organization, role or degree, location, date, and bullets across the in-app preview and both export formats, while still preserving Markdown as the stored source of record.
- Decision:
  1. Add a shared backend resume render/parser service that parses stored Markdown into a semantic render model and serializes parseable drafts back into canonical Markdown.
  2. Standardize `Professional Experience` and `Education` on the same two-row block pattern: row 1 left is organization or school, row 1 right is location, row 2 left is role title or degree, and row 2 right is duration or graduation date.
  3. Normalize generated, regenerated, manually saved, and exported drafts through that same contract and fail closed on malformed or ambiguous structured blocks.
  4. Render the generated-resume preview, PDF export, and DOCX export from the same semantic model rather than separate line-parsing heuristics.
  5. Rebalance typography so section headings remain strongest, structured entry headers sit above body text, and section and entry spacing are roomier for readability.
- Consequences: Experience and Education now remain visually and semantically aligned across preview and export surfaces, legacy parseable drafts converge to one canonical Markdown format over time, malformed manual edits are rejected instead of producing inconsistent output, and future layout changes can be made once in the shared render model instead of separately in preview, PDF, and DOCX.

## 2026-04-18 08:17:15 EDT — Cap Resume Judge reruns per draft and harden Railway callback delivery against stale backend ports

- Status: Accepted
- Context: Production Resume Judge jobs were completing in the `agents` worker, but callback delivery back into the backend was failing. Railway inspection showed the worker was still configured with `BACKEND_API_URL=http://backend.railway.internal:8000` while the backend was bound to Railway’s runtime port `8080`, so started and succeeded judge callbacks could miss persistence and leave the UI in a retryable failed or queued state.
- Decision:
  1. Cap manual Resume Judge reruns at three queued runs for the same draft and job context.
  2. Persist a dedicated `resume_judge_result.run_attempt_count` so rerun caps survive callback misses and stale UI refreshes without overloading the existing provider-level `attempt_count`.
  3. Disable the Resume Judge rerun CTA in the frontend once the current draft reaches the three-run cap.
  4. Harden worker callback delivery by trying Railway-safe backend URL candidates when the configured callback URL still points at the stale internal `:8000` port.
- Consequences: Resume Judge no longer spins indefinitely on the same draft, Railway callback delivery is resilient to the current backend URL misconfiguration after redeploy, and older stored judge payloads without `run_attempt_count` remain readable with a safe fallback.

## 2026-04-17 22:10:54 EDT — Use per-application SSE for detail-page workflow updates with polling retained as a watchdog

- Status: Accepted
- Context: The application detail page was polling `/progress` every 3 seconds for extraction and generation state plus polling application detail every 5 seconds for Resume Judge state. That contract already had important Redis-backed reconciliation and stalled-job recovery behavior, so simply replacing it with a client-only live transport would have risked losing the fail-closed recovery paths while still keeping the same backend complexity.
- Decision:
  1. Add an authenticated per-application SSE endpoint for detail-page workflows instead of introducing a broader app-wide stream.
  2. Keep Redis progress records and terminal reconciliation as the source of truth, and publish `progress` plus `detail` events from those existing backend paths.
  3. Use a fetch-based stream client in the frontend rather than native `EventSource`, because the app authenticates API requests with a Supabase bearer token header.
  4. Keep 5-second detail/progress polling as a watchdog and reconnect fallback while active extraction, generation, regeneration, or Resume Judge work is in flight.
- Consequences: Detail-page progress now updates immediately when backend callbacks land, but stalled-job recovery and callback-missed reconciliation still run through the existing read paths. The rollout avoids WebSocket infrastructure, preserves fail-closed behavior, and limits long-lived connections to pages that actually need live workflow state.

## 2026-04-17 20:45:00 EDT — Standardize the frontend on a production runtime plus shared query caching

- Status: Accepted
- Context: Railway was serving the frontend through Vite development mode, which kept React dev-only behavior such as duplicate `StrictMode` mount effects live in production. At the same time, the shell and route pages were independently fetching the same bootstrap, applications, base-resume, profile, and notification resources, multiplying backend requests and making each redundant GET more expensive because repositories still open fresh Postgres connections per call.
- Decision:
  1. Replace the frontend’s Railway runtime with a production build served from `nginx:alpine`, while keeping a separate Docker `dev` target for the local Compose stack.
  2. Inject runtime frontend configuration through a generated `env-config.js` so the same production image can read Railway-provided values without falling back to `vite dev`.
  3. Add a shared React Query cache as the single client-side data layer for session bootstrap, applications, application detail, drafts, base resumes, notifications, admin metrics, and admin users.
  4. Remove the shell-wide eager applications fetch and stop using a custom window event to fan out notification clears; use query invalidation instead.
  5. Extend session bootstrap with aggregate application summary counts so shell badges and attention indicators no longer require a full applications list fetch.
- Consequences: Hosted frontend traffic now runs through a production bundle instead of the Vite dev server, shared route data is deduped across pages and shell chrome, and the shell can render badge counts from a small aggregate bootstrap payload. Backend connection pooling remains a separate follow-up if Railway costs stay elevated after these request-volume reductions.

## 2026-04-17 10:30:00 EDT — Add Resume Judge as a dedicated post-generation evaluator with local scoring arithmetic

- Status: Accepted
- Context: The resume workflow needed a maintained evaluator agent that could score generated drafts, expose the score prominently in the detail workspace, and provide actionable regeneration feedback without blocking draft availability or giving the model responsibility for arithmetic and pass/fail bookkeeping.
- Decision:
  1. Add a dedicated OpenRouter-backed `Resume Judge` agent with its own primary model, fallback model, and reasoning-effort env configuration.
  2. Run Resume Judge automatically after initial generation, full regeneration, and section regeneration, but keep generation non-blocking so the draft becomes available before scoring completes.
  3. Persist the latest judge lifecycle state on `applications.resume_judge_result` and include `evaluated_draft_updated_at` so stale callbacks and stale UI scores can be fenced against later draft edits.
  4. Sanitize the generated draft before the LLM call and provide ATS/density facts through deterministic local observations instead of asking the model to infer everything from raw text.
  5. Keep the LLM contract evaluator-only: the model returns dimension scores, notes, summary, regeneration instructions, and evaluator notes, while local code computes weighted contributions, final score, display score, and verdict.
  6. Treat judge failures as fail-open. Resume Judge may show `failed` or stale score state, but it must not alter `visible_status`, `failure_reason`, export availability, or draft editability.
- Consequences: The application detail page now has a first-class score tile and breakdown dialog, full regeneration can optionally append judge feedback to user instructions, and the prompt/schema/runbook contract now includes a new persisted JSONB state plus a separate evaluator prompt family.

## 2026-04-16 23:50:07 EDT — Make compare the MVP review path for JD-driven additions

- Status: Accepted
- Context: The product had briefly diverged between code review feedback and the intended UX contract for medium/high tailoring. The compare workflow was already the active review surface in the application detail workspace, but the PRD still required a separate generated-draft warning panel for `review_flags`, which no longer matched the desired frontend behavior.
- Decision:
  1. Keep emitting draft `review_flags` in the backend payload for provenance and future use, but do not require a standalone generated-draft warning panel in the MVP detail view.
  2. Treat compare mode as the explicit MVP review path for JD-driven additions that are not explicit in the source resume.
  3. Update the PRD to describe compare as the required review workflow before apply/export for medium/high runs.
- Consequences: The frontend remains simpler and aligned with the current compare-first detail experience, the product contract no longer conflicts with the implemented UI, and `review_flags` data remains available without creating a second mandatory review surface.

## 2026-04-16 22:38:50 EDT — Move generation reasoning effort into env config and default it to none

- Status: Accepted
- Context: Generation and regeneration reasoning effort was still hardcoded in `agents/generation.py`, which meant model changes were configurable but reasoning intensity was not. You wanted the same runtime flexibility for reasoning effort, with the ability to set `none`, `low`, `medium`, `high`, or `xhigh` without another code change.
- Decision:
  1. Add a validated worker env setting, `GENERATION_AGENT_REASONING_EFFORT`, with allowed values `none`, `low`, `medium`, `high`, and `xhigh`.
  2. Thread that setting through full generation, full regeneration, and section regeneration for both primary and fallback attempts instead of hardcoding reasoning in `agents/generation.py`.
  3. Keep validation-repair non-reasoning regardless of the configured generation setting.
  4. Set the tracked dotenv defaults to `none` for now.
- Consequences: Runtime model configuration now also controls generation/regeration reasoning intensity, local and compose defaults are aligned on `none`, and repair stays narrow and deterministic even when generation reasoning is increased later.

## 2026-04-16 22:20:00 EDT — Make medium/high Professional Experience visibly stronger and restore bounded reasoning defaults

- Status: Accepted
- Context: Live medium/high outputs were still often changing Summary and Skills while leaving Professional Experience nearly untouched, which made aggressiveness feel weaker than the UI contract. The current dirty-tree generation code had also disabled reasoning entirely, diverging from the intended bounded reasoning policy for full drafts and section regeneration.
- Decision:
  1. Restore bounded reasoning defaults for generation and regeneration at `medium` effort on both primary and fallback attempts, and keep validation-repair attempts non-reasoning.
  2. Make Professional Experience the primary tailoring surface in medium and high mode by requiring visible bullet rewrites in the first up to 2 source-ordered roles with bullets, while keeping anchored role order fixed.
  3. Keep medium targeted rather than broad: allow opportunistic grounded title reframing when fit clearly improves, but do not require title rewrites.
  4. Keep high as the most assertive mode: actively retitle grounded roles when alignment is clear, especially the most recent role, while preserving company, dates, duration, and seniority.
  5. Add a medium/high-only heuristic validation failure for insufficient Professional Experience tailoring, and feed that failure through the existing repair prompt so repair attempts push on experience bullets instead of only Summary or Skills.
  6. Expand read-time draft review flags so medium/high Professional Experience header/title rewrites that introduce JD-only wording are surfaced for user review under the existing payload shape.
- Consequences: Medium/high outputs now have a stronger default obligation to visibly rewrite experience content, the repair pass gets a clearer target when experience stays too close to source wording, and the generation stack uses a cheaper consistent `medium` reasoning policy for generation/regeneration while keeping repair narrow.

## 2026-04-15 21:20:00 EDT — Let medium/high inject JD-driven keywords and add explicit draft review flags

- Status: Accepted
- Context: Live usage showed low, medium, and high generation outputs were often too similar. The prompt contract required source-only skills in medium/high and explicitly blocked adding new skills, which made tailoring feel like light cleanup instead of true role targeting.
- Decision:
  1. Keep low mode strictly source-preserving for skills and factual claims.
  2. Allow medium and high modes to inject job-description-driven non-factual keyword/skill phrasing for role fit.
  3. Keep deterministic Professional Experience invariants unchanged: role-block count, company/date source-exactness, low title exactness, medium title grounding + seniority preservation, high seniority preservation.
  4. Keep factual hallucination guardrails fail-closed for employers, dates, institutions, credentials, awards, scope, and outcomes.
  5. Add read-time draft `review_flags` for medium/high so JD-only additions are visibly surfaced in the application detail UI for explicit user review.
  6. Increase generation sampling variance by aggressiveness (`low=0.2`, `medium=0.35`, `high=0.5`) so mode choices produce meaningfully different outputs.
- Consequences: Medium/high now perform materially stronger tailoring, user review burden is made explicit through flagged additions instead of hidden behavior shifts, and deterministic structural safeguards continue to prevent factual drift in work history.

## 2026-04-14 21:34:11 EDT — Bound generation to one primary attempt, one fallback attempt, and one repair-only pass with stage diagnostics

- Status: Accepted
- Context: Generation had two distinct failure modes in live use. Some requests were slow because the pipeline could fan out into multiple full LLM calls before success or failure, especially when structured output failed or a provider rejected the reasoning field. Other requests never reached the backend generation endpoint at all, but the frontend and backend did not emit enough structured diagnostics to show whether the request was blocked locally, failed during enqueue, died in the worker before OpenRouter, or was rejected after deterministic validation.
- Decision:
  1. Keep the generation pipeline bounded to one primary-model attempt followed by one fallback-model attempt, instead of allowing generic same-request resend fan-out across multiple transport modes on the same model.
  2. Keep same-model retry only for the narrow case where the provider explicitly rejects the `reasoning` parameter; retry that model once without reasoning and otherwise move on.
  3. Use primary structured output first and fallback prompt-level JSON second for full generation, full regeneration, and section regeneration.
  4. After a successful LLM response fails deterministic validation, allow exactly one validation-aware repair attempt in prompt-level JSON mode before failing closed.
  5. Remove whole-job automatic reruns for generation and regeneration by reducing worker job retries to a single attempt and relying on explicit model fallback plus the repair pass instead.
  6. Add sanitized structured diagnostics across frontend guard handling, backend route entry and enqueue, worker LLM attempts, validation and repair, cache writes, and callback delivery, and persist enriched `generation_failure_details` so the UI can show where the request stopped.
  7. Move generation defaults to faster lighter models for local/runtime defaults: `openai/gpt-5-mini` primary and `google/gemini-flash-1.5` fallback, with `medium` reasoning for generation and regeneration and no reasoning on repair.
- Consequences: Resume-writing latency is now constrained by a small fixed attempt budget instead of an open-ended retry matrix, deterministic validation remains fail-closed while still getting one salvage pass, and operators can distinguish “blocked in the UI,” “enqueue failed,” “worker failed before LLM,” and “LLM or validation failed” without exposing sensitive resume or job-posting content in logs.

## 2026-04-13 22:45:01 EDT — Make medium title reframing bounded, add high-mode bounded inference, and harden resume voice rules

- Status: Accepted
- Context: Real usage showed that medium aggressiveness was too close to low, the prompt contract had no explicit anti-filler or human-sounding voice guidance, and the previous high-only title-rewrite rule was too binary for users who wanted medium to do more than cleanup while still keeping roles grounded in the original title.
- Decision:
  1. Keep low aggressiveness fully title-fixed: Professional Experience role titles remain source-exact.
  2. Allow medium aggressiveness to lightly reframe Professional Experience titles only when the rewritten title stays grounded in the same core role family and preserves source seniority.
  3. Keep high aggressiveness as the most flexible mode, and explicitly allow bounded professional inference from demonstrated source patterns in Summary and role framing, while still forbidding invented employers, dates, institutions, credentials, metrics, technologies, or seniority changes.
  4. Preserve company and date ranges as deterministic invariants in every mode, and preserve source duration by rehydrating company/date from Professional Experience anchors after generation.
  5. Add an explicit voice contract to resume prompts: banned filler phrases, varied bullet structure, candidate-specific specificity guidance, and at least one concrete source-backed detail per role when available.
  6. Add a dedicated worked example for bounded inference in high aggressiveness, remove the filler-phrase loophole even when the source uses those phrases, explicitly permit medium-mode bullet consolidation, and document that medium title-family checking is only approximated by deterministic validation.
- Consequences: Medium now produces a meaningfully stronger rewrite than low without becoming free-form retitling, high becomes more honest about bounded inference while remaining fail-closed on factual drift, the prompts give the model fewer loopholes for generic AI phrasing, and future maintainers have a clearer picture of which title checks are deterministic heuristics versus prompt-layer intent.

## 2026-04-12 16:10:00 EDT — Treat DOCX as a first-class export alongside PDF

- Status: Accepted
- Context: The product already had a tuned PDF export pipeline, but users also needed a clean DOCX download that preserved the same grounded resume structure, fit a Letter-sized page cleanly, and behaved consistently in workflow status and notifications.
- Decision:
  1. Add DOCX as a second on-demand export format generated from the latest draft with no persistent file storage.
  2. Refactor export rendering around one shared normalized resume document structure so PDF and DOCX consume the same header replacement, section parsing, bullet handling, and split-row semantics.
  3. Treat successful DOCX exports as workflow-equivalent to successful PDF exports by updating export timestamps, setting visible status to `Complete`, and recording the same generic export usage event.
  4. Use Word-native DOCX formatting with Letter page size, fixed clean margins, real list paragraphs, and tab-stop split rows; keep page-length behavior best-effort rather than requiring exact PDF pagination parity.
- Consequences: Users can export either PDF or DOCX without changing the storage model, the backend keeps one export status contract instead of format-specific state, and future export-format changes can build on the shared parsing layer instead of duplicating Markdown normalization logic.

## 2026-04-10 17:00:08 EDT — Use GitHub Actions path-filtered Railway CLI deploys for selective push-to-main releases

- Status: Accepted
- Context: The repo did not have deployment automation from `main` to Railway, and the requirement was to redeploy only services whose code changed (for example backend-only changes should not redeploy frontend).
- Decision:
  1. Create a dedicated Railway project `job-app-prod` with separate `backend` and `frontend` services and keep deploy targeting service-specific IDs.
  2. Add a GitHub Actions workflow (`.github/workflows/deploy-railway-main.yml`) on `push` to `main` that uses path filters to compute changed services.
  3. Deploy each changed service independently with `railway up <service-path> --path-as-root --service <service-id> --project <project-id> --environment production --ci`.
  4. Store deploy credentials and identifiers in GitHub secrets (`RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_BACKEND_SERVICE_ID`, `RAILWAY_FRONTEND_SERVICE_ID`).
- Consequences: Pushes to `main` now trigger automatic Railway deployments while avoiding unnecessary redeploys for untouched services; shared-path changes still redeploy both services by design.

## 2026-04-10 13:30:00 EDT — Make regeneration structure deterministic, cap non-admin full regenerations, and move generation to slower higher-quality defaults

- Status: Accepted
- Context: Full and section regeneration occasionally returned Professional Experience output that dropped or altered company/date lines, creating structural drift that deterministic validation could miss when model output was inconsistent. The team also needed longer async windows for slower higher-quality models and explicit cost controls for repeated full regenerations.
- Decision:
  1. Add deterministic Professional Experience source anchors (`title`, `company`, `date_range`, source order) extracted from sanitized base resume content and pass them into full and section regeneration prompts as explicit invariants.
  2. Add a deterministic post-LLM normalization pass that rehydrates Professional Experience company/date from source anchors before validation and assembly; low/medium also force source-exact titles while high preserves generated titles only when company/date stay source-exact.
  3. Strengthen deterministic validation to fail closed when Professional Experience role blocks cannot satisfy the structure contract after normalization.
  4. Enforce a hard per-application cap of three full regenerations for non-admin users, consume a slot only when queueing succeeds, and allow admin bypass.
  5. Increase generation timeout profiles to `240s` full generation/full regeneration and `120s` section regeneration, and surface section-aware stage messages through progress updates.
  6. Set generation model defaults to `z-ai/glm-5.1` primary and `anthropic/claude-sonnet-4.6` fallback, while leaving extraction defaults unchanged.
- Consequences: Regeneration output stays structurally stable for Professional Experience across retries, user-facing progress becomes clearer for longer-running models, full-regeneration spend is bounded for non-admin users, and admin workflows retain operational override capability.

## 2026-04-10 10:42:00 EDT — Keep onboarding invite-only via tokenized signup, and scope admin to metrics plus user lifecycle controls

- Status: Accepted
- Context: The product needed account creation for new users without opening public registration. Admin users also needed operational visibility and user lifecycle controls before launch, with reliable invite delivery through Resend and clear onboarding requirements.
- Decision:
  1. Keep signup invite-only by introducing tokenized invite links and dedicated unauthenticated invite preview/accept endpoints, while keeping all other application APIs JWT-protected.
  2. Pre-provision invited users in Supabase Auth at invite-send time, then complete onboarding on invite acceptance by setting password and mandatory profile fields.
  3. Require invite-signup profile fields `first_name`, `last_name`, `location`, `phone`, and `email`; keep LinkedIn optional.
  4. Enforce password confirmation and a minimum password policy of 12+ characters with uppercase, lowercase, number, and symbol.
  5. Scope admin MVP responsibilities to exactly two surfaces: a metrics dashboard (invite funnel plus extraction/generation/regeneration/export outcomes) and user management (invite, edit, deactivate/reactivate, delete).
- Consequences: The app remains private and invite-gated, onboarding becomes deterministic and auditable, and admins can operate user access and monitor core workflow health without adding non-actionable vanity analytics.

## 2026-04-09 20:56:55 EDT — Add semantic job-location extraction separate from compensation

- Status: Accepted
- Context: Live testing against an Accenture posting showed that a single rendered line could contain both location text and salary text, which caused `compensation_text` to absorb location data when extraction treated the line as one compensation snippet. The product also needed users to be able to review and edit location separately in the application detail workspace.
- Decision:
  1. Add a nullable `applications.job_location_text` field that stores raw location or hiring-region text exactly as shown in the posting or manual entry.
  2. Keep the separation between `job_location_text` and `compensation_text` model-driven: extraction should use labels, surrounding context, and page meaning rather than brittle deterministic splitting rules.
  3. Leave `job_location_text` or `compensation_text` null when the page does not support a clear distinction, instead of forcing a guess.
  4. Expose `job_location_text` in manual entry and the application detail Job Information card, but keep duplicate-review behavior unchanged when only that field changes.
- Consequences: Accenture-style postings where location and salary share a line can still produce clean structured fields, the schema remains additive and backward compatible, and the extraction contract stays robust across employers that render location and compensation differently.

## 2026-04-09 20:18:29 EDT — Keep export header profile-driven, add LinkedIn explicitly, and let PDF export tighten to the saved page target

- Status: Accepted
- Context: PDF export was rendering a second header on top of the assembled Markdown header, existing drafts could still contain the legacy `# (Name)` placeholder block, and the profile contract had no first-class LinkedIn field even though the desired resume format required one. Export also ignored the saved `page_length` target, so the final PDF page count could drift more than necessary from the user’s configured length.
- Decision:
  1. Keep the user profile as the single source of truth for export header data and add `profiles.linkedin_url` as an additive nullable field.
  2. Continue storing `profiles.address`, but treat it as the short location line shown in resume assembly and export rather than a mailing-address-specific requirement.
  3. Remove the export-time duplicate-header prepend and normalize only known legacy or assembly-style header blocks during export so broken drafts recover without forcing regeneration.
  4. Require a non-blank profile `name` before initial generation, full regeneration, and PDF export, with actionable fail-closed errors instead of emitting the `# (Name)` placeholder.
  5. Read the saved draft `generation_params.page_length` during export and retry progressively tighter layout presets until the PDF fits the target page count or the minimum preset is reached.
- Consequences: Exported PDFs now stay closer to the intended reference format, profile-managed contact fields remain outside the model boundary, old broken drafts recover on export, and users get clearer recovery guidance when mandatory profile data is missing.

## 2026-04-09 20:22:31 EDT — Make new-application intake modal-based and allow optional pasted-text creation from the applications page

- Status: Accepted
- Context: The applications page still created new applications through an inline top-of-page card that accepted only a URL, while the better-looking modal intake the product needed also had to support the already-available pasted-text extraction path without forcing users through a failure-recovery detour first.
- Decision:
  1. Replace the inline applications-page intake card with a dedicated modal that matches the existing spruce/ink/ember visual language.
  2. Keep the modal URL-first: the job URL is always required and visible when the modal opens.
  3. Reveal the pasted job-description textarea only after the user explicitly clicks the secondary paste option, rather than showing it by default.
  4. Extend `POST /api/applications` so the applications page can create directly from `{ job_url, source_text }`, reusing the existing capture-backed extraction path instead of inventing a separate intake workflow.
- Consequences: New-application intake becomes more intentional and visually polished, pasted source text can improve extraction from the first submit instead of only during recovery, the database contract remains unchanged because `job_url` stays required, and the PRD plus roadmap now need to describe the dashboard flow as URL-first rather than URL-only.

## 2026-04-09 20:00:24 EDT — Allow high-only professional-experience title rewrites while keeping low and medium title-fixed

- Status: Accepted
- Context: Users wanted the highest aggressiveness setting to go beyond bullet reframing and allow professional-experience role titles to be rewritten for target-role alignment. The existing prompt contract, validator, and agent guidance treated any rewritten job title as unsupported hallucination, so the feature could not work without a coordinated rules change.
- Decision:
  1. Keep low and medium aggressiveness title-fixed: Professional Experience role titles must remain exactly as they appear in the source resume.
  2. Allow high aggressiveness to retitle Professional Experience role names only when the new title is a truthful reframing of the same source role.
  3. Preserve employer and dates exactly when role titles are rewritten, and explicitly forbid seniority inflation or invented scope through the prompt contract.
  4. Update deterministic validation so the high-aggressiveness carveout applies only to Professional Experience role-title claims; employers, dates, credentials, and other unsupported claims remain blocked.
- Consequences: High aggressiveness becomes materially more assertive for experience positioning, low and medium remain conservative, and the validator still fail-closes on invented employers, dates, credentials, or broader hallucinations.

## 2026-04-09 19:36:58 EDT — Store full posting bodies, add raw compensation text, and keep aggressiveness help compact

- Status: Accepted
- Context: Extraction was stopping at partial job-description content on some postings, which caused lower-page sections like qualifications and compensation to be dropped. The application detail page also exposed low, medium, and high aggressiveness settings without clearly showing which sections each level rewrites.
- Decision:
  1. Treat `applications.job_description` as the full primary posting body rather than a narrowed duties excerpt, and preserve more captured page text so lower-page sections remain available to extraction.
  2. Add a nullable `applications.compensation_text` field that stores raw compensation text exactly as shown in the posting or manual entry, without attempting MVP normalization into min/max or currency fields.
  3. Prefer main-content extraction targets (`main`, `article`, `[role="main"]`) before falling back to the page body, while still excluding obvious page chrome and blocked-page noise.
  4. Keep the Generation Settings card compact and expose the complete low, medium, and high behavior contract through inline popovers instead of permanently expanded copy.
- Consequences: Existing rows remain compatible without backfill, extraction gets better coverage of full postings, compensation becomes reviewable and user-editable in the detail workspace, and aggressiveness choices become clearer without making the settings rail materially taller.

## 2026-04-08 12:55:00 EDT — Make resume prompts operational, enable generation-only reasoning, and surface low-confidence upload cleanup

- Status: Accepted
- Context: The single-call generation pipeline had the right grounding and privacy posture, but the prompts were still underspecified for resume-writing quality, section-specific rewrite behavior, word-budget control, and adversarial user instructions. The upload cleanup path also had no way to signal when a badly parsed resume still needed manual review.
- Decision:
  1. Replace the prior generation prompt with a fixed five-block structure: role, non-negotiables, section rules, aggressiveness contract, and length contract.
  2. Treat the model as an expert ATS resume writer, explicitly require resume-writing best practices, forbid em dashes in model-authored resume content, and make aggressiveness section-specific: Summary and Professional Experience vary most, Skills varies by level, and Education stays fact-frozen.
  3. Replace vague page-count language with explicit word-budget targets and hard caps, plus section-level content budgets.
  4. Enable OpenRouter reasoning only for resume generation calls, using medium reasoning for initial full generation and high reasoning for full or section regeneration. Keep extraction and upload cleanup non-reasoning.
  5. Try structured output first for generation, but keep a strict prompt-level JSON contract and fall back locally when structured output or provider-specific reasoning support is not available.
  6. Add deterministic screening for unsafe user instructions that attempt to override grounding or inject new facts.
  7. Let upload cleanup return both cleaned Markdown and a minimal review-warning signal when the parsed resume still looks too degraded to trust automatically.
- Consequences: Resume prompts become more controllable and auditable, generation can spend extra reasoning budget only where quality matters most, prompt injection on user instructions is reduced before jobs start, and uploaded resumes can surface a review banner instead of silently feeding questionable parsed content into later generation steps.

## 2026-04-08 08:39:33 EDT — Move resume writing to single-call structured generation with local privacy and validation controls

- Status: Accepted
- Context: Resume generation had regressed into mediocre output, redundant OpenRouter calls, and prompt paths that could include user contact data. The existing architecture used multiple model calls to write sections and a separate model call to validate them, which increased cost and complexity while leaving privacy and async edge cases exposed.
- Decision:
  1. Use one OpenRouter call for each initial-generation, full-regeneration, or single-section-regeneration action, with the model returning strict JSON that the app splits and assembles locally.
  2. Remove personal and contact information from resume content before every external LLM call that touches resume text, and reattach the stripped header locally after deterministic validation or upload cleanup.
  3. Replace the separate validation model call with local schema and rule validation that checks section order, ATS-safety, contact leakage, grounding snippets, and unsupported date or claim drift.
  4. Allow a second model request only when the primary request fails at the provider or transport layer, or returns invalid structured output; user-requested regeneration remains the only normal user-initiated repeat path.
  5. Harden async generation callbacks with bounded callback retries, stale-job fencing, and frontend hydration of saved generation settings so retries and regenerations reuse the intended configuration.
- Consequences: Resume writing is cheaper and easier to reason about, PII stays inside the app boundary, validation becomes deterministic and fail-closed, and late or stale async updates can no longer overwrite terminal application state as easily.

## 2026-04-07 23:07:06 EDT — Treat full-generation timeouts as stalled-progress detection, not a blunt wall-clock cutoff

- Status: Accepted
- Context: Full resume generation could still be healthy after the original 90-second mark because sections complete independently, but the worker enforced a flat wall-clock timeout and the frontend kept polling forever when terminal progress could not be reconciled back into application detail.
- Decision:
  1. Keep section-level generation and validation calls individually bounded, but change full-generation timeout handling to a `90s` idle timeout with a `300s` maximum wall-clock cap.
  2. Let backend stalled-job recovery run from the polling progress endpoint so the frontend sees the terminal state directly even when a detail refresh is lagging or broken.
  3. Stop frontend generation polling once terminal progress is observed, using that terminal progress to exit the active state even if the final detail refresh fails.
- Consequences: Long-running but advancing generations get more time to finish, truly stalled jobs still fail closed, and the detail page cannot remain stuck in an infinite `progress -> detail refresh -> retry` loop after a generation timeout or failure.

## 2026-04-07 22:45:00 EDT — Separate ready-to-generate from actively-running generation and fence stale callbacks

- Status: Accepted
- Context: Applications were getting stuck in apparent generation progress because the worker callback payload shape diverged from the backend contract, the frontend treated every `generation_pending` row as actively running, and cancel or timeout recovery paths tried to write failure reasons the database enum did not allow.
- Decision:
  1. Reserve `generation_pending` for ready or retryable initial-generation states, and treat actively running generation as `generating` plus live non-terminal progress.
  2. Use nested `generated` and `failure` payloads for generation and regeneration worker callbacks so success and failure data match the backend models exactly.
  3. When cancelling or timing out a generation job, write terminal progress with a fresh synthetic job id so any late worker callback is ignored by the existing job-id fence.
  4. Extend `failure_reason_enum` with `generation_timeout` and `generation_cancelled` so cancel and timeout behavior remains explicit and schema-safe.
- Consequences: Failed or cancelled initial-generation rows stay retryable without masquerading as active jobs, stale callbacks cannot overwrite a cancelled or timed-out application, and the detail page can reliably switch from progress UI to failure or retry UI for both current and future applications.

## Phase 3 & 4: Generation, Editing, and Export (2026-04-07)

### Generation Architecture
- **Superseded on 2026-04-08**: The original section-based multi-call generation approach was replaced by single-call structured generation plus deterministic local validation and privacy sanitization.
- **Model fallback**: Primary model → fallback model on failure. Configured via GENERATION_AGENT_MODEL and GENERATION_AGENT_FALLBACK_MODEL env vars.
- **LangChain + OpenRouter**: Used ChatOpenAI from langchain-openai pointed at OpenRouter API base for model flexibility.

### Validation Pipeline
- **Hallucination detection**: LLM-based comparison of generated content against source resume to flag invented facts.
- **ATS-safety**: Rule-based checks (no tables, no images, clean Markdown).
- **Required sections + ordering**: Validates all enabled sections are present and correctly ordered.

### PDF Export
- **WeasyPrint**: Chosen for ATS-safe PDF output. Runs in thread pool with 20s timeout.
- **On-demand only**: No persistent PDF storage per PRD. Generated from latest draft content on each export request.
- **Deferred import**: WeasyPrint imported at call time to avoid breaking dev environments without native libs.

### Frontend Editing
- **Inline Markdown editor**: Edit/preview toggle in the draft card. Direct Markdown editing with save to backend.
- **react-markdown + remark-gfm**: For Markdown preview rendering with GitHub Flavored Markdown support.

### Status Management
- After export, visible_status transitions to "complete".
- After edit or regeneration post-export, status returns to "in_progress".
- `applied` flag remains independently user-controlled throughout.

## 2026-04-07 17:30:00 EDT — Phase 2 — File Format and LLM Cleanup Decisions

- Status: Accepted
- Context: Phase 2 needed concrete decisions for resume file ingestion and optional LLM post-processing before the base resume management and profile surfaces could be implemented without leaving open design gaps.
- Decisions:
  1. PDF-only resume upload for MVP (using pdfplumber). .docx support deferred to reduce scope.
  2. Optional LLM cleanup pass via direct OpenRouter API call (httpx) rather than LangChain. LangChain integration deferred to Phase 3 generation pipeline.
  3. OpenRouter cleanup model defaults to openai/gpt-4o-mini with 30-second timeout. Cleanup failures are non-blocking — raw parsed Markdown is returned on any error.
- Rationale: Keep Phase 2 focused on data management and configuration setup. PDF is the most common resume format. Direct OpenRouter call avoids premature LangChain dependency.
- Consequences: The resume upload path now accepts only `.pdf` files, the backend makes a best-effort LLM cleanup call with graceful fallback, and Phase 3 will introduce LangChain for generation rather than retrofitting it into the upload pipeline.

## 2026-04-07 15:30:43 EDT — Add blocked-source recovery and Chrome extension intake as the Phase 1A follow-on

- Status: Accepted
- Context: Phase 1 left extraction failures recoverable through retry and manual entry, but hostile job sites can return block pages instead of postings, and the product needed a compliant way to ingest job content from a user-controlled browser session without introducing a separate extension sign-in flow.
- Decision: Detect blocked pages explicitly before LLM extraction, persist sanitized blocked-source diagnostics on the application, and route recovery through pasted-text retry first and manual entry second. Add a Chrome-only Manifest V3 extension that captures current-tab content, creates new applications through a token-protected import endpoint, and receives its scoped token from the authenticated web app rather than storing Supabase session credentials.
- Consequences: The schema now needs additive storage for `applications.extraction_failure_details` and revocable hashed extension tokens on `profiles`. The detail page becomes the blocked-source recovery surface, the worker must classify block pages deterministically, and extension imports stay inside the existing per-user ownership boundary without expanding the public auth surface.

## 2026-04-07 13:15:06 EDT — Lock the Phase 1 extraction and per-agent model configuration contract

- Status: Accepted
- Context: Phase 1 needed concrete extraction behavior and a stable environment-variable contract for multiple AI agents before the worker, backend callback flow, duplicate review, and frontend recovery states could be implemented without leaving open design gaps.
- Decision: Implement extraction as a hybrid pipeline that captures deterministic page context with Playwright, sends that context to an OpenRouter-backed extraction agent for structured output, and accepts automatic extraction only when `job_title` and `job_description` validate successfully. Keep `company` optional at extraction time, defer duplicate review until company exists, and score duplicates with additional URL, reference-id, origin, and description context instead of title-company similarity alone.
- Model-config decision: Use one shared `OPENROUTER_API_KEY` plus explicit primary and fallback model environment variables per agent. Phase 1 wires the extraction agent now and reserves the same pattern for generation, validation, and future agents.
- Consequences: The worker now owns Playwright capture plus LLM extraction, the backend keeps workflow state and duplicate decisions, extraction failure cleanly falls back to manual entry, and future AI agents can be added without reworking the model configuration surface.

## 2026-04-07 12:06:48 EDT — Simplify the local env contract and separate app email from local auth email

- Status: Accepted
- Context: The initial Phase 0 stack exposed duplicated frontend, backend, worker, and local GoTrue mailer variables through the root env file even though local development only needs a small user-edited surface. The product requirement for Resend applies to app notifications, not to self-hosted local Supabase Auth delivery.
- Decision: Make the root `.env.compose` contract canonical, collapse repeated runtime toggles into shared root values, disable local GoTrue email delivery in dev mode, and reserve app-level email configuration for `EMAIL_NOTIFICATIONS_ENABLED`, `RESEND_API_KEY`, and `EMAIL_FROM`.
- Consequences: Local testing no longer depends on user-supplied SMTP or Mailpit variables, app email sending is explicitly gated in the backend, and developers only edit the reduced root env contract for normal Compose-based work.

## 2026-04-07 11:36:08 EDT — Lock Phase 0 foundation choices for implementation

- Status: Accepted
- Context: Phase 0 required concrete decisions for the local development stack, background job baseline, initial progress-delivery contract, and frontend auth persistence before code could be scaffolded without leaving major implementation gaps.
- Decision: Implement the local stack as a repo-owned Docker Compose workflow, use ARQ + Redis as the background job baseline, standardize initial progress delivery around polling, and persist frontend Supabase sessions in `sessionStorage` rather than `localStorage`.
- Consequences: The committed foundation now centers on a single root Compose + Makefile workflow, a runnable ARQ worker container, a shared polling-progress contract, and a frontend auth client that avoids browser `localStorage`. Future phases can add extraction and generation behavior without re-deciding the infrastructure baseline.

## 2026-04-07 10:00:16 EDT — Normalize job posting origin on applications

- Status: Accepted
- Context: Application intake previously relied on extracted or manually entered job title, company, and job description, while duplicate review compared only title and company. That left no structured way to record where a posting came from and made duplicate warnings less precise for postings that appear across multiple boards.
- Decision: Add a nullable normalized `job_posting_origin` field to applications, with fixed MVP values for common sources and a conditional free-text companion field when the user selects `Other`. Automatic extraction should classify the origin when confidence is sufficient; otherwise the user can provide or edit it later from manual entry or the application detail page.
- Duplicate-review rule: Consider `job_posting_origin` during duplicate evaluation when both compared applications have it populated, but do not require it. If origin is missing on either side, fall back to the existing title-and-company duplicate check.
- Consequences: The PRD, schema contract, migration runbook, and roadmap now treat posting origin as a first-class application field. Existing rows do not require a backfill and may remain `NULL` until a user or later tooling supplies the value.
