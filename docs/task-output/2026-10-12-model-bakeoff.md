# Model bake-off: generation, regeneration, section edits and Resume Judge

Full report (private page): https://claude.ai/artifact/Wu1tHJb2HNMw8D3Ux3b7eM

## Scope

The test compared seven writing models: Opus 5.5, Sonnet 5.5, Haiku 5.5, GPT-6.1 Sol, GPT-5.6 Sol, GPT-6 Luna and GPT-5.6 Luna. Gemini 3.8 Flash was added as the incumbent for section regeneration and the Resume Judge.

- **Pipeline:** the production section pipeline, with only the model in the role under test swapped.
- **Audit:** Jev plus Sonnet escalation audited every arm.
- **Fallbacks:** off, so failures counted against the model.
- **Reasoning:** effort `low` for every model.
- **Providers:** each model pinned to its fastest measured endpoint, excluding providers that keep data.
- **Resumes:**
  - the owner's real resume (contact details masked) against a real job posting
  - two fictional resumes, one of them a long 2-page resume

| Task | Runs |
| --- | --- |
| Generation | 126 |
| Section regeneration | 96 |
| Full regeneration | 21 |
| Resume Judge (corrected schema) | 160 |
| Provider probes | 29 |

Total spend was $11.14. The harness lived in a scratchpad and is not committed.

Quality was graded blind by Claude on a 1–5 rubric:

| Criterion | Weight |
| --- | --- |
| Grounding | 30% |
| Fit | 20% |
| Specificity | 20% |
| Writing | 20% |
| Length | 10% |

## Results

Quality is the weighted rubric score. Time is the median; cost is per run.

**Generation**

| Level | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 (production) | Other notes |
| --- | --- | --- | --- | --- |
| Low | 4.73 | 4.67, 9.4 s, $0.042 | 4.37 | Differences were small |
| Medium | 4.73, 20 s, $0.13 | 4.27 | 3.73, 19 s, worst score | Haiku put finished roles in present tense in 2 of 7 runs |
| High | 4.87, 26 s, $0.11 | 4.43 (production) | 4.53, $0.005 | GPT-6.1 Sol wrote the longest drafts (up to 1,382 words), median 53 s |

**Section regeneration**

- **High:** Opus scored 4.75; the next best was 4.47.
- **Low and Medium:** GPT-6 Luna scored within 0.15 of the best at about 4 s and $0.0007 a run.
- **Gemini (production):** distorted real facts at High (team size became a platform count; a metric was attached to the wrong work), and the High audit approved both.

**Resume Judge**

- **Haiku:** perfect on every calibration check: draft ordering, fabrication flagged, allowed High content accepted. 20 of 20 calls returned, at $0.0012 and 9 s.
- **GPT-5.6 Sol:** also perfect, at 10× the price.
- **Incomplete results:** five models hit HTTP 402 once the account ran out of credit, so their Judge results are partial.

**Suggested routing:**

| Task | Low | Medium | High |
| --- | --- | --- | --- |
| Generation and full regeneration | Sonnet | Opus | Opus |
| Section regeneration | GPT-6 Luna | GPT-6 Luna | Opus |
| Resume Judge | Haiku | Haiku | Haiku |

Nothing has been changed yet; this is waiting for the owner's decision.

## Defects found

1. **Production Resume Judge bug.**
   - `JudgeModelResponse.dimension_scores` is an open dictionary, so native-JSON providers (Gemini, Sonnet, Opus, Haiku) return `{}` and validation fails.
   - Every production Judge call therefore fails on Gemini, then succeeds on the GPT-6 Luna fallback.
   - Six named fields fix it; this was proven with a harness-only patch.
2. **Seniority qualifier dropped.** "(Internship)" was removed from a title in 4 runs and the audit approved it. A deterministic guard is needed.
3. **No tense check.** Nothing catches finished roles written in present tense.
4. **High audit misses moved metrics.** The audit doesn't catch real metrics reattached to a different achievement.
5. **Slow writer fallback.** GPT-6.1 Sol is the writer fallback but has the worst tail latency (50–119 s). GPT-5.6 Sol is the same price and much faster.
6. **Frequent repairs.** 55% of Medium and High generations needed a repair, against 12% at Low.
7. **Shared OpenRouter account.**
   - Local evals use the production key and account.
   - The account balance, not the key limit, ran out: $40 bought, $38.03 used, about $1.97 left.
   - A separate dev account and a low-balance alert are needed.

## Correction (2026-10-12)

An earlier version listed "length cap not enforced at High" and said GPT-6.1 Sol was over length in 7 of 7 runs. Both were measured against my own made-up thresholds of 620 and 1,050 words. The product's limits in `agents/length_policy.py` are a 700-word target maximum and an 850-word hard cap for 1 page, and 1,400 / 1,600 for 2 pages. Every draft was within the hard caps, so that item has been removed. The remaining defects were fixed with the owner's routing; see `docs/task-output/2026-10-12-bakeoff-fixes-and-routing.md`.

## Limits

- **Sample size:** three graded outputs per generation cell, plus three checked automatically.
- **What separates:** Opus at Medium and High, and Haiku at Medium, stand out clearly.
- **What doesn't:** models within about 0.2 of each other are not separable.
- **Judge:** results for five models are incomplete because of the credit limit.

Verified: 2026-10-12.
