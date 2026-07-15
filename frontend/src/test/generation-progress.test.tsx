import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationProgress } from "@/components/ui/generation-progress";
import type { ExtractionProgress } from "@/lib/api";

const SERVER_PROGRESS: ExtractionProgress = {
  job_id: "job-1",
  workflow_kind: "generation",
  state: "running",
  message: "Generating resume",
  percent_complete: 20,
  created_at: "2026-07-14T00:00:00Z",
  updated_at: "2026-07-14T00:00:00Z",
  completed_at: null,
  terminal_error_code: null,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("generation progress", () => {
  it("resets elapsed time when the active generation session changes", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <GenerationProgress
        progress={null}
        isOptimistic
        isActive
        isCancelling={false}
        onCancel={vi.fn()}
      />,
    );

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("2s")).toBeInTheDocument();

    rerender(
      <GenerationProgress
        progress={SERVER_PROGRESS}
        isOptimistic={false}
        isActive
        isCancelling={false}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("0s")).toBeInTheDocument();
  });
});
