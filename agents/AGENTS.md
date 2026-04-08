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
- Tailoring may reorder, rephrase, and prioritize grounded source content, but it must not invent employers, titles, dates, credentials, or institutions.

## Validation Rules
- Validate structured output deterministically with schema checks plus rule-based grounding, ATS-safety, section presence, section order, and cross-section consistency checks.
- Detect contact leakage and hallucinated content, including invented employers, job titles, dates, credentials, or educational institutions not supported by the sanitized source resume.
- Validator outcomes are limited to:
  - approve
  - fail
- Missing enabled sections, wrong section order, or hallucinated credentials must fail validation.

## Failure Posture
- Fail closed on invalid, ungrounded, or incomplete AI output.
- Do not silently coerce substantive hallucinations into acceptance.
- Preserve enough structured diagnostic context to debug failures without logging unnecessary sensitive resume or job-posting content.
- Keep AI guidance limited to durable product rules. Do not encode unresolved choices such as provider-specific prompt patterns, alternate validation policies, or future MVP expansions as if they are settled.
