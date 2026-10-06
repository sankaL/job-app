import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { GenerationSettingsFields } from "@/components/applications/GenerationSettingsFields";

function SettingsHarness() {
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>("base-1");
  const [pageLength, setPageLength] = useState("1_page");
  const [instructions, setInstructions] = useState("");
  return (
    <MemoryRouter>
      <GenerationSettingsFields
        baseResumes={[
          { id: "base-1", name: "Engineering", is_default: true, created_at: "", updated_at: "" },
          { id: "base-2", name: "Management", is_default: false, created_at: "", updated_at: "" },
        ]}
        selectedResumeId={selectedResumeId}
        setSelectedResumeId={setSelectedResumeId}
        pageLength={pageLength}
        onPageLengthChange={setPageLength}
        additionalInstructions={instructions}
        onAdditionalInstructionsChange={setInstructions}
      />
    </MemoryRouter>
  );
}

describe("compact generation settings", () => {
  it("shows read-only fields and preserves edits when returning to the read view", async () => {
    render(<SettingsHarness />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Engineering (default)")).toBeInTheDocument();
    expect(screen.getByText("1 Page")).toBeInTheDocument();
    const instructions = screen.getByRole("group", { name: "Additional Instructions" });
    expect(within(instructions).getByText("Not specified")).toBeInTheDocument();
    expect(within(instructions).queryByRole("button", { name: /View more/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit Additional Instructions" }));
    const editor = screen.getByRole("textbox", { name: "Additional Instructions" });
    expect(editor).toHaveFocus();
    await userEvent.type(editor, "Emphasize platform architecture.");
    await userEvent.click(screen.getByRole("button", { name: "Done editing Additional Instructions" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Emphasize platform architecture.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit Additional Instructions" }));
    expect(screen.getByRole("textbox", { name: "Additional Instructions" })).toHaveValue("Emphasize platform architecture.");
  });

  it("edits base resume and target length separately", async () => {
    render(<SettingsHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Base Resume" }));
    await userEvent.click(screen.getByRole("button", { name: "Base Resume" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Management" }));
    await userEvent.click(screen.getByRole("button", { name: "Done editing Base Resume" }));
    expect(within(screen.getByRole("group", { name: "Base Resume" })).getByText("Management")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit Target Length" }));
    await userEvent.click(screen.getByRole("button", { name: "Target Length" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "2 Pages" }));
    await userEvent.click(screen.getByRole("button", { name: "Done editing Target Length" }));
    expect(screen.getByText("2 Pages")).toBeInTheDocument();
  });

  it("no longer renders the aggressiveness control", () => {
    render(<SettingsHarness />);
    expect(screen.queryByRole("slider", { name: "Aggressiveness" })).not.toBeInTheDocument();
  });
});
