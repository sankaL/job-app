# Bake-off routing and defect fixes

This task follows `docs/task-output/2026-10-12-model-bakeoff.md`. The owner chose the routing below and asked for every confirmed defect to be fixed.

## Routing (`shared/model-config.json`, with identical copies in agents and backend)

| Role | Low / Medium | High | Fallback |
| --- | --- | --- | --- |
| `resume_writer` | Sonnet 5.5 | Haiku 5.5 | GPT-5.6 Sol |
| `repair_writer` | Sonnet 5.5 | Haiku 5.5 | GPT-5.6 Sol |
| `section_writer` | GPT-6 Luna | Sonnet 5.5 | Haiku 5.5 |
| `keyword_writer` (new) | Sonnet 5.5 | Sonnet 5.5 | GPT-5.6 Sol |
| `resume_judge` | Haiku 5.5 | Haiku 5.5 | GPT-6 Luna |

- **Reasoning:** Sonnet, Haiku, GPT-6 Luna and GPT-5.6 Sol now use effort `low`, as tested. Gemini keeps medium.
- **Provider order:**
  - Sonnet: `anthropic`, `azure/global`
  - Haiku: `azure/global`, `anthropic`
  - GPT-6 Luna: `openai`, `azure`
  - GPT-5.6 Sol: `openai`
  - Gemini stays pinned to `google-ai-studio`.
  - No `/fast` tier is configured, and a test enforces this.
- **New role:** keyword optimization has its own `keyword_writer` role (owner request). `section_writer` would otherwise have put it on GPT-6 Luna, which the bake-off never tested on keyword patches. The worker and the live eval runner route `keyword_optimization` to it.
- **Removed:** GPT-6.1 Sol is no longer used, so its profile is gone.
- **Unchanged:** the audit roles and the extraction and import roles.

## Fixes

1. **Resume Judge schema** (`agents/resume_judge.py`).
   - `JudgeDimensionScores` names the six dimensions as required fields.
   - `JudgeRegenerationInstructions` gives each supported section an optional list.
   - Normalization, the "Unsupported regeneration instruction section" error and the persisted result shape are unchanged.
   - Before this fix, native JSON-schema providers returned `dimension_scores: {}`, so every production Judge call failed on Gemini.
2. **Seniority** (`agents/experience_contract.py`). Internship, co-op and coop now carry seniority rank 0. "Student" was dropped after code review: it names who a job serves ("Student Success Advisor"), not seniority. A dropped "(Internship)" fails at Medium and High.
3. **Present tense in ended roles** (`agents/section_generation.py`).
   - The new `present_tense_past_role` check rejects a bullet when its role's date range has ended and the bullet starts with a listed base-form verb.
   - Same-form irregulars such as cut, set and put are not listed.
   - A cited source that starts with the same verb keeps the user's voice.
   - `RESUME_VOICE_RULE` asks for past tense in ended roles.
4. **High number reuse.** The rule against reusing a source number for different work or a different quantity was added to:
   - `HIGH_FIT_CLAIM_POLICY` (High writer and LLM audit)
   - the High audit's failure list (`unsupported_metric`)
   - Jev's High `implausible_claim` definition
5. **Medium repairs.** `STRICT_CLAIM_POLICY` now states the audit's own rules: number context, job requirements are not evidence, and the title reframe rule.
6. **Eval spend guard** (`agents/evals/run_sections.py`, `agents/evals/jev_audit_eval.py`).
   - A live run first reads the key's `limit_remaining` and the account's credits.
   - It refuses below `--min-remaining-usd` (default $20), and also refuses when either balance can't be read.
   - The key is never echoed.

## Not changed

- **High length enforcement:** the bake-off's length finding was wrong. All drafts were within `length_policy.py`'s hard caps, and both the report and the summary were corrected.
- **Local number-provenance check for High:** the observed distortions kept the number in its cited bullet, so a local check would not catch them. The fix lives in the prompt and audit wording.

## Verification

- **Agents tests:** 429 passed (before docs); the final run is recorded in the build plan.
  - New tests cover per-level routing, Judge routing, low reasoning, no fast tiers, the Judge schema and empty-dict rejection, internship and co-op titles, tense, the High and strict policy wording, and the spend guard.
  - A worker test now reads the expected route from the config.
- **Backend tests:** 529 passed.
- **Offline evals:** 7 of 7 passed.
- **Live check of the committed config** (after the credit top-up; about $0.24 in total; the guard floor was lowered to $10 for this run):
  - **Generation** on the fictional customer-success resume. Low and Medium were served by Sonnet (Anthropic); High by Haiku (Azure). Repairs used Sonnet at Medium and Haiku at High; the escalation audit used Sonnet. Every call returned HTTP 200, with no model fallbacks and no failed checks.
  - **Section edits.** Low was served by GPT-6 Luna (OpenAI, about 3 s, $0.0006). High was served by Sonnet (Anthropic), with Haiku repairs (Azure).
  - **Keyword optimization** (`keyword_preservation`). The keyword writer ran on Sonnet ($0.020 for about 8,500 input tokens) and all checks passed.
  - **Resume Judge on Haiku (Azure).** 20 of 20 calls succeeded on the first request with the fixed schema.
    - Fabrications were flagged on all three resumes, with grounding scores of 2–4 out of 10.
    - The allowed High content was not penalized.
    - Weak drafts scored lowest.
    - On the real resume, the untailored copy (69.0) scored above the strong draft (66.5). That is within the 0–3 point drift between repeats, so Haiku separates close drafts less reliably than it ranks extremes.
  - **Jev at High** after the wording change, on 702 labelled claims at the production thresholds (0.80/0.20):

    | Measure | 6 Oct | Now |
    | --- | --- | --- |
    | Bad claims accepted | 0% | 0% |
    | Good claims wrongly rejected | 9.4% | 4.3% |
    | Bad claims caught by Jev alone | 95.7% | 91.5% |
    | Escalated to the LLM audit | 10.7% | 11.5% |

    Seniority rejections rose from 51 to 57 of 61, and the pass gate still passes. The labelled set has no reused-number variant, so this shows no regression rather than a measured benefit. Report: `agents/evals/results/jev-audit-report-v2-2026-10-12.json` (dataset copy, so the 2026-10-06 baseline is kept).
