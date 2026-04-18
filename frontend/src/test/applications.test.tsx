import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/components/layout/AppContext";
import { ShellLayoutProvider } from "@/components/layout/ShellLayoutContext";
import { TopBar } from "@/components/layout/TopBar";
import { ToastProvider } from "@/components/ui/toast";
import { AppBreadcrumbs } from "@/components/layout/Breadcrumbs";
import { AppShell } from "@/routes/AppShell";
import { ApplicationDetailPage } from "@/routes/ApplicationDetailPage";
import { ApplicationsListPage } from "@/routes/ApplicationsListPage";
import { AdminUsersPage } from "@/routes/AdminUsersPage";
import { BaseResumeEditorPage } from "@/routes/BaseResumeEditorPage";
import { BaseResumesPage } from "@/routes/BaseResumesPage";
import { DashboardPage } from "@/routes/DashboardPage";
import { ExtensionPage } from "@/routes/ExtensionPage";
import { ProfilePage } from "@/routes/ProfilePage";
import { createAppQueryClient } from "@/lib/query-client";

const api = vi.hoisted(() => ({
  cancelExtraction: vi.fn(),
  cancelGeneration: vi.fn(),
  createApplication: vi.fn(),
  createBaseResume: vi.fn(),
  clearNotifications: vi.fn(),
  deactivateAdminUser: vi.fn(),
  deleteApplication: vi.fn(),
  deleteAdminUser: vi.fn(),
  deleteBaseResume: vi.fn(),
  exportDocx: vi.fn(),
  exportPdf: vi.fn(),
  fetchExtensionStatus: vi.fn(),
  fetchApplicationDetail: vi.fn(),
  fetchAdminMetrics: vi.fn(),
  fetchProfile: vi.fn(),
  fetchApplicationProgress: vi.fn(),
  fetchBaseResume: vi.fn(),
  fetchDraft: vi.fn(),
  fetchSessionBootstrap: vi.fn(),
  inviteAdminUser: vi.fn(),
  issueExtensionToken: vi.fn(),
  listAdminUsers: vi.fn(),
  listBaseResumes: vi.fn(),
  listApplications: vi.fn(),
  listNotifications: vi.fn(),
  openApplicationEventStream: vi.fn(),
  patchApplication: vi.fn(),
  reactivateAdminUser: vi.fn(),
  recoverApplicationFromSource: vi.fn(),
  resolveDuplicate: vi.fn(),
  revokeExtensionToken: vi.fn(),
  retryExtraction: vi.fn(),
  saveDraft: vi.fn(),
  setDefaultBaseResume: vi.fn(),
  submitManualEntry: vi.fn(),
  triggerFullRegeneration: vi.fn(),
  triggerGeneration: vi.fn(),
  triggerResumeJudge: vi.fn(),
  triggerSectionRegeneration: vi.fn(),
  updateAdminUser: vi.fn(),
  updateBaseResume: vi.fn(),
  updateProfile: vi.fn(),
  uploadBaseResume: vi.fn(),
}));

vi.mock("@/lib/api", () => api);
vi.mock("@/lib/supabase", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      signOut: vi.fn(),
    },
  }),
}));

const defaultBootstrap = {
  user: { id: "u1", email: "test@test.com", role: null },
  profile: {
    id: "user-1",
    email: "test@test.com",
    first_name: "Alex",
    last_name: "Example",
    name: "Alex Example",
    phone: "555-0100",
    address: "Toronto, ON",
    linkedin_url: "https://linkedin.com/in/alex-example",
    is_admin: false,
    is_active: true,
    onboarding_completed_at: "2026-04-07T12:00:00Z",
    default_base_resume_id: null,
    section_preferences: {
      summary: true,
      professional_experience: true,
      education: true,
      skills: true,
    },
    section_order: ["summary", "professional_experience", "education", "skills"],
    created_at: "2026-04-07T12:00:00Z",
    updated_at: "2026-04-07T12:00:00Z",
  },
  application_summary: {
    total_count: 0,
    applied_count: 0,
    needs_action_count: 0,
  },
  workflow_contract_version: "1",
};

function buildApplicationSummary(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function buildApplicationDetail(overrides: Record<string, unknown> = {}) {
  const summary = buildApplicationSummary(overrides);
  return {
    ...summary,
    job_description: "Build APIs",
    job_location_text: null,
    compensation_text: null,
    extracted_reference_id: null,
    job_posting_origin_other_text: null,
    base_resume_id: null,
    notes: null,
    extraction_failure_details: null,
    generation_failure_details: null,
    resume_judge_result: null,
    duplicate_warning: null,
    ...overrides,
  };
}

function buildAdminUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-2",
    email: "member@example.com",
    first_name: "Casey",
    last_name: "Member",
    name: "Casey Member",
    address: "Toronto, ON",
    phone: "555-0134",
    linkedin_url: "https://linkedin.com/in/casey-member",
    is_admin: false,
    is_active: true,
    onboarding_completed_at: "2026-04-07T12:00:00Z",
    latest_invite_status: "accepted",
    latest_invite_sent_at: "2026-04-07T12:00:00Z",
    latest_invite_expires_at: "2026-04-14T12:00:00Z",
    created_at: "2026-04-07T12:00:00Z",
    updated_at: "2026-04-07T12:05:00Z",
    ...overrides,
  };
}

function renderWithAppProvider(
  ui: ReactNode,
  options?: {
    initialEntries?: string[];
  },
) {
  const queryClient = createAppQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={options?.initialEntries}>
        <AppProvider>
          <ToastProvider>
            <ShellLayoutProvider>{ui}</ShellLayoutProvider>
          </ToastProvider>
        </AppProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderTopBar(options?: {
  initialEntries?: string[];
}) {
  return renderWithAppProvider(
    <Routes>
      <Route path="/app" element={<TopBar />} />
      <Route path="/app/applications/:applicationId" element={<div>Detail Route</div>} />
    </Routes>,
    { initialEntries: options?.initialEntries ?? ["/app"] },
  );
}

function buildNotificationSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: "notif-1",
    application_id: "app-1",
    type: "info",
    message: "Resume generated successfully.",
    action_required: false,
    read: false,
    created_at: "2026-04-09T12:00:00Z",
    ...overrides,
  };
}

function latestStreamHandlers() {
  const lastCall = api.openApplicationEventStream.mock.calls.at(-1);
  if (!lastCall) {
    throw new Error("Expected live stream to be opened.");
  }
  return lastCall[1] as {
    onSnapshot: (snapshot: { detail: ReturnType<typeof buildApplicationDetail>; progress: ReturnType<typeof buildProgressPayload> | null }) => void;
    onProgress: (progress: ReturnType<typeof buildProgressPayload>) => void;
    onDetail: (detail: ReturnType<typeof buildApplicationDetail>) => void;
    onHeartbeat?: (heartbeat: { sent_at: string }) => void;
  };
}

function buildProgressPayload(overrides: Record<string, unknown> = {}) {
  return {
    job_id: "job-1",
    workflow_kind: "generation",
    state: "generating",
    message: "Resume generation is running.",
    percent_complete: 25,
    created_at: "2026-04-07T12:00:00Z",
    updated_at: "2026-04-07T12:01:00Z",
    completed_at: null,
    terminal_error_code: null,
    ...overrides,
  };
}

