import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { CompareWorkspace } from "@/components/diff/CompareWorkspace";
import type { BaseResumeDetail, ResumeDraft } from "@/lib/api";

describe("CompareWorkspace Component", () => {
  const mockBaseResume: BaseResumeDetail = {
    id: "resume-1",
    name: "Standard Resume",
    content_md: `# Sanka Lokuliyana
sanka@example.com | Toronto, ON

## Summary
Quality Engineering Manager with 10+ years leading QE teams.

## Professional Experience
Deloitte Canada | Toronto, ON
Manager, Quality Engineering | Jan 2022 - Present
- Responsible for QE strategy and test automation.
- Mentored junior engineers.

## Skills
- Cypress
- Playwright
`,
    is_default: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
  };

  const mockDraft: ResumeDraft = {
    id: "draft-1",
    application_id: "app-1",
    content_md: `# Sanka Lokuliyana
sanka@example.com | Toronto, ON

## Summary
Software QA/QC Test Manager with 10+ years leading high-impact QE teams.

## Professional Experience
Deloitte Canada | Toronto, ON
Software QA/QC Test Manager | Jan 2022 - Present
- Define end-to-end QE strategy and scalable test automation.
- Mentored junior engineers.
- Introduced automated Jira defect triage.

## Skills
- Cypress
- Playwright
- Defect Density
- Escape Rate
`,
    generation_params: {
      base_resume_id: "resume-1",
      page_length: "1_page",
      aggressiveness: "high",
    },
    sections_snapshot: {},
    last_generated_at: "2026-04-07T12:00:00Z",
    last_exported_at: null,
    updated_at: "2026-04-07T12:00:00Z",
  };

  it("renders the comparison workspace with hero metrics and section cards", () => {
    render(
      <CompareWorkspace
        baseResume={mockBaseResume}
        draft={mockDraft}
        editMode={false}
        editContent=""
        isSavingDraft={false}
        onEnterEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onContentChange={vi.fn()}
        onSaveDraft={vi.fn()}
        onCloseCompare={vi.fn()}
      />,
    );

    expect(screen.getByText(/tailored comparison/i)).toBeInTheDocument();
    expect(screen.getAllByText("Standard Resume").length).toBeGreaterThan(0);
    expect(screen.getByText(/Roles \(/i)).toBeInTheDocument();
    expect(screen.getByText(/Deloitte Canada/i)).toBeInTheDocument();
    expect(screen.getByText(/Software QA\/QC Test Manager/i)).toBeInTheDocument();
    expect(screen.getByText(/Role Title Targeted/i)).toBeInTheDocument();
  });

  it("switches view mode between unified and side by side", async () => {
    const user = userEvent.setup();
    render(
      <CompareWorkspace
        baseResume={mockBaseResume}
        draft={mockDraft}
        editMode={false}
        editContent=""
        isSavingDraft={false}
        onEnterEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onContentChange={vi.fn()}
        onSaveDraft={vi.fn()}
        onCloseCompare={vi.fn()}
      />,
    );

    const sideBySideBtn = screen.getByTitle("Side-by-side cards comparing base and tailored");
    await user.click(sideBySideBtn);

    expect(screen.getAllByText(/Base Resume/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Tailored Draft/i).length).toBeGreaterThan(0);
  });

  it("filters sections when clicking navigation pills", async () => {
    const user = userEvent.setup();
    render(
      <CompareWorkspace
        baseResume={mockBaseResume}
        draft={mockDraft}
        editMode={false}
        editContent=""
        isSavingDraft={false}
        onEnterEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onContentChange={vi.fn()}
        onSaveDraft={vi.fn()}
        onCloseCompare={vi.fn()}
      />,
    );

    expect(screen.getByText(/All Sections/i)).toBeInTheDocument();
    const skillsTab = screen.getByRole("button", { name: /^skills/i });
    await user.click(skillsTab);

    // Summary and experience should be hidden from stream
    expect(screen.queryByText(/Role Title Targeted/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Target ATS Keywords Added/i)).toBeInTheDocument();

    const allTab = screen.getByRole("button", { name: /all sections/i });
    await user.click(allTab);
    expect(screen.getByText(/Role Title Targeted/i)).toBeInTheDocument();
  });

  it("renders in-place editor when editMode is true", async () => {
    const user = userEvent.setup();
    const handleSave = vi.fn();
    const handleCancel = vi.fn();
    const handleChange = vi.fn();

    render(
      <CompareWorkspace
        baseResume={mockBaseResume}
        draft={mockDraft}
        editMode={true}
        editContent="# Custom Content"
        isSavingDraft={false}
        onEnterEdit={vi.fn()}
        onCancelEdit={handleCancel}
        onContentChange={handleChange}
        onSaveDraft={handleSave}
        onCloseCompare={vi.fn()}
      />,
    );

    expect(screen.getByText(/Edit Tailored Draft/i)).toBeInTheDocument();
    const saveBtn = screen.getByRole("button", { name: /save draft/i });
    await user.click(saveBtn);
    expect(handleSave).toHaveBeenCalledTimes(1);

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancelBtn);
    expect(handleCancel).toHaveBeenCalledTimes(1);
  });

  it("triggers close compare callback", async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();

    render(
      <CompareWorkspace
        baseResume={mockBaseResume}
        draft={mockDraft}
        editMode={false}
        editContent=""
        isSavingDraft={false}
        onEnterEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onContentChange={vi.fn()}
        onSaveDraft={vi.fn()}
        onCloseCompare={handleClose}
      />,
    );

    const closeBtn = screen.getByRole("button", { name: /close comparison/i });
    await user.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
