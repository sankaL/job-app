import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/components/layout/AppContext";
import { ToastProvider } from "@/components/ui/toast";
import { AppBreadcrumbs } from "@/components/layout/Breadcrumbs";
import { ApplicationDetailPage } from "@/routes/ApplicationDetailPage";
import { ApplicationsListPage } from "@/routes/ApplicationsListPage";
import { DashboardPage } from "@/routes/DashboardPage";
import { ExtensionPage } from "@/routes/ExtensionPage";

const api = vi.hoisted(() => ({
  cancelGeneration: vi.fn(),
  createApplication: vi.fn(),
  exportPdf: vi.fn(),
  fetchExtensionStatus: vi.fn(),
  fetchApplicationDetail: vi.fn(),
  fetchApplicationProgress: vi.fn(),
  fetchDraft: vi.fn(),
  fetchSessionBootstrap: vi.fn(),
  issueExtensionToken: vi.fn(),
  listBaseResumes: vi.fn(),
  listApplications: vi.fn(),
  patchApplication: vi.fn(),
  recoverApplicationFromSource: vi.fn(),
  resolveDuplicate: vi.fn(),
  revokeExtensionToken: vi.fn(),
  retryExtraction: vi.fn(),
  saveDraft: vi.fn(),
  submitManualEntry: vi.fn(),
  triggerFullRegeneration: vi.fn(),
  triggerGeneration: vi.fn(),
  triggerSectionRegeneration: vi.fn(),
}));

vi.mock("@/lib/api", () => api);

const defaultBootstrap = {
  user: { id: "u1", email: "test@test.com", role: null },
  profile: null,
  workflow_contract_version: "1",
};

