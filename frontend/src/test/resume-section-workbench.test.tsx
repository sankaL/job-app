import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ResumeSectionWorkbench } from "@/components/resume/ResumeSectionWorkbench";
import { DraftSectionWorkbench } from "@/components/resume/DraftSectionWorkbench";
import { CompareWorkspace } from "@/components/diff/CompareWorkspace";
import { alignProvenanceBullets, compareResumeDocs } from "@/components/diff/diff-engine";
import { parseResumeDocument } from "@/components/diff/resume-parser";
import { getResumeRegenerationBlocker, renderSectionContent, resumeDocumentError } from "@/lib/resume-document";
import type { ResumeDocument, ResumeDraft } from "@/lib/api";

const source: ResumeDocument = {
  schema_version: 1, revision: 4, sections: [{
    id: "experience-1", kind: "professional_experience", heading: "Experience", enabled: true,
    review_state: "reviewed", confidence: 0.92, content_md: "",
    entries: [{ id: "role-1", fields: { title: "Engineer", company: "Acme", date_range: "2022 - Present" }, bullets: [
      { id: "source-a", text: "Built services", source_ids: [] },
      { id: "source-b", text: "Maintained deployments", source_ids: [] },
    ] }],
  }],
};
const draft: ResumeDraft = {
  id: "draft-1", application_id: "app-1", content_md: "", document: source,
  source_snapshot: { base_resume_id: "base-1", revision: 4, document: source, content_md: "" },
  generation_params: {}, sections_snapshot: {}, last_generated_at: "2026-09-30T00:00:00Z",
  last_exported_at: null, updated_at: "2026-09-30T00:00:00Z",
};

function ControlledWorkbench() {
  const [document, setDocument] = useState<ResumeDocument>(source);
  return <ResumeSectionWorkbench document={document} onChange={setDocument} source />;
}

