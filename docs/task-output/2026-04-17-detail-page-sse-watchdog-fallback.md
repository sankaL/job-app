# 2026-04-17 — Detail-page SSE with watchdog fallback

## Scope

- Replaced detail-page polling-first workflow updates with a per-application SSE stream for extraction, generation, regeneration, and Resume Judge state.
- Kept the existing Redis progress contract, terminal reconciliation, and stalled-job recovery paths intact.
- Preserved 5-second detail/progress polling as a watchdog and reconnect fallback.

## Backend

- Added `GET /api/applications/{application_id}/events` as an authenticated `text/event-stream` endpoint.
- Extended the Redis progress store to publish workflow `progress` events automatically whenever progress records are written.
- Added best-effort `detail` event publishing from backend state transitions that matter to the detail page, including:
  - extraction started / success / failure
  - generation started / success / failure
  - regeneration started / success / failure
  - Resume Judge queued / running / success / failure
  - duplicate-resolution transitions and progress-cache reconciliations
- Stream connections send a reconciled initial snapshot and periodic heartbeats.

## Frontend

- Added a fetch-based SSE client and `useApplicationEventStream` hook so the app can stream with the existing bearer-token auth model.
- Wired the hook into the application detail page and pushed live `detail` and `progress` events into the shared React Query cache.
- Kept the existing detail-page terminal handling logic in place by continuing to consume React Query data rather than building a second state machine.
- Slowed watchdog polling from 3 seconds to 5 seconds and added progress-event deduping so stream + polling do not double-process the same terminal payload.

## Verification

- `python3 -m pytest tests/test_phase1_applications.py -q`
- `npm --prefix frontend test -- --run src/test/applications.test.tsx -t "updates generation progress from live stream events|updates the Resume Judge card from live detail events"`
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json` from `frontend/`

## Notes

- The full `frontend/src/test/applications.test.tsx` suite still contains older UI assertions unrelated to this transport change; I updated only the focused cases needed to cover the new SSE behavior in this task.
