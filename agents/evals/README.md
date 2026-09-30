# Synthetic section evaluations

`run_sections.py` uses the production section pipeline and Pydantic AI runtime. Every fixture is hand-written and fictional. It does not connect to Postgres, Supabase Auth, Redis, or application callbacks. LangSmith tracing is disabled inside the evaluator so its results stay local.

Default execution is offline. An `httpx.MockTransport` returns typed tool responses, including controlled failures. No real provider request is possible in this mode. Live mode requires `--live`, dev mode, a non-placeholder provider key, both configured generation models, and the HTTPS OpenRouter endpoint. Model names come from the current worker environment. This standalone runner does not load application subscription-tier overrides, so its model pair can differ from a user's Basic or Pro application workflow. Configuration checks print availability booleans only.

| Case | What it checks | Live eligible |
| --- | --- | --- |
| `full_low` | Stable sections, exact role titles, immutable employer/date/education/certification facts | Yes |
| `full_high` | Unsupported technologies and credentials in the job posting remain absent from candidate claims | Yes |
| `entry_preservation` | One source-backed role changes; manually edited, reordered, and user-added siblings remain exact | Yes |
| `keyword_preservation` | Minimal truthful keyword patches preserve matched phrases and unrelated edits | Yes |
| `schema_recovery` | A malformed envelope causes one Pydantic AI output correction | Offline only |
| `metric_recovery` | A false metric causes repair of the affected section while other sections stay valid | Offline only |
| `audit_recovery` | A semantic audit rejects invented technology and repairs only the affected section | Offline only |

The offline provider's usage values are synthetic constants. Its timing measures local orchestration, not live inference. A passing offline result verifies contracts and recovery paths; it says nothing about a model's live failure rate.

Run the regression coverage through the existing Makefile-managed Docker test service:

```sh
make test-agents TEST_ARGS='evals/test_run_sections.py -q'
```

Use the Makefile targets for configuration checks and complete offline runs:

```sh
make test-resume-evals EVAL_ARGS='--check-config'
make test-resume-evals EVAL_ARGS='--output /app/evals/results/offline.json'
```

The offline target replaces provider credentials with a test placeholder. Its credential availability check will therefore show false. For the bounded initial live sample, the separate target retains the local configured key and adds `--live`:

```sh
make eval-resumes EVAL_ARGS='--case full_low --case entry_preservation --case keyword_preservation --max-requests 8 --max-output-tokens 64000 --max-seconds 360 --max-cost-usd 0.50 --save-documents --output /app/evals/results/live-initial.json'
```

Use `--env-file` only when running outside the agents service. It loads local settings without printing their values. Do not pass credentials through CLI arguments.

The live runner has an overall maximum of eight HTTP requests, including schema corrections. It reserves each request's full output allowance before dispatch, capped at 64,000 output tokens across the run. Shared production deadlines and per-workflow limits still apply. A global deadline also stops remaining cases. `--max-requests`, `--max-output-tokens`, and `--max-seconds` may reduce these allowances.

The dollar threshold stops subsequent requests after OpenRouter reports a charged cost. It cannot prevent the last in-flight request from crossing the threshold. Missing cost metadata stops subsequent live requests. The request count and reserved token limits provide the pre-dispatch bounds; cost totals remain provider-reported rather than pricing estimates.

JSON reports contain case outcomes, deterministic check results, per-call operation/model roles, schema correction counts, repair counts, HTTP status, token usage, reported cost, and latency. They omit credentials, actual configured model names, raw prompts and raw provider payloads. By default they also omit exception messages. `--save-documents` adds only the synthetic generated documents for human review. Result files are ignored by Git.

For a provider rejection that fixed diagnostic categories cannot explain, `--diagnostic-errors` opts into evaluator-only debugging. It includes at most three extracted error-message fields, each capped at 500 characters, after masking configured credentials and models, synthetic fixture facts and contact values, and URLs. Request echoes and oversized messages are omitted. This flag is restricted to this fictional fixture runner; it does not enable provider-message logging in the application runtime. Use a one-request limit for such a diagnostic probe.

For the first live pass, inspect each saved document alongside the source fixture. Verify that technologies, outcomes, metric meanings, and permitted role-title reframes remain supported. Check whether keyword edits actually improve the document and whether the prose sounds human. The pipeline's own semantic audit is part of the measured system, not an independent truth label. Repeat the four live cases before using their outcomes to estimate reliability. A small first pass can expose failures; it cannot establish a dependable failure rate.

Import parsing and Jev classification are outside this runner. They need a separate labeled synthetic upload set with expected section boundaries, contact removal, field extraction, and reviewed/unreviewed decisions. Jev remains opt-in until that evidence exists.

## Local browser fixture

Use `make test-local-guards`, then `make test-browser`. Browser testing requires local `API_URL` and `APP_URL`, including exported shell overrides, and a stopped local agents worker. The target refuses hosted endpoints, running workers and an unknown worker state. It starts the API and frontend with a test-only provider key, email and tracing disabled.

Log in with the fictional walkthrough account and save the reviewed source described in `scripts/seed_section_walkthrough.py`. `make test-browser-seed` adds one manually authored draft without calling a provider. Reruns preserve existing edits and the stored source snapshot. `make test-browser-seed-check` exercises a fresh atomic insert and rolls it back. `make test-browser-export` verifies PDF and DOCX bytes against the latest saved fixture content and closes its temporary login session. It creates the normal local export status, activity and in-app notifications. These fixtures do not measure generation quality.
