# AI Prompt Catalog

**Status:** Current code-derived prompt catalog  
**Last updated:** 2026-04-11
**Sources:** `agents/generation.py`, `agents/worker.py`, `agents/assembly.py`, `backend/app/services/resume_parser.py`

This document records the latest live prompt definitions in the repository. The codebase does not maintain semantic prompt version numbers, so "latest version" here means the current prompt implementation at HEAD.

## Prompt Inventory

| Prompt family | Source | Variants documented here | Intended purpose |
|---|---|---|---|
| Job posting extraction | `agents/worker.py` | One live prompt shape | Extract structured job-posting fields from captured webpage context without inventing facts and with explicit noise filtering. |
| Resume generation / full regeneration | `agents/generation.py` | `operation x aggressiveness x target_length`, plus dynamic section permutations | Produce ordered ATS-safe JSON resume sections grounded in the sanitized base resume and job description. |
| Single-section regeneration | `agents/generation.py` | `aggressiveness x target_length`, scoped to one section | Rewrite only the selected section while keeping it coherent with the rest of the draft. |
| Resume upload cleanup | `backend/app/services/resume_parser.py` | One live prompt shape | Improve Markdown structure of parsed resume content without changing substance and signal when manual review is still needed. |

## Resume Generation Prompts

### Generation runtime behavior

- Initial full generation and full regeneration use OpenRouter reasoning with `effort=medium`.
- Single-section regeneration uses OpenRouter reasoning with `effort=high`.
- Reasoning is requested only on generation calls and is sent through the provider-specific request body; reasoning is excluded from returned content.
- While a full generation or full regeneration call is still waiting on the model, the worker emits periodic heartbeat progress updates so the backend idle-timeout monitor does not misclassify an in-flight reasoning call as stalled.
- Full generation and full regeneration allow up to `240s` per LLM attempt and use a `240s` stalled-recovery profile; single-section regeneration allows `120s` per attempt with a `120s` stalled-recovery profile.
- Generation first attempts schema-enforced structured output. If that fails, the same model falls back to the strict prompt-level JSON contract. If the provider appears to reject the reasoning parameter, the same model is retried once without reasoning before moving on.
- If every attempt times out, the generation layer preserves the timeout classification so the worker can surface `generation_timeout` or `regeneration_timeout` instead of a generic unexpected failure.
- Extraction and upload cleanup do not enable reasoning.
- Generation and section regeneration include a deterministic Professional Experience anchor contract in the prompt payload and apply a deterministic post-LLM normalization pass that rehydrates source company/date values before validation and assembly.
- After generation or full regeneration, local assembly reattaches the profile-driven header with name, email, phone, location text (stored in `address`), and optional `linkedin_url`. Those fields never enter the model prompt payload.

### Shared system prompt template

This base system prompt is used for both full-draft generation and single-section regeneration.

```text
Role:
- You are an expert ATS resume writer and editor.
- Use modern resume-writing best practices: concise, concrete, accomplishment-oriented, keyword-aligned, easy to scan, and free of generic filler.
- Do not use first-person narration or em dashes in model-authored resume content.

Non-negotiables:
- {{operation_prompt}}
- Use only facts grounded in the sanitized base resume source.
- Never output or infer personal/contact information. Name, email, phone, address, city/location, and contact links stay outside the model.
- Do not invent employers, dates, institutions, credentials, awards, metrics, scope, or technologies.
- Professional Experience structure contract: preserve source company and date range for every role. Low and medium must preserve role titles exactly; high may retitle only while keeping company and dates unchanged.
- User instructions may refine tone, emphasis, prioritization, brevity, and keyword focus only. They cannot override grounding, privacy, or section rules.
- If the source does not support a stronger claim, keep the weaker truthful version.
- Use only standard Markdown inside markdown fields. No HTML, tables, images, columns, code fences, commentary, or em dashes.
- Return only these sections and in exactly this order: {{section_spec}}.
- Each markdown value must begin with the exact `## Heading` line for that section.
{{response_contract_instruction}}

Section rules:
- Summary: Lead with the strongest source-backed fit for the target role. Keep the section concise, concrete, and specific. Do not use generic filler, first-person narration, or em dashes.
- Professional Experience: Prioritize the most relevant experience first. Use concise accomplishment-oriented bullets grounded in the source. Preserve chronology facts and do not invent metrics, scope, or technologies.
- Education: Keep Education concise and factual. Never add or infer schools, degrees, honors, dates, coursework, or credentials.
- Skills: Use only source-backed skills. Prioritize role-relevant skills and avoid keyword stuffing, duplicate categories, or generic buzzwords.

