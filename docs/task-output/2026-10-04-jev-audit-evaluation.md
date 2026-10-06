# Jev grounding-audit evaluation (2026-10-04)

**Purpose:** decide whether the Jev decision model (`typesafe/jev-1.13`, OpenRouter Decisions API) can replace the LLM grounding audit, and choose the routing thresholds. The user chose to favour speed: occasional misses at Medium are acceptable.

## Method
- **Harness:** `agents/evals/jev_audit_eval.py` (`make eval-jev-audit`). It reuses the production question builder, batching and routing in `agents/jev_audit.py`.
- **Data:** 76 source bullets. They came from the fictional fixture, six Sonnet-generated fictional resumes (nurse, marketing, accounting, data analyst, teacher, SRE) and one private reviewed resume. The private resume was used locally only; its text is not in this report or the repo.
- **Labelled variants per bullet (684 claims):**
  - original
  - faithful rewrite
  - overstated ownership or scope
  - plausible addition (tool, metric or outcome)
  - implausible addition (unrelated field or unrealistic scale)
  - deterministic injections: employer, credential, tenure, seniority
- **Labels:** at Medium only the original and faithful versions pass. At High the overstated and plausible additions also pass.
- **Routing:** P(pass option) ≥ accept → accept. P ≤ reject → reject, with the most likely failure code. Anything in between escalates to the LLM audit.

## Results at the chosen thresholds (accept 0.80, reject 0.20)

| Level | Invented or invalid claims caught | Accepted wrongly | Good claims rejected | Escalated |
|---|---|---|---|---|
| Medium | 99.2% | 0% | 0% | 1.2% |
| High | 96.6% | 0% | 9.5% | 7.6% |

- **Gates passed:** Medium needed ≥80% caught and ≤10% false rejects. High needed ≥90% caught and ≤10% false rejects. High therefore uses Jev for plausibility too.
- **High false rejects** are mostly the "overstated ownership" variant. Whether that counts as acceptable at High is debatable; Jev splits it.
- **Speed:** about 1.3–1.4s for 684 claims across 114 batches running in parallel. A real resume (19–25 claims) takes 0.25–1.1s. Cost is about $0.0001 per call.

## Real drafts (three earlier model outputs for one resume)

**Two fixes found during evaluation:**
- **Small batches.** A verbatim bullet scored P=0.34–0.42 inside a 20-claim batch, but 0.80–0.85 alone. Batches are now capped at 6 claims and run in parallel.
- **Whole-role evidence.** Evidence is now the cited bullet plus the whole reviewed role, which raised that same bullet to 0.97–0.98.

**After the fixes:**
- Medium escalates 2–3 claims per resume (about 10%), mostly Summary/Skills sentences.
- The known invented phrase ("engineering milestones across continuous integration pipelines") is **rejected**.
- The known overclaim ("owns … go or no-go release decisions") **escalates** (P=0.34), so the LLM audit judges it.

## Decision
- Use Jev as the first-pass auditor at all levels, with thresholds (0.80, 0.20).
- Escalate only uncertain claims to the Sonnet LLM audit, and fall back to the full LLM audit when Jev is unavailable.
- Retitled roles always use the LLM audit, which judges a title against the whole role.

**Spend:** about $0.22 for Sonnet dataset generation plus about $0.05 for Jev, across all runs.

## Follow-up (2026-10-06): Summary and Skills claims

**Why:** every Medium production generation from Oct 4–6 (5 of 5) needed a repair. Four were caused by Jev rejecting true claims, and all four were Summary sentences or Skills groups, which the bullet-only dataset never covered:
- Two Summary sentences named facts the writer had not cited: the earliest employer, and languages listed only under Skills.
- Two Skills groups copied word for word from the source were rejected with confidence 0.88–0.92.

**Changes:**
- Summary and Skills evidence is now the whole rendered reviewed resume, with the evidence cap raised to 12,000 characters.
- Skills labels and items that equal a label or item of the reviewed Skills section are accepted locally; Jev judges only the rest.
- The Sonnet escalation audit receives the whole reviewed source for Summary and Skills.

**Dataset v2** (`jev-dataset-v2.json`): the 549 bullet claims plus 77 Summary sentences and 76 Skills groups from the fixture and six fictional resumes. Summary evidence imitates production's partial citations (the Summary source and the most recent role). Each row is scored as production now sends it and as before the change. Cost: $0.28 Sonnet dataset and $0.03 Jev per scoring pass.

| Level | Kind | Good claims rejected (before → now) | Invented claims accepted (before → now) | Escalated (now) |
|---|---|---|---|---|
| Medium | Summary | 90.5% → **0%** | 0% → 0% | 5.2% |
| Medium | Skills | 0% → 0% | 2.6% → **0%** | 7.9% |
| High | Summary | 46.9% → 22.4% (all overstated) | 0% → 0% | 15.6% |
| High | Skills | 1.8% → 1.8% | 0% → 0% | 17.1% |

- 19 of 76 Skills groups were accepted locally, none of them invented. After code review, local matching was narrowed from words anywhere in the resume to whole items of the reviewed Skills section. A re-score of the saved dataset ($0.03 Jev) gave the same 19 local accepts, none invented, and identical Medium Skills results. The fictional skills groups did not reproduce the production verbatim-list failure, so the production re-check below matters more for Skills.
- An intermediate design appended only role headers and Skills to the cited text. It still rejected 47.6% of faithful Medium Summary sentences, because they used facts from earlier roles' bullets.

**Production re-check:** all 40 traced Summary/Skills claims from the 6 production generations were re-scored against the real reviewed resume (3,815 characters).
- All 4 previous rejections are now accepted (P = 0.92–1.00).
- Escalations fell from 8 to 3. One sentence moved from P 0.80–0.81 to 0.77–0.78, which is noise at the accept threshold.
- Claim text was read only in the session and is not recorded here.

**High reject threshold:** this pass did not change it. Lowering it to 0.12 would have cut bullet false rejects from 9.8% to 4.5%. However, every High false reject is the debatable "overstated ownership" variant, and the one production High run had no claim below 0.58. It stays 0.20.
