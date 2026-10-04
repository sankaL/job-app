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
  it("counts elapsed time from the server job start and resets when the session changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
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

    // Job began a minute before this view mounted, as after a reload mid-generation.
    rerender(
      <GenerationProgress
        progress={{ ...SERVER_PROGRESS, created_at: "2026-07-13T23:59:00Z", updated_at: "2026-07-14T00:00:02Z" }}
        isOptimistic={false}
        isActive
        isCancelling={false}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("1m 2s")).toBeInTheDocument();

    rerender(
      <GenerationProgress
        progress={{ ...SERVER_PROGRESS, job_id: "job-2", created_at: "2026-07-14T00:00:02Z", updated_at: "2026-07-14T00:00:02Z" }}
        isOptimistic={false}
        isActive
        isCancelling={false}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("0s")).toBeInTheDocument();
  });

  it("warns about slow progress after 90 seconds without an update and clears when one arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
    const props = { isOptimistic: false, isActive: true, isCancelling: false, onCancel: vi.fn() };
    const { rerender } = render(<GenerationProgress progress={SERVER_PROGRESS} {...props} />);
    act(() => vi.advanceTimersByTime(89_000));
    expect(screen.queryByRole("status", { name: "Slow progress notice" })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("status", { name: "Slow progress notice" })).toHaveTextContent("This is taking longer than usual. You can stop and try again.");
    rerender(<GenerationProgress progress={{ ...SERVER_PROGRESS, percent_complete: 35, message: "Drafting sections", updated_at: "2026-07-14T00:01:30Z" }} {...props} />);
    expect(screen.queryByRole("status", { name: "Slow progress notice" })).not.toBeInTheDocument();
  });

  it("does not warn when the local clock runs ahead of the server timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:10:00Z"));
    render(<GenerationProgress progress={SERVER_PROGRESS} isOptimistic={false} isActive isCancelling={false} onCancel={vi.fn()} />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.queryByRole("status", { name: "Slow progress notice" })).not.toBeInTheDocument();
  });
});

it("explains work immediately and eases the bar from zero before the server responds", () => {
  vi.useFakeTimers();
  const { unmount } = render(<GenerationProgress progress={null} isOptimistic isActive={false} isCancelling={false} onCancel={vi.fn()} />);
  expect(screen.getByRole("status", { name: "Resume processing status" })).toHaveTextContent("Waiting for the first processing update");
  expect(screen.queryByText("Processing steps")).not.toBeInTheDocument();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  expect(screen.getByTestId("resume-generation-skeleton")).toBeInTheDocument();
  const progress = screen.getByRole("progressbar");
  expect(progress).toHaveAttribute("aria-valuenow", "0");
  act(() => vi.advanceTimersByTime(25000));
  const eased = Number(progress.getAttribute("aria-valuenow"));
  expect(eased).toBeGreaterThan(60);
  expect(eased).toBeLessThan(94);
  expect(screen.getByText("You\'ll be able to review and edit the result before using it.")).toBeInTheDocument();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("never shows less than server progress, identifies fact checks and keeps cancellation available", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
  const cancel = vi.fn();
  const { rerender } = render(<GenerationProgress progress={{ ...SERVER_PROGRESS, percent_complete: 85, message: "Running deterministic validation and structure checks" }} isOptimistic={false} isActive isCancelling={false} onCancel={cancel} />);
  const progress = screen.getByRole("progressbar");
  expect(screen.getByRole("status", { name: "Resume processing status" })).toHaveTextContent("Running deterministic validation and structure checks");
  act(() => vi.advanceTimersByTime(10000));
  expect(progress).toHaveAttribute("aria-valuenow", "85");
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
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText("2s")).toBeInTheDocument();
});

it("shows a section skeleton immediately and respects the reported workflow after reconnecting", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
  const { rerender } = render(<GenerationProgress progress={null} scope="section" isOptimistic isActive={false} isCancelling={false} onCancel={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "Updating your resume section" })).toBeInTheDocument();
  expect(screen.getByTestId("resume-generation-skeleton")).toHaveAttribute("data-scope", "section");
  expect(screen.getByTestId("resume-generation-skeleton")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  rerender(<GenerationProgress progress={SERVER_PROGRESS} scope="section" isOptimistic={false} isActive isCancelling={false} onCancel={vi.fn()} />);
  expect(screen.getByTestId("resume-generation-skeleton")).toHaveAttribute("data-scope", "resume");
  act(() => vi.advanceTimersByTime(5000));
  expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(20);
  rerender(<GenerationProgress progress={{ ...SERVER_PROGRESS, workflow_kind: "regeneration_section" }} isOptimistic={false} isActive isCancelling={false} onCancel={vi.fn()} />);
  expect(screen.getByTestId("resume-generation-skeleton")).toHaveAttribute("data-scope", "section");
});

it("shows verified sections in place of skeleton blocks while generation continues", () => {
  render(
    <GenerationProgress
      progress={{ ...SERVER_PROGRESS, partial_sections: [
        { id: "summary", kind: "summary", heading: "Summary", content_md: "Quality engineering leader." },
      ] }}
      isOptimistic={false}
      isActive
      isCancelling={false}
      onCancel={() => {}}
    />,
  );
  const ready = screen.getAllByTestId("ready-section");
  expect(ready).toHaveLength(1);
  expect(ready[0]).toHaveTextContent("Summary");
  expect(ready[0]).toHaveTextContent("Quality engineering leader.");
});

it("drops partial sections once the job reaches a terminal state", () => {
  render(
    <GenerationProgress
      progress={{ ...SERVER_PROGRESS, completed_at: "2026-07-14T00:01:00Z", partial_sections: [
        { id: "summary", kind: "summary", heading: "Summary", content_md: "Quality engineering leader." },
      ] }}
      isOptimistic={false}
      isActive={false}
      isCancelling={false}
      onCancel={() => {}}
    />,
  );
  expect(screen.queryByTestId("ready-section")).not.toBeInTheDocument();
});
