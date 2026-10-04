import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ResumeContactSection, ResumeSectionWorkbench } from "@/components/resume/ResumeSectionWorkbench";
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

function editSection(heading = "Experience") {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(heading) }));
  fireEvent.click(screen.getByRole("button", { name: `Edit ${heading}` }));
}

describe("section workbench", () => {
  it.each([
    ["professional_experience", ["title", "company", "location", "date_range"]],
    ["education", ["qualification", "institution", "location", "date_range"]],
    ["projects", ["name", "details", "url"]],
    ["certifications", ["name", "issuer", "date"]],
  ] as const)("keeps %s fields in semantic order after persisted keys are reordered", (kind, order) => {
    const fields = Object.fromEntries<string>([["z_extra", "last extra"], ...[...order].reverse().map((key) => [key, key] as const), ["a_extra", "first extra"]]);
    const section = { ...source.sections[0], kind, entries: [{ ...source.sections[0].entries[0], fields, bullets: [] }] };
    const document = { ...source, sections: [section] };
    const { rerender } = render(<ResumeSectionWorkbench document={document} onChange={vi.fn()} />);
    editSection();
    const values = () => screen.getAllByRole("textbox").map((input) => (input as HTMLInputElement).value);
    expect(values()).toEqual([section.heading, ...order, "first extra", "last extra"]);
    const persisted = { ...document, sections: [{ ...section, entries: [{ ...section.entries[0], fields: Object.fromEntries(Object.entries(fields).sort(([left], [right]) => left.localeCompare(right))) }] }] };
    rerender(<ResumeSectionWorkbench document={persisted} onChange={vi.fn()} />);
    expect(values()).toEqual([section.heading, ...order, "first extra", "last extra"]);
  });

  it.each(["Contact", "Contact information", "Contact info", "Contact details", "Contacts", "Personal information", "Personal details", "Personal info"])("routes the %s heading to profile contact editing", (heading) => {
    const document = { ...source, sections: [{ ...source.sections[0], kind: "custom" as const, heading: ` ${heading.toUpperCase()} ` }] };
    expect(resumeDocumentError(document)).toBe("Manage contact information in your profile.");
  });

  it("preserves IDs while editing facts and asks for review again", async () => {
    const user = userEvent.setup();
    render(<ControlledWorkbench />);
    editSection();
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
    editSection();
    expect(screen.getByRole("button", { name: /mark reviewed/i })).toBeDisabled();
    await user.type(screen.getByLabelText("Employer"), "Acme");
    expect(screen.getByRole("button", { name: /mark reviewed/i })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: /mark reviewed/i }));
    expect(screen.getByText("Reviewed")).toBeInTheDocument();
  });

  it("adds flexible custom sections without losing existing entries", async () => {
    const user = userEvent.setup();
    render(<ControlledWorkbench />);
    await user.click(screen.getByLabelText("New section type"));
    await user.click(screen.getByRole("menuitemradio", { name: "Custom section" }));
    await user.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByLabelText("Section heading 2")).toHaveValue("Custom section");
    expect(screen.queryByTestId("section-preview-experience-1")).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("tab", { name: /Experience/ }));
    await user.click(screen.getByRole("button", { name: "Regenerate role" }));
    expect(onRegenerate).toHaveBeenCalledWith(source.sections[0], "role-1");
    editSection();
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
    editSection();
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
    for (const section of sections) {
      await user.click(screen.getByRole("tab", { name: new RegExp(section.heading) }));
      const button = screen.getByRole("button", { name: "Regenerate section" });
      expect(button).toBeDisabled();
      await user.click(button);
      expect(screen.getByText(new RegExp(reason(section)!))).toBeInTheDocument();
    }
    expect(onRegenerate).not.toHaveBeenCalled();
    editSection("Education");
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
    await user.click(roles[0]);
    await user.click(screen.getByRole("tab", { name: /Volunteering/ }));
    expect(screen.getByText(/Add this section to your base resume/)).toBeInTheDocument();
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
    render(<CompareWorkspace baseResume={{ id: "base-1", name: "Changed base", content_md: "## Experience\nDifferent Employer", is_default: false, created_at: "", updated_at: "" }} draft={draft} editMode={false} editContent="" isSavingDraft={false} onCancelEdit={vi.fn()} onContentChange={vi.fn()} onSaveDraft={vi.fn()} />);
    expect(screen.getByText("Source revision 4")).toBeInTheDocument();
    expect(screen.queryByText(/Different Employer/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("diff-section-professional_experience")).getByText("Acme")).toBeInTheDocument();
  });
});

