import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/components/layout/AppContext";
import { AppBreadcrumbs } from "@/components/layout/Breadcrumbs";
import { ToastProvider } from "@/components/ui/toast";
import { BaseResumeEditorPage } from "@/routes/BaseResumeEditorPage";
import * as api from "@/lib/api";

vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(),
  fetchSessionBootstrap: vi.fn(), fetchBaseResume: vi.fn(), updateBaseResume: vi.fn(), uploadBaseResume: vi.fn(),
}));

const document: api.ResumeDocument = { schema_version: 1, revision: 3, sections: [
  { id: "experience", kind: "professional_experience", heading: "Experience", enabled: true, review_state: "needs_review", confidence: null, content_md: "", entries: [
    { id: "job", fields: { company: "Acme", title: "Engineer", location: "Remote", date_range: "2022 - Present" }, bullets: [{ id: "fact", text: "Built services", source_ids: [] }] },
  ] },
  { id: "skills", kind: "skills", heading: "Skills", enabled: true, review_state: "needs_review", confidence: null, content_md: "Python", entries: [] },
] };
const resume: api.BaseResumeDetail = { id: "base", name: "Source resume", document, content_md: "", is_default: false, created_at: "", updated_at: "" };

function renderEditor(path = "/app/resumes/base") {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><AppProvider><ToastProvider><AppBreadcrumbs /><Routes><Route path="/app/resumes/:resumeId" element={<BaseResumeEditorPage />} /></Routes></ToastProvider></AppProvider></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.fetchSessionBootstrap).mockResolvedValue({ user: { id: "user", email: "jordan@example.test", role: "user" }, profile: null, application_summary: { total_count: 0, applied_count: 0, needs_action_count: 0 }, generation_quota: { subscription_tier: "basic", monthly_resume_generation_limit: 10, generation_count: 0, remaining_count: 10, period_start: "", resets_at: "" }, workflow_contract_version: "test" });
  vi.mocked(api.fetchBaseResume).mockResolvedValue(resume);
});

describe("base resume save dock", () => {
  it("submits the form from the floating action group and keeps offscreen section edits and review gates", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateBaseResume).mockImplementation(async (_id, payload) => ({ ...resume, document: { ...payload.document!, revision: 4 } }));
    renderEditor();
    await user.click(await screen.findByRole("tab", { name: /Experience/ }));
    await user.click(screen.getByRole("button", { name: "Edit Experience" }));
    const save = screen.getByRole("button", { name: "Save Changes" });
    expect(save.closest("form")).toBeNull();
    expect(save.closest(".app-floating-page-actions")).not.toBeNull();
    expect(save).toHaveAttribute("form", "base-resume-edit-form");
    await user.type(screen.getByRole("textbox", { name: "Employer" }), " Ltd");
    await user.click(screen.getByRole("tab", { name: /Skills/ }));
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
    await user.click(await screen.findByRole("tab", { name: /Experience/ }));
    await user.click(screen.getByRole("button", { name: "Edit Experience" }));
    await user.type(screen.getByRole("textbox", { name: "Entry 1 bullet 1" }), " for clients");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByText(/A newer revision was saved/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Entry 1 bullet 1" })).toHaveValue("Built services for clients");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
});

it("keeps the page label and breadcrumb aligned after a floating rename", async () => {
  const user = userEvent.setup();
  vi.mocked(api.updateBaseResume).mockImplementation(async (_id, payload) => ({ ...resume, name: payload.name!, document: { ...payload.document!, revision: 4 } }));
  renderEditor();
  expect(await screen.findByRole("heading", { name: "Source resume", level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Resume Name" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit resume name" }));
  const input = screen.getByRole("textbox", { name: "Resume Name" });
  expect(input).toHaveAttribute("form", "base-resume-edit-form");
  await user.clear(input);
  await user.type(input, "Engineering resume");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(await screen.findByRole("heading", { name: "Engineering resume", level: 1 })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Engineering resume");
});

it("preserves edits when a duplicate name is rejected", async () => {
  const user = userEvent.setup();
  vi.mocked(api.updateBaseResume).mockRejectedValue(new Error("You already have a resume with this name. Choose a different name."));
  renderEditor();
  await user.click(await screen.findByRole("tab", { name: "Skills" }));
  await user.click(screen.getByRole("button", { name: "Edit Skills" }));
  await user.type(screen.getByRole("textbox", { name: /Section content/ }), ", SQL");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(await screen.findByText(/Choose a different name/)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /Section content/ })).toHaveValue("Python, SQL");
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
});