describe("section workbench", () => {
  it.each(["Contact", "Contact information", "Contact info", "Contact details", "Contacts", "Personal information", "Personal details", "Personal info"])("routes the %s heading to profile contact editing", (heading) => {
    const document = { ...source, sections: [{ ...source.sections[0], kind: "custom" as const, heading: ` ${heading.toUpperCase()} ` }] };
    expect(resumeDocumentError(document)).toBe("Manage contact information in your profile.");
  });

  it("preserves IDs while editing facts and asks for review again", async () => {
    const user = userEvent.setup();
    render(<ControlledWorkbench />);
    await user.clear(screen.getByLabelText("Employer"));
    await user.type(screen.getByLabelText("Employer"), "Acme Ltd");
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /mark reviewed/i }));
    expect(screen.getByText("Reviewed")).toBeInTheDocument();
    expect(screen.getByLabelText("Employer")).toHaveValue("Acme Ltd");
    expect(screen.getByTestId("resume-section-workbench").querySelector('[data-section-id="experience-1"]')).not.toBeNull();
  });

  it("requires factual role fields before review while allowing missing dates", async () => {
    const user = userEvent.setup();
    const incomplete = { ...source, sections: [{ ...source.sections[0], review_state: "needs_review" as const, entries: [{ ...source.sections[0].entries[0], fields: { company: "", title: "Engineer", date_range: "" } }] }] };
    function IncompleteWorkbench() {
      const [document, setDocument] = useState<ResumeDocument>(incomplete);
      return <ResumeSectionWorkbench document={document} onChange={setDocument} source />;
    }
    render(<IncompleteWorkbench />);
    expect(screen.getByRole("button", { name: /mark reviewed/i })).toBeDisabled();
    await user.type(screen.getByLabelText("Employer"), "Acme");
    expect(screen.getByRole("button", { name: /mark reviewed/i })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: /mark reviewed/i }));
    expect(screen.getByText("Reviewed")).toBeInTheDocument();
  });

  it("adds flexible custom sections without losing existing entries", async () => {
    const user = userEvent.setup();
    render(<ControlledWorkbench />);
    await user.selectOptions(screen.getByLabelText("New section type"), "custom");
    await user.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByLabelText("Section heading 2")).toHaveValue("Custom section");
    expect(screen.getByLabelText("Employer")).toHaveValue("Acme");
    await user.click(screen.getByRole("button", { name: "Move Custom section up" }));
    expect(screen.getByLabelText("Section heading 1")).toHaveValue("Custom section");
  });

  it("preserves opaque source text exactly when organizing its first role", async () => {
    const user = userEvent.setup();
    const content = "Acme — Engineer\n\n- Improved delivery by +20.5%\n- Built C++ services\n";
    const onChange = vi.fn();
    function OpaqueWorkbench() {
      const [document, setDocument] = useState<ResumeDocument>({ ...source, sections: [{ ...source.sections[0], entries: [], content_md: content }] });
      return <ResumeSectionWorkbench document={document} source onChange={(next) => { setDocument(next); onChange(next); }} />;
    }
    render(<OpaqueWorkbench />);
    await user.click(screen.getByRole("button", { name: "Add role" }));
    expect(screen.getByLabelText("Entry 1 bullet 1")).toHaveValue(content);
    expect(screen.getByRole("button", { name: /mark reviewed/i })).toBeDisabled();
    const section = onChange.mock.calls.at(-1)?.[0].sections[0];
    expect(section.content_md).toBe("");
    expect(section.entries[0].bullets.map((bullet: { text: string }) => bullet.text).join("")).toBe(content);
    expect(new Set([section.id, section.entries[0].id, ...section.entries[0].bullets.map((bullet: { id: string }) => bullet.id)]).size).toBe(3);
    await user.click(screen.getByRole("button", { name: "Add role" }));
    expect(screen.getByLabelText("Entry 1 bullet 1")).toHaveValue(content);
    expect(screen.queryByLabelText("Entry 2 bullet 1")).not.toBeInTheDocument();
  });

  it("preserves long source text within bullet limits with distinct identities", async () => {
    const user = userEvent.setup();
    const content = "Fact ".repeat(2200) + "✓";
    const onChange = vi.fn();
    render(<ResumeSectionWorkbench document={{ ...source, sections: [{ ...source.sections[0], entries: [], content_md: content }] }} source onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Add role" }));
    const entry = onChange.mock.calls[0][0].sections[0].entries[0];
    expect(entry.bullets.map((bullet: { text: string }) => bullet.text).join("")).toBe(content);
    expect(entry.bullets).toHaveLength(2);
    expect(entry.bullets.every((bullet: { text: string }) => [...bullet.text].length <= 10000)).toBe(true);
    expect(new Set(entry.bullets.map((bullet: { id: string }) => bullet.id)).size).toBe(2);
  });

  it("regenerates the selected role and saves with the captured revision", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    const onRegenerate = vi.fn();
    render(<MemoryRouter><DraftSectionWorkbench draft={draft} profile={null} onSave={onSave} onRegenerate={onRegenerate} /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Regenerate role" }));
    expect(onRegenerate).toHaveBeenCalledWith(source.sections[0], "role-1");
    await user.type(screen.getByLabelText("Entry 1 bullet 1"), " for customers");
    expect(screen.queryByRole("button", { name: "Regenerate role" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }), 4));
    expect(onSave.mock.calls[0][0].sections[0].entries[0].bullets[0].id).toBe("source-a");
  });

  it("keeps unsaved edits when a newer server revision arrives", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(false);
    const props = { profile: null, onSave, onRegenerate: vi.fn() };
    const { rerender } = render(<MemoryRouter><DraftSectionWorkbench draft={draft} {...props} /></MemoryRouter>);
    await user.type(screen.getByLabelText("Entry 1 bullet 1"), " locally");
    rerender(<MemoryRouter><DraftSectionWorkbench draft={{ ...draft, document: { ...source, revision: 5 }, updated_at: "2026-09-30T00:01:00Z" }} {...props} /></MemoryRouter>);
    expect(screen.getByLabelText("Entry 1 bullet 1")).toHaveValue("Built services locally");
    expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Reload latest draft" }));
    expect(screen.getByLabelText("Entry 1 bullet 1")).toHaveValue("Built services");
  });

  it("disables fixed facts and opaque experience without disabling direct editing", async () => {
    const user = userEvent.setup();
    const sections: ResumeDocument["sections"] = [
      { ...source.sections[0], id: "education", kind: "education", heading: "Education", entries: [{ id: "school", fields: { institution: "College", qualification: "BSc" }, bullets: [] }] },
      { ...source.sections[0], id: "certs", kind: "certifications", heading: "Certifications", entries: [], content_md: "Cloud certificate" },
      { ...source.sections[0], id: "skills", kind: "skills", heading: "Skills", entries: [], content_md: "Python" },
      { ...source.sections[0], id: "opaque", entries: [], content_md: "Engineering at Acme" },
    ];
    const document = { ...source, sections };
    const onRegenerate = vi.fn();
    const reason = (section: ResumeDocument["sections"][number], entryId?: string) => getResumeRegenerationBlocker(section, document, "low", entryId);
    render(<MemoryRouter><DraftSectionWorkbench draft={{ ...draft, document }} profile={null} onSave={vi.fn()} onRegenerate={onRegenerate} canRegenerate={(section, entryId) => !reason(section, entryId)} regenerationReason={reason} /></MemoryRouter>);
    const buttons = screen.getAllByRole("button", { name: "Regenerate section" });
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button).toBeDisabled();
      await user.click(button);
    }
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(screen.getAllByText(/These source facts stay fixed/)).toHaveLength(2);
    expect(screen.getByText(/Low tailoring keeps skills fixed/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Institution"), " University");
    expect(screen.getByRole("button", { name: "Save Draft" })).not.toBeDisabled();
  });

  it("allows an existing role while blocking a draft-only role and section", async () => {
    const user = userEvent.setup();
    const draftOnlyRole = { ...source.sections[0].entries[0], id: "draft-only-role" };
    const experience = { ...source.sections[0], entries: [...source.sections[0].entries, draftOnlyRole] };
    const custom = { ...source.sections[0], id: "draft-only-section", kind: "custom" as const, heading: "Volunteering", entries: [], content_md: "Community work" };
    const document = { ...source, sections: [experience, custom] };
    const onRegenerate = vi.fn();
    const reason = (section: ResumeDocument["sections"][number], entryId?: string) => getResumeRegenerationBlocker(section, source, "medium", entryId);
    render(<ResumeSectionWorkbench document={document} onChange={vi.fn()} onRegenerate={onRegenerate} canRegenerate={(section, entryId) => !reason(section, entryId)} regenerationReason={reason} />);
    const roles = screen.getAllByRole("button", { name: "Regenerate role" });
    expect(roles[0]).not.toBeDisabled();
    expect(roles[1]).toBeDisabled();
    for (const button of screen.getAllByRole("button", { name: "Regenerate section" })) expect(button).toBeDisabled();
    expect(screen.getByText(/Add this section to your base resume/)).toBeInTheDocument();
    await user.click(roles[0]);
    expect(onRegenerate).toHaveBeenCalledWith(experience, "role-1");
    expect(getResumeRegenerationBlocker(experience, undefined, "medium")).toMatch(/base resume/);
  });

  it("keeps extra structured facts and normalizes row whitespace in the Markdown projection", () => {
    const experience = { ...source.sections[0], entries: [{ ...source.sections[0].entries[0], fields: { company: "Acme\nLtd", title: "Senior   Engineer", location: "Remote\nCanada", date_range: "2022\n- Present", team_size: "6 engineers\n2 designers" }, bullets: [] }] };
    expect(renderSectionContent(experience)).toBe("Acme Ltd | Remote Canada\nSenior Engineer | 2022 - Present\n- Team size: 6 engineers\n  2 designers");
    const project = { ...experience, kind: "projects" as const, entries: [{ id: "project", fields: { name: "Weather\nApp", details: "Forecast dashboard", url: "https://example.test", technologies: "Python, C++", award_name: "Local prize" }, bullets: [] }] };
    expect(renderSectionContent(project)).toBe("Weather App | https://example.test\nForecast dashboard\n- Technologies: Python, C++\n- Award name: Local prize");
    expect(renderSectionContent({ ...project, kind: "custom" })).toContain("- Award name: Local prize");
  });
});