describe("resume-owned section structure", () => {
  it("saves custom ordering and exclusions without losing section, entry or bullet IDs", async () => {
    const user = userEvent.setup();
    const document = { ...source, sections: [...source.sections, { ...source.sections[0], id: "community", kind: "custom" as const, heading: "Community", entries: [], content_md: "Community work" }] };
    const onSave = vi.fn().mockResolvedValue(true);
    render(<MemoryRouter><DraftSectionWorkbench draft={{ ...draft, document }} profile={null} onSave={onSave} onRegenerate={vi.fn()} /></MemoryRouter>);
    await user.click(screen.getByRole("tab", { name: /Community/ }));
    await user.click(screen.getByRole("button", { name: "Move Community up" }));
    await user.click(screen.getByRole("tab", { name: /Experience/ }));
    await user.click(screen.getByRole("button", { name: "Include Experience" }));
    await user.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0] as ResumeDocument;
    expect(saved.sections.map((s) => s.id)).toEqual(["community", "experience-1"]);
    expect(saved.sections[1].enabled).toBe(false);
    expect(saved.sections[1].entries).toEqual(source.sections[0].entries);
    expect(renderSectionContent(saved.sections[1])).toContain("Built services");
  });

  it("allows reviewed source sections to be included again and blocks unreviewed source", () => {
    const section = source.sections[0];
    const excludedSource = { ...source, sections: [{ ...section, enabled: false }] };
    expect(getResumeRegenerationBlocker(section, excludedSource, "medium")).toBeNull();
    expect(getResumeRegenerationBlocker(section, { ...excludedSource, sections: [{ ...section, enabled: false, review_state: "needs_review" }] }, "medium")).toMatch(/Review this source section/);
  });
});


it("comparison keeps custom IDs and saved order while showing excluded source sections as removed", () => {
  const custom = { ...source.sections[0], id: "community", kind: "custom" as const, heading: "Community", entries: [], content_md: "Community work" };
  const base = { ...source, sections: [...source.sections, custom] };
  const current = { ...source, sections: [custom, { ...source.sections[0], enabled: false }] };
  expect(parseResumeDocument(current).sections.map((section) => section.id)).toEqual(["community"]);
  const comparison = compareResumeDocs(parseResumeDocument(base), parseResumeDocument(current));
  expect(comparison.sections[0].heading).toBe("Community");
  expect(comparison.sections[1].status).toBe("removed");
});

it("compares a re-included section with its frozen source rather than labeling it newly added", () => {
  const custom = { ...source.sections[0], id: "community", kind: "custom" as const, heading: "Community", entries: [], content_md: "Community work", enabled: false };
  const frozen = { ...source, sections: [...source.sections, custom] };
  const current = { ...source, sections: [...source.sections, { ...custom, enabled: true }] };
  render(<CompareWorkspace baseResume={null} draft={{ ...draft, document: current, source_snapshot: { base_resume_id: "base-1", revision: 4, document: frozen, content_md: "" } }} editMode={false} editContent="" isSavingDraft={false} onCancelEdit={vi.fn()} onContentChange={vi.fn()} onSaveDraft={vi.fn()} />);
  const card = screen.getByTestId("diff-section-custom");
  expect(within(card).queryByText("Added")).not.toBeInTheDocument();
  expect(card).toHaveTextContent("Community work");
  expect(frozen.sections[1].enabled).toBe(false);
});