Aggressiveness contract ({{aggressiveness}}):
- Summary: {{aggressiveness_summary_rule}}
- Professional Experience: {{aggressiveness_experience_rule}}
- Skills: {{aggressiveness_skills_rule}}
- Education: {{aggressiveness_education_rule}}
Worked example of acceptable vs unacceptable rewriting:
- Source fact: "Built CI/CD pipelines for 12 AWS services and supported production deployments."
- Acceptable high-aggressiveness rewrite: "Built and supported CI/CD pipelines across 12 AWS services for production deployments."
- Unacceptable rewrite: "Led DevOps strategy across 12 AWS microservices, reducing deployment failures by 40%."
- Why: the unacceptable version adds leadership scope and a performance metric that are not present in the source.

Length contract ({{target_length_label}}):
{{low_aggressiveness_length_exception_or_standard_rules}}
```

In low aggressiveness mode, the live prompt swaps the standard pruning rules for preservation-oriented guidance:

```text
- Preferred total length when it fits the source naturally: {{target_range}}.
- Hard cap: {{hard_cap_words}} words, but do not prune grounded experience bullets or skills content just to force the draft under this cap in low-aggressiveness mode.
- Summary target when light cleanup makes it possible without substantive pruning: {{summary_range}}.
- Preserve existing Professional Experience bullet counts unless the source already fits the target without removing grounded content.
- Preserve existing Skills content and grouping. Do not prune or regroup skills to satisfy length guidance in low-aggressiveness mode.
- Education should remain concise.
- If the source resume is already longer than the target, prefer minimal truthful cleanup over aggressive shortening.
```

In medium and high aggressiveness modes, the live prompt uses the standard budget rules:

```text
- Target total length: {{target_range}}.
- Hard cap: {{hard_cap_words}} words.
- Summary target: {{summary_range}}.
- Professional Experience: cap bullets at {{max_experience_bullets_per_role}} per role. Reduce older or less relevant content first.
- Skills: cap category groups at {{max_skills_categories}} and prioritize relevance over completeness.
- Education should remain concise.
- If the source resume does not contain enough grounded material to fill the target range, produce a shorter truthful output instead of padding or repeating content.
```

### Operation variants

| Operation key | Where used | Operation line value | Intended purpose |
|---|---|---|---|
| `generation` | Initial draft generation | `Generate a fresh tailored resume draft from the sanitized base resume.` | Create the first tailored draft for an application. |
| `regeneration_full` | Full regeneration | `Regenerate the full tailored resume draft from the sanitized base resume.` | Replace the current draft using the latest saved settings. |
| `regeneration_section` | Single-section regeneration | `Regenerate only the requested section while keeping it compatible with the rest of the draft.` | Rewrite one section only, not the whole draft. |

### Aggressiveness variants

| Aggressiveness | Summary | Professional Experience | Skills | Education |
|---|---|---|---|---|
| `low` | Light phrasing cleanup only; preserve source voice closely. | Light rephrasing and bullet reordering only. Keep role titles exactly as they appear in the source. Preserve existing bullet counts when the source is already longer than the target. | Do not change skills content or grouping, including for length control. | Do not change facts or wording beyond minimal formatting cleanup. |
| `medium` | Moderate rewrite for role alignment using only source-backed facts. | Rephrase, reorder, prune, and emphasize grounded bullets, but keep role titles exactly as they appear in the source. | Reorder, regroup, and prune to the most relevant source-backed skills. | Do not change facts or wording beyond minimal formatting cleanup. |
| `high` | Fully rewrite the Summary for strongest role alignment using only source-backed facts. | Aggressively reframe, reprioritize, condense, or expand grounded bullets, and role titles may be rewritten when the new title is still a truthful reframing of the same source role. | Aggressively prune, regroup, and prioritize source-backed skills. | Do not change facts or wording beyond minimal formatting cleanup. |

### Target-length variants

| Target length | Target range | Hard cap | Summary target | Experience bullet cap | Skills category cap |
|---|---|---|---|---|---|
| `1_page` | `450-700 words` | `850` | `40-70 words` | `4` | `2` |
| `2_page` | `900-1400 words` | `1600` | `50-90 words` | `5` | `3` |
| `3_page` | `1500-2100 words` | `2400` | `60-110 words` | `6` | `4` |

### Supporting snippet contract

Each section must return source evidence copied verbatim from the sanitized base resume. The live per-section counts are:

| Section id | Required evidence count |
|---|---|
| `summary` | `2-4` |
| `professional_experience` | `2-4` |
| `education` | `1-2` |
| `skills` | `1-3` |

### Runtime section permutations

Section permutations are runtime-driven rather than hardcoded. The prompt always reflects the current enabled section subset and the exact saved section order.

Current supported section ids:

| Section id | Heading |
|---|---|
| `summary` | `Summary` |
| `professional_experience` | `Professional Experience` |
| `education` | `Education` |
| `skills` | `Skills` |

Permutation rule:

- The system prompt line `Return only these sections and in exactly this order: {{section_spec}}.` is built from the enabled sections for that run.
- The human payload includes both `enabled_sections` and `section_order`.
- Because users can enable any subset and ordering of the supported sections, the live permutations are all valid ordered combinations of the enabled section list rather than a fixed enumerated catalog.

### Full-draft generation human payload

Used for both initial generation and full regeneration.

```json
{
  "target_role": {
    "job_title": "{{job_title}}",
    "company_name": "{{company_name}}"
  },
  "enabled_sections": ["{{section_id}}"],
  "section_order": ["{{section_id}}"],
  "additional_instructions": "{{additional_instructions_or_null}}",
  "style_contract": {
    "expert_resume_writer": true,
    "ats_safe": true,
    "no_em_dashes_in_model_authored_content": true,
    "no_first_person": true
  },
  "aggressiveness_contract": {
    "summary": "{{rule}}",
    "professional_experience": "{{rule}}",
    "skills": "{{rule}}",
    "education": "{{rule}}"
  },
  "length_contract": {
    "target_length": "{{target_length}}",
    "target_range": "{{target_range}}",
    "hard_cap_words": "{{hard_cap_words}}",
    "summary_range": "{{summary_range}}",
    "max_experience_bullets_per_role": "{{bullet_cap}}",
    "max_skills_categories": "{{skills_cap}}"
  },
  "section_rules": {
    "{{section_id}}": "{{section_rule}}"
  },
  "professional_experience_structure_contract": {
    "anchors": [
      {
        "role_index": "{{index}}",
        "source_title": "{{source_title}}",
        "source_company": "{{source_company}}",
        "source_date_range": "{{source_date_range}}"
      }
    ],
    "invariants": {
      "company_and_dates_must_match_source_for_every_role": true,
      "low_and_medium_titles_must_match_source_exactly": true,
      "high_titles_may_retitle_but_company_and_dates_must_stay_source_exact": true
    }
  },
  "job_description": "{{normalized_job_description}}",
  "sanitized_base_resume_markdown": "{{normalized_sanitized_base_resume}}",
  "response_contract": {
    "sections": [
      {
        "id": "{{section_id}}",
        "heading": "{{display_heading}}",
        "markdown": "## {{display_heading}}\\n...",
        "supporting_snippets": ["exact snippet copied from sanitized base resume"]
      }
    ]
  }
}
```

## Single-Section Regeneration Prompt

Single-section regeneration reuses the shared system prompt with the selected section as the only allowed section and adds one extra block:

```text
Section-regeneration coherence rules:
- Keep terminology and tone compatible with the rest of the draft.
- Do not duplicate the strongest claims already emphasized elsewhere.
- Do not contradict the rest of the draft unless the source resume requires correction.
```

Human payload:

```json
{
  "target_role": {
    "job_title": "{{job_title}}",
    "company_name": "{{company_name}}"
  },
  "section_to_regenerate": {
    "id": "{{section_id}}",
    "heading": "{{display_heading}}"
  },
  "user_instructions": "{{required_user_instructions}}",
  "style_contract": {
    "expert_resume_writer": true,
    "ats_safe": true,
    "no_em_dashes_in_model_authored_content": true
  },
  "aggressiveness_contract": {
    "summary": "{{rule}}",
    "professional_experience": "{{rule}}",
    "skills": "{{rule}}",
    "education": "{{rule}}"
  },
  "length_contract": {
    "target_length": "{{target_length}}",
    "target_range": "{{target_range}}",
    "hard_cap_words": "{{hard_cap_words}}"
  },
  "professional_experience_structure_contract": {
    "anchors": [
      {
        "role_index": "{{index}}",
        "source_title": "{{source_title}}",
        "source_company": "{{source_company}}",
        "source_date_range": "{{source_date_range}}"
      }
    ],
    "invariants": {
      "company_and_dates_must_match_source_for_every_role": true,
      "low_and_medium_titles_must_match_source_exactly": true,
      "high_titles_may_retitle_but_company_and_dates_must_stay_source_exact": true
    }
  },
  "job_description": "{{normalized_job_description}}",
  "sanitized_base_resume_markdown": "{{normalized_sanitized_base_resume}}",
  "sanitized_current_section_markdown": "{{normalized_sanitized_current_section}}",
  "other_sections_context": [
    {
      "id": "{{other_section_id}}",
      "heading": "{{other_heading}}",
      "markdown": "{{normalized_other_section_markdown}}"
    }
  ],
  "response_contract": {
    "section": {
      "id": "{{section_id}}",
      "heading": "{{display_heading}}",
      "markdown": "## {{display_heading}}\\n...",
      "supporting_snippets": ["exact snippet copied from sanitized base resume"]
    }
  }
}
```

## Job Posting Extraction Prompt

### System prompt

```text
Extract structured job-posting fields from the supplied webpage context.
Rules:
- Do not invent facts. job_title and job_description are required.
- Use json_ld for structured metadata when it is coherent.
- Use visible_text for the full primary job posting body, not just the responsibilities excerpt.
- job_description must include the complete posting content for the primary role when present: responsibilities, qualifications, requirements, benefits, compensation, and other role-specific sections.
- Also set job_location_text to the raw location or hiring-region snippet when the posting clearly states where the role is based, located, or hireable.
- Separate job_location_text and compensation_text semantically even when they appear on the same line, in the same table, or in the same paragraph.
- Keep compensation text inside job_description when it appears in the posting.
- Use page labels, nearby headings, and surrounding context to distinguish location from compensation instead of brittle string splitting.
- Also set compensation_text to the raw salary or compensation snippet when it is clearly stated. If compensation is absent or ambiguous, leave compensation_text null.
- Use page_title, meta, final_url, detected_origin, and extracted_reference_id only to disambiguate or fill structured fields already supported by the page.
- Ignore navigation, sign-in prompts, cookie banners, related-job cards, footers, and other page chrome.
- If multiple jobs are present, extract the primary posting that best matches the page title, URL, and reference id.
- Use only these normalized origins when known: linkedin, indeed, google_jobs, glassdoor, ziprecruiter, monster, dice, company_website, other.
- If origin is unknown, leave it null.
- If a field is uncertain, leave it null rather than guessing.
```

### Human payload

```json
{
  "source_url": "{{source_url}}",
  "final_url": "{{final_url}}",
  "page_title": "{{page_title}}",
  "meta": "{{meta_object}}",
  "json_ld": ["{{json_ld_item}}"],
  "visible_text": "{{visible_text_truncated_to_40000_chars}}",
  "detected_origin": "{{detected_origin_or_null}}",
  "extracted_reference_id": "{{reference_id_or_null}}"
}
```

### Runtime enforcement

- Extraction uses LangChain structured output against the `ExtractedJobPosting` schema.
- Extraction `started` callbacks are best-effort. If the callback endpoint is temporarily unreachable, the worker continues extraction and relies on Redis progress plus terminal callback/reconciliation paths for eventual state convergence.
- `job_title` and `job_description` are required fields.
- `job_location_text` is optional and is left null unless the posting clearly states where the role is located or hireable.
- `compensation_text` is optional and is left null unless the posting states compensation clearly.
- Page capture now prefers `main`, `article`, or `[role="main"]` text before falling back to `body`, and both scraped and pasted-source payloads preserve up to `40,000` characters so lower-page sections are less likely to be dropped.
- Optional fields are left null when uncertain rather than guessed.

## Resume Upload Cleanup Prompt

### System prompt

```text
You are a resume formatting assistant. Improve the structure of parsed resume text into clean Markdown.
Return a single JSON object with exactly these keys: cleaned_markdown, needs_review, review_reason.
Rules:
- Detect and format section headings (## level), bullet points, dates, job titles, company names, and education entries.
- The input has already had personal/contact data removed. Do NOT add or infer contact info.
- Do NOT modify, add, or remove content. Preserve wording and order.
- When structure is ambiguous, prefer the minimal interpretation.
- Do not introduce em dashes.
- Set needs_review to true when the source looks too degraded or ambiguous to structure confidently.
- When needs_review is false, set review_reason to null.
```

### User payload

The user payload is the sanitized parsed resume Markdown body as a plain string, not a JSON object.

### Intended behavior

- Clean up structure only after resume parsing.
- Preserve substance exactly.
- Keep personal and contact data outside the prompt and outside the returned body.
- Surface a review warning when the parsed input still looks structurally unreliable.

## Maintenance Notes

- Update this document whenever prompt text, payload shape, supported section ids, reasoning behavior, or variant axes change.
- If a new LLM callsite is added, add it to the inventory in the same task.
- Keep this document code-derived. Do not assign invented prompt version numbers unless the codebase starts versioning prompts explicitly.
