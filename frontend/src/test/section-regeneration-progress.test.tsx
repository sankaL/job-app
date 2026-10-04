import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SectionRegenerationProgress } from "@/components/ui/section-regeneration-progress";

afterEach(() => vi.useRealTimers());

it("keeps section loading inline and uses only the reported percentage", () => {
  const onCancel = vi.fn();
  const props = { progress: null, isOptimistic: true, isActive: false, isCancelling: false, onCancel };
  const { rerender } = render(<SectionRegenerationProgress {...props} />);
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  expect(screen.getByRole("status", { name: "Section regeneration status" })).toHaveTextContent("Preparing this section");
  rerender(<SectionRegenerationProgress {...props} isOptimistic={false} isActive progress={{ job_id: "job-1", workflow_kind: "regeneration_section", state: "running", message: "Checking the revised section against your source.", percent_complete: 85, created_at: "", updated_at: "", completed_at: null, terminal_error_code: null }} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "85");
  expect(screen.getByRole("status", { name: "Section regeneration status" })).toHaveTextContent("Checking the revised section");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledOnce();
});

it("shows a slow notice after 90 seconds without a reported update", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-14T00:00:00Z"));
  const progress = { job_id: "job-1", workflow_kind: "regeneration_section", state: "running", message: "Rewriting the section.", percent_complete: 40, created_at: "2026-07-14T00:00:00Z", updated_at: "2026-07-14T00:00:00Z", completed_at: null, terminal_error_code: null };
  render(<SectionRegenerationProgress progress={progress} isOptimistic={false} isActive isCancelling={false} onCancel={vi.fn()} />);
  act(() => vi.advanceTimersByTime(89_000));
  expect(screen.queryByRole("status", { name: "Slow progress notice" })).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1_000));
  expect(screen.getByRole("status", { name: "Slow progress notice" })).toHaveTextContent("This is taking longer than usual. You can stop and try again.");
});
