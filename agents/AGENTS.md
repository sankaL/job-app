# Agents — AI Orchestration Guidance

Keep this file focused on durable AI prompt and validation rules for the AI Resume Builder. Do not add backend job orchestration details, setup steps, or provider-specific implementation tricks.

## Source of Truth
- Product behavior for generation, regeneration, validation, and grounding: `docs/resume_builder_PRD_v3.md`

## Prompt-Layer Rules
- Persist versioned section documents and deterministic Markdown projections. Resume writers return prose and source references in structured JSON; stable IDs and reviewed factual fields are copied or checked locally.
- Generation must stay grounded in the user's base resume, the job description, eligible sections, section order, generation settings, and user instructions.
- Remove personal and contact information from resume content before any external LLM call and reattach it locally after validation or formatting.
- Do not rely on provider-specific prompt syntax or model-specific features. Prompts must remain portable across OpenRouter-supported models.
- Model selection belongs in the role-based `shared/model-config.json` (bundled as `agents/model-config.json`; keep the copies identical), not prompt assets, code constants or environment variables. Look models up by role through `model_config.route(...)`; per-model reasoning, output mode and provider routing come from the same file. Subscription plans govern request allowances only.
- Every model system prompt that authors prose must include the shared Unslop policy verbatim. Prompts whose output copies source text or returns decisions (job posting extraction, ATS keyword extraction, resume cleanup, nested entry extraction, grounding claim audit) omit it, because the policy only adds tokens and risks rewriting source wording. Grounding, privacy, exact-copy, ATS, structured-output, and operation-specific resume rules take precedence over conflicting general writing advice.
- Pydantic AI output corrections, explicit model fallback, targeted section repairs and LLM audit escalations share one bounded budget per workflow: 10 requests, a 64k output-token allowance (16k per call) and the 240s/120s deadline. Jev audit calls do not count toward the request limit. Hidden reasoning is bounded per model in the config file. A repair round starts only when its writes plus one audit fit. Preserve validated sibling sections during repairs.

## Generation Rules
- Initial generation and full regeneration write in two concurrent groups: Professional Experience, and all other writable sections. Each group uses a strict JSON envelope and is audited as soon as it is written; one group failing never discards the other's validated sections. Fixed Education and Certification facts remain local; recovery requests target only failed writable sections. Verified sections are reported for progressive display.
- Grounding audit: the `claim_audit` role judges each claim first; confident results are final and only uncertain claims escalate to the `audit_escalation` LLM audit, which also covers every section when the claim audit is unavailable. Everything sent to either auditor is privacy-masked. Re-run the labelled evaluation before changing audit thresholds. Mechanics: `docs/prompts.md`.
- When a section still cannot be verified after the bounded repairs, initial generation and full regeneration keep its original text with `generation_notice: kept_original_unverified` instead of failing. They still fail when every writable section would be kept. Targeted section/entry regeneration and keyword optimization still fail.
- Known section types are Summary, Professional Experience, Education, Skills, Projects, and Certifications; user-defined custom sections retain their own stable IDs and headings.
- Initial writing uses the reviewed base document inclusion/order; default full regeneration preserves saved draft structure and frozen source links. Locally preserve fixed or structurally edited sections; an explicit latest-base reset refreshes source links and layout. Generate only enabled, reviewed source-supported sections. Preserve stable section/entry identities and document order, validate many-to-many source references, and never send contact or disabled contact-bearing content externally.
- Use prompt variants that explicitly reflect the selected page-length target and aggressiveness level.
- Section regeneration requires explicit user instructions and must reject blank instruction input.
- Do not generate or rewrite personal information such as name, email, phone number, or address.
- Tailoring may reorder, rephrase, and prioritize grounded source content, but it must never invent employers, dates, tenure, credentials, or institutions. Low and Medium add no unsupported claims. High may add plausible job-fit technologies, scope, outcomes and metrics consistent with the source role, seniority and domain; the High audit checks plausibility and the identity limits instead of source support. Low aggressiveness keeps Professional Experience role titles source-exact. Medium may lightly reframe them only when the title stays grounded in the same core role family and seniority. High may retitle more freely only when the new title still matches the demonstrated work and keeps employer and dates unchanged.

## Validation Rules
- Validate structured output deterministically with schema checks plus rule-based grounding, ATS-safety, section presence, section order, and cross-section consistency checks.
- Detect contact leakage and hallucinated content, including invented employers, dates, credentials, or educational institutions not supported by the sanitized source resume. In High, plausible job-fit additions are allowed; implausible or contradicting claims still fail. Medium and high Professional Experience role-title rewrites are allowed only inside their narrow product rules; employers and dates remain invariant in every mode.
- Local privacy checks report specific codes (`contact_information_email`, `_phone_like_number`, `_profile_url`, `_profile_value`) so repairs know what to rephrase.
- Validator outcomes are limited to:
  - approve
  - fail
- Missing eligible sections, wrong section order, or hallucinated credentials must fail validation.

## Failure Posture
- Fail closed on invalid, ungrounded, or incomplete AI output.
- Do not silently coerce substantive hallucinations into acceptance.
- Preserve enough structured diagnostic context to debug failures without logging unnecessary sensitive resume or job-posting content.
- Keep AI guidance limited to durable product rules. Do not encode unresolved choices such as provider-specific prompt patterns, alternate validation policies, or future MVP expansions as if they are settled.

## Documentation Requirements (CRITICAL)
- **Any change to agent logic** (generation, validation, extraction, or AI orchestration) **must** update `docs/prompts.md` in the same task.
- Documentation must include:
  - Updated prompt structure and template text
  - Parameters and payload schema changes
  - Behavioral changes and their intended effects
  - New prompt variants or removed variants
- This applies to all prompt modifications, including system prompts, human payloads, operation variants, aggressiveness levels, target lengths, and section permutations.
- Never modify agent logic without simultaneously updating the prompt catalog.
