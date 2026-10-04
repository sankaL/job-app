import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { JobExtractionProgress } from "@/components/ui/resume-processing";

afterEach(() => vi.useRealTimers());

it("shows job extraction immediately, rotates explanations and uses only reported percentages", () => {
  vi.useFakeTimers();
  const { rerender, unmount } = render(<JobExtractionProgress progress={null} isCancelling={false} />);
  expect(screen.getByRole("progressbar", { name: "Job extraction progress" })).not.toHaveAttribute("aria-valuenow");
  expect(screen.getByRole("status", { name: "Job extraction status" })).toHaveTextContent("Waiting for the first update");
  expect(screen.getByTestId("resume-generation-skeleton")).toHaveAttribute("aria-hidden", "true");
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByText("Relevant skills and responsibilities help shape your tailored resume.")).toBeInTheDocument();
  rerender(<JobExtractionProgress progress={{ job_id: "job-1", message: "Reading the job requirements", percent_complete: 42 }} isCancelling={false} />);
  expect(screen.getByText("0s")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  act(() => vi.advanceTimersByTime(30000));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  rerender(<JobExtractionProgress progress={{ job_id: "job-1", message: "Reading the job requirements", percent_complete: 42 }} isCancelling />);
  expect(screen.getByRole("status", { name: "Job extraction status" })).toHaveTextContent("Stopping extraction. Waiting for confirmation.");
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("offers a Stop extraction button on the card that follows the cancelling state", async () => {
  const onCancel = vi.fn();
  const { rerender } = render(<JobExtractionProgress progress={null} isCancelling={false} onCancel={onCancel} />);
  await userEvent.click(screen.getByRole("button", { name: "Stop extraction" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  rerender(<JobExtractionProgress progress={null} isCancelling onCancel={onCancel} />);
  expect(screen.getByRole("button", { name: "Stopping..." })).toBeDisabled();
  rerender(<JobExtractionProgress progress={null} isCancelling={false} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("keeps job extraction elapsed time and shows a slow notice from server timestamps", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-14T00:02:00Z"));
  const progress = { job_id: "job-1", message: "Reading the job requirements", percent_complete: 42, created_at: "2026-07-14T00:00:00Z", updated_at: "2026-07-14T00:00:00Z" };
  render(<JobExtractionProgress progress={progress} isCancelling={false} onCancel={vi.fn()} />);
  expect(screen.getByText("2m 0s")).toBeInTheDocument();
  // Server idle is 120s but the local view just opened, so the warning waits for 90 local seconds.
  expect(screen.queryByRole("status", { name: "Slow progress notice" })).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(90_000));
  expect(screen.getByRole("status", { name: "Slow progress notice" })).toHaveTextContent("You can stop extraction and enter the details yourself.");
});