it("cancels a floating rename without discarding section edits", async () => {
  const user = userEvent.setup();
  renderEditor();
  await user.click(await screen.findByRole("tab", { name: "Skills" }));
  await user.click(screen.getByRole("button", { name: "Edit Skills" }));
  await user.type(screen.getByRole("textbox", { name: /Section content/ }), ", SQL");
  await user.click(screen.getByRole("button", { name: "Edit resume name" }));
  const input = screen.getByRole("textbox", { name: "Resume Name" });
  await user.clear(input);
  await user.type(input, "Cancelled name{Escape}");
  expect(screen.getByRole("heading", { name: "Source resume", level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Resume Name" })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /Section content/ })).toHaveValue("Python, SQL");
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(api.updateBaseResume).not.toHaveBeenCalled();
});

it("submits a floating rename with Enter through its associated save form", async () => {
  const user = userEvent.setup();
  vi.mocked(api.updateBaseResume).mockImplementation(async (_id, payload) => ({ ...resume, name: payload.name!, document: { ...payload.document!, revision: 4 } }));
  renderEditor();
  await user.click(await screen.findByRole("button", { name: "Edit resume name" }));
  const input = screen.getByRole("textbox", { name: "Resume Name" });
  await user.clear(input);
  await user.type(input, "Renamed source{Enter}");
  await waitFor(() => expect(api.updateBaseResume).toHaveBeenCalledWith("base", expect.objectContaining({ name: "Renamed source", expected_revision: 3 })));
  expect(await screen.findByRole("heading", { name: "Renamed source", level: 1 })).toBeInTheDocument();
});

it("starts a new source resume with one focused floating name field", () => {
  renderEditor("/app/resumes/new");
  const input = screen.getByRole("textbox", { name: "Resume Name" });
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute("form", "base-resume-edit-form");
  expect(screen.getAllByRole("textbox", { name: "Resume Name" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Create Resume" })).toBeInTheDocument();
});

it("closes floating name editing when returning an imported resume to upload", async () => {
  const user = userEvent.setup();
  vi.mocked(api.uploadBaseResume).mockResolvedValue({ ...resume, raw_source_md: "Imported source text" });
  renderEditor("/app/resumes/new?mode=upload");
  await user.type(screen.getByRole("textbox", { name: "Resume Name" }), "Import name");
  await user.upload(screen.getByLabelText("PDF File"), new File(["synthetic"], "resume.pdf", { type: "application/pdf" }));
  await user.click(screen.getByRole("button", { name: "Upload & Parse" }));
  await user.click(await screen.findByRole("button", { name: "Edit resume name" }));
  await user.click(screen.getByRole("tab", { name: /Extracted text/ }));
  await user.click(screen.getByRole("button", { name: "Re-upload" }));
  expect(screen.getByRole("heading", { name: "Upload resume", level: 1 })).toBeInTheDocument();
  const input = screen.getByRole("textbox", { name: "Resume Name" });
  expect(input).not.toHaveAttribute("form", "base-resume-edit-form");
  expect(screen.getAllByRole("textbox", { name: "Resume Name" })).toHaveLength(1);
});

it("fills the upload workspace and explains a pending import before opening the parsed sections", async () => {
  const user = userEvent.setup();
  let finishUpload!: (resume: api.BaseResumeDetail) => void;
  vi.mocked(api.uploadBaseResume).mockReturnValue(new Promise((resolve) => { finishUpload = resolve; }));
  renderEditor("/app/resumes/new?mode=upload");
  expect(screen.queryByRole("complementary", { name: "After import" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Start with your existing resume" })).not.toBeInTheDocument();
  expect(screen.getByText(/Drag your PDF here/)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Resume Name" }).closest("form")).toHaveClass("resume-upload-form");
  await user.type(screen.getByRole("textbox", { name: "Resume Name" }), "Import name");
  await user.upload(screen.getByLabelText("PDF File"), new File(["synthetic"], "resume.pdf", { type: "application/pdf" }));
  await user.click(screen.getByRole("button", { name: "Upload & Parse" }));
  expect(screen.getByRole("region", { name: "Reading and structuring your resume" })).toBeInTheDocument();
  expect(screen.getByText("Separate roles and their details")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
  expect(screen.getByRole("button", { name: "Import in progress" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Resume Name" })).toBeDisabled();
  await act(async () => { finishUpload({ ...resume, raw_source_md: "Original extracted text" }); });
  expect(await screen.findByRole("tab", { name: /Experience/ })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Reading and structuring your resume" })).not.toBeInTheDocument();
});

it("keeps upload inputs for retry after failure and explains local-only import accurately", async () => {
  const user = userEvent.setup();
  let failUpload!: (error: Error) => void;
  vi.mocked(api.uploadBaseResume).mockReturnValue(new Promise((_resolve, reject) => { failUpload = reject; }));
  renderEditor("/app/resumes/new?mode=upload");
  const name = screen.getByRole("textbox", { name: "Resume Name" });
  const file = screen.getByLabelText("PDF File");
  await user.type(name, "Retry me");
  await user.upload(file, new File(["synthetic"], "resume.pdf", { type: "application/pdf" }));
  await user.click(screen.getByRole("checkbox", { name: /Use AI to extract/ }));
  await user.click(screen.getByRole("button", { name: "Upload & Parse" }));
  expect(screen.getByRole("status", { name: "Resume processing status" })).toHaveTextContent("without AI entry extraction");
  expect(screen.getByText("Parse recognizable role headers")).toBeInTheDocument();
  await act(async () => { failUpload(new Error("Import unavailable. Retry your PDF.")); });
  expect(await screen.findByText("Import unavailable. Retry your PDF.")).toBeInTheDocument();
  expect(name).toHaveValue("Retry me");
  expect(file).not.toBeDisabled();
  expect((file as HTMLInputElement).files).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Upload & Parse" })).toBeEnabled();
});

it("imports a dropped PDF and rejects multiple or non-PDF drops without replacing it", async () => {
  const user = userEvent.setup();
  vi.mocked(api.uploadBaseResume).mockResolvedValue(resume);
  renderEditor("/app/resumes/new?mode=upload");
  const drop = screen.getByLabelText("PDF File").closest("label")!;
  const pdf = new File(["synthetic"], "dropped.pdf", { type: "application/pdf" });
  fireEvent.drop(drop, { dataTransfer: { files: [pdf] } });
  expect(screen.getByText("dropped.pdf")).toBeInTheDocument();
  fireEvent.drop(drop, { dataTransfer: { files: [new File(["text"], "notes.txt", { type: "text/plain" })] } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a PDF file.");
  fireEvent.drop(drop, { dataTransfer: { files: [pdf, pdf] } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose one PDF file at a time.");
  await user.type(screen.getByRole("textbox", { name: "Resume Name" }), "Dropped resume");
  await user.click(screen.getByRole("button", { name: "Upload & Parse" }));
  await waitFor(() => expect(api.uploadBaseResume).toHaveBeenCalledWith(pdf, "Dropped resume", true));
});

it("ignores dropped replacements while importing and preserves the selected PDF after failure", async () => {
  const user = userEvent.setup();
  let failUpload!: (error: Error) => void;
  vi.mocked(api.uploadBaseResume).mockReturnValue(new Promise((_resolve, reject) => { failUpload = reject; }));
  renderEditor("/app/resumes/new?mode=upload");
  const drop = screen.getByLabelText("PDF File").closest("label")!;
  const pdf = new File(["synthetic"], "first.pdf", { type: "application/pdf" });
  fireEvent.drop(drop, { dataTransfer: { files: [pdf] } });
  await user.type(screen.getByRole("textbox", { name: "Resume Name" }), "Retry dropped file");
  await user.click(screen.getByRole("button", { name: "Upload & Parse" }));
  fireEvent.drop(drop, { dataTransfer: { files: [new File(["other"], "replacement.pdf", { type: "application/pdf" })] } });
  expect(screen.getByText("first.pdf")).toBeInTheDocument();
  expect(screen.queryByText("replacement.pdf")).not.toBeInTheDocument();
  await act(async () => { failUpload(new Error("Try again.")); });
  expect(screen.getByText("first.pdf")).toBeInTheDocument();
  expect(screen.getByLabelText("PDF File")).toBeEnabled();
});
