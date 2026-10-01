import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/components/layout/AppContext";
import { ToastProvider } from "@/components/ui/toast";
import { BaseResumeEditorPage } from "@/routes/BaseResumeEditorPage";
import * as api from "@/lib/api";

vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(),
  fetchSessionBootstrap: vi.fn(), fetchBaseResume: vi.fn(), updateBaseResume: vi.fn(),
}));

const document: api.ResumeDocument = { schema_version: 1, revision: 3, sections: [
  { id: "experience", kind: "professional_experience", heading: "Experience", enabled: true, review_state: "needs_review", confidence: null, content_md: "", entries: [
    { id: "job", fields: { company: "Acme", title: "Engineer", location: "Remote", date_range: "2022 - Present" }, bullets: [{ id: "fact", text: "Built services", source_ids: [] }] },
  ] },
  { id: "skills", kind: "skills", heading: "Skills", enabled: true, review_state: "needs_review", confidence: null, content_md: "Python", entries: [] },
] };
const resume: api.BaseResumeDetail = { id: "base", name: "Source resume", document, content_md: "", is_default: false, created_at: "", updated_at: "" };

function renderEditor() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/app/resumes/base"]}><AppProvider><ToastProvider><Routes><Route path="/app/resumes/:resumeId" element={<BaseResumeEditorPage />} /></Routes></ToastProvider></AppProvider></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.fetchSessionBootstrap).mockResolvedValue({ user: { id: "user", email: "jordan@example.test", role: "user" }, profile: null, application_summary: { total_count: 0, applied_count: 0, needs_action_count: 0 }, generation_quota: { subscription_tier: "basic", monthly_resume_generation_limit: 10, generation_count: 0, remaining_count: 10, period_start: "", resets_at: "" }, workflow_contract_version: "test" });
  vi.mocked(api.fetchBaseResume).mockResolvedValue(resume);
});

describe("base resume save dock", () => {
  it("submits the linked form from the floating dock and keeps offscreen section edits and review gates", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateBaseResume).mockImplementation(async (_id, payload) => ({ ...resume, document: { ...payload.document!, revision: 4 } }));
    renderEditor();
    await user.click(await screen.findByRole("button", { name: "Edit Experience" }));
    const save = screen.getByRole("button", { name: "Save Changes" });
    expect(save.closest("form")).toBeNull();
    expect(save).toHaveAttribute("form", "base-resume-edit-form");
    await user.type(screen.getByRole("textbox", { name: "Employer" }), " Ltd");
    await user.selectOptions(screen.getByRole("combobox", { name: "Current resume section" }), "skills");
    await user.click(screen.getByRole("button", { name: "Edit Skills" }));
    await user.type(screen.getByRole("textbox", { name: /Section content/ }), ", SQL");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(save);
    await waitFor(() => expect(api.updateBaseResume).toHaveBeenCalledWith("base", expect.objectContaining({ expected_revision: 3 })));
    const saved = vi.mocked(api.updateBaseResume).mock.calls[0][1].document!;
    expect(saved.sections[0].entries[0].fields.company).toBe("Acme Ltd");
    expect(saved.sections[0].entries[0].id).toBe("job");
    expect(saved.sections[0].entries[0].bullets[0].id).toBe("fact");
    expect(saved.sections[1].content_md).toBe("Python, SQL");
    expect(saved.sections.every((section) => section.review_state === "needs_review")).toBe(true);
    expect(await screen.findByText("Changes saved")).toBeInTheDocument();
    expect(screen.getByText("2 sections need review before tailoring")).toBeInTheDocument();
  });

  it("keeps edits and unsaved state after a revision conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateBaseResume).mockRejectedValue(new Error("A newer revision was saved. Reload before retrying."));
    renderEditor();
    await user.click(await screen.findByRole("button", { name: "Edit Experience" }));
    await user.type(screen.getByRole("textbox", { name: "Entry 1 bullet 1" }), " for clients");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByText(/A newer revision was saved/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Entry 1 bullet 1" })).toHaveValue("Built services for clients");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
});