describe("canonical comparison", () => {
  it("uses explicit many-to-many bullet provenance instead of text similarity", () => {
    const items = alignProvenanceBullets(source.sections[0].entries[0].bullets, [
      { id: "output-1", text: "Owned the service delivery lifecycle", source_ids: ["source-a", "source-b"] },
      { id: "output-2", text: "Improved service reliability", source_ids: ["source-a"] },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].baseText).toBe("Built services\nMaintained deployments");
    expect(items.every((item) => item.status === "modified")).toBe(true);
  });

  it("compares reordered roles by their IDs even when employers match", () => {
    const second = { ...source.sections[0].entries[0], id: "role-2", fields: { ...source.sections[0].entries[0].fields, title: "Manager" }, bullets: [] };
    const base = { ...source, sections: [{ ...source.sections[0], entries: [source.sections[0].entries[0], second] }] };
    const tailored = { ...source, sections: [{ ...source.sections[0], entries: [second, source.sections[0].entries[0]] }] };
    const result = compareResumeDocs(parseResumeDocument(base), parseResumeDocument(tailored));
    expect(result.sections[0].experienceDiffs?.map((entry) => entry.title.base)).toEqual(["Manager", "Engineer"]);
    expect(result.stats.retitledRoles).toBe(0);
  });

  it("reads the generation snapshot even when the current base has changed", () => {
    render(<CompareWorkspace baseResume={{ id: "base-1", name: "Changed base", content_md: "## Experience\nDifferent Employer", is_default: false, created_at: "", updated_at: "" }} draft={draft} editMode={false} editContent="" isSavingDraft={false} onEnterEdit={vi.fn()} onCancelEdit={vi.fn()} onContentChange={vi.fn()} onSaveDraft={vi.fn()} onCloseCompare={vi.fn()} />);
    expect(screen.getByText("Source revision 4")).toBeInTheDocument();
    expect(screen.queryByText(/Different Employer/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("diff-section-professional_experience")).getByText("Acme")).toBeInTheDocument();
  });
});
