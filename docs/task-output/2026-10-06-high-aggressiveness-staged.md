# High aggressiveness: fit the job, staged writing (2026-10-06)

## What changed
- **Contract.** High keeps each Professional Experience role's employer and dates. It retitles roles at the same seniority (any role family), may replace any bullet with work that could fit the role, employer and period, and may add job skills. Summary is written last from the tailored draft. Education and certifications stay fixed. See `HIGH_FIT_CLAIM_POLICY` and `HIGH_WRITING_RULES` in `agents/section_generation.py`, and the High entries in `agents/generation.py`.
- **Staged pipeline.** `_high_stages` runs Experience, then Projects/custom/other, then Skills + Summary (Skills first). Later stages receive `tailored_draft`. Each stage has up to three rounds, and repairs reserve budget for later stages. The request budget is 14 (`STAGED_MAX_REQUESTS`). Section regeneration at High sends the current draft's other sections as context.
- **Citations and IDs.** High bullets may cite their role's entry ID. A repeated citation, or one equal to the entry ID, gets a `tailored-<hash>` bullet ID. Worker revalidation and keyword validation accept the same.
- **Audit.** Jev High options and the LLM escalation prompt are a light fit check. High Summary/Skills evidence is the tailored resume. Title claims at High check seniority only.
- **Keywords.** The High target is 95% (`KEYWORD_COVERAGE_TARGETS`). High keyword optimization uses `HIGH_KEYWORD_CONTRACT` and the High audit. Bug fix at every level: `_keyword_contract` now passes `job_keywords` and `keyword_coverage_target` to the writer; before this, first generation and full regeneration sent `{}`.
- **UI.** The High description, details and warning in `frontend/src/lib/application-options.ts`. Resume Judge's `grounding_integrity` note covers High.

## Verification
- `agents` pytest: 370 passed. New tests cover stage order, `tailored_draft` and progress messages, entry-ID citations and tailored IDs, seniority still enforced, prose naming a new title, the keyword contract, and keyword audit per level.
- `backend` pytest: 518 passed (the High target assertion is now 95).
- Frontend: the aggressiveness hover/warning test passes; `tsc --noEmit` is clean.
- Not yet done: a live High generation to measure latency, repair rate under the light check and keyword coverage.
