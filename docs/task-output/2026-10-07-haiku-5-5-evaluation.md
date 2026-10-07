# Claude Haiku 5.5 evaluation and Low/Medium writer switch

Claude Haiku 5.5 (`anthropic/claude-haiku-5.5`) was released on 2026-10-07. On OpenRouter it costs $0.10/$0.50 per million input/output tokens, against $2/$10 for Sonnet 5.5. This task tested whether it can replace Sonnet in the three roles Sonnet held: `resume_writer`, `repair_writer` and `audit_escalation`.

## Method

All data was fictional. Runs used the production section pipeline through `agents/evals/run_sections.py`, with the worker's production routing keys, so the Jev claim audit ran first. Only Sonnet's three roles were swapped, and Haiku received Sonnet's exact profile (native JSON, 2,000-token reasoning cap). There were two resumes:

- A: the existing tech fixture (2 roles, 5 bullets).
- B: a customer-success resume (4 roles, 14 bullets) with a job posting that asks for unsupported tools (Salesforce, Gainsight, SQL), a language and credentials (PMP, MBA).

Extra checks on every run: employers and dates unchanged, Low titles exact, no first person, and no trap credentials (at High) or trap skills (Low/Medium). The production Resume Judge (Gemini 3.8 Flash) scored each draft. The comparison harness was a scratchpad script and is not committed.

## Pre-existing blocker

Pydantic-ai 2.52.0 (and the latest release, 2.54.0) allows native JSON-schema output only for Claude models on a hard-coded name list, and Haiku 5.5 is missing from it. A config-only switch made every Haiku call fail locally with `UserError` in under 0.1 s. The pipeline then used the GPT 6.1 Sol fallback without any visible error. The first smoke test showed exactly this. `portable_openrouter_profile` now treats the config's `native_json` mode as authoritative. Apart from that flag, the resulting profile is identical to the SDK default (verified for Sonnet and Haiku).

## Generation: 36 runs

| Resume / level | Sonnet median time | Haiku median time | Sonnet cost | Haiku cost | Repairs (S / H) |
| --- | ---: | ---: | ---: | ---: | --- |
| A Low | 7.5 s | 8.9 s | $0.027 | $0.0015 | 0 / 0 |
| A Medium | 12.2 s | 10.2 s | $0.030 | $0.0020 | 0 / 0 |
| A High | 16.0 s | 25.5 s | $0.031 | $0.0028 | 0 / 2 |
| B Low | 5.9 s | 9.2 s | $0.027 | $0.0021 | 0 / 1 |
| B Medium | 9.8 s | 11.8 s | $0.035 | $0.0032 | 1 / 1 |
| B High | 27.8 s | 25.3 s | $0.064 | $0.0035 | 4 / 0 |

- Both models passed 18/18 runs, with no calls served by a fallback model.
- Mean Resume Judge score: Sonnet 81.4, Haiku 81.1.
- Total cost: Sonnet $0.64, Haiku $0.045.
- Haiku emitted 2-3x more output tokens than Sonnet. This is probably hidden reasoning, which would explain why it is not faster.

Reading the drafts side by side, Low and Medium were indistinguishable. At High, Sonnet added specific, believable detail (query plans, indexes, CI). Haiku repeated earlier bullets and once contradicted itself ("45 mid-market enterprise SaaS accounts"). The Resume Judge did not separate the two.

## Audit escalation: 72 labelled claims

These were claims from `jev-dataset-v2.json` whose Jev P(pass) fell between 0.20 and 0.80, the ones production escalates to the LLM audit. Each was sent through `_llm_grounding_audit`, one claim per call.

| | Sonnet 5.5 | Haiku 5.5 |
| --- | --- | --- |
| Medium correct (12) | 12 | 11 (1 faithful claim rejected) |
| High correct (60) | 53 | 53 |
| High implausible additions approved (of 17) | 1 | 4 |
| Median time per audit | 1.6-1.9 s | 3.3 s |

Haiku approves more claims that could not fit the role, which is the failure the High audit exists to catch. Sonnet stays as the auditor.

## Not measured

- **Key limit:** the OpenRouter key hit its $10 monthly limit during the follow-up tests. Every later call returned HTTP 403 in about 0.1 s, so the remaining 70 audit claims were discarded. The local agents container uses the same key as Railway production (matching key hashes), so production calls were also rejected until the limit was raised to $50. A separate development key is needed.
- **Jev unavailable:** the audit path where the LLM checks every section had no valid data.
- **Reasoning cap:** Haiku with a 600-token cap or with reasoning off produced only two valid runs each. One run with reasoning off was about twice as fast, which proves nothing.
- **Real resumes and more repetitions:** samples this small cannot establish failure rates.

## Change

- **Per-level override:** `RoleRoute.by_aggressiveness` adds an optional override for writer and audit roles. It is validated like the base route, and its fallback is inherited when omitted. `route(role, aggressiveness)` applies it, and an unknown level fails closed.
- **Config:** `resume_writer` and `repair_writer` use Haiku 5.5, with High pointing to Sonnet 5.5. The fallback stays GPT 6.1 Sol, and `audit_escalation` is unchanged.
- **Worker:** the worker resolves first writers, repairs and pipeline routing keys with the job's aggressiveness.
- **Eval runner:** the live runner picks the first writer per case aggressiveness.
- **Tests:**
  - Agents: 399 passed. New cases cover per-level routing, override validation, the unknown level, and Haiku native output. The Haiku case was confirmed to fail without the runtime fix.
  - Backend: 529 passed.

## Live verification after the change

The live eval runner used the committed config with no harness patches, after the key's limit was raised. `full_low`, `full_high`, `entry_preservation` and `keyword_preservation` all passed every check, with every request answered by its configured primary model (HTTP 200, no fallbacks). The costs confirm the routing: `full_low` cost $0.0036, consistent with Haiku (Sonnet averaged $0.027 on this case), and `full_high` cost $0.068, consistent with Sonnet. This runner does not pass the worker's audit keys, so its LLM audit used the case's writer model; production uses `audit_escalation` (Sonnet).

Verified: 2026-10-07 17:23 EDT.
