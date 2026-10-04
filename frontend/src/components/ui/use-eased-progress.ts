import { useEffect, useRef, useState } from "react";
import { parseTime } from "./use-processing-clock";

/** Ceiling for the elapsed-time estimate; a higher reported percentage raises the target. */
export const EASED_PROGRESS_CEILING = 94;

/**
 * Perceived progress after `seconds` of work. A fast exponential carries the bar to 70% in
 * the first 15 seconds, and a slow one adds the rest, so it keeps creeping toward the ceiling
 * without ever reaching it: 82% at 1 minute, 88% at 2 minutes, 94% only as time approaches infinity.
 */
export function easedProgress(seconds: number) {
  const t = Math.max(0, seconds);
  return 70 * (1 - Math.exp(-t / 5)) + (EASED_PROGRESS_CEILING - 70) * (1 - Math.exp(-t / 90));
}

const TICK_MS = 200;
const CATCH_UP = 0.2;

/**
 * A progress value that moves quickly at first and then slows, so a running job feels responsive.
 *
 * The value follows elapsed time, counted from the job's reported start so a reload does not
 * restart the bar, and it never moves backwards. The target is at least the reported percentage;
 * the displayed value catches up smoothly when a server update is higher,
 * and the bar only reaches 100 once the job reports 100. Inactive jobs return undefined; callers
 * show the reported value instead.
 */
export function useEasedProgress({ enabled, sessionKey, startedAt, reported, provisional = false }: {
  enabled: boolean;
  sessionKey: string;
  startedAt?: string | null;
  reported?: number;
  /** True while the key is a placeholder (before the job exists); its progress carries into the real job. */
  provisional?: boolean;
}) {
  const [value, setValue] = useState(0);
  const shown = useRef(0);
  const sessionStart = useRef(Date.now());
  const reportedRef = useRef(reported);

  useEffect(() => {
    reportedRef.current = reported;
  });

  const previous = useRef({ sessionKey, provisional, enabled });

  useEffect(() => {
    const prior = previous.current;
    previous.current = { sessionKey, provisional, enabled };
    // A placeholder session becoming the real job is the same run: keep the bar where it is.
    if (enabled && prior.enabled && prior.provisional && prior.sessionKey !== sessionKey) return;
    shown.current = 0;
    sessionStart.current = Date.now();
    setValue(0);
  }, [enabled, sessionKey]);

  useEffect(() => {
    if (!enabled) return;
    const serverStart = parseTime(startedAt);
    const tick = () => {
      const seconds = (Date.now() - (serverStart ?? sessionStart.current)) / 1000;
      const real = reportedRef.current ?? 0;
      const target = real >= 100 ? 100 : Math.max(easedProgress(seconds), real);
      const gap = target - shown.current;
      const next = gap <= 0.05 ? Math.max(shown.current, target) : shown.current + gap * CATCH_UP;
      if (next === shown.current) return;
      shown.current = next;
      setValue(Math.round(next));
    };
    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled, startedAt]);

  return enabled ? value : undefined;
}
