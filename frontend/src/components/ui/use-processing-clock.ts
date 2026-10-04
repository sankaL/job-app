import { useEffect, useRef, useState } from "react";

/** Seconds without a new progress update before a job is described as slow. */
export const STALLED_AFTER_SECONDS = 90;

export function parseTime(value?: string | null) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

/**
 * Elapsed and idle seconds for a running job.
 *
 * Elapsed counts from the job's `startedAt` when reported, so a reload or navigation does not
 * restart the clock. Without it, both values count from when this session began. Idle is the
 * smaller of the server and local readings, so a client clock running ahead of the server cannot
 * raise a false slow-job warning.
 */
export function useProcessingClock({ active, sessionKey, startedAt, updatedAt, updateKey }: {
  active: boolean;
  sessionKey: string;
  startedAt?: string | null;
  updatedAt?: string | null;
  updateKey: string;
}) {
  const [clock, setClock] = useState({ elapsed: 0, idle: 0 });
  const sessionStart = useRef(Date.now());
  useEffect(() => {
    sessionStart.current = Date.now();
  }, [active, sessionKey]);

  useEffect(() => {
    if (!active) {
      setClock({ elapsed: 0, idle: 0 });
      return;
    }
    const changedAt = Date.now();
    const serverStart = parseTime(startedAt);
    const serverUpdate = parseTime(updatedAt);
    const tick = () => {
      const now = Date.now();
      const elapsedMs = serverStart === undefined ? now - sessionStart.current : Math.max(0, now - serverStart);
      const localIdleMs = now - changedAt;
      const idleMs = serverUpdate === undefined ? localIdleMs : Math.min(localIdleMs, Math.max(0, now - serverUpdate));
      setClock({ elapsed: Math.floor(elapsedMs / 1000), idle: Math.floor(idleMs / 1000) });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active, sessionKey, startedAt, updatedAt, updateKey]);

  return { elapsed: clock.elapsed, stalled: active && clock.idle >= STALLED_AFTER_SECONDS };
}