describe("focused source review", () => {
  it("shows one section at a time and keeps edits, inclusion and review progress when switching", async () => {
    const user = userEvent.setup();
    const initial = { ...source, sections: [...source.sections, { ...source.sections[0], id: "skills-focus", kind: "skills" as const, heading: "Skills", entries: [], content_md: "Python", review_state: "needs_review" as const }] };
    function FocusedWorkbench() {
      const [document, setDocument] = useState(initial);
      return <ResumeSectionWorkbench document={document} onChange={setDocument} source />;
    }
    render(<FocusedWorkbench />);
    expect(screen.getByRole("tabpanel", { name: "Experience" })).toBeVisible();
    expect(screen.queryByRole("tabpanel", { name: "Skills" })).not.toBeInTheDocument();
    editSection();
    await user.type(screen.getByLabelText("Employer"), " Ltd");
    const navigation = screen.getByRole("tablist", { name: "Resume sections" });
    await user.click(within(navigation).getByRole("tab", { name: /Skills/ }));
    expect(screen.getByRole("tabpanel", { name: "Skills" })).toBeVisible();
    expect(screen.queryByRole("tabpanel", { name: "Experience" })).not.toBeInTheDocument();
    editSection("Skills");
    await user.type(screen.getByLabelText(/Section content/), ", SQL");
    await user.click(screen.getByRole("button", { name: "Mark reviewed" }));
    expect(screen.getByText("1 of 2 populated sections reviewed")).toBeInTheDocument();
    expect(within(navigation).getByLabelText("Section reviewed")).toHaveClass("reviewed");
    expect(screen.queryByRole("button", { name: /Continue review/ })).not.toBeInTheDocument();
    await user.click(within(navigation).getByRole("tab", { name: /Experience/ }));
    editSection();
    expect(screen.getByLabelText("Employer")).toHaveValue("Acme Ltd");
    await user.click(screen.getByRole("button", { name: "Include Experience" }));
    expect(screen.getByText("1 of 1 populated sections reviewed")).toBeInTheDocument();
    await user.click(within(navigation).getByRole("tab", { name: /Skills/ }));
    editSection("Skills");
    expect(screen.getByLabelText(/Section content/)).toHaveValue("Python, SQL");
    await user.click(screen.getByRole("tab", { name: /Experience/ }));
    expect(screen.getByRole("tabpanel", { name: "Experience" })).toBeVisible();
    editSection();
    expect(screen.getByLabelText("Employer")).toHaveValue("Acme Ltd");
  });

  it("keeps multiple roles independent when collapsed, edited and reviewed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const second = { ...source.sections[0].entries[0], id: "role-two", fields: { title: "Developer", company: "Beta", location: "Remote", date_range: "2019 - 2022" }, bullets: [{ id: "beta-bullet", text: "Built tools", source_ids: [] }] };
    function MultipleRoles() {
      const [document, setDocument] = useState({ ...source, sections: [{ ...source.sections[0], entries: [...source.sections[0].entries, second] }] });
      return <ResumeSectionWorkbench document={document} onChange={(next) => { setDocument(next); onChange(next); }} source />;
    }
    render(<MultipleRoles />);
    editSection();
    await user.click(screen.getByRole("button", { name: "Collapse role 1" }));
    expect(screen.queryByRole("textbox", { name: "Entry 1 bullet 1" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Entry 2 bullet 1"), " for users");
    await user.click(screen.getByRole("button", { name: "Expand role 1" }));
    expect(screen.getByLabelText("Entry 1 bullet 1")).toHaveValue("Built services");
    const updated = onChange.mock.calls.at(-1)?.[0] as ResumeDocument;
    expect(updated.sections[0].entries[0]).toEqual(source.sections[0].entries[0]);
    expect(updated.sections[0].entries[1].id).toBe("role-two");
    expect(updated.sections[0].entries[1].bullets[0]).toEqual({ id: "beta-bullet", text: "Built tools for users", source_ids: [] });
    expect(updated.sections[0].review_state).toBe("needs_review");
  });
});

describe("preview-first section editing", () => {
  it.each([true, false])("starts with read-only content for source=%s and opens the chosen section from its Edit button", async (isSource) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ResumeSectionWorkbench document={source} onChange={onChange} source={isSource} />);
    expect(screen.queryByRole("textbox", { name: "Employer" })).not.toBeInTheDocument();
    expect(screen.getByTestId("section-preview-experience-1")).toHaveTextContent("Acme");
    expect(screen.getByTestId("section-preview-experience-1")).toHaveTextContent("Built services");
    await user.click(screen.getByRole("tab", { name: /Experience/ }));
    await user.click(screen.getByRole("button", { name: "Edit Experience" }));
    expect(screen.getByRole("textbox", { name: "Employer" })).toHaveValue("Acme");
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Preview Experience" }));
    expect(screen.queryByRole("textbox", { name: "Employer" })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("double-clicks into just one section and retains edits when another section opens", async () => {
    const user = userEvent.setup();
    function PreviewWorkbench() {
      const [document, setDocument] = useState({ ...source, sections: [...source.sections, { ...source.sections[0], id: "skills-preview", kind: "skills" as const, heading: "Skills", entries: [], content_md: "Python" }] });
      return <ResumeSectionWorkbench document={document} onChange={setDocument} />;
    }
    render(<PreviewWorkbench />);
    await user.dblClick(screen.getByTestId("section-preview-experience-1"));
    await user.type(screen.getByRole("textbox", { name: "Entry 1 bullet 1" }), " for clients");
    await user.click(screen.getByRole("tab", { name: /Skills/ }));
    await user.click(screen.getByRole("button", { name: "Edit Skills" }));
    expect(screen.queryByRole("textbox", { name: "Employer" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-preview-experience-1")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Section content/ }), ", SQL");
    await user.click(screen.getByRole("tab", { name: /Experience/ }));
    await user.click(screen.getByRole("button", { name: "Edit Experience" }));
    expect(screen.queryByRole("textbox", { name: /Section content/ })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Entry 1 bullet 1" })).toHaveValue("Built services for clients");
    await user.click(screen.getByRole("tab", { name: /Skills/ }));
    expect(screen.getByTestId("section-preview-skills-preview")).toHaveTextContent("Python, SQL");
  });

  it("blocks both Edit and double-click editing while locked and keeps regeneration available in preview", async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    const { rerender } = render(<ResumeSectionWorkbench document={source} onChange={vi.fn()} disabled onRegenerate={onRegenerate} />);
    expect(screen.getByRole("button", { name: "Edit Experience" })).toBeDisabled();
    await user.dblClick(screen.getByTestId("section-preview-experience-1"));
    expect(screen.queryByRole("textbox", { name: "Employer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate role" })).toBeDisabled();
    rerender(<ResumeSectionWorkbench document={source} onChange={vi.fn()} onRegenerate={onRegenerate} />);
    await user.click(screen.getByRole("tab", { name: /Experience/ }));
    await user.click(screen.getByRole("button", { name: "Regenerate role" }));
    expect(onRegenerate).toHaveBeenCalledWith(source.sections[0], "role-1");
  });
});

it("keeps Markdown images from loading external resources in preview while retaining text and safe links", () => {
  const document = { ...source, sections: [{ ...source.sections[0], kind: "custom" as const, heading: "Research", entries: [], content_md: "Research notes\n\n![Research figure](https://tracking.example.test/private-source)\n\n[Published paper](https://example.test/paper)" }] };
  const { container } = render(<ResumeSectionWorkbench document={document} onChange={vi.fn()} />);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("Research figure")).toBeInTheDocument();
  expect(screen.getByText("Research notes")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "Published paper" });
  expect(link).toHaveAttribute("href", "https://example.test/paper");
  fireEvent.doubleClick(link);
  expect(screen.queryByRole("textbox", { name: /Section content/ })).not.toBeInTheDocument();
});

it.each([true, false])("uses ordered tabs and keyboard activation for source=%s", async (isSource) => {
  const user = userEvent.setup();
  const skills = { ...source.sections[0], id: "contact", kind: "skills" as const, heading: "Skills", entries: [], content_md: "Python" };
  render(<ResumeSectionWorkbench document={{ ...source, sections: [...source.sections, skills] }} onChange={vi.fn()} source={isSource} contactPanel={<p>Profile facts</p>} referencePanel={<p>Original import</p>} />);
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual(["Contact information", "Experience", "Skills", "Extracted text"]);
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  expect(screen.getByRole("tabpanel", { name: "Contact information" })).toHaveTextContent("Profile facts");
  tabs[0].focus();
  await user.keyboard("{ArrowRight}");
  expect(tabs[1]).toHaveFocus();
  expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByText("Profile facts")).not.toBeInTheDocument();
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  await user.keyboard("{End}");
  expect(screen.getByRole("tabpanel", { name: "Extracted text" })).toHaveTextContent("Original import");
  await user.keyboard("{Home}{ArrowLeft}");
  expect(tabs[3]).toHaveFocus();
  await user.click(tabs[2]);
  // A stored section ID cannot collide with the profile contact tab.
  expect(screen.getByRole("tabpanel", { name: "Skills" })).toHaveTextContent("Python");
});

it.each([true, false])("uses the shared section preview for profile contact details, source=%s", async (isSource) => {
  const user = userEvent.setup();
  render(<MemoryRouter><ResumeSectionWorkbench document={source} onChange={vi.fn()} source={isSource} contactPanel={<ResumeContactSection profile={null} suggestions={isSource ? { name: "Source name", email: "source@example.test" } : undefined} />} /></MemoryRouter>);
  const panel = screen.getByRole("tabpanel", { name: "Contact information" });
  expect(within(panel).getByRole("heading", { name: "Contact information" })).toHaveClass("resume-section-heading");
  expect(within(panel).getByRole("link", { name: "Edit profile" })).toHaveAttribute("href", "/app/profile");
  expect(within(panel).getByText("Add your name in your profile")).toBeInTheDocument();
  if (isSource) {
    expect(within(panel).getByText("Source name")).toBeInTheDocument();
    expect(within(panel).getByText("Review these details in your profile before using them.")).toBeInTheDocument();
  }
  await user.click(screen.getByRole("tab", { name: "Experience" }));
  await user.click(screen.getByRole("tab", { name: "Contact information" }));
  expect(screen.getByRole("link", { name: "Edit profile" })).toBeInTheDocument();
});

it("keeps the workbench mounted and limits section loading to the target content", async () => {
  const props = { draft, profile: null, onSave: vi.fn(), onRegenerate: vi.fn() };
  const { rerender } = render(<MemoryRouter><DraftSectionWorkbench {...props} /></MemoryRouter>);
  await userEvent.click(screen.getByRole("tab", { name: "Experience" }));
  const navigation = screen.getByRole("tablist", { name: "Resume sections" });
  rerender(<MemoryRouter><DraftSectionWorkbench {...props} locked processing={{ sectionId: "experience-1", content: <p role="status" aria-label="Regeneration">Rewriting experience</p> }} /></MemoryRouter>);
  expect(screen.getByRole("tablist", { name: "Resume sections" })).toBe(navigation);
  expect(screen.getByRole("tabpanel", { name: "Experience" })).toContainElement(screen.getByRole("status", { name: "Regeneration" }));
  expect(screen.queryByText("Built services")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit Experience" })).toBeDisabled();
  await userEvent.click(screen.getByRole("tab", { name: "Contact information" }));
  expect(screen.getByRole("tabpanel", { name: "Contact information" })).toBeInTheDocument();
  rerender(<MemoryRouter><DraftSectionWorkbench {...props} /></MemoryRouter>);
  await userEvent.click(screen.getByRole("tab", { name: "Experience" }));
  expect(screen.getByText("Built services")).toBeInTheDocument();
});

it("preserves sibling roles while one role regenerates", () => {
  const document = { ...source, sections: [{ ...source.sections[0], entries: [
    source.sections[0].entries[0],
    { id: "role-2", fields: { title: "Lead", company: "Second employer" }, bullets: [{ id: "b2", text: "Kept sibling content", source_ids: [] }] },
  ] }] };
  render(<ResumeSectionWorkbench document={document} disabled onChange={vi.fn()} processing={{ sectionId: "experience-1", entryId: "role-1", content: <p role="status" aria-label="Regeneration">Rewriting one role</p> }} />);
  expect(screen.getByText("Kept sibling content")).toBeInTheDocument();
  expect(screen.queryByText("Built services")).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Regeneration" })).toHaveTextContent("Rewriting one role");
});