function renderWithAppProvider(
  ui: ReactNode,
  options?: {
    initialEntries?: string[];
  },
) {
  return render(
    <MemoryRouter initialEntries={options?.initialEntries}>
      <AppProvider>
        <ToastProvider>{ui}</ToastProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

describe("phase 1 applications UI", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.fetchDraft.mockResolvedValue(null);
    api.fetchSessionBootstrap.mockResolvedValue(defaultBootstrap);
    api.listBaseResumes.mockResolvedValue([]);
    api.listApplications.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the applications empty state when there are no applications", async () => {
    api.listApplications.mockResolvedValue([]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText(/no applications yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /new application/i })).not.toHaveLength(0);
  });

  it("surfaces dashboard load failures instead of showing the empty state", async () => {
    api.listApplications.mockRejectedValueOnce(new Error("Session expired."));

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/dashboard unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    expect(screen.queryByText(/no applications yet/i)).not.toBeInTheDocument();
  });

  it("shows conditional other-origin input on the manual entry form", async () => {
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: null,
      company: null,
      job_description: null,
      job_posting_origin: null,
      job_posting_origin_other_text: null,
      base_resume_id: null,
      base_resume_name: null,
      visible_status: "needs_action",
      internal_state: "manual_entry_required",
      failure_reason: "extraction_failed",
      applied: false,
      duplicate_similarity_score: null,
      duplicate_resolution_status: null,
      duplicate_matched_application_id: null,
      notes: null,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
      has_action_required_notification: true,
      extraction_failure_details: null,
      duplicate_warning: null,
    });
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-1",
      workflow_kind: "extraction",
      state: "manual_entry_required",
      message: "Manual entry required.",
      percent_complete: 100,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
      completed_at: "2026-04-07T12:00:00Z",
      terminal_error_code: "extraction_failed",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByText(/manual entry required/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/other source label/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/posting source/i), "other");

    expect(await screen.findByPlaceholderText(/other source label/i)).toBeInTheDocument();
  });

  it("renders duplicate review actions on the detail page", async () => {
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: "Backend Engineer",
      company: "Acme",
      job_description: "Build APIs",
      job_posting_origin: "linkedin",
      job_posting_origin_other_text: null,
      base_resume_id: null,
      base_resume_name: null,
      visible_status: "needs_action",
      internal_state: "duplicate_review_required",
      failure_reason: null,
      applied: false,
      duplicate_similarity_score: 98.5,
      duplicate_resolution_status: "pending",
      duplicate_matched_application_id: "app-2",
      notes: null,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
      has_action_required_notification: true,
      extraction_failure_details: null,
      duplicate_warning: {
        similarity_score: 98.5,
        matched_fields: ["job_title", "company", "job_url"],
        match_basis: "exact_job_url",
        matched_application: {
          id: "app-2",
          job_url: "https://example.com/job",
          job_title: "Backend Engineer",
          company: "Acme",
          visible_status: "draft",
        },
      },
    });
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-1",
      workflow_kind: "extraction",
      state: "duplicate_review_required",
      message: "Duplicate review required.",
      percent_complete: 100,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
      completed_at: "2026-04-07T12:00:00Z",
      terminal_error_code: null,
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByText(/duplicate detected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /proceed anyway/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open existing/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/job title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/company/i)).toBeInTheDocument();
  });

  it("shows blocked-source recovery details on the detail page", async () => {
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://www.indeed.com/viewjob?jk=abc123",
      job_title: null,
      company: null,
      job_description: null,
      job_posting_origin: "indeed",
      job_posting_origin_other_text: null,
      base_resume_id: null,
      base_resume_name: null,
      visible_status: "needs_action",
      internal_state: "manual_entry_required",
      failure_reason: "extraction_failed",
      extraction_failure_details: {
        kind: "blocked_source",
        provider: "indeed",
        reference_id: "9e8afb060bd31117",
        blocked_url: "https://www.indeed.com/viewjob?jk=abc123",
        detected_at: "2026-04-07T12:00:00Z",
      },
      applied: false,
      duplicate_similarity_score: null,
      duplicate_resolution_status: null,
      duplicate_matched_application_id: null,
      notes: null,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
      has_action_required_notification: true,
      duplicate_warning: null,
    });
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-1",
      workflow_kind: "extraction",
      state: "manual_entry_required",
      message: "Manual entry required.",
      percent_complete: 100,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
      completed_at: "2026-04-07T12:00:00Z",
      terminal_error_code: "blocked_source",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByText(/blocked automated retrieval/i)).toBeInTheDocument();
    expect(screen.getByText(/9e8afb060bd31117/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry with text/i })).toBeInTheDocument();
  });

  it("refreshes shell breadcrumbs after saving job info on the detail page", async () => {
    api.listApplications
      .mockResolvedValueOnce([
        {
          id: "app-1",
          job_url: "https://example.com/job",
          job_title: "Backend Engineer",
          company: "Acme",
          job_posting_origin: "linkedin",
          visible_status: "in_progress",
          internal_state: "resume_ready",
          failure_reason: null,
          applied: false,
          duplicate_similarity_score: null,
          duplicate_resolution_status: null,
          duplicate_matched_application_id: null,
          created_at: "2026-04-07T12:00:00Z",
          updated_at: "2026-04-07T12:05:00Z",
          base_resume_name: "Default Resume",
          has_action_required_notification: false,
          has_unresolved_duplicate: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "app-1",
          job_url: "https://example.com/job",
          job_title: "Staff Backend Engineer",
          company: "Beta Labs",
          job_posting_origin: "linkedin",
          visible_status: "in_progress",
          internal_state: "resume_ready",
          failure_reason: null,
          applied: false,
          duplicate_similarity_score: null,
          duplicate_resolution_status: null,
          duplicate_matched_application_id: null,
          created_at: "2026-04-07T12:00:00Z",
          updated_at: "2026-04-07T12:15:00Z",
          base_resume_name: "Default Resume",
          has_action_required_notification: false,
          has_unresolved_duplicate: false,
        },
      ]);
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: "Backend Engineer",
      company: "Acme",
      job_description: "Build APIs",
      extracted_reference_id: null,
      job_posting_origin: "linkedin",
      job_posting_origin_other_text: null,
      base_resume_id: "resume-1",
      base_resume_name: "Default Resume",
      visible_status: "in_progress",
      internal_state: "resume_ready",
      failure_reason: null,
      extraction_failure_details: null,
      generation_failure_details: null,
      applied: false,
      duplicate_similarity_score: null,
      duplicate_resolution_status: null,
      duplicate_matched_application_id: null,
      notes: null,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:05:00Z",
      has_action_required_notification: false,
      duplicate_warning: null,
    });
    api.patchApplication.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: "Staff Backend Engineer",
      company: "Beta Labs",
      job_description: "Build APIs",
      extracted_reference_id: null,
      job_posting_origin: "linkedin",
      job_posting_origin_other_text: null,
      base_resume_id: "resume-1",
      base_resume_name: "Default Resume",
      visible_status: "in_progress",
      internal_state: "resume_ready",
      failure_reason: null,
      extraction_failure_details: null,
      generation_failure_details: null,
      applied: false,
      duplicate_similarity_score: null,
      duplicate_resolution_status: null,
      duplicate_matched_application_id: null,
      notes: null,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:15:00Z",
      has_action_required_notification: false,
      duplicate_warning: null,
    });

    renderWithAppProvider(
      <>
        <AppBreadcrumbs />
        <Routes>
          <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
        </Routes>
      </>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByText("Acme — Backend Engineer")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/job title/i));
    await userEvent.type(screen.getByLabelText(/job title/i), "Staff Backend Engineer");
    await userEvent.clear(screen.getByLabelText(/company/i));
    await userEvent.type(screen.getByLabelText(/company/i), "Beta Labs");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Beta Labs — Staff Backend Engineer")).toBeInTheDocument();
    await waitFor(() => expect(api.listApplications).toHaveBeenCalledTimes(2));
  });

  it("renders extension onboarding status", async () => {
    api.fetchExtensionStatus.mockResolvedValue({
      connected: false,
      token_created_at: null,
      token_last_used_at: null,
    });

    render(
      <MemoryRouter initialEntries={["/app/extension"]}>
        <Routes>
          <Route path="/app/extension" element={<ExtensionPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /chrome extension/i })).toBeInTheDocument();
    expect(screen.getByText(/no active token/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect extension/i })).toBeInTheDocument();
  });

  it("treats generation_pending with a failure reason as failed, not active", async () => {
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: "Backend Engineer",
      company: "Acme",
      job_description: "Build APIs",
      extracted_reference_id: null,
      job_posting_origin: "linkedin",
      job_posting_origin_other_text: null,
      base_resume_id: "resume-1",
      base_resume_name: "Default Resume",
      visible_status: "needs_action",
      internal_state: "generation_pending",
      failure_reason: "generation_failed",
      extraction_failure_details: null,
      generation_failure_details: {
        message: "Resume validation failed.",
        validation_errors: ["summary: Invented employer"],
      },
      applied: false,
      duplicate_similarity_score: null,
      duplicate_resolution_status: null,
      duplicate_matched_application_id: null,
      notes: null,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
      has_action_required_notification: true,
      duplicate_warning: null,
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByRole("heading", { name: /generation failed/i })).toBeInTheDocument();
    expect(screen.queryByText(/resume generation/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel generation/i })).not.toBeInTheDocument();
    expect(api.fetchApplicationProgress).not.toHaveBeenCalled();
  });

  it("polls immediately for active generation and swaps to failure UI on terminal progress", async () => {
    api.fetchApplicationDetail
      .mockResolvedValueOnce({
        id: "app-1",
        job_url: "https://example.com/job",
        job_title: "Backend Engineer",
        company: "Acme",
        job_description: "Build APIs",
        extracted_reference_id: null,
        job_posting_origin: "linkedin",
        job_posting_origin_other_text: null,
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
        visible_status: "draft",
        internal_state: "generating",
        failure_reason: null,
        extraction_failure_details: null,
        generation_failure_details: null,
        applied: false,
        duplicate_similarity_score: null,
        duplicate_resolution_status: null,
        duplicate_matched_application_id: null,
        notes: null,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
        has_action_required_notification: false,
        duplicate_warning: null,
      })
      .mockResolvedValueOnce({
        id: "app-1",
        job_url: "https://example.com/job",
        job_title: "Backend Engineer",
        company: "Acme",
        job_description: "Build APIs",
        extracted_reference_id: null,
        job_posting_origin: "linkedin",
        job_posting_origin_other_text: null,
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
        visible_status: "needs_action",
        internal_state: "generation_pending",
        failure_reason: "generation_failed",
        extraction_failure_details: null,
        generation_failure_details: {
          message: "Resume generation failed unexpectedly.",
          validation_errors: null,
        },
        applied: false,
        duplicate_similarity_score: null,
        duplicate_resolution_status: null,
        duplicate_matched_application_id: null,
        notes: null,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:05:00Z",
        has_action_required_notification: true,
        duplicate_warning: null,
      });
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-1",
      workflow_kind: "generation",
      state: "generation_pending",
      message: "Resume generation failed unexpectedly.",
      percent_complete: 100,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:05:00Z",
      completed_at: "2026-04-07T12:05:00Z",
      terminal_error_code: "generation_failed",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() => expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: /generation failed/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel generation/i })).not.toBeInTheDocument();
  });

  it("stops generation polling when terminal progress is returned but detail refresh fails", async () => {
    vi.useFakeTimers();
    api.fetchApplicationDetail
      .mockResolvedValueOnce({
        id: "app-1",
        job_url: "https://example.com/job",
        job_title: "Backend Engineer",
        company: "Acme",
        job_description: "Build APIs",
        extracted_reference_id: null,
        job_posting_origin: "linkedin",
        job_posting_origin_other_text: null,
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
        visible_status: "draft",
        internal_state: "generating",
        failure_reason: null,
        extraction_failure_details: null,
        generation_failure_details: null,
        applied: false,
        duplicate_similarity_score: null,
        duplicate_resolution_status: null,
        duplicate_matched_application_id: null,
        notes: null,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
        has_action_required_notification: false,
        duplicate_warning: null,
      })
      .mockRejectedValueOnce(new Error("Application request failed."));
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-1",
      workflow_kind: "generation",
      state: "generation_failed",
      message: "Resume generation failed unexpectedly.",
      percent_complete: 100,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:05:00Z",
      completed_at: "2026-04-07T12:05:00Z",
      terminal_error_code: "generation_failed",
    });

    await act(async () => {
      renderWithAppProvider(
        <Routes>
          <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
        </Routes>,
        { initialEntries: ["/app/applications/app-1"] },
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/application request failed/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1);
    expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(2);
  });

  it("hydrates saved generation settings from the latest draft", async () => {
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: "Backend Engineer",
      company: "Acme",
      job_description: "Build APIs",
      extracted_reference_id: null,
      job_posting_origin: "linkedin",
      job_posting_origin_other_text: null,
      base_resume_id: "resume-1",
      base_resume_name: "Default Resume",
      visible_status: "in_progress",
      internal_state: "resume_ready",
      failure_reason: null,
      extraction_failure_details: null,
      generation_failure_details: null,
      applied: false,
      duplicate_similarity_score: null,
      duplicate_resolution_status: null,
      duplicate_matched_application_id: null,
      notes: null,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:05:00Z",
      has_action_required_notification: false,
      duplicate_warning: null,
    });
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume",
      generation_params: {
        page_length: "3_page",
        aggressiveness: "high",
        additional_instructions: "Emphasize architecture leadership.",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:05:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:05:00Z",
    });
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Default Resume",
        is_default: true,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("3 Pages")).toBeChecked();
    expect(screen.getByRole("radio", { name: /high/i })).toBeChecked();
    expect(screen.getByDisplayValue("Emphasize architecture leadership.")).toBeInTheDocument();
  });
});
