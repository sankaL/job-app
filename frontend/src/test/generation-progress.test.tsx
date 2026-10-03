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

it("explains work immediately without manufacturing progress before the server responds", () => {
  vi.useFakeTimers();
  const { unmount } = render(<GenerationProgress progress={null} isOptimistic isActive={false} isCancelling={false} onCancel={vi.fn()} />);
  expect(screen.getByRole("status", { name: "Resume processing status" })).toHaveTextContent("Waiting for the first processing update");
  expect(screen.getByText("Write the tailored sections")).toBeInTheDocument();
  const progress = screen.getByRole("progressbar");
  expect(progress).not.toHaveAttribute("value");
  act(() => vi.advanceTimersByTime(25000));
  expect(progress).not.toHaveAttribute("value");
  expect(screen.getByText(/Still working/)).toBeInTheDocument();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("uses only server progress, identifies fact checks and keeps cancellation available", () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const { rerender } = render(<GenerationProgress progress={{ ...SERVER_PROGRESS, percent_complete: 85, message: "Running deterministic validation and structure checks" }} isOptimistic={false} isActive isCancelling={false} onCancel={cancel} />);
  const progress = screen.getByRole("progressbar");
  expect(progress).toHaveAttribute("value", "85");
  expect(screen.getByText("Check facts and structure").closest("li")).toHaveAttribute("aria-current", "step");
  act(() => vi.advanceTimersByTime(10000));
  expect(progress).toHaveAttribute("value", "85");
  screen.getByRole("button", { name: "Cancel" }).click();
  expect(cancel).toHaveBeenCalledOnce();
  rerender(<GenerationProgress progress={SERVER_PROGRESS} isOptimistic={false} isActive isCancelling onCancel={cancel} />);
  expect(screen.getByRole("button", { name: "Cancelling..." })).toBeDisabled();
  expect(screen.getByRole("status", { name: "Resume processing status" })).toHaveTextContent("Waiting for confirmation");
});

it("ignores terminal progress from an earlier job while a new request is starting", () => {
  vi.useFakeTimers();
  render(<GenerationProgress progress={{ ...SERVER_PROGRESS, percent_complete: 100, completed_at: "2026-07-14T00:01:00Z", message: "Resume generated" }} isOptimistic isActive={false} isCancelling={false} onCancel={vi.fn()} />);
  expect(screen.getByRole("status", { name: "Resume processing status" })).toHaveTextContent("Sending your generation request");
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText("2s")).toBeInTheDocument();
});
