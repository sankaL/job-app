import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SectionRegenerationProgress } from "@/components/ui/section-regeneration-progress";

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
