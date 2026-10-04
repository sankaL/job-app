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
