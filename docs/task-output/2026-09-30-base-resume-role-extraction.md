# Base resume role extraction repair

Completed 2026-09-30 22:57:20 EDT.

## Root cause and evidence

The reported local source used company/location and role/date rows without Markdown pipes. The local adapter could not create entries. AI assistance had been enabled for this upload, but live reproduction failed: primary output did not cover all requested section IDs, fallback output violated exact-source excerpt checks, and both exhausted their 10s correction slices. Work experience and education remained editable text with a warning. The source contained three roles at the same employer and an internship at another employer.

## Implementation

- Enable configured Tier 2 extraction by default for all populated Experience/Education sections. Keep explicit `use_llm_cleanup=false` opt-out and update the upload checkbox text.
- Replace opaque factual dictionaries with explicit typed employment/education schemas. Send numbered nonblank source lines; receive inclusive role and duty line spans.
- Copy duty text locally, removing bullet markers and joining wrapped lines with spaces. Preserve spelling, metrics, technology suffixes and extracted hyphenation. The model identifies structure rather than transcribing duties.
- Require all requested section IDs once, contiguous role spans, facts copied from each role's own header, separate dated headers, ordered/nonoverlapping duty spans, separate source bullets, and exact word/number coverage per role. Copy missing optional dates/locations as empty strings; accept single-year education dates.
- Build all replacements before mutating sections; assign local stable IDs. Preserve exact section source text and explicit review gates. The timeout fallback also discards suspicious local projections.
- Keep the 30s upload window. Primary nested extraction gets 65% of remaining time, fallback gets the remaining deadline, and identical configured model names produce one invocation. Existing two-request correction and token limits remain. Auth/billing rejection stops fallback.

## Live verification and local repair

An intermediate typed-fields result succeeded on fallback in 27.33s. Returning duty spans instead of duty text then succeeded on the primary configured Tier 2 model in 11.60s; total import including classification took 11.89s with no warning.

Validated four roles with duty counts 5, 4, 4 and 2, exact company/location/title/date bindings, and one education entry with its source graduation year. The owner-scoped service saved only the reported unreviewed local import from revision 1 to revision 2 under an expected-revision fence. Original section text, headings, IDs, inclusion, contacts and raw extracted text were preserved. It still requires user review. Browser verification showed four distinct role entries and all duties under the correct headers.

The stack was rebuilt/refreshed through the Makefile with active ports preserved; API and frontend health passed. The first restart attempt's port allocator tried to reassign ports belonging to the running stack. Stopped before service changes, restored the original configuration and skipped that allocator during the refresh. No secrets or private resume body were added to repository fixtures or diagnostic output.

## Review and regression checks

Self-reviewed the final diff for role association, privacy, timeout/fallback behavior, schema portability, ownership, revision fencing and compatibility. Addressed these findings:

- Source coverage across the whole section could accept wrong-role duties or swapped facts. Validate within each entry span and require facts in its header.
- Source-reference assembly could merge separate bullets. Reject spans containing multiple source bullet markers.
- Timeout fallback could expose a suspicious local partial entry. Clear it while retaining source text.
- A duplicated primary/fallback configuration could reattempt incorrectly. Deduplicate models and use a one-invocation deadline.
- Invalid injected-provider output could bypass fallback. Apply validation inside the attempt loop and mutate only after the complete result passes.

Full Makefile suites passed 438 backend, 231 worker and 218 frontend tests, totaling 887. Frontend type check and production build passed. Two additional review regressions for identical models and atomic sibling validation were added afterward; the final focused import/upload/document suite passed 101 tests. Whitespace checks and Makefile health checks passed.

Synthetic fixtures cover repeated employers, plain headers, wrapped duties, single graduation years, missing dates, default/opt-out upload behavior, wrong-role duties/titles/dates, wrong field kinds, merged headers/bullets, gaps/overlaps, source omission, unsupported rewritten duty output, provider correction/fallback, rejected credentials and atomic section replacement. The existing backend/worker document-contract equality check passed.

## Compatibility and limits

No SQL migration or stored document schema change. Source spans are transient extraction evidence. Existing imports and generated snapshots are not bulk-rewritten; only the reported local source was repaired. Production deployment was outside this task.

The live test used the stored text from the actual upload; the original PDF bytes are not retained by the app. This verifies role extraction on that source, rather than an end-to-end replay of the original PDF upload. One live sample does not establish reliability across other layouts. Unclear or degraded source, or unsupported structures such as roles whose employer appears only in a shared heading, may remain text for manual review. All accepted imported facts still require review before generation.
