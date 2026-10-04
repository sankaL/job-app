import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InlineDetailField } from "@/components/applications/InlineDetailField";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function Fields() {
  const [company, setCompany] = useState("Acme");
  return (
    <>
      <InlineDetailField label="Company" value={company}>
        <Input aria-label="Company" value={company} onChange={(event) => setCompany(event.target.value)} />
      </InlineDetailField>
      <InlineDetailField label="Location" value="Toronto">
        <Input aria-label="Location" defaultValue="Toronto" />
      </InlineDetailField>
    </>
  );
}

describe("inline application detail fields", () => {
  it("opens one field, focuses it, and keeps controlled changes when editing finishes", async () => {
    const user = userEvent.setup();
    render(<Fields />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Company" }));
    const company = screen.getByRole("textbox", { name: "Company" });
    expect(company).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "Location" })).not.toBeInTheDocument();
    await user.clear(company);
    await user.type(company, "Updated company");
    await user.click(screen.getByRole("button", { name: "Done editing Company" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Company" })).getByText("Updated company")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Company" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Edit Company" }));
    expect(screen.getByRole("textbox", { name: "Company" })).toHaveValue("Updated company");
    await user.type(screen.getByRole("textbox", { name: "Company" }), " retained");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Updated company retained")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Company" })).toHaveFocus();
  });

  it("shows a short placeholder for empty fields and respects disabled editing", () => {
    render(
      <InlineDetailField label="Location" value="  " disabled>
        <Input aria-label="Location" />
      </InlineDetailField>,
    );
    expect(screen.getByText("Not specified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Location" })).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("expands and collapses a multiline value independently of editing", async () => {
    const user = userEvent.setup();
    const description = "First line\nSecond line\nThird line\nFourth line";
    render(
      <InlineDetailField label="Job Description" value={description} multiline>
        <Textarea aria-label="Job Description" defaultValue={description} />
      </InlineDetailField>,
    );
    const more = screen.getByRole("button", { name: "View more Job Description" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(more.getAttribute("aria-controls")!)).toHaveTextContent("Fourth line");
    await user.click(more);
    expect(screen.getByRole("button", { name: "View less Job Description" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View less Job Description" }));
    expect(screen.getByRole("button", { name: "View more Job Description" })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Edit Job Description" }));
    expect(screen.getByRole("textbox", { name: "Job Description" })).toHaveFocus();
  });
});
