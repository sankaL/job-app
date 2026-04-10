# Agents — AI Orchestration Guidance

Keep this file focused on durable AI prompt and validation rules for the AI Resume Builder. Do not add backend job orchestration details, setup steps, or provider-specific implementation tricks.

## Source of Truth
- Product behavior for generation, regeneration, validation, and grounding: `docs/resume_builder_PRD_v3.md`

## Prompt-Layer Rules
- All generated resume content must be Markdown.
- Generation must stay grounded in the user's base resume, the job description, enabled sections, section order, generation settings, and user instructions.
- Remove personal and contact information from resume content before any external LLM call and reattach it locally after validation or formatting.
- Do not rely on provider-specific prompt syntax or model-specific features. Prompts must remain portable across OpenRouter-supported models.
- Model selection belongs in configuration, not prompt assets or code constants.
- If the primary OpenRouter model fails or returns invalid structured output, allow one retry using the configured fallback model before treating the operation as failed.

## Generation Rules
- Initial generation and full regeneration must use a single LLM call that returns a strict JSON envelope for all enabled sections in order.
- MVP default sections are Summary, Professional Experience, Education, and Skills.
- Generate only enabled sections and preserve the requested section order in the returned JSON.
- Use prompt variants that explicitly reflect the selected page-length target and aggressiveness level.
- Section regeneration requires explicit user instructions and must reject blank instruction input.
- Do not generate or rewrite personal information such as name, email, phone number, or address.
- Tailoring may reorder, rephrase, and prioritize grounded source content, but it must not invent employers, dates, credentials, or institutions. High aggressiveness may retitle Professional Experience role names only when the new title remains a truthful reframing of the same source role and keeps employer and dates unchanged.

## Validation Rules
- Validate structured output deterministically with schema checks plus rule-based grounding, ATS-safety, section presence, section order, and cross-section consistency checks.
- Detect contact leakage and hallucinated content, including invented employers, dates, credentials, or educational institutions not supported by the sanitized source resume. High-aggressiveness Professional Experience role-title rewrites are allowed only inside that narrow product rule.
- Validator outcomes are limited to:
  - approve
  - fail
- Missing enabled sections, wrong section order, or hallucinated credentials must fail validation.

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