describe("phase 1 applications UI", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    globalThis.URL.revokeObjectURL = vi.fn();
    api.openApplicationEventStream.mockImplementation(
      () =>
        new Promise<void>(() => {
          // Keep the stream open by default so tests opt into explicit live events.
        }),
    );
    api.fetchApplicationDetail.mockResolvedValue(buildApplicationDetail());
    api.fetchApplicationProgress.mockResolvedValue(buildProgressPayload());
    api.fetchDraft.mockResolvedValue(null);
    api.fetchProfile.mockResolvedValue({
      id: "user-1",
      email: "test@test.com",
      name: "Alex Example",
      phone: "555-0100",
      address: "Toronto, ON",
      linkedin_url: "https://linkedin.com/in/alex-example",
      default_base_resume_id: null,
      section_preferences: {
        summary: true,
        professional_experience: true,
        education: true,
        skills: true,
      },
      section_order: ["summary", "professional_experience", "education", "skills"],
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
    });
    api.fetchSessionBootstrap.mockResolvedValue(defaultBootstrap);
    api.fetchBaseResume.mockResolvedValue({
      id: "resume-1",
      name: "Default Resume",
      content_md: "# Base Resume\n\n## Summary\nGrounded summary",
      is_default: true,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
    });
    api.listAdminUsers.mockResolvedValue([]);
    api.listBaseResumes.mockResolvedValue([]);
    api.listApplications.mockResolvedValue([]);
    api.listNotifications.mockResolvedValue([]);
    api.updateProfile.mockImplementation(async (payload) => ({
      id: "user-1",
      email: "test@test.com",
      name: payload.name ?? "Alex Example",
      phone: payload.phone ?? "555-0100",
      address: payload.address ?? "Toronto, ON",
      linkedin_url: payload.linkedin_url ?? "https://linkedin.com/in/alex-example",
      default_base_resume_id: null,
      section_preferences: payload.section_preferences ?? {
        summary: true,
        professional_experience: true,
        education: true,
        skills: true,
      },
      section_order: payload.section_order ?? ["summary", "professional_experience", "education", "skills"],
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:05:00Z",
    }));
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

  it("loads the applications page with one bootstrap request and one applications request", async () => {
    api.listApplications.mockResolvedValue([]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText(/no applications yet/i)).toBeInTheDocument();
    expect(api.fetchSessionBootstrap).toHaveBeenCalledTimes(1);
    expect(api.listApplications).toHaveBeenCalledTimes(1);
  });

  it("loads the dashboard with one bootstrap request and one applications request", async () => {
    api.listApplications.mockResolvedValue([]);

    renderWithAppProvider(<DashboardPage />);

    expect(await screen.findByText(/no applications yet/i)).toBeInTheDocument();
    expect(api.fetchSessionBootstrap).toHaveBeenCalledTimes(1);
    expect(api.listApplications).toHaveBeenCalledTimes(1);
  });

  it("loads the resumes page with one bootstrap request and one base resumes request", async () => {
    api.listBaseResumes.mockResolvedValue([]);

    renderWithAppProvider(<BaseResumesPage />);

    expect(await screen.findByText(/no resumes yet/i)).toBeInTheDocument();
    expect(api.fetchSessionBootstrap).toHaveBeenCalledTimes(1);
    expect(api.listBaseResumes).toHaveBeenCalledTimes(1);
    expect(api.listApplications).toHaveBeenCalledTimes(0);
  });

  it("initializes the profile page from bootstrap without calling the profile endpoint", async () => {
    renderWithAppProvider(<ProfilePage />);

    expect(await screen.findByDisplayValue("Alex Example")).toBeInTheDocument();
    expect(api.fetchSessionBootstrap).toHaveBeenCalledTimes(1);
    expect(api.fetchProfile).not.toHaveBeenCalled();
  });

  it("shows a recoverable error on the profile page when bootstrap fails", async () => {
    api.fetchSessionBootstrap.mockRejectedValue(new Error("Session bootstrap failed."));

    renderWithAppProvider(<ProfilePage />);

    expect(await screen.findByText(/profile unavailable/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Session bootstrap failed.")).toBeInTheDocument();
  });

  it("opens a new application modal with only the URL field visible by default", async () => {
    api.listApplications.mockResolvedValue([]);

    renderWithAppProvider(<ApplicationsListPage />);

    await screen.findByText(/no applications yet/i);
    await userEvent.click(screen.getAllByRole("button", { name: /new application/i })[0]);

    expect(await screen.findByRole("dialog", { name: /new application/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/job url/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/pasted job description/i)).not.toBeInTheDocument();
  });

  it("reveals the pasted job description field only when the user asks for it", async () => {
    api.listApplications.mockResolvedValue([]);

    renderWithAppProvider(<ApplicationsListPage />);

    await screen.findByText(/no applications yet/i);
    await userEvent.click(screen.getAllByRole("button", { name: /new application/i })[0]);
    await userEvent.click(screen.getByRole("button", { name: /paste it/i }));

    expect(await screen.findByLabelText(/pasted job description/i)).toBeInTheDocument();
  });

  it("submits URL-only application creation from the modal and navigates to the detail page", async () => {
    api.listApplications.mockResolvedValue([]);
    api.createApplication.mockResolvedValue(buildApplicationDetail({ id: "app-42", job_url: "https://example.com/jobs/42" }));

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications" element={<ApplicationsListPage />} />
        <Route path="/app/applications/:applicationId" element={<div>Detail Route</div>} />
      </Routes>,
      { initialEntries: ["/app/applications"] },
    );

    await screen.findByText(/no applications yet/i);
    await userEvent.click(screen.getAllByRole("button", { name: /new application/i })[0]);
    await userEvent.type(screen.getByLabelText(/job url/i), "https://example.com/jobs/42");
    await userEvent.click(screen.getByRole("button", { name: /create application/i }));

    await waitFor(() =>
      expect(api.createApplication).toHaveBeenCalledWith({ job_url: "https://example.com/jobs/42", source_text: undefined }),
    );
    expect(await screen.findByText("Detail Route")).toBeInTheDocument();
  });

  it("submits pasted job text from the modal when that field is revealed", async () => {
    api.listApplications.mockResolvedValue([]);
    api.createApplication.mockResolvedValue(buildApplicationDetail({ id: "app-84", job_url: "https://example.com/jobs/84" }));

    renderWithAppProvider(<ApplicationsListPage />);

    await screen.findByText(/no applications yet/i);
    await userEvent.click(screen.getAllByRole("button", { name: /new application/i })[0]);
    await userEvent.type(screen.getByLabelText(/job url/i), "https://example.com/jobs/84");
    await userEvent.click(screen.getByRole("button", { name: /paste it/i }));
    await userEvent.type(
      await screen.findByLabelText(/pasted job description/i),
      "Senior Platform Engineer. Build APIs, queues, and internal tools.",
    );
    await userEvent.click(screen.getByRole("button", { name: /create with pasted text/i }));

    await waitFor(() =>
      expect(api.createApplication).toHaveBeenCalledWith({
        job_url: "https://example.com/jobs/84",
        source_text: "Senior Platform Engineer. Build APIs, queues, and internal tools.",
      }),
    );
  });

  it("keeps create failures inside the modal instead of promoting them to the page error card", async () => {
    api.listApplications.mockResolvedValue([]);
    api.createApplication.mockRejectedValueOnce(new Error("Unable to create application."));

    renderWithAppProvider(<ApplicationsListPage />);

    await screen.findByText(/no applications yet/i);
    await userEvent.click(screen.getAllByRole("button", { name: /new application/i })[0]);
    await userEvent.type(screen.getByLabelText(/job url/i), "https://example.com/jobs/99");
    await userEvent.click(screen.getByRole("button", { name: /create application/i }));

    expect(await screen.findByText("Unable to create application.")).toBeInTheDocument();
    expect(screen.queryByText("Request failed")).not.toBeInTheDocument();
  });

  it("opens the notifications dropdown and keeps the badge count tied to attention items", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", visible_status: "needs_action", has_action_required_notification: true }),
      buildApplicationSummary({ id: "app-2", visible_status: "complete" }),
    ]);
    api.listNotifications.mockResolvedValue([
      buildNotificationSummary({ id: "notif-1", message: "Resume generated successfully." }),
      buildNotificationSummary({
        id: "notif-2",
        application_id: null,
        type: "success",
        message: "Export completed successfully.",
      }),
    ]);

    renderTopBar();

    const bell = screen.getByRole("button", { name: /notifications/i });
    expect(api.listNotifications).not.toHaveBeenCalled();

    await userEvent.click(bell);

    expect(await screen.findByRole("dialog", { name: /notifications panel/i })).toBeInTheDocument();
    expect(await screen.findByText("Resume generated successfully.")).toBeInTheDocument();
    expect(api.listNotifications).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(bell).getByText("1")).toBeInTheDocument());
  });

  it("renders a scrollable notifications list for larger inboxes", async () => {
    api.listNotifications.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        buildNotificationSummary({
          id: `notif-${index}`,
          application_id: `app-${index}`,
          message: `Notification ${index + 1}`,
          created_at: `2026-04-09T12:${String(index).padStart(2, "0")}:00Z`,
        }),
      ),
    );

    renderTopBar();

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    const notificationsList = await screen.findByRole("list", { name: /notifications list/i });
    expect(notificationsList).toHaveClass("max-h-96");
    expect(notificationsList).toHaveClass("overflow-y-auto");
  });

  it("navigates to the linked application when a notification is selected", async () => {
    api.listNotifications.mockResolvedValue([
      buildNotificationSummary({
        id: "notif-route",
        application_id: "app-42",
        message: "Generation finished for Platform Engineer.",
      }),
    ]);

    renderTopBar();

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await userEvent.click(await screen.findByRole("button", { name: /generation finished for platform engineer/i }));

    expect(await screen.findByText("Detail Route")).toBeInTheDocument();
  });

  it("shows orphaned notifications without navigation", async () => {
    api.listNotifications.mockResolvedValue([
      buildNotificationSummary({
        id: "notif-orphan",
        application_id: null,
        message: "Account-level notification.",
      }),
    ]);

    renderTopBar();

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    const notificationButton = await screen.findByRole("button", { name: /account-level notification/i });
    expect(notificationButton).toBeDisabled();
    await userEvent.click(notificationButton);
    expect(screen.queryByText("Detail Route")).not.toBeInTheDocument();
  });

  it("shows an empty notifications state when the inbox is clear", async () => {
    api.listNotifications.mockResolvedValue([]);

    renderTopBar();

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
  });

  it("clears only notifications that do not need attention", async () => {
    api.listApplications
      .mockResolvedValueOnce([buildApplicationSummary({ id: "app-1", has_action_required_notification: true })])
      .mockResolvedValueOnce([buildApplicationSummary({ id: "app-1", has_action_required_notification: false })]);
    api.listNotifications
      .mockResolvedValueOnce([
        buildNotificationSummary({
          id: "notif-clear",
          application_id: "app-1",
          message: "Resume needs manual review.",
          action_required: true,
          type: "warning",
        }),
        buildNotificationSummary({
          id: "notif-clearable",
          application_id: null,
          message: "Export completed successfully.",
          action_required: false,
          type: "success",
        }),
      ])
      .mockResolvedValueOnce([
        buildNotificationSummary({
          id: "notif-clear",
          application_id: "app-1",
          message: "Resume needs manual review.",
          action_required: true,
          type: "warning",
        }),
      ]);
    api.clearNotifications.mockResolvedValue(undefined);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    renderWithAppProvider(
      <>
        <TopBar />
        <ApplicationsListPage />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await userEvent.click(await screen.findByRole("button", { name: /clear all/i }));

    await waitFor(() => expect(api.clearNotifications).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listApplications).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Resume needs manual review.")).toBeInTheDocument();
    expect(screen.queryByText("Export completed successfully.")).not.toBeInTheDocument();
    expect(screen.getByText("Cleared notifications that do not need attention.")).toBeInTheDocument();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("shows a sanitized error state when notifications fail to load", async () => {
    api.listNotifications.mockRejectedValueOnce(new Error("Failed to load notifications."));

    renderTopBar();

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
  });

  it("keeps notifications visible when clearing fails", async () => {
    api.listNotifications.mockResolvedValue([
      buildNotificationSummary({
        id: "notif-clear-error",
        application_id: "app-1",
        message: "Resume needs manual review.",
        action_required: true,
        type: "warning",
      }),
    ]);
    api.clearNotifications.mockRejectedValueOnce(new Error("Failed to clear notifications"));

    renderTopBar();

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await userEvent.click(await screen.findByRole("button", { name: /clear all/i }));

    await waitFor(() => expect(api.clearNotifications).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Resume needs manual review.")).toBeInTheDocument();
    expect(screen.getByText("Failed to clear notifications")).toBeInTheDocument();
  });

  it("supports current-page selection without triggering row navigation", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer" }),
      buildApplicationSummary({ id: "app-2", job_title: "Platform Engineer", company: "Beta Labs" }),
    ]);

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications" element={<ApplicationsListPage />} />
        <Route path="/app/applications/:applicationId" element={<div>Detail Route</div>} />
      </Routes>,
      { initialEntries: ["/app/applications"] },
    );

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Select Backend Engineer"));

    expect(screen.getByText("1 application selected")).toBeInTheDocument();
    expect(screen.queryByText("Detail Route")).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/select current page/i));

    expect(screen.getByText("2 applications selected")).toBeInTheDocument();
    expect(screen.getByLabelText("Select Backend Engineer")).toBeChecked();
    expect(screen.getByLabelText("Select Platform Engineer")).toBeChecked();
  });

  it("bulk mark applied updates only selected rows that are not already applied", async () => {
    const initial = [
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer", applied: false }),
      buildApplicationSummary({ id: "app-2", job_title: "Platform Engineer", company: "Beta Labs", applied: true }),
    ];
    const updated = [
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer", applied: true }),
      buildApplicationSummary({ id: "app-2", job_title: "Platform Engineer", company: "Beta Labs", applied: true }),
    ];
    api.listApplications
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(updated);
    api.patchApplication.mockResolvedValue({
      ...buildApplicationSummary({ id: "app-1", applied: true }),
      job_description: "Build APIs",
      extracted_reference_id: null,
      job_posting_origin_other_text: null,
      base_resume_id: null,
      notes: null,
      extraction_failure_details: null,
      generation_failure_details: null,
      duplicate_warning: null,
    });

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Select Backend Engineer"));
    await userEvent.click(screen.getByLabelText("Select Platform Engineer"));
    await userEvent.click(screen.getAllByRole("button", { name: /mark applied/i })[0]);

    await waitFor(() => expect(api.patchApplication).toHaveBeenCalledTimes(1));
    expect(api.patchApplication).toHaveBeenCalledWith("app-1", { applied: true });
    expect(await screen.findByText(/marked 1 application as applied/i)).toBeInTheDocument();
    expect(screen.queryByText("2 applications selected")).not.toBeInTheDocument();
  });

  it("shows singular and plural bulk delete confirmation copy", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer" }),
      buildApplicationSummary({ id: "app-2", job_title: "Platform Engineer", company: "Beta Labs" }),
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Select Backend Engineer"));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(await screen.findByText("Delete application?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    await userEvent.click(screen.getByLabelText("Select Platform Engineer"));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(await screen.findByText("Delete applications?")).toBeInTheDocument();
  });

  it("disables bulk delete when selected rows are still processing", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer", internal_state: "generating" }),
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Select Backend Engineer"));

    expect(screen.getByRole("button", { name: /^delete$/i })).toBeDisabled();
    expect(screen.getByText(/delete is unavailable while 1 selected application is still processing/i)).toBeInTheDocument();
  });

  it("keeps failed selections after a partial bulk delete failure", async () => {
    const initial = [
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer" }),
      buildApplicationSummary({ id: "app-2", job_title: "Platform Engineer", company: "Beta Labs" }),
    ];
    const updated = [buildApplicationSummary({ id: "app-2", job_title: "Platform Engineer", company: "Beta Labs" })];
    api.listApplications
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(updated);
    api.deleteApplication
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Application cannot be deleted while background work is still running."));

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Select Backend Engineer"));
    await userEvent.click(screen.getByLabelText("Select Platform Engineer"));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /delete applications/i }));

    await waitFor(() => expect(api.deleteApplication).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("1 application selected")).toBeInTheDocument();
    expect(screen.getByLabelText("Select Platform Engineer")).toBeChecked();
    expect(await screen.findByText(/1 application failed/i)).toBeInTheDocument();
  });

  it("renders row-level icon delete controls for idle applications", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer", internal_state: "resume_ready" }),
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete backend engineer/i })).toBeInTheDocument();
  });

  it("renders row-level stop controls for active extraction applications", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer", internal_state: "extracting", visible_status: "draft" }),
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop extraction for backend engineer/i })).toBeInTheDocument();
  });

  it("disables row-level delete controls while generation work is active", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer", internal_state: "generating", visible_status: "draft" }),
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete unavailable while backend engineer is still processing/i })).toBeDisabled();
  });

  it("renders middle-aligned application table cells for the compact list layout", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer" }),
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    const titleCell = await screen.findByText("Backend Engineer");
    const row = titleCell.closest("tr");
    const firstCell = row?.querySelector("td");

    expect(firstCell?.className).toContain("align-middle");
  });

  it("surfaces dashboard load failures instead of showing the empty state", async () => {
    api.listApplications.mockRejectedValueOnce(new Error("Session expired."));

    renderWithAppProvider(<DashboardPage />);

    expect(await screen.findByText(/dashboard unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    expect(screen.queryByText(/no applications yet/i)).not.toBeInTheDocument();
  });

  it("renders the monthly activity year selector and updates dashboard analytics for prior years", async () => {
    const user = userEvent.setup();
    const currentYear = new Date().getFullYear();
    const previousYear = currentYear - 1;

    api.listApplications.mockResolvedValue([
      {
        id: "app-current-1",
        job_url: "https://example.com/1",
        job_title: "Platform Engineer",
        company: "Northstar",
        job_posting_origin: "linkedin",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        failure_reason: null,
        applied: true,
        duplicate_similarity_score: null,
        duplicate_resolution_status: null,
        duplicate_matched_application_id: null,
        created_at: `${currentYear}-01-12T12:00:00Z`,
        updated_at: `${currentYear}-01-14T12:00:00Z`,
        base_resume_name: "Default Resume",
        has_action_required_notification: false,
        has_unresolved_duplicate: false,
      },
      {
        id: "app-current-2",
        job_url: "https://example.com/2",
        job_title: "Product Analyst",
        company: "Northstar",
        job_posting_origin: "indeed",
        visible_status: "draft",
        internal_state: "draft_created",
        failure_reason: null,
        applied: false,
        duplicate_similarity_score: null,
        duplicate_resolution_status: null,
        duplicate_matched_application_id: null,
        created_at: `${currentYear}-03-03T12:00:00Z`,
        updated_at: `${currentYear}-03-03T12:00:00Z`,
        base_resume_name: "Default Resume",
        has_action_required_notification: false,
        has_unresolved_duplicate: false,
      },
      {
        id: "app-previous-1",
        job_url: "https://example.com/3",
        job_title: "Backend Engineer",
        company: "Acme",
        job_posting_origin: "linkedin",
        visible_status: "complete",
        internal_state: "applied",
        failure_reason: null,
        applied: true,
        duplicate_similarity_score: null,
        duplicate_resolution_status: null,
        duplicate_matched_application_id: null,
        created_at: `${previousYear}-02-11T12:00:00Z`,
        updated_at: `${previousYear}-02-12T12:00:00Z`,
        base_resume_name: "Default Resume",
        has_action_required_notification: false,
        has_unresolved_duplicate: false,
      },
      {
        id: "app-previous-2",
        job_url: "https://example.com/4",
        job_title: "ML Engineer",
        company: "Beacon",
        job_posting_origin: "company_website",
        visible_status: "needs_action",
        internal_state: "manual_entry_required",
        failure_reason: "extraction_failed",
        applied: true,
        duplicate_similarity_score: null,
        duplicate_resolution_status: null,
        duplicate_matched_application_id: null,
        created_at: `${previousYear}-05-08T12:00:00Z`,
        updated_at: `${previousYear}-05-09T12:00:00Z`,
        base_resume_name: "Default Resume",
        has_action_required_notification: true,
        has_unresolved_duplicate: false,
      },
      {
        id: "app-previous-3",
        job_url: "https://example.com/5",
        job_title: "Design Systems Lead",
        company: "Beacon",
        job_posting_origin: "glassdoor",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        failure_reason: null,
        applied: false,
        duplicate_similarity_score: null,
        duplicate_resolution_status: null,
        duplicate_matched_application_id: null,
        created_at: `${previousYear}-10-02T12:00:00Z`,
        updated_at: `${previousYear}-10-03T12:00:00Z`,
        base_resume_name: "Default Resume",
        has_action_required_notification: false,
        has_unresolved_duplicate: false,
      },
    ]);

    renderWithAppProvider(<DashboardPage />);

    expect(await screen.findByText("Monthly Activity")).toBeInTheDocument();
    expect(screen.getByText("Job Sources")).toBeInTheDocument();
    expect(screen.getByText("Top Companies")).toBeInTheDocument();
    expect(screen.getByText("Status Breakdown")).toBeInTheDocument();

    const yearSelect = screen.getByRole("combobox", { name: /select monthly activity year/i });
    expect(yearSelect).toHaveValue(String(currentYear));
    expect(within(yearSelect).getByRole("option", { name: String(previousYear) })).toBeInTheDocument();

    const chart = screen.getByTestId("monthly-activity-chart");
    expect(chart).toHaveAttribute("aria-label", `Monthly activity for ${currentYear}`);
    expect(screen.getByText("2 created")).toBeInTheDocument();
    expect(screen.getByText("1 created + applied")).toBeInTheDocument();
    expect(screen.getByText(`${currentYear} overview`)).toBeInTheDocument();

    await user.selectOptions(yearSelect, String(previousYear));

    expect(chart).toHaveAttribute("aria-label", `Monthly activity for ${previousYear}`);
    expect(screen.getByText("3 created")).toBeInTheDocument();
    expect(screen.getByText("2 created + applied")).toBeInTheDocument();
    expect(screen.getByText(`${previousYear} overview`)).toBeInTheDocument();
  });

  it("aggregates lower-volume job sources into an other bucket", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_posting_origin: "linkedin" }),
      buildApplicationSummary({ id: "app-2", job_posting_origin: "linkedin" }),
      buildApplicationSummary({ id: "app-3", job_posting_origin: "linkedin" }),
      buildApplicationSummary({ id: "app-4", job_posting_origin: "indeed" }),
      buildApplicationSummary({ id: "app-5", job_posting_origin: "indeed" }),
      buildApplicationSummary({ id: "app-6", job_posting_origin: "company_website" }),
      buildApplicationSummary({ id: "app-7", job_posting_origin: "glassdoor" }),
      buildApplicationSummary({ id: "app-8", job_posting_origin: "monster" }),
    ]);

    renderWithAppProvider(<DashboardPage />);

    expect(await screen.findByText("Job Sources")).toBeInTheDocument();
    expect(screen.getByText("LinkedIn")).toBeInTheDocument();
    expect(screen.getByText("Indeed")).toBeInTheDocument();
    expect(screen.getByText("Company Website")).toBeInTheDocument();
    const otherRow = screen.getByText("Other").closest("div.flex.items-center.justify-between.gap-3");

    expect(otherRow).not.toBeNull();
    expect(screen.getByLabelText("Job sources pie chart")).toHaveTextContent("8");
    expect(within(otherRow as HTMLElement).getByText("2")).toBeInTheDocument();
  });

  it("renders authenticated pages inside the fluid shell without a desktop max-width cap", async () => {
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <MemoryRouter initialEntries={["/app"]}>
          <AppProvider>
            <ToastProvider>
              <Routes>
                <Route path="/app" element={<AppShell />}>
                  <Route index element={<div>Shell Child</div>} />
                </Route>
              </Routes>
            </ToastProvider>
          </AppProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const shellChild = await screen.findByText("Shell Child");
    const shellContent = shellChild.closest(".app-shell-content");

    expect(shellContent).not.toBeNull();
    expect(shellContent?.className).not.toContain("max-w-[1440px]");
  });

  it("shows only the primary needs-action status in application rows", async () => {
    api.listApplications.mockResolvedValue([
      {
        id: "app-1",
        job_url: "https://example.com/job",
        job_title: "Blocked role",
        company: "Acme",
        job_posting_origin: "linkedin",
        visible_status: "needs_action",
        internal_state: "manual_entry_required",
        failure_reason: "extraction_failed",
        applied: false,
        duplicate_similarity_score: null,
        duplicate_resolution_status: null,
        duplicate_matched_application_id: null,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
        base_resume_name: "Default Resume",
        has_action_required_notification: true,
        has_unresolved_duplicate: false,
      },
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    const titleCell = await screen.findByText("Blocked role");
    const row = titleCell.closest("tr");

    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Needs Action")).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText(/action required/i)).not.toBeInTheDocument();
  });

  it("shows conditional other-origin input on the manual entry form", async () => {
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: null,
      company: null,
      job_description: null,
      compensation_text: null,
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
      compensation_text: null,
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

  it("renders the wide detail workspace with settings and generated resume panels", async () => {
    api.listBaseResumes.mockResolvedValue([{ id: "resume-1", name: "Default Resume", is_default: true, created_at: "2026-04-07T12:00:00Z", updated_at: "2026-04-07T12:00:00Z" }]);
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: "AI & Data Senior Manager",
      company: "Accenture",
      job_description: "Lead AI delivery programs.",
      compensation_text: "$170,000 - $210,000 base salary",
      job_posting_origin: "company_website",
      job_posting_origin_other_text: null,
      base_resume_id: "resume-1",
      base_resume_name: "Default Resume",
      visible_status: "in_progress",
      internal_state: "resume_ready",
      failure_reason: null,
      applied: false,
      duplicate_similarity_score: null,
      duplicate_resolution_status: null,
      duplicate_matched_application_id: null,
      notes: null,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
      has_action_required_notification: false,
      extraction_failure_details: null,
      duplicate_warning: null,
      generation_failure_details: null,
    });
    api.fetchDraft.mockResolvedValue({
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByText(/generated resume/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /job description/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /generation settings/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("$170,000 - $210,000 base salary")).toBeInTheDocument();
    expect(screen.getByText(/grounded summary/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete application/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark applied/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view posting/i })).toBeInTheDocument();
  });

  it("downloads DOCX using the server-provided filename", async () => {
    const user = userEvent.setup();
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    api.listBaseResumes.mockResolvedValue([{ id: "resume-1", name: "Default Resume", is_default: true, created_at: "2026-04-07T12:00:00Z", updated_at: "2026-04-07T12:00:00Z" }]);
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: "Backend Engineer",
      company: "Acme",
      job_description: "Build APIs",
      compensation_text: null,
      job_posting_origin: "company_website",
      job_posting_origin_other_text: null,
      base_resume_id: "resume-1",
      base_resume_name: "Default Resume",
      visible_status: "in_progress",
      internal_state: "resume_ready",
      failure_reason: null,
      applied: false,
      duplicate_similarity_score: null,
      duplicate_resolution_status: null,
      duplicate_matched_application_id: null,
      notes: null,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
      has_action_required_notification: false,
      extraction_failure_details: null,
      duplicate_warning: null,
      generation_failure_details: null,
    });
    api.fetchDraft.mockResolvedValue({
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
    });
    api.exportDocx.mockResolvedValue({
      blob: new Blob(["docx"], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      filename: "Alex_Example_resume_20260412_101500.docx",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByText(/generated resume/i);
    await user.click(screen.getByRole("button", { name: /^export$/i }));
    await user.click(screen.getByRole("menuitem", { name: /export docx/i }));

    await waitFor(() => expect(api.exportDocx).toHaveBeenCalledWith("app-1"));
    const anchor = appendSpy.mock.calls.find(([node]) => node instanceof HTMLAnchorElement)?.[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("Alex_Example_resume_20260412_101500.docx");
    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    appendSpy.mockRestore();
    removeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("saves location and linkedin fields from the profile page", async () => {
    const user = userEvent.setup();

    renderWithAppProvider(<ProfilePage />);

    expect(await screen.findByLabelText("Location")).toBeInTheDocument();
    expect(screen.queryByLabelText("Address")).not.toBeInTheDocument();

    const locationInput = screen.getByLabelText("Location");
    const linkedinInput = screen.getByLabelText("LinkedIn");

    await user.clear(locationInput);
    await user.type(locationInput, "Ottawa, ON");
    await user.clear(linkedinInput);
    await user.type(linkedinInput, "https://linkedin.com/in/alex-updated");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          address: "Ottawa, ON",
          linkedin_url: "https://linkedin.com/in/alex-updated",
        }),
      ),
    );
  });

  it("filters resumes by search term on the resumes page", async () => {
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Product Resume",
        is_default: true,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
      {
        id: "resume-2",
        name: "Backend Resume",
        is_default: false,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);

    renderWithAppProvider(<BaseResumesPage />);

    expect(await screen.findByText("Product Resume")).toBeInTheDocument();
    expect(screen.getByText("Backend Resume")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/search resumes/i), "product");

    expect(screen.getByText("Product Resume")).toBeInTheDocument();
    expect(screen.queryByText("Backend Resume")).not.toBeInTheDocument();
  });

  it("renders icon-only delete controls on resume cards", async () => {
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Product Resume",
        is_default: false,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);

    renderWithAppProvider(<BaseResumesPage />);

    expect(await screen.findByText("Product Resume")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete product resume/i })).toBeInTheDocument();
  });

  it("deletes a resume from the detail header icon flow", async () => {
    api.fetchBaseResume.mockResolvedValue({
      id: "resume-1",
      name: "Product Resume",
      content_md: "# Resume",
      is_default: false,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
    });
    api.deleteBaseResume.mockResolvedValue(undefined);

    renderWithAppProvider(
      <Routes>
        <Route path="/app/resumes" element={<div>Resumes Route</div>} />
        <Route path="/app/resumes/:resumeId" element={<BaseResumeEditorPage />} />
      </Routes>,
      { initialEntries: ["/app/resumes/resume-1"] },
    );

    expect(await screen.findByText("Product Resume")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^delete resume$/i }));
    expect(await screen.findByText(/delete resume\?/i)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: /delete resume/i }).at(-1) as HTMLElement);

    await waitFor(() => expect(api.deleteBaseResume).toHaveBeenCalledWith("resume-1"));
    expect(await screen.findByText("Resumes Route")).toBeInTheDocument();
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

  it("does not re-request base resumes when notes autosave updates unrelated detail state", async () => {
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
    api.fetchDraft.mockResolvedValue(null);
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Default Resume",
        is_default: true,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);
    api.patchApplication.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
        notes: "Remember recruiter context",
      }),
    );

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const notesInput = await screen.findByPlaceholderText(/add your own notes/i);
    expect(api.listBaseResumes).toHaveBeenCalledTimes(1);

    fireEvent.change(notesInput, { target: { value: "Remember recruiter context" } });

    await waitFor(() =>
      expect(api.patchApplication).toHaveBeenCalledWith("app-1", { notes: "Remember recruiter context" }),
    );
    expect(api.listBaseResumes).toHaveBeenCalledTimes(1);
  });

  it("preserves unsaved job edits while notes autosave completes", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
        notes: null,
      }),
    );
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Default Resume",
        is_default: true,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);

    let resolveNotesSave: ((value: ReturnType<typeof buildApplicationDetail>) => void) | null = null;
    api.patchApplication.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNotesSave = resolve as typeof resolveNotesSave;
        }),
    );

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const notesInput = await screen.findByPlaceholderText(/add your own notes/i);
    const jobTitleInput = screen.getByLabelText("Job Title");

    fireEvent.change(notesInput, { target: { value: "Remember recruiter context" } });
    fireEvent.change(jobTitleInput, { target: { value: "Staff Backend Engineer" } });

    await waitFor(() =>
      expect(api.patchApplication).toHaveBeenCalledWith("app-1", { notes: "Remember recruiter context" }),
    );

    await act(async () => {
      resolveNotesSave?.(
        buildApplicationDetail({
          id: "app-1",
          base_resume_id: "resume-1",
          base_resume_name: "Default Resume",
          notes: "Remember recruiter context",
        }),
      );
    });

    expect(screen.getByLabelText("Job Title")).toHaveValue("Staff Backend Engineer");
    expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(1);
  });

  it("invalidates cached admin user filters after a status change", async () => {
    const user = userEvent.setup();
    let isActive = true;

    api.listAdminUsers.mockImplementation(async (params?: { search?: string; status?: string }) => {
      const adminUser = buildAdminUser({ is_active: isActive, updated_at: isActive ? "2026-04-07T12:05:00Z" : "2026-04-07T12:10:00Z" });
      if (params?.status === "active") {
        return isActive ? [adminUser] : [];
      }
      if (params?.status === "deactivated") {
        return isActive ? [] : [adminUser];
      }
      return [adminUser];
    });
    api.deactivateAdminUser.mockImplementation(async () => {
      isActive = false;
      return buildAdminUser({ is_active: false, updated_at: "2026-04-07T12:10:00Z" });
    });

    renderWithAppProvider(<AdminUsersPage />);

    expect(await screen.findByText("Casey Member")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "active");
    expect(await screen.findByText("Casey Member")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "all");
    expect(await screen.findByText("Casey Member")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /deactivate/i }));
    await waitFor(() => expect(api.deactivateAdminUser).toHaveBeenCalledWith("user-2"));

    await user.selectOptions(screen.getByRole("combobox"), "active");

    expect(await screen.findByText(/no users found/i)).toBeInTheDocument();
    expect(screen.queryByText("Casey Member")).not.toBeInTheDocument();
  });

  it("renders a stop icon on the detail page while extraction is active", async () => {
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: null,
      company: null,
      job_description: null,
      extracted_reference_id: null,
      job_posting_origin: null,
      job_posting_origin_other_text: null,
      base_resume_id: null,
      base_resume_name: null,
      visible_status: "draft",
      internal_state: "extracting",
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
    });
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-1",
      workflow_kind: "extraction",
      state: "extracting",
      message: "Extraction is running.",
      percent_complete: 50,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:30Z",
      completed_at: null,
      terminal_error_code: null,
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByRole("button", { name: /stop extraction/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete application$/i })).not.toBeInTheDocument();
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
      job_location_text: null,
      compensation_text: null,
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
      job_location_text: "British Columbia/Ontario",
      compensation_text: "$145,000 - $175,000",
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
    await userEvent.type(screen.getByLabelText(/location/i), "British Columbia/Ontario");
    await userEvent.type(screen.getByLabelText(/compensation/i), "$145,000 - $175,000");
    await userEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]);

    expect(await screen.findByText("Beta Labs — Staff Backend Engineer")).toBeInTheDocument();
    expect(api.patchApplication).toHaveBeenCalledWith(
      "app-1",
      expect.objectContaining({
        job_title: "Staff Backend Engineer",
        company: "Beta Labs",
        job_location_text: "British Columbia/Ontario",
        compensation_text: "$145,000 - $175,000",
      }),
    );
    await waitFor(() => expect(api.listApplications).toHaveBeenCalledTimes(2));
  });

  it("shows detailed aggressiveness help in compact popovers", async () => {
    api.listBaseResumes.mockResolvedValue([
      { id: "resume-1", name: "Default Resume", is_default: true, created_at: "2026-04-07T12:00:00Z", updated_at: "2026-04-07T12:00:00Z" },
    ]);
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: "Backend Engineer",
      company: "Acme",
      job_description: "Build APIs and backend systems.",
      compensation_text: null,
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
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByRole("heading", { name: /generation settings/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /high aggressiveness details/i }));

    expect(await screen.findByText(/professional experience: aggressively reframe, reprioritize, consolidate, and condense grounded bullets/i)).toBeInTheDocument();
    expect(screen.getByText(/role titles may be rewritten when the new title still matches the demonstrated work\. company and dates remain fixed\./i)).toBeInTheDocument();
    expect(screen.getByText(/education: no factual rewrites beyond minimal formatting cleanup\./i)).toBeInTheDocument();
    await userEvent.click(screen.getByText("High"));
    expect(
      await screen.findByText(/high aggressiveness can make substantial changes to wording, emphasis, professional experience role framing, and keyword\/skills coverage, while company and dates stay fixed/i),
    ).toBeInTheDocument();
  });

  it("removes the review-flags panel, shows the regenerate menu, and renders the generated preview without diff highlighting", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nBuilt backend systems with Kubernetes.\n\n## Professional Experience\n- Built APIs",
      generation_params: {
        base_resume_id: "resume-1",
        page_length: "1_page",
        aggressiveness: "high",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      review_flags: [
        {
          section_name: "summary",
          text: "Built backend systems with Kubernetes.",
          reason: "job_description_only_addition",
        },
      ],
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.fetchBaseResume.mockResolvedValue({
      id: "resume-1",
      name: "Default Resume",
      content_md: "# Resume\n\n## Summary\nBuilt backend systems.\n\n## Professional Experience\n- Built services",
      is_default: true,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
    });

    const { container } = renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByRole("button", { name: /^compare$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^regenerate$/i })).toBeInTheDocument();
    expect(screen.queryByText(/review flagged additions/i)).not.toBeInTheDocument();
    expect(screen.queryByText("## Professional Experience")).not.toBeInTheDocument();
    expect(container.querySelector("mark.generated-diff-highlight")).toBeNull();
    expect(container.querySelector(".generated-diff-block")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^regenerate$/i }));

    const regenerateMenu = await screen.findByRole("menu", { name: /regenerate options/i });
    expect(within(regenerateMenu).getByRole("menuitem", { name: /^regen section$/i })).toBeInTheDocument();
    expect(within(regenerateMenu).getByRole("menuitem", { name: /^full regen$/i })).toBeInTheDocument();
  });

  it("opens compare mode, keeps generated edit mode available, and closes back to the default layout", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nTailored summary",
      generation_params: {
        base_resume_id: "resume-1",
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.fetchBaseResume.mockResolvedValue({
      id: "resume-1",
      name: "Default Resume",
      content_md: "# Resume\n\n## Summary\nBase summary",
      is_default: true,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await userEvent.click(await screen.findByRole("button", { name: /^compare$/i }));

    expect(await screen.findByRole("button", { name: /close comparison/i })).toBeInTheDocument();
    expect(screen.queryByText(/tailored draft shown beside the generation-time base resume/i)).not.toBeInTheDocument();
    const baseHeading = screen.getByRole("heading", { name: /base resume/i });
    const basePane = baseHeading.closest(".compare-pane-card");
    expect(basePane).not.toBeNull();
    expect(within(basePane as HTMLElement).getByText("Default Resume")).toBeInTheDocument();
    expect(screen.getAllByText(/base summary/i).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByDisplayValue(/tailored summary/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /base resume/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /close comparison/i }));
    expect(await screen.findByRole("button", { name: /^compare$/i })).toBeInTheDocument();
  });

  it("renders base-resume headings and bullets cleanly in compare mode", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nTailored summary",
      generation_params: {
        base_resume_id: "resume-1",
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.fetchBaseResume.mockResolvedValue({
      id: "resume-1",
      name: "Default Resume",
      content_md: "# Resume\n\n## Skills\n- Playwright\n- Cypress",
      is_default: true,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await userEvent.click(await screen.findByRole("button", { name: /^compare$/i }));

    const baseHeading = await screen.findByRole("heading", { name: "Base Resume" });
    const basePane = baseHeading.closest(".compare-pane-card");

    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.queryByText("## Skills")).not.toBeInTheDocument();
    expect(basePane).not.toBeNull();
    expect(within(basePane as HTMLElement).getByText("Playwright").tagName).toBe("LI");
    expect(within(basePane as HTMLElement).getByText("Cypress").tagName).toBe("LI");
  });

  it("switches the shell into immersive mode during compare and restores the default shell on close", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nTailored summary",
      generation_params: {
        base_resume_id: "resume-1",
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.fetchBaseResume.mockResolvedValue({
      id: "resume-1",
      name: "Default Resume",
      content_md: "# Resume\n\n## Summary\nBase summary",
      is_default: true,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
    });

    render(
      <MemoryRouter initialEntries={["/app/applications/app-1"]}>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route path="applications/:applicationId" element={<ApplicationDetailPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const compareButton = await screen.findByRole("button", { name: /^compare$/i });
    const shellRoot = compareButton.closest(".app-shell-root");
    const shellFrame = compareButton.closest(".app-shell-frame");

    expect(shellRoot).not.toBeNull();
    expect(shellFrame).not.toBeNull();
    expect(shellRoot).toHaveAttribute("data-shell-mode", "default");
    expect(screen.getByLabelText(/toggle sidebar/i)).toBeInTheDocument();

    await userEvent.click(compareButton);

    expect(shellRoot).toHaveAttribute("data-shell-mode", "immersive");
    expect(shellFrame).toHaveStyle({ marginLeft: "0px" });
    expect(screen.queryByLabelText(/toggle sidebar/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /close comparison/i }));

    expect(shellRoot).toHaveAttribute("data-shell-mode", "default");
  });

  it("uses the generation-time base resume id for compare even after the selected base resume changes", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        base_resume_id: "resume-2",
        base_resume_name: "Current Resume",
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nTailored summary",
      generation_params: {
        base_resume_id: "resume-1",
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Generation Resume",
        is_default: false,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
      {
        id: "resume-2",
        name: "Current Resume",
        is_default: true,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);
    api.fetchBaseResume.mockResolvedValue({
      id: "resume-1",
      name: "Generation Resume",
      content_md: "# Resume\n\n## Summary\nOriginal baseline",
      is_default: false,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByRole("button", { name: /^compare$/i });
    await waitFor(() => expect(api.fetchBaseResume).toHaveBeenCalledWith("resume-1"));

    await userEvent.click(screen.getByRole("button", { name: /^compare$/i }));
    expect((await screen.findAllByText(/original baseline/i)).length).toBeGreaterThan(0);
  });

  it("keeps normal preview usable and blocks compare when the generation-time base resume cannot be loaded", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nTailored summary",
      generation_params: {
        base_resume_id: "resume-1",
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.fetchBaseResume.mockRejectedValue(new Error("Forbidden"));

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await userEvent.click(await screen.findByRole("button", { name: /^compare$/i }));

    expect(await screen.findAllByText(/compare view is unavailable/i)).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: /base resume/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/tailored summary/i).length).toBeGreaterThan(0);
  });

  it("deletes an application from the detail header and navigates back to the list", async () => {
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: "Backend Engineer",
      company: "Acme",
      job_description: "Build APIs",
      extracted_reference_id: null,
      job_posting_origin: "linkedin",
      job_posting_origin_other_text: null,
      base_resume_id: null,
      base_resume_name: null,
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
    api.deleteApplication.mockResolvedValue(undefined);

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications" element={<div>Applications Route</div>} />
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByText("Backend Engineer");

    await userEvent.click(screen.getByRole("button", { name: /^delete application$/i }));
    expect(await screen.findByText(/delete application\?/i)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: /delete application/i }).at(-1) as HTMLElement);

    await waitFor(() => expect(api.deleteApplication).toHaveBeenCalledWith("app-1"));
    expect(await screen.findByText("Applications Route")).toBeInTheDocument();
  });

  it("stops extraction from the detail header and shows recovery actions", async () => {
    const user = userEvent.setup();
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: null,
      company: null,
      job_description: null,
      extracted_reference_id: null,
      job_posting_origin: null,
      job_posting_origin_other_text: null,
      base_resume_id: null,
      base_resume_name: null,
      visible_status: "draft",
      internal_state: "extracting",
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
    });
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-1",
      workflow_kind: "extraction",
      state: "extracting",
      message: "Extraction is running.",
      percent_complete: 50,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:30Z",
      completed_at: null,
      terminal_error_code: null,
    });
    api.cancelExtraction.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: null,
      company: null,
      job_description: null,
      extracted_reference_id: null,
      job_posting_origin: null,
      job_posting_origin_other_text: null,
      base_resume_id: null,
      base_resume_name: null,
      visible_status: "needs_action",
      internal_state: "manual_entry_required",
      failure_reason: "extraction_failed",
      extraction_failure_details: {
        kind: "user_cancelled",
        provider: null,
        reference_id: null,
        blocked_url: "https://example.com/job",
        detected_at: "2026-04-07T12:05:00Z",
      },
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

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByRole("button", { name: /stop extraction/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /stop extraction/i }));
    expect(await screen.findByText(/stop extraction\?/i)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /stop extraction/i }).at(-1) as HTMLElement);

    await waitFor(() => expect(api.cancelExtraction).toHaveBeenCalledWith("app-1"));
    expect(await screen.findByRole("heading", { name: /manual entry required/i })).toBeInTheDocument();
    expect(screen.getByText(/extraction was stopped/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry with text/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete application$/i })).toBeInTheDocument();
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

    await waitFor(() => expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/application request failed/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1);
    expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(2);
  });

  it("stops extraction polling and shows manual-entry fallback when terminal extraction progress cannot sync detail state", async () => {
    vi.useFakeTimers();
    api.fetchApplicationDetail
      .mockResolvedValueOnce(
        buildApplicationDetail({
          id: "app-1",
          visible_status: "draft",
          internal_state: "extracting",
          failure_reason: null,
        }),
      )
      .mockResolvedValueOnce(
        buildApplicationDetail({
          id: "app-1",
          visible_status: "draft",
          internal_state: "extracting",
          failure_reason: null,
        }),
      );
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-1",
      workflow_kind: "extraction",
      state: "manual_entry_required",
      message: "Automatic extraction failed. Manual entry is required.",
      percent_complete: 100,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:05:00Z",
      completed_at: "2026-04-07T12:05:00Z",
      terminal_error_code: "extraction_failed",
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
      await Promise.resolve();
    });

    await waitFor(() => expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { name: /manual entry required/i })).toBeInTheDocument();
    expect(screen.getByText(/automatic extraction failed\. manual entry is required\./i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1);
  });

  it("maps terminal extraction success progress to generation-pending fallback when detail sync lags", async () => {
    vi.useFakeTimers();
    api.fetchApplicationDetail
      .mockResolvedValueOnce(
        buildApplicationDetail({
          id: "app-1",
          visible_status: "draft",
          internal_state: "extracting",
          failure_reason: null,
          company: null,
        }),
      )
      .mockResolvedValueOnce(
        buildApplicationDetail({
          id: "app-1",
          visible_status: "draft",
          internal_state: "extracting",
          failure_reason: null,
          company: null,
        }),
      );
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-1",
      workflow_kind: "extraction",
      state: "generation_pending",
      message: "Extraction completed.",
      percent_complete: 100,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:05:00Z",
      completed_at: "2026-04-07T12:05:00Z",
      terminal_error_code: null,
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
      await Promise.resolve();
    });

    await waitFor(() => expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("heading", { name: /manual entry required/i })).not.toBeInTheDocument();
    expect(screen.getByText(/company is missing from extraction/i)).toBeInTheDocument();
  });

  it("shows contact-administrator guidance when full regeneration is capped", async () => {
    const user = userEvent.setup();
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.triggerFullRegeneration.mockRejectedValue(
      new Error(
        "You have reached the full regeneration limit for this resume. Please contact an administrator for additional regenerations.",
      ),
    );

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const regenerateButton = await screen.findByRole("button", { name: /^regenerate$/i });
    await user.click(regenerateButton);
    await user.click(await screen.findByRole("menuitem", { name: /full regen/i }));

    await waitFor(() => expect(api.triggerFullRegeneration).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/please contact an administrator for additional regenerations/i)).toBeInTheDocument();
  });

  it("shows backend generation stage messages while progress polling is active", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "draft",
        internal_state: "generating",
        failure_reason: null,
      }),
    );
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-2",
      workflow_kind: "generation",
      state: "generating",
      message: "Applying deterministic Professional Experience structure checks",
      percent_complete: 62,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:01:00Z",
      completed_at: null,
      terminal_error_code: null,
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() => expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/applying deterministic professional experience structure checks/i)).toBeInTheDocument();
  });

  it("updates generation progress from live stream events without waiting for the next watchdog poll", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "draft",
        internal_state: "generating",
        failure_reason: null,
      }),
    );
    api.fetchApplicationProgress.mockResolvedValue(
      buildProgressPayload({
        workflow_kind: "generation",
        state: "generating",
        message: "Resume generation is running.",
      }),
    );

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() => expect(api.openApplicationEventStream).toHaveBeenCalledTimes(1));

    await act(async () => {
      latestStreamHandlers().onProgress(
        buildProgressPayload({
          workflow_kind: "generation",
          state: "generating",
          message: "Applying deterministic Professional Experience structure checks",
          percent_complete: 62,
          updated_at: "2026-04-07T12:02:00Z",
        }),
      );
    });

    expect(await screen.findByText(/applying deterministic professional experience structure checks/i)).toBeInTheDocument();
  });

  it("keeps the saved draft visible while regeneration is running after a refresh", async () => {
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Default Resume",
        is_default: true,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "regenerating_full",
        failure_reason: null,
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
      }),
    );
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-2",
      workflow_kind: "regeneration_full",
      state: "regenerating_full",
      message: "Refreshing experience bullets",
      percent_complete: 62,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:01:00Z",
      completed_at: null,
      terminal_error_code: null,
    });
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        base_resume_id: "resume-1",
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() => expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledWith("app-1"));
    await waitFor(() => {
      expect(document.querySelector(".resume-preview-markdown")).toHaveTextContent("Grounded summary");
    });
    expect(screen.getByText(/refreshing experience bullets/i)).toBeInTheDocument();
    expect(screen.queryByText(/no resume generated yet/i)).not.toBeInTheDocument();
  });

  it("closes the stale draft editor immediately when full regeneration starts", async () => {
    const user = userEvent.setup();
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Default Resume",
        is_default: true,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        failure_reason: null,
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        base_resume_id: "resume-1",
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    api.triggerFullRegeneration.mockImplementation(
      () =>
        new Promise(() => {
          // Keep the regeneration request in-flight so the optimistic transition stays visible.
        }),
    );

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledWith("app-1"));
    await screen.findByText(/grounded summary/i);

    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    await waitFor(() => {
      expect(document.querySelector(".markdown-editor-input")).not.toBeNull();
    });

    await user.click(screen.getByRole("button", { name: /regenerate/i }));
    await user.click(await screen.findByRole("menuitem", { name: /full regen/i }));

    await waitFor(() => expect(api.triggerFullRegeneration).toHaveBeenCalledTimes(1));
    expect(document.querySelector(".markdown-editor-input")).toBeNull();
    expect(screen.getByText(/grounded summary/i)).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByLabelText("3 Pages")).toBeChecked());
    expect(screen.getByRole("radio", { name: /high/i })).toBeChecked();
    expect(screen.getByDisplayValue("Emphasize architecture leadership.")).toBeInTheDocument();
  });

  it("keeps generation settings dirty when the user changes them locally", async () => {
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
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
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

    const settingsHeading = await screen.findByRole("heading", { name: /generation settings/i });
    const settingsForm = settingsHeading.closest("form");
    expect(settingsForm).not.toBeNull();

    const saveButton = within(settingsForm as HTMLFormElement).getByRole("button", { name: /^save$/i });
    expect(saveButton).toBeDisabled();

    await userEvent.click(screen.getByLabelText("2 Pages"));

    expect(screen.getByLabelText("2 Pages")).toBeChecked();
    expect(saveButton).toBeEnabled();
  });

  it("renders the resume judge score tile and opens the breakdown dialog", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        resume_judge_result: {
          status: "succeeded",
          final_score: 77.6,
          display_score: 78,
          verdict: "warn",
          pass_threshold: 80,
          score_summary: "Strong alignment with a few voice issues.",
          dimension_scores: {
            role_alignment: { score: 8, weight: 0.25, weighted_contribution: 20, notes: "Aligned to the JD." },
            specificity_and_concreteness: { score: 7, weight: 0.2, weighted_contribution: 14, notes: "Mostly specific." },
            voice_and_human_quality: { score: 5, weight: 0.2, weighted_contribution: 10, notes: "Voice still feels templated." },
            grounding_integrity: { score: 8, weight: 0.2, weighted_contribution: 16, notes: "Grounded." },
            ats_safety_and_formatting: { score: 9, weight: 0.1, weighted_contribution: 9, notes: "ATS-safe." },
            length_and_density: { score: 7, weight: 0.05, weighted_contribution: 3.5, notes: "Acceptable length." },
          },
          regeneration_instructions: "Tighten the summary voice.",
          regeneration_priority_dimensions: ["voice_and_human_quality"],
          evaluator_notes: "A targeted rewrite should push this above the pass threshold.",
          evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
          scored_at: "2026-04-07T12:12:00Z",
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(screen.getAllByText(/resume judge/i)).toHaveLength(1);
    const jobDescriptionCard = await screen.findByTestId("job-description-card");
    expect(judgeCard.compareDocumentPosition(jobDescriptionCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(judgeCard).getByText(/78\/100/i)).toBeInTheDocument();
    expect(within(judgeCard).getByText(/strong alignment with a few voice issues/i)).toBeInTheDocument();

    await userEvent.click(judgeCard.closest("button") as HTMLButtonElement);

    expect(await screen.findByRole("dialog", { name: /resume judge breakdown/i })).toBeInTheDocument();
    expect(screen.getByText(/verdict: review at 77\.6 \/ 100\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /regenerate with judge feedback/i })).toBeInTheDocument();
    expect(screen.queryByText(/aligned to the jd/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /role alignment/i }));
    expect(screen.getByText(/aligned to the jd/i)).toBeInTheDocument();
    expect(screen.getByText(/a targeted rewrite should push this above the pass threshold/i)).toBeInTheDocument();
  });

  it("renders an unscored left-rail judge card above the job description", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        resume_judge_result: null,
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    const jobDescriptionCard = await screen.findByTestId("job-description-card");
    expect(judgeCard.compareDocumentPosition(jobDescriptionCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(judgeCard).getByText(/pending review/i)).toBeInTheDocument();
    expect(within(judgeCard).getByRole("button", { name: /run judge/i })).toBeInTheDocument();
  });

  it("renders the queued judge state in the left rail", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        resume_judge_result: {
          status: "queued",
          message: "Resume Judge is queued.",
          evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(within(judgeCard).getByText(/scoring draft/i)).toBeInTheDocument();
    expect(within(judgeCard).getByText(/judge feedback will appear here shortly/i)).toBeInTheDocument();
  });

  it("updates the Resume Judge card from live detail events", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        resume_judge_result: {
          status: "queued",
          message: "Resume Judge is queued.",
          evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() => expect(api.openApplicationEventStream).toHaveBeenCalledTimes(1));

    await act(async () => {
      latestStreamHandlers().onDetail(
        buildApplicationDetail({
          id: "app-1",
          visible_status: "in_progress",
          internal_state: "resume_ready",
          resume_judge_result: {
            status: "succeeded",
            final_score: 78.4,
            display_score: 78,
            verdict: "warn",
            pass_threshold: 80,
            score_summary: "Strong alignment with a few voice issues.",
            dimension_scores: {
              role_alignment: { score: 8, weight: 0.25, weighted_contribution: 20, notes: "Aligned." },
              specificity_and_concreteness: { score: 8, weight: 0.2, weighted_contribution: 16, notes: "Specific." },
              voice_and_human_quality: { score: 6, weight: 0.2, weighted_contribution: 12, notes: "Needs variation." },
              grounding_integrity: { score: 8, weight: 0.2, weighted_contribution: 16, notes: "Grounded." },
              ats_safety_and_formatting: { score: 9, weight: 0.1, weighted_contribution: 9, notes: "ATS safe." },
              length_and_density: { score: 7, weight: 0.05, weighted_contribution: 3.5, notes: "Acceptable." },
            },
            regeneration_instructions: "Tighten the summary voice.",
            regeneration_priority_dimensions: ["voice_and_human_quality"],
            evaluator_notes: "Voice is the main gap.",
            evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
            scored_at: "2026-04-07T12:12:00Z",
          },
        }),
      );
    });

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(within(judgeCard).getByText(/78\/100/i)).toBeInTheDocument();
    expect(within(judgeCard).getByText(/strong alignment with a few voice issues/i)).toBeInTheDocument();
  });

  it("does not render a stale queued judge result as a completed score card", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        job_description: "Build APIs",
        resume_judge_result: {
          status: "queued",
          message: "Resume Judge is queued.",
          evaluated_draft_updated_at: "2026-04-07T12:08:00Z",
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nEdited summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(within(judgeCard).getByText(/scoring unavailable/i)).toBeInTheDocument();
    expect(within(judgeCard).queryByText(/—\/100/i)).not.toBeInTheDocument();
    expect(within(judgeCard).getByRole("button", { name: /re-evaluate/i })).toBeInTheDocument();
  });

  it("marks stale judge results and lets the user re-evaluate the current draft", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        resume_judge_result: {
          status: "succeeded",
          final_score: 72.4,
          display_score: 72,
          verdict: "warn",
          pass_threshold: 80,
          score_summary: "Usable but out of date.",
          dimension_scores: {
            role_alignment: { score: 7, weight: 0.25, weighted_contribution: 17.5, notes: "Aligned." },
            specificity_and_concreteness: { score: 7, weight: 0.2, weighted_contribution: 14, notes: "Specific." },
            voice_and_human_quality: { score: 6, weight: 0.2, weighted_contribution: 12, notes: "Natural enough." },
            grounding_integrity: { score: 7, weight: 0.2, weighted_contribution: 14, notes: "Grounded." },
            ats_safety_and_formatting: { score: 9, weight: 0.1, weighted_contribution: 9, notes: "ATS-safe." },
            length_and_density: { score: 7, weight: 0.05, weighted_contribution: 3.5, notes: "Dense enough." },
          },
          regeneration_instructions: "Refresh the score after edits.",
          regeneration_priority_dimensions: ["role_alignment"],
          evaluator_notes: "This score predates the latest draft edits.",
          evaluated_draft_updated_at: "2026-04-07T12:08:00Z",
          scored_at: "2026-04-07T12:09:00Z",
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nEdited summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.triggerResumeJudge.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        resume_judge_result: {
          status: "queued",
          message: "Resume Judge is queued.",
          evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
        },
      }),
    );

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    const judgeTile = judgeCard.closest("button");
    expect(judgeTile).not.toBeNull();
    expect(within(judgeCard).getByText(/stale/i)).toBeInTheDocument();

    await userEvent.click(judgeTile as HTMLButtonElement);
    await userEvent.click(await screen.findByRole("button", { name: /re-evaluate/i }));

    await waitFor(() => expect(api.triggerResumeJudge).toHaveBeenCalledWith("app-1"));
  });

  it("passes judge feedback into full regeneration without overwriting user instructions", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        resume_judge_result: {
          status: "succeeded",
          final_score: 51.2,
          display_score: 51,
          verdict: "fail",
          pass_threshold: 80,
          score_summary: "Tailoring and voice need a rewrite.",
          dimension_scores: {
            role_alignment: { score: 5, weight: 0.25, weighted_contribution: 12.5, notes: "Misses core priorities." },
            specificity_and_concreteness: { score: 5, weight: 0.2, weighted_contribution: 10, notes: "Too generic." },
            voice_and_human_quality: { score: 4, weight: 0.2, weighted_contribution: 8, notes: "Reads AI-generated." },
            grounding_integrity: { score: 7, weight: 0.2, weighted_contribution: 14, notes: "Mostly grounded." },
            ats_safety_and_formatting: { score: 8, weight: 0.1, weighted_contribution: 8, notes: "ATS-safe." },
            length_and_density: { score: 7, weight: 0.05, weighted_contribution: 3.5, notes: "Length is okay." },
          },
          regeneration_instructions: "Rewrite the summary to be candidate-specific and vary bullet openings.",
          regeneration_priority_dimensions: ["voice_and_human_quality", "role_alignment"],
          evaluator_notes: "The draft should be regenerated with targeted feedback.",
          evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
          scored_at: "2026-04-07T12:12:00Z",
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        page_length: "2_page",
        aggressiveness: "high",
        additional_instructions: "Keep infrastructure metrics prominent.",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.triggerFullRegeneration.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "draft",
        internal_state: "regenerating_full",
        failure_reason: null,
      }),
    );
    api.fetchApplicationProgress.mockResolvedValue({
      job_id: "job-regen-1",
      workflow_kind: "generation",
      state: "regenerating_full",
      message: "Regeneration is running.",
      percent_complete: 25,
      created_at: "2026-04-07T12:12:00Z",
      updated_at: "2026-04-07T12:12:05Z",
      completed_at: null,
      terminal_error_code: null,
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeTile = (await screen.findByTestId("resume-judge-card")).closest("button");
    expect(judgeTile).not.toBeNull();

    await userEvent.click(judgeTile as HTMLButtonElement);
    await userEvent.click(await screen.findByRole("button", { name: /regenerate with judge feedback/i }));

    await waitFor(() =>
      expect(api.triggerFullRegeneration).toHaveBeenCalledWith("app-1", {
        target_length: "2_page",
        aggressiveness: "high",
        additional_instructions:
          "Keep infrastructure metrics prominent.\n\nResume Judge Feedback:\nRewrite the summary to be candidate-specific and vary bullet openings.",
      }),
    );
  });

  it("renders a failed judge card with retry in the left rail", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        resume_judge_result: {
          status: "failed",
          message: "Judge provider timed out.",
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.triggerResumeJudge.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        resume_judge_result: {
          status: "queued",
          message: "Resume Judge is queued.",
          evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
        },
      }),
    );

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(within(judgeCard).getByText(/scoring unavailable/i)).toBeInTheDocument();
    expect(within(judgeCard).getByText(/judge provider timed out/i)).toBeInTheDocument();

    await userEvent.click(within(judgeCard).getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(api.triggerResumeJudge).toHaveBeenCalledWith("app-1"));
  });

  it("disables re-evaluation after three failed judge runs for the current draft", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        resume_judge_result: {
          status: "failed",
          message: "Resume Judge has already reached the maximum of 3 attempts for this draft.",
          evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
          run_attempt_count: 3,
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nGrounded summary",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary", "professional_experience", "education", "skills"],
        section_order: ["summary", "professional_experience", "education", "skills"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(within(judgeCard).getByText(/maximum of 3 attempts/i)).toBeInTheDocument();
    expect(within(judgeCard).getByRole("button", { name: /max attempts reached/i })).toBeDisabled();
  });
});
