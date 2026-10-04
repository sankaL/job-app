import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EASED_PROGRESS_CEILING, easedProgress, useEasedProgress } from "@/components/ui/use-eased-progress";

afterEach(() => vi.useRealTimers());

describe("easedProgress", () => {
  it("starts at zero, passes 70% in the first 15 seconds and slows afterwards", () => {
    expect(easedProgress(0)).toBe(0);
    expect(easedProgress(15)).toBeGreaterThanOrEqual(70);
    const early = easedProgress(15) - easedProgress(5);
    const late = easedProgress(45) - easedProgress(35);
    expect(late).toBeLessThan(early / 4);
  });

  it("only rises and never reaches the ceiling", () => {
    let previous = -1;
    for (let seconds = 0; seconds <= 3600; seconds += 5) {
      const value = easedProgress(seconds);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(previous).toBeLessThanOrEqual(EASED_PROGRESS_CEILING);
    expect(easedProgress(86_400)).toBeLessThanOrEqual(EASED_PROGRESS_CEILING);
  });
});

describe("useEasedProgress", () => {
  it("moves in small steps instead of jumping, and never goes backwards", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEasedProgress({ enabled: true, sessionKey: "job-1" }));
    const seen: number[] = [result.current as number];
    for (let step = 0; step < 100; step += 1) {
      act(() => vi.advanceTimersByTime(200));
      seen.push(result.current as number);
    }
    expect(seen[0]).toBeLessThan(10);
    seen.forEach((value, index) => { if (index) expect(value).toBeGreaterThanOrEqual(seen[index - 1]); });
    expect(Math.max(...seen.slice(1).map((value, index) => value - seen[index]))).toBeLessThan(15);
    expect(seen[seen.length - 1]).toBeGreaterThan(60);
  });

  it("follows reported progress when it is ahead and finishes only when the job reports 100", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ reported }) => useEasedProgress({ enabled: true, sessionKey: "job-1", reported }), { initialProps: { reported: 85 as number | undefined } });
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toBeGreaterThanOrEqual(80);
    act(() => vi.advanceTimersByTime(600_000));
    expect(result.current).toBeGreaterThanOrEqual(85);
    expect(result.current).toBeLessThan(100);
    rerender({ reported: 20 });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBeGreaterThanOrEqual(85);
    rerender({ reported: 100 });
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(100);
  });

  it("counts from the server start, resets for a new session, stops when disabled and cleans up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:05:00Z"));
    const { result, rerender, unmount } = renderHook(
      ({ enabled, sessionKey, startedAt }) => useEasedProgress({ enabled, sessionKey, startedAt }),
      { initialProps: { enabled: true, sessionKey: "job-1", startedAt: "2026-07-14T00:00:00Z" as string | undefined } },
    );
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toBeGreaterThan(80);
    rerender({ enabled: true, sessionKey: "job-2", startedAt: undefined });
    expect(result.current).toBe(0);
    rerender({ enabled: false, sessionKey: "job-2", startedAt: undefined });
    expect(result.current).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    rerender({ enabled: true, sessionKey: "job-2", startedAt: undefined });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
