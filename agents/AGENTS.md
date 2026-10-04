# Agents — AI Orchestration Guidance

Keep this file focused on durable AI prompt and validation rules for the AI Resume Builder. Do not add backend job orchestration details, setup steps, or provider-specific implementation tricks.

## Source of Truth
- Product behavior for generation, regeneration, validation, and grounding: `docs/resume_builder_PRD_v3.md`

## Prompt-Layer Rules
- Persist versioned section documents and deterministic Markdown projections. Resume writers return prose and source references in structured JSON; stable IDs and reviewed factual fields are copied or checked locally.
- Generation must stay grounded in the user's base resume, the job description, eligible sections, section order, generation settings, and user instructions.
- Remove personal and contact information from resume content before any external LLM call and reattach it locally after validation or formatting.
- Do not rely on provider-specific prompt syntax or model-specific features. Prompts must remain portable across OpenRouter-supported models.
- Model selection belongs in configuration, not prompt assets or code constants. Initial/full writing uses Tier 1; section writing, extraction, audits, repairs and requested quality scoring use Tier 2. Subscription plans govern request allowances only; models use default reasoning.
- Every model system prompt that authors prose must include the shared Unslop policy verbatim. Prompts whose output copies source text or returns decisions (job posting extraction, ATS keyword extraction, resume cleanup, nested entry extraction, grounding claim audit) omit it, because the policy only adds tokens and risks rewriting source wording. Grounding, privacy, exact-copy, ATS, structured-output, and operation-specific resume rules take precedence over conflicting general writing advice.
- Pydantic AI output corrections, explicit model fallback and targeted section repairs share a bounded request, token and deadline budget. Preserve validated sibling sections during repairs.

## Generation Rules
- Initial generation and full regeneration batch writable sections in a strict JSON envelope. Fixed Education and Certification facts remain local; recovery requests target only failed writable sections.
- Known section types are Summary, Professional Experience, Education, Skills, Projects, and Certifications; user-defined custom sections retain their own stable IDs and headings.
- Initial writing uses the reviewed base document inclusion/order; default full regeneration preserves saved draft structure and frozen source links. Locally preserve fixed or structurally edited sections; an explicit latest-base reset refreshes source links and layout. Generate only enabled, reviewed source-supported sections. Preserve stable section/entry identities and document order, validate many-to-many source references, and never send contact or disabled contact-bearing content externally.
- Use prompt variants that explicitly reflect the selected page-length target and aggressiveness level.
- Section regeneration requires explicit user instructions and must reject blank instruction input.
- Do not generate or rewrite personal information such as name, email, phone number, or address.
- Tailoring may reorder, rephrase, and prioritize grounded source content, but it must never invent employers, dates, tenure, credentials, or institutions. Low and Medium add no unsupported claims. High may add plausible job-fit technologies, scope, outcomes and metrics consistent with the source role, seniority and domain; the High audit checks plausibility and the identity limits instead of source support. Low aggressiveness keeps Professional Experience role titles source-exact. Medium may lightly reframe them only when the title stays grounded in the same core role family and seniority. High may retitle more freely only when the new title still matches the demonstrated work and keeps employer and dates unchanged.

## Validation Rules
- Validate structured output deterministically with schema checks plus rule-based grounding, ATS-safety, section presence, section order, and cross-section consistency checks.
- Detect contact leakage and hallucinated content, including invented employers, dates, credentials, or educational institutions not supported by the sanitized source resume. In High, plausible job-fit additions are allowed; implausible or contradicting claims still fail. Medium and high Professional Experience role-title rewrites are allowed only inside their narrow product rules; employers and dates remain invariant in every mode.
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
