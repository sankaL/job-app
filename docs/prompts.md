# AI Prompt Catalog

**Status:** Current code-derived prompt catalog  
**Last updated:** 2026-04-08  
**Sources:** `agents/generation.py`, `agents/worker.py`, `backend/app/services/resume_parser.py`

This document records the latest live prompt definitions in the repository. The codebase does not maintain semantic prompt version numbers, so "latest version" here means the current prompt implementation at HEAD.

## Prompt Inventory

| Prompt family | Source | Variants documented here | Intended purpose |
|---|---|---|---|
| Job posting extraction | `agents/worker.py` | One live prompt shape | Extract structured job-posting fields from captured webpage context without inventing facts. |
| Resume generation / full regeneration | `agents/generation.py` | `operation x aggressiveness x target_length`, plus dynamic section permutations | Produce ordered ATS-safe JSON resume sections grounded in the sanitized base resume and job description. |
| Single-section regeneration | `agents/generation.py` | `aggressiveness x target_length`, scoped to one section | Rewrite only the selected section while keeping it compatible with the rest of the draft. |
| Resume upload cleanup | `backend/app/services/resume_parser.py` | One live prompt shape | Improve Markdown structure of parsed resume content without changing substance or restoring contact data. |

## Resume Generation Prompts

### Shared system prompt template

This base system prompt is used for both full-draft generation and single-section regeneration.

```text
You are an ATS-focused resume writing assistant.
Operation: {{operation_prompt}}
Length profile: {{target_length_guidance}}
Tailoring profile: {{aggressiveness_prompt}}
Hard requirements:
- Use only facts grounded in the sanitized base resume source.
- Never output or infer personal/contact information. Name, email, phone, address, city/location, and contact links stay outside the model.
- Do not invent employers, titles, dates, institutions, credentials, awards, or technologies.
- Use only standard Markdown. No HTML, tables, images, columns, code fences, or commentary.
- Return only these sections and in exactly this order: {{section_spec}}.
- Return valid JSON only. No prose before or after the JSON object.
- Every section must include 1 to 6 supporting_snippets copied verbatim from the sanitized base resume. Those snippets must justify the section's claims.
- Each markdown value must begin with the exact `## Heading` line for that section.
```

### Operation variants

| Operation key | Where used | Operation line value | Intended purpose |
|---|---|---|---|
| `generation` | Initial draft generation | `Generate a fresh tailored resume draft from the sanitized base resume.` | Create the first tailored draft for an application. |
| `regeneration_full` | Full regeneration | `Regenerate the full tailored resume draft from the sanitized base resume.` | Replace the current draft using the latest saved settings. |
| `regeneration_section` | Single-section regeneration | `Regenerate only the requested section while keeping it compatible with the rest of the draft.` | Rewrite one section only, not the whole draft. |

### Aggressiveness variants

| Aggressiveness | Prompt text | Intended behavior |
|---|---|---|
| `low` | `Preserve the original voice closely. Make small keyword and phrasing adjustments only when the job description clearly justifies them.` | Conservative tailoring with minimal rewriting. |
| `medium` | `Reorder and rephrase grounded content to align with the role. Improve keyword alignment and emphasis without changing the underlying facts.` | Balanced tailoring and keyword alignment. |
| `high` | `Rewrite assertively for fit and impact while staying strictly grounded in the source. Mirror important job language when the source supports it.` | Stronger reframing while remaining grounded. |

### Target-length variants

| Target length | Prompt text | Intended behavior |
|---|---|---|
| `1_page` | `Keep the total draft concise and selective so it is likely to fit on one page.` | Prefer brevity and selectivity. |
| `2_page` | `Allow moderate detail and fuller bullet coverage so the total draft can span up to two pages.` | Allow a moderate level of detail. |
| `3_page` | `Allow fuller detail and supporting bullets so the total draft can span up to three pages when needed.` | Permit the fullest grounded detail. |

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

### Single-section regeneration prompt

Single-section regeneration reuses the shared system prompt with the selected section as the only allowed section and appends one extra requirement:

```text
- Return an object shaped as {"section": {...}}.
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
  "job_description": "{{normalized_job_description}}",
  "sanitized_base_resume_markdown": "{{normalized_sanitized_base_resume}}",
  "sanitized_current_section_markdown": "{{normalized_sanitized_current_section}}",
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
Extract job-posting fields from the supplied webpage context. Do not invent facts. job_title and job_description are required. Use only these normalized origins when known: linkedin, indeed, google_jobs, glassdoor, ziprecruiter, monster, dice, company_website, other. If origin is unknown, leave it null.
```

### Human payload

```json
{
  "source_url": "{{source_url}}",
  "final_url": "{{final_url}}",
  "page_title": "{{page_title}}",
  "meta": "{{meta_object}}",
  "json_ld": ["{{json_ld_item}}"],
  "visible_text": "{{visible_text_truncated_to_15000_chars}}",
  "detected_origin": "{{detected_origin_or_null}}",
  "extracted_reference_id": "{{reference_id_or_null}}"
}
```

### Intended behavior

- Extract a strict structured job posting from captured page context.
- Require `job_title` and `job_description`.
- Normalize origin to the allowed enum set when known.
- Leave unknown values null instead of guessing.

## Resume Upload Cleanup Prompt

### System prompt

```text
You are a resume formatting assistant. Your job is to improve the structure of parsed resume text into clean Markdown. Detect and format section headings (## level), bullet points, dates, job titles, company names, education entries. The input has already had personal/contact data removed. Do NOT add or infer contact info. Do NOT modify, add, or remove any content - only improve formatting and structure. Return only the formatted Markdown body without personal/contact header lines.
```

### User payload

The user payload is the sanitized parsed resume Markdown body as a plain string, not a JSON object.

### Intended behavior

- Clean up structure only after resume parsing.
- Preserve substance exactly.
- Keep personal and contact data outside the prompt and outside the returned body.

## Maintenance Notes

- Update this document whenever prompt text, payload shape, supported section ids, or variant axes change.
- If a new LLM callsite is added, add it to the inventory in the same task.
- Keep this document code-derived. Do not assign invented prompt version numbers unless the codebase starts versioning prompts explicitly.
