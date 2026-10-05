import { useState, type ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import { Sidebar } from "@/components/layout/Sidebar";
import { ApplicationDetailPage } from "@/routes/ApplicationDetailPage";
import { ApplicationsListPage } from "@/routes/ApplicationsListPage";
import { AdminDashboardPage } from "@/routes/AdminDashboardPage";
import { AdminUsersPage } from "@/routes/AdminUsersPage";
import { AdminSubscriptionsPage } from "@/routes/AdminSubscriptionsPage";
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
  fetchApplicationProgress: vi.fn(),
  fetchBaseResume: vi.fn(),
  fetchCreationActivity: vi.fn(),
  fetchDraft: vi.fn(),
  fetchSessionBootstrap: vi.fn(),
  inviteAdminUser: vi.fn(),
  issueExtensionToken: vi.fn(),
  listAdminUsers: vi.fn(),
  listSubscriptionTiers: vi.fn(),
  listBaseResumes: vi.fn(),
  listApplications: vi.fn(),
  listApplicationActivity: vi.fn(),
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
  triggerKeywordOptimization: vi.fn(),
  triggerResumeJudge: vi.fn(),
  triggerSectionRegeneration: vi.fn(),
  updateManualKeywords: vi.fn(),
  updateAdminUser: vi.fn(),
  updateSubscriptionTier: vi.fn(),
  updateBaseResume: vi.fn(),
  updateProfile: vi.fn(),
  uploadBaseResume: vi.fn(),
}));

vi.mock("@/lib/api", () => api);
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "test@test.com" },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  getAccessToken: () => Promise.resolve("mock-token"),
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
    subscription_tier: "basic",
    default_base_resume_id: null,
    section_preferences: {
      summary: true,
      professional_experience: true,
      education: true,
      skills: true,
      projects: true,
      certifications: true,
    },
    section_order: [
      "summary",
      "professional_experience",
      "education",
      "skills",
      "projects",
      "certifications",
    ],
    created_at: "2026-04-07T12:00:00Z",
    updated_at: "2026-04-07T12:00:00Z",
  },
  application_summary: {
    total_count: 0,
    applied_count: 0,
    needs_action_count: 0,
  },
  generation_quota: {
    subscription_tier: "basic",
    monthly_resume_generation_limit: 10,
    generation_count: 3,
    remaining_count: 7,
    period_start: "2026-05-01",
    resets_at: "2026-06-01",
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

function buildCreationActivity(
  range: "7d" | "30d" | "3m" | "1y",
  counts: Record<number, [number, number]> = {},
) {
  const bucketCount = { "7d": 7, "30d": 30, "3m": 90, "1y": 52 }[range];
  const stepDays = range === "1y" ? 7 : 1;
  const end = new Date(Date.UTC(2026, 9, 3));
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - (bucketCount - 1 - index) * stepDays);
    const bucketEnd = new Date(start);
    bucketEnd.setUTCDate(start.getUTCDate() + stepDays - 1);
    const [created, applied] = counts[index] ?? [0, 0];
    return {
      start_date: start.toISOString().slice(0, 10),
      end_date: (bucketEnd > end ? end : bucketEnd).toISOString().slice(0, 10),
      created,
      applied,
    };
  });
  return {
    range,
    granularity: range === "1y" ? "week" : "day",
    timezone: "UTC",
    start_date: buckets[0].start_date,
    end_date: "2026-10-03",
    total_created: buckets.reduce((sum, bucket) => sum + bucket.created, 0),
    total_applied: buckets.reduce((sum, bucket) => sum + bucket.applied, 0),
    buckets,
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
    job_keywords: null,
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
  queryClient.setDefaultOptions({
    queries: {
      ...queryClient.getDefaultOptions().queries,
      retryDelay: 0,
    },
  });
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

function renderTopBar(options?: { initialEntries?: string[] }) {
  return renderWithAppProvider(
    <Routes>
      <Route path="/app" element={<TopBar />} />
      <Route
        path="/app/applications/:applicationId"
        element={<div>Detail Route</div>}
      />
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
    onSnapshot: (snapshot: {
      detail: ReturnType<typeof buildApplicationDetail>;
      progress: ReturnType<typeof buildProgressPayload> | null;
    }) => void;
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
    api.listApplicationActivity.mockResolvedValue([]);
    api.fetchCreationActivity.mockImplementation(
      async (range: "7d" | "30d" | "3m" | "1y") => buildCreationActivity(range),
    );
    api.listNotifications.mockResolvedValue([]);
    api.updateProfile.mockImplementation(async (payload) => ({
      id: "user-1",
      email: "test@test.com",
      name: payload.name ?? "Alex Example",
      phone: payload.phone ?? "555-0100",
      address: payload.address ?? "Toronto, ON",
      linkedin_url:
        payload.linkedin_url ?? "https://linkedin.com/in/alex-example",
      default_base_resume_id: null,
      section_preferences: payload.section_preferences ?? {
        summary: true,
        professional_experience: true,
        education: true,
        skills: true,
        projects: true,
        certifications: true,
      },
      section_order: payload.section_order ?? [
        "summary",
        "professional_experience",
        "education",
        "skills",
        "projects",
        "certifications",
      ],
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
    expect(
      screen.getAllByRole("button", { name: /new application/i }),
    ).not.toHaveLength(0);
  });

  it("loads the applications page with one bootstrap request and one applications request", async () => {
    api.listApplications.mockResolvedValue([]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText(/no applications yet/i)).toBeInTheDocument();
    expect(api.fetchSessionBootstrap).toHaveBeenCalledTimes(1);
    expect(api.listApplications).toHaveBeenCalledTimes(1);
  });

  it("loads the dashboard with one bootstrap request, one applications request and one activity request", async () => {
    api.listApplications.mockResolvedValue([]);

    renderWithAppProvider(<DashboardPage />);

    expect(await screen.findByText(/no applications yet/i)).toBeInTheDocument();
    expect(screen.getByText("7 left")).toBeInTheDocument();
    expect(screen.getByText(/3 of 10 used/i)).toBeInTheDocument();
    expect(api.fetchSessionBootstrap).toHaveBeenCalledTimes(1);
    expect(api.listApplications).toHaveBeenCalledTimes(1);
    expect(api.fetchCreationActivity).toHaveBeenCalledTimes(1);
  });

  it("loads the resumes page with one bootstrap request and one base resumes request", async () => {
    api.listBaseResumes.mockResolvedValue([]);

    renderWithAppProvider(<BaseResumesPage />);

    expect(await screen.findByText(/no resumes yet/i)).toBeInTheDocument();
    expect(api.fetchSessionBootstrap).toHaveBeenCalledTimes(1);
    expect(api.listBaseResumes).toHaveBeenCalledTimes(1);
    expect(api.listApplications).toHaveBeenCalledTimes(0);
  });

  it("does not show a dismiss action for applications query load failures", async () => {
    api.listApplications.mockRejectedValue(new Error("Session expired."));

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Session expired.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /dismiss/i }),
    ).not.toBeInTheDocument();
  });

  it("does not show a dismiss action for base resume query load failures", async () => {
    api.listBaseResumes.mockRejectedValue(
      new Error("Resume list unavailable."),
    );

    renderWithAppProvider(<BaseResumesPage />);

    expect(
      await screen.findByText("Resume list unavailable."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /dismiss/i }),
    ).not.toBeInTheDocument();
  });

  it("initializes the profile page from bootstrap", async () => {
    renderWithAppProvider(<ProfilePage />);

    expect(await screen.findByDisplayValue("Alex Example")).toBeInTheDocument();
    expect(api.fetchSessionBootstrap).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Section Preferences")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Manage base resumes" }),
    ).toHaveAttribute("href", "/app/resumes");
  });

  it("shows profile settings directly without section navigation", async () => {
    const user = userEvent.setup();
    renderWithAppProvider(<ProfilePage />);
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Alex Updated");
    expect(screen.queryByLabelText("Profile sections")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume sections" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Resume sections" })).toBeInTheDocument();
    expect(name).toHaveValue("Alex Updated");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
  });

  it("keeps profile edits after a failed keyboard save and allows retry", async () => {
    const user = userEvent.setup();
    api.updateProfile.mockRejectedValueOnce(new Error("Could not save. Try again."));
    renderWithAppProvider(<ProfilePage />);
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Alex Updated");
    screen.getByRole("button", { name: "Save" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save. Try again.");
    expect(name).toHaveValue("Alex Updated");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(api.updateProfile).toHaveBeenCalledTimes(2);
  });

  it("shows a recoverable error on the profile page when bootstrap fails", async () => {
    api.fetchSessionBootstrap.mockRejectedValue(
      new Error("Session bootstrap failed."),
    );

    renderWithAppProvider(<ProfilePage />);

    expect(
      await screen.findByText(/profile unavailable/i, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Session bootstrap failed.")).toBeInTheDocument();
  });

  it("opens a new application modal with only the URL field visible by default", async () => {
    api.listApplications.mockResolvedValue([]);

    renderWithAppProvider(<ApplicationsListPage />);

    await screen.findByText(/no applications yet/i);
    await userEvent.click(
      screen.getAllByRole("button", { name: /new application/i })[0],
    );

    expect(
      await screen.findByRole("dialog", { name: /new application/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/job url/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /paste description/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/pasted job description/i),
    ).not.toBeInTheDocument();
  });

  it("reveals the pasted job description field only when the user asks for it", async () => {
    api.listApplications.mockResolvedValue([]);

    renderWithAppProvider(<ApplicationsListPage />);

    await screen.findByText(/no applications yet/i);
    await userEvent.click(
      screen.getAllByRole("button", { name: /new application/i })[0],
    );
    await userEvent.click(
      screen.getByRole("button", { name: /add pasted description/i }),
    );

    expect(
      await screen.findByLabelText(/pasted job description/i),
    ).toBeInTheDocument();
  });

  it("submits URL-only application creation from the modal and navigates to the detail page", async () => {
    api.listApplications.mockResolvedValue([]);
    api.createApplication.mockResolvedValue(
      buildApplicationDetail({
        id: "app-42",
        job_url: "https://example.com/jobs/42",
      }),
    );

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications" element={<ApplicationsListPage />} />
        <Route
          path="/app/applications/:applicationId"
          element={<div>Detail Route</div>}
        />
      </Routes>,
      { initialEntries: ["/app/applications"] },
    );

    await screen.findByText(/no applications yet/i);
    await userEvent.click(
      screen.getAllByRole("button", { name: /new application/i })[0],
    );
    await userEvent.type(
      screen.getByLabelText(/job url/i),
      "https://example.com/jobs/42",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /create application/i }),
    );

    await waitFor(() =>
      expect(api.createApplication).toHaveBeenCalledWith({
        job_url: "https://example.com/jobs/42",
        source_text: undefined,
      }),
    );
    expect(await screen.findByText("Detail Route")).toBeInTheDocument();
  });

  it("submits pasted job text from the modal when that field is revealed", async () => {
    api.listApplications.mockResolvedValue([]);
    api.createApplication.mockResolvedValue(
      buildApplicationDetail({
        id: "app-84",
        job_url: "https://example.com/jobs/84",
      }),
    );

    renderWithAppProvider(<ApplicationsListPage />);

    await screen.findByText(/no applications yet/i);
    await userEvent.click(
      screen.getAllByRole("button", { name: /new application/i })[0],
    );
    await userEvent.type(
      screen.getByLabelText(/job url/i),
      "https://example.com/jobs/84",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /add pasted description/i }),
    );
    await userEvent.type(
      await screen.findByLabelText(/pasted job description/i),
      "Senior Platform Engineer. Build APIs, queues, and internal tools.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /create with pasted text/i }),
    );

    await waitFor(() =>
      expect(api.createApplication).toHaveBeenCalledWith({
        job_url: "https://example.com/jobs/84",
        source_text:
          "Senior Platform Engineer. Build APIs, queues, and internal tools.",
      }),
    );
  });

  it("submits pasted job text without requiring a job URL", async () => {
    api.listApplications.mockResolvedValue([]);
    api.createApplication.mockResolvedValue(
      buildApplicationDetail({ id: "app-85", job_url: null }),
    );

    renderWithAppProvider(<ApplicationsListPage />);

    await screen.findByText(/no applications yet/i);
    await userEvent.click(
      screen.getAllByRole("button", { name: /new application/i })[0],
    );
    await userEvent.click(
      screen.getByRole("button", { name: /paste description/i }),
    );
    await userEvent.type(
      await screen.findByLabelText(/^job description$/i),
      "Senior Platform Engineer. Build APIs, queues, and internal tools.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /create from description/i }),
    );

    await waitFor(() =>
      expect(api.createApplication).toHaveBeenCalledWith({
        job_url: undefined,
        source_text:
          "Senior Platform Engineer. Build APIs, queues, and internal tools.",
      }),
    );
  });

  it("ignores duplicate create submissions while the first request is pending", async () => {
    api.listApplications.mockResolvedValue([]);
    api.createApplication.mockImplementation(
      () =>
        new Promise(() => {
          // Keep submission pending so a duplicate submit attempts the in-flight path.
        }),
    );

    renderWithAppProvider(<ApplicationsListPage />);

    await screen.findByText(/no applications yet/i);
    await userEvent.click(
      screen.getAllByRole("button", { name: /new application/i })[0],
    );
    await userEvent.type(
      screen.getByLabelText(/job url/i),
      "https://example.com/jobs/42",
    );

    const submitButton = screen.getByRole("button", {
      name: /create application/i,
    });
    const form = submitButton.closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(api.createApplication).toHaveBeenCalledTimes(1));
  });

  it("keeps create failures inside the modal instead of promoting them to the page error card", async () => {
    api.listApplications.mockResolvedValue([]);
    api.createApplication.mockRejectedValueOnce(
      new Error("Unable to create application."),
    );

    renderWithAppProvider(<ApplicationsListPage />);

    await screen.findByText(/no applications yet/i);
    await userEvent.click(
      screen.getAllByRole("button", { name: /new application/i })[0],
    );
    await userEvent.type(
      screen.getByLabelText(/job url/i),
      "https://example.com/jobs/99",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /create application/i }),
    );

    expect(
      await screen.findByText("Unable to create application."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Request failed")).not.toBeInTheDocument();
  });

  it("opens the notifications dropdown and keeps the badge count tied to attention items", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({
        id: "app-1",
        visible_status: "needs_action",
        has_action_required_notification: true,
      }),
      buildApplicationSummary({ id: "app-2", visible_status: "complete" }),
    ]);
    api.listNotifications.mockResolvedValue([
      buildNotificationSummary({
        id: "notif-1",
        message: "Resume generated successfully.",
      }),
      buildNotificationSummary({
        id: "notif-2",
        application_id: null,
        type: "success",
        message: "Export completed successfully.",
      }),
    ]);

    api.fetchSessionBootstrap.mockResolvedValue({
      ...defaultBootstrap,
      application_summary: {
        total_count: 2,
        applied_count: 0,
        needs_action_count: 1,
      },
    });

    renderTopBar();

    const bell = screen.getByRole("button", { name: /notifications/i });
    expect(api.listNotifications).not.toHaveBeenCalled();

    await userEvent.click(bell);

    expect(
      await screen.findByRole("dialog", { name: /notifications panel/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Resume generated successfully."),
    ).toBeInTheDocument();
    expect(api.listNotifications).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(within(bell).getByText("1")).toBeInTheDocument(),
    );
  });

  it("renders a scrollable notifications list for larger inboxes", async () => {
    api.listNotifications.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        buildNotificationSummary({
          id: `notif-${index}`,
          application_id: `app-${index}`,
          message: `Notification ${index + 1}: Resume keyword optimization completed successfully. Review the updated application before proceeding.`,
          created_at: `2026-04-09T12:${String(index).padStart(2, "0")}:00Z`,
        }),
      ),
    );

    renderTopBar();

    await userEvent.click(
      screen.getByRole("button", { name: /notifications/i }),
    );

    const notificationsList = await screen.findByRole("list", {
      name: /notifications list/i,
    });
    expect(notificationsList).toHaveClass("max-h-96");
    expect(notificationsList).toHaveClass("overflow-y-auto");
    for (const row of within(notificationsList).getAllByRole("button")) {
      expect(row).toHaveStyle({ height: "auto" });
      expect(row.querySelector(".app-button-content--block")).toBeInTheDocument();
    }
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

    await userEvent.click(
      screen.getByRole("button", { name: /notifications/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: /generation finished for platform engineer/i,
      }),
    );

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

    await userEvent.click(
      screen.getByRole("button", { name: /notifications/i }),
    );

    const notificationButton = await screen.findByRole("button", {
      name: /account-level notification/i,
    });
    expect(notificationButton).toBeDisabled();
    await userEvent.click(notificationButton);
    expect(screen.queryByText("Detail Route")).not.toBeInTheDocument();
  });

  it("shows an empty notifications state when the inbox is clear", async () => {
    api.listNotifications.mockResolvedValue([]);

    renderTopBar();

    await userEvent.click(
      screen.getByRole("button", { name: /notifications/i }),
    );

    expect(
      await screen.findByText(/no notifications yet/i),
    ).toBeInTheDocument();
  });

  it("clears only notifications that do not need attention", async () => {
    api.listApplications
      .mockResolvedValueOnce([
        buildApplicationSummary({
          id: "app-1",
          has_action_required_notification: true,
        }),
      ])
      .mockResolvedValueOnce([
        buildApplicationSummary({
          id: "app-1",
          has_action_required_notification: false,
        }),
      ]);
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

    await userEvent.click(
      screen.getByRole("button", { name: /notifications/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /clear all/i }),
    );

    await waitFor(() =>
      expect(api.clearNotifications).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(api.listApplications).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("Resume needs manual review."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Export completed successfully."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Cleared notifications that do not need attention."),
    ).toBeInTheDocument();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("shows a sanitized error state when notifications fail to load", async () => {
    api.listNotifications.mockRejectedValueOnce(
      new Error("Failed to load notifications."),
    );

    renderTopBar();

    await userEvent.click(
      screen.getByRole("button", { name: /notifications/i }),
    );

    expect(
      await screen.findByText(/no notifications yet/i),
    ).toBeInTheDocument();
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
    api.clearNotifications.mockRejectedValueOnce(
      new Error("Failed to clear notifications"),
    );

    renderTopBar();

    await userEvent.click(
      screen.getByRole("button", { name: /notifications/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /clear all/i }),
    );

    await waitFor(() =>
      expect(api.clearNotifications).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByText("Resume needs manual review."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Failed to clear notifications"),
    ).toBeInTheDocument();
  });

  it("filters applications by multiple statuses and clears the selection", async () => {
    const user = userEvent.setup();
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({
        id: "draft",
        job_title: "Draft role",
        visible_status: "draft",
      }),
      buildApplicationSummary({
        id: "attention",
        job_title: "Attention role",
        visible_status: "needs_action",
      }),
      buildApplicationSummary({
        id: "complete",
        job_title: "Completed role",
        visible_status: "complete",
      }),
    ]);
    renderWithAppProvider(<ApplicationsListPage />);
    expect(await screen.findByText("Draft role")).toBeInTheDocument();
    for (const status of ["Draft", "Needs Action", "Complete"]) {
      expect(
        screen.getByRole("button", { name: `Collapse group ${status}` }),
      ).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Filter by status" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Draft" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Needs Action" }),
    );
    await user.keyboard("{Escape}");
    expect(screen.getByText("Draft role")).toBeInTheDocument();
    expect(screen.getByText("Attention role")).toBeInTheDocument();
    expect(screen.queryByText("Completed role")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Clear status filter" }),
    );
    expect(screen.getByText("Completed role")).toBeInTheDocument();
  });

  it("supports current-page selection without triggering row navigation", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer" }),
      buildApplicationSummary({
        id: "app-2",
        job_title: "Platform Engineer",
        company: "Beta Labs",
      }),
    ]);

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications" element={<ApplicationsListPage />} />
        <Route
          path="/app/applications/:applicationId"
          element={<div>Detail Route</div>}
        />
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
      buildApplicationSummary({
        id: "app-1",
        job_title: "Backend Engineer",
        applied: false,
      }),
      buildApplicationSummary({
        id: "app-2",
        job_title: "Platform Engineer",
        company: "Beta Labs",
        applied: true,
      }),
    ];
    const updated = [
      buildApplicationSummary({
        id: "app-1",
        job_title: "Backend Engineer",
        applied: true,
      }),
      buildApplicationSummary({
        id: "app-2",
        job_title: "Platform Engineer",
        company: "Beta Labs",
        applied: true,
      }),
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
    await userEvent.click(
      screen.getAllByRole("button", { name: /mark applied/i })[0],
    );

    await waitFor(() => expect(api.patchApplication).toHaveBeenCalledTimes(1));
    expect(api.patchApplication).toHaveBeenCalledWith("app-1", {
      applied: true,
    });
    expect(
      await screen.findByText(/marked 1 application as applied/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("2 applications selected"),
    ).not.toBeInTheDocument();
  });

  it("shows singular and plural bulk delete confirmation copy", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer" }),
      buildApplicationSummary({
        id: "app-2",
        job_title: "Platform Engineer",
        company: "Beta Labs",
      }),
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
      buildApplicationSummary({
        id: "app-1",
        job_title: "Backend Engineer",
        internal_state: "generating",
      }),
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Select Backend Engineer"));

    expect(screen.getByRole("button", { name: /^delete$/i })).toBeDisabled();
    expect(
      screen.getByText(
        /delete is unavailable while 1 selected application is still processing/i,
      ),
    ).toBeInTheDocument();
  });

  it("keeps failed selections after a partial bulk delete failure", async () => {
    const initial = [
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer" }),
      buildApplicationSummary({
        id: "app-2",
        job_title: "Platform Engineer",
        company: "Beta Labs",
      }),
    ];
    const updated = [
      buildApplicationSummary({
        id: "app-2",
        job_title: "Platform Engineer",
        company: "Beta Labs",
      }),
    ];
    api.listApplications
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(updated);
    api.deleteApplication
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error(
          "Application cannot be deleted while background work is still running.",
        ),
      );

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Select Backend Engineer"));
    await userEvent.click(screen.getByLabelText("Select Platform Engineer"));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /delete applications/i }),
    );

    await waitFor(() => expect(api.deleteApplication).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("1 application selected"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Select Platform Engineer")).toBeChecked();
    expect(
      await screen.findByText(/1 application failed/i),
    ).toBeInTheDocument();
  });

  it("renders row-level icon delete controls for idle applications", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({
        id: "app-1",
        job_title: "Backend Engineer",
        internal_state: "resume_ready",
      }),
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete backend engineer/i }),
    ).toBeInTheDocument();
  });

  it("renders row-level stop controls for active extraction applications", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({
        id: "app-1",
        job_title: "Backend Engineer",
        internal_state: "extracting",
        visible_status: "draft",
      }),
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /stop extraction for backend engineer/i,
      }),
    ).toBeInTheDocument();
  });

  it("disables row-level delete controls while generation work is active", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({
        id: "app-1",
        job_title: "Backend Engineer",
        internal_state: "generating",
        visible_status: "draft",
      }),
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /delete unavailable while backend engineer is still processing/i,
      }),
    ).toBeDisabled();
  });

  it("summarizes admin metrics with labeled composition and outcome rows", async () => {
    api.fetchAdminMetrics.mockResolvedValue({
      total_users: 10,
      active_users: 8,
      deactivated_users: 2,
      invited_users: 3,
      total_applications: 42,
      invites_sent: 8,
      invites_accepted: 5,
      invites_pending: 2,
      extraction: {
        total: 8,
        success_count: 6,
        failure_count: 2,
        success_rate: 75,
      },
      generation: {
        total: 3,
        success_count: 3,
        failure_count: 0,
        success_rate: 100,
      },
      regeneration: {
        total: 0,
        success_count: 0,
        failure_count: 0,
        success_rate: 0,
      },
      export: {
        total: 9,
        success_count: 9,
        failure_count: 0,
        success_rate: 100,
      },
    });

    renderWithAppProvider(<AdminDashboardPage />);

    expect(await screen.findByText("Workflow outcomes")).toBeInTheDocument();
    expect(screen.getByText("62.5%")).toBeInTheDocument();
    expect(screen.getByText("90.0%")).toBeInTheDocument();
    expect(screen.getByText("2 failed of 20 runs")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("composition-row-onboarded")).getByText("5"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("composition-row-closed")).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("operation-row-regeneration")).getByText(
        "No runs",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Extraction outcomes: Succeeded 6 (75%), Failed 2 (25%)",
      }),
    ).toBeInTheDocument();
  });

  it("surfaces dashboard load failures instead of showing the empty state", async () => {
    api.listApplications.mockRejectedValue(new Error("Session expired."));

    renderWithAppProvider(<DashboardPage />);

    expect(
      await screen.findByText(/dashboard unavailable/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    expect(screen.queryByText(/no applications yet/i)).not.toBeInTheDocument();
  });

  it("requests bounded creation activity and refetches when the range changes", async () => {
    const user = userEvent.setup();
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", applied: true }),
      buildApplicationSummary({ id: "app-2", company: "Northstar" }),
    ]);
    api.fetchCreationActivity.mockImplementation(
      async (range: "7d" | "30d" | "3m" | "1y") =>
        range === "30d"
          ? buildCreationActivity(range, { 28: [2, 1], 29: [1, 0] })
          : buildCreationActivity(range, { 51: [4, 3] }),
    );

    renderWithAppProvider(<DashboardPage />);

    const chart = await screen.findByTestId("creation-activity-chart");
    expect(chart).toHaveAttribute("data-range", "30d");
    expect(chart.getAttribute("aria-label")).toMatch(
      /3 created, 1 marked applied/,
    );
    expect(api.fetchCreationActivity).toHaveBeenCalledTimes(1);
    expect(api.fetchCreationActivity).toHaveBeenCalledWith(
      "30d",
      expect.any(String),
    );
    expect(
      screen.getByText("Applications created per day, last 30 days"),
    ).toBeInTheDocument();
    expect(screen.getByText("Job sources")).toBeInTheDocument();
    expect(screen.getByText("Top companies")).toBeInTheDocument();
    expect(screen.getByText("Status breakdown")).toBeInTheDocument();
    expect(
      screen.getAllByRole("row").filter((row) => row.closest("table.sr-only")),
    ).toHaveLength(31);

    await user.click(screen.getByRole("radio", { name: "1Y" }));

    await waitFor(() =>
      expect(screen.getByTestId("creation-activity-chart")).toHaveAttribute(
        "data-range",
        "1y",
      ),
    );
    expect(api.fetchCreationActivity).toHaveBeenLastCalledWith(
      "1y",
      expect.any(String),
    );
    expect(
      screen.getByText("Applications created per week, last 12 months"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("creation-activity-chart").getAttribute("aria-label"),
    ).toMatch(/4 created, 3 marked applied/);
  });

  it("keeps the dashboard usable when creation activity fails", async () => {
    const user = userEvent.setup();
    api.listApplications.mockResolvedValue([buildApplicationSummary()]);
    const failure = new Error("Activity service unavailable.");
    // The shared query client retries once before surfacing the error.
    api.fetchCreationActivity
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure);

    renderWithAppProvider(<DashboardPage />);

    expect(
      await screen.findByText(/activity could not be loaded/i, undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByTestId("creation-activity-chart"),
    ).toBeInTheDocument();
  });

  it("retains cached creation activity and surfaces a failed refresh with a working retry", async () => {
    const user = userEvent.setup();
    api.listApplications.mockResolvedValue([buildApplicationSummary()]);
    const initialActivity = buildCreationActivity("30d", { 29: [2, 1] });
    const refreshedActivity = buildCreationActivity("30d", { 29: [3, 2] });
    const failure = new Error("Activity service unavailable.");
    let finishRetry!: (
      activity: ReturnType<typeof buildCreationActivity>,
    ) => void;
    api.fetchCreationActivity
      .mockResolvedValueOnce(initialActivity)
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce(
        () => new Promise((resolve) => { finishRetry = resolve; }),
      );
    const queryClient = createAppQueryClient();
    queryClient.setDefaultOptions({
      queries: { ...queryClient.getDefaultOptions().queries, retryDelay: 0 },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppProvider>
            <ToastProvider>
              <ShellLayoutProvider><DashboardPage /></ShellLayoutProvider>
            </ToastProvider>
          </AppProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const chart = await screen.findByTestId("creation-activity-chart");
    expect(chart).toHaveAttribute(
      "aria-label",
      expect.stringContaining("2 created, 1 marked applied"),
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["applications", "creationActivity"] });
    });
    expect(await screen.findByText(
      /activity could not be refreshed.*last loaded activity/i,
    )).toBeInTheDocument();
    expect(chart).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(api.fetchCreationActivity).toHaveBeenCalledTimes(4));
    expect(chart.parentElement).toHaveAttribute("aria-busy", "true");
    expect(chart.parentElement).toHaveClass("opacity-50");
    await act(async () => {
      finishRetry(refreshedActivity);
    });

    await waitFor(() => expect(chart).toHaveAttribute(
      "aria-label",
      expect.stringContaining("3 created, 2 marked applied"),
    ));
    expect(screen.queryByText(/activity could not be refreshed/i)).not.toBeInTheDocument();
    expect(chart.parentElement).toHaveAttribute("aria-busy", "false");
  });

  it("aggregates lower-volume job sources into an other bucket", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_posting_origin: "linkedin" }),
      buildApplicationSummary({ id: "app-2", job_posting_origin: "linkedin" }),
      buildApplicationSummary({ id: "app-3", job_posting_origin: "linkedin" }),
      buildApplicationSummary({ id: "app-4", job_posting_origin: "indeed" }),
      buildApplicationSummary({ id: "app-5", job_posting_origin: "indeed" }),
      buildApplicationSummary({
        id: "app-6",
        job_posting_origin: "company_website",
      }),
      buildApplicationSummary({ id: "app-7", job_posting_origin: "glassdoor" }),
      buildApplicationSummary({ id: "app-8", job_posting_origin: "monster" }),
    ]);

    renderWithAppProvider(<DashboardPage />);

    expect(await screen.findByText("Job sources")).toBeInTheDocument();
    expect(screen.getByText("LinkedIn")).toBeInTheDocument();
    expect(screen.getByText("Indeed")).toBeInTheDocument();
    expect(screen.getByText("Company Website")).toBeInTheDocument();
    expect(screen.queryByText("Glassdoor")).not.toBeInTheDocument();
    const otherRow = screen.getByTestId("composition-row-other");
    expect(within(otherRow).getByText("Other")).toBeInTheDocument();
    expect(within(otherRow).getByText("2")).toBeInTheDocument();
    expect(within(otherRow).getByText("25%")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /^Job sources: LinkedIn 3 \(38%\)/ }),
    ).toBeInTheDocument();
    const inProgress = screen.getByTestId("status-figure-in_progress");
    expect(within(inProgress).getByText("8")).toBeInTheDocument();
    expect(within(inProgress).getByText("100%")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("status-figure-draft")).getByText("0"),
    ).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("Acme");
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
    expect(
      within(row as HTMLElement).getByText("Needs Action"),
    ).toBeInTheDocument();
    expect(
      within(row as HTMLElement).queryByText(/action required/i),
    ).not.toBeInTheDocument();
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(
      await screen.findByText(/manual entry required/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/other source label/i),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Posting Source" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Other" }));

    expect(
      await screen.findByPlaceholderText(/other source label/i),
    ).toBeInTheDocument();
  });

  it("hides URL retry on URL-less manual entry applications", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        job_url: null,
        job_title: null,
        company: null,
        job_description: null,
        visible_status: "needs_action",
        internal_state: "manual_entry_required",
        failure_reason: "extraction_failed",
        has_action_required_notification: true,
      }),
    );
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(
      await screen.findByText(/manual entry required/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry with text/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry extraction/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry url/i }),
    ).not.toBeInTheDocument();
  });

  it("ignores duplicate extraction retry clicks while the first retry is pending", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "needs_action",
        internal_state: "manual_entry_required",
        failure_reason: "extraction_failed",
      }),
    );
    api.retryExtraction.mockImplementation(
      () =>
        new Promise(() => {
          // Keep retry pending so the second click exercises the in-flight guard.
        }),
    );

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const retryButton = await screen.findByRole("button", {
      name: /retry url/i,
    });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    await waitFor(() => expect(api.retryExtraction).toHaveBeenCalledTimes(1));
  });

  it("ignores duplicate recover-from-source submissions while the first retry is pending", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "needs_action",
        internal_state: "manual_entry_required",
        failure_reason: "extraction_failed",
      }),
    );
    api.recoverApplicationFromSource.mockImplementation(
      () =>
        new Promise(() => {
          // Keep recovery pending so the second submit exercises the in-flight guard.
        }),
    );

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const sourceText = await screen.findByPlaceholderText(
      /paste job posting text/i,
    );
    await userEvent.type(
      sourceText,
      "Senior Platform Engineer. Build APIs and queues.",
    );

    const retryButton = screen.getByRole("button", {
      name: /retry with text/i,
    });
    const form = retryButton.closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() =>
      expect(api.recoverApplicationFromSource).toHaveBeenCalledTimes(1),
    );
  });

  it("ignores duplicate manual-entry submissions while the first save is pending", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "needs_action",
        internal_state: "manual_entry_required",
        failure_reason: "extraction_failed",
      }),
    );
    api.submitManualEntry.mockImplementation(
      () =>
        new Promise(() => {
          // Keep manual entry pending so the second submit exercises the in-flight guard.
        }),
    );

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const submitButton = await screen.findByRole("button", {
      name: /submit manual entry/i,
    });
    const form = submitButton.closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(api.submitManualEntry).toHaveBeenCalledTimes(1));
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByText(/duplicate detected/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /proceed anyway/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open existing/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Job Title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Company" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Job Title" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Company" })).not.toBeInTheDocument();
  });

  it("renders the wide detail workspace with settings and generated resume panels", async () => {
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Default Resume",
        is_default: true,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);
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
      job_keywords: null,
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const heading = await screen.findByRole("heading", { name: "AI & Data Senior Manager" });
    const header = heading.closest(".app-page-header");
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByText("Accenture")).toBeInTheDocument();
    expect(await within(header as HTMLElement).findByText(/Generated .*Revision 1/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /generated resume/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Preview your resume. Double-click/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Job Description" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Job Description" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /job description/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /generation settings/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("$170,000 - $210,000 base salary"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Summary/ }));
    expect(screen.getByText(/grounded summary/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Summary" }),
    ).toBeInTheDocument();
    const actionsButton = screen.getByRole("button", { name: /actions/i });
    expect(actionsButton).toHaveAttribute("aria-haspopup", "menu");
    expect(actionsButton).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: /delete application/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^export$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^regenerate$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^compare$/i }),
    ).not.toBeInTheDocument();

    // Open Actions dropdown to view nested options
    await userEvent.click(actionsButton);

    expect(actionsButton).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("menuitem", { name: /export pdf/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /export docx/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /mark applied/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /view posting/i }),
    ).toBeInTheDocument();
  });

  it("opens the ATS keyword modal with exact match states", async () => {
    const user = userEvent.setup();
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
        job_keywords: {
          status: "succeeded",
          source_hash: "hash-1",
          extracted_at: "2026-04-07T12:08:00Z",
          updated_at: "2026-04-07T12:08:00Z",
          model_used: "cheap-keyword-model",
          keywords: [
            { text: "React Native", source: "extracted" },
            { text: "CI/CD", source: "extracted" },
            {
              text: "Kubernetes",
              source: "manual",
              added_at: "2026-04-07T12:09:00Z",
            },
          ],
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md:
        "# Resume\n\n## Summary\nBuilt React Native apps with CI/CD pipelines.",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      keyword_match: {
        matched_count: 2,
        total_count: 3,
        percentage: 66.6667,
        target_percentage: 65,
        target_met: true,
        matched_keywords: ["React Native", "CI/CD"],
        missing_keywords: ["Kubernetes"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const card = await screen.findByTestId("keyword-match-card");
    expect(within(card).getByText(/66\.7% matched/i)).toBeInTheDocument();
    expect(within(card).getByText("2/3")).toBeInTheDocument();
    expect(within(card).queryByText("React Native")).not.toBeInTheDocument();

    await user.click(
      within(card).getByRole("button", { name: /ats keywords/i }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: /ats keyword breakdown/i,
    });
    expect(within(dialog).getByText("React Native")).toBeInTheDocument();
    expect(within(dialog).getByText("CI/CD")).toBeInTheDocument();
    expect(within(dialog).getByText("Kubernetes")).toBeInTheDocument();
    const matchedKeywordPill = dialog.querySelector(
      '[aria-label="React Native, matched keyword"]',
    );
    const missingKeywordPill = dialog.querySelector(
      '[aria-label="Kubernetes, missing keyword"]',
    );
    expect(matchedKeywordPill).not.toBeNull();
    expect(missingKeywordPill).not.toBeNull();
    expect(matchedKeywordPill as HTMLElement).not.toHaveTextContent(/matched/i);
    expect(missingKeywordPill as HTMLElement).not.toHaveTextContent(/missing/i);
    expect(matchedKeywordPill as HTMLElement).toHaveAttribute(
      "style",
      expect.stringContaining("var(--color-accent)"),
    );
    expect(missingKeywordPill as HTMLElement).toHaveAttribute(
      "style",
      expect.stringContaining("var(--color-error)"),
    );
    expect(within(dialog).getByText(/2\/3/i)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /remove kubernetes/i }),
    ).toBeInTheDocument();
  });

  it("adds and removes manual ATS keywords from the modal", async () => {
    const user = userEvent.setup();
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        job_keywords: {
          status: "succeeded",
          source_hash: "hash-1",
          updated_at: "2026-04-07T12:08:00Z",
          keywords: [{ text: "React Native", source: "extracted" }],
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nBuilt React Native apps.",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary"],
        section_order: ["summary"],
      },
      keyword_match: {
        matched_count: 1,
        total_count: 1,
        percentage: 100,
        target_percentage: 65,
        target_met: true,
        matched_keywords: ["React Native"],
        missing_keywords: [],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.updateManualKeywords.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        job_keywords: {
          status: "succeeded",
          source_hash: "hash-1",
          updated_at: "2026-04-07T12:09:00Z",
          keywords: [
            { text: "React Native", source: "extracted" },
            {
              text: "Kubernetes",
              source: "manual",
              added_at: "2026-04-07T12:09:00Z",
            },
          ],
        },
      }),
    );

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const card = await screen.findByTestId("keyword-match-card");
    await user.click(
      within(card).getByRole("button", { name: /ats keywords/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /ats keyword breakdown/i,
    });
    expect(
      within(dialog).getByRole("button", {
        name: /optimize for missing keywords/i,
      }),
    ).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText(/add keyword/i),
      " Kubernetes ",
    );
    await user.click(within(dialog).getByRole("button", { name: /^add$/i }));

    await waitFor(() =>
      expect(api.updateManualKeywords).toHaveBeenCalledWith("app-1", [
        "Kubernetes",
      ]),
    );
    expect(api.fetchDraft).toHaveBeenCalled();

    api.updateManualKeywords.mockResolvedValueOnce(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        job_keywords: {
          status: "succeeded",
          source_hash: "hash-1",
          updated_at: "2026-04-07T12:10:00Z",
          keywords: [{ text: "React Native", source: "extracted" }],
        },
      }),
    );
    await user.click(
      await within(dialog).findByRole("button", { name: /remove kubernetes/i }),
    );
    await waitFor(() =>
      expect(api.updateManualKeywords).toHaveBeenLastCalledWith("app-1", []),
    );
  });

  it("starts targeted keyword optimization from the modal", async () => {
    const user = userEvent.setup();
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        job_keywords: {
          status: "succeeded",
          source_hash: "hash-1",
          updated_at: "2026-04-07T12:08:00Z",
          keywords: [{ text: "React Native" }, { text: "Kubernetes" }],
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nBuilt React Native apps.",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary"],
        section_order: ["summary"],
      },
      keyword_match: {
        matched_count: 1,
        total_count: 2,
        percentage: 50,
        target_percentage: 65,
        target_met: false,
        matched_keywords: ["React Native"],
        missing_keywords: ["Kubernetes"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.triggerKeywordOptimization.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "regenerating_full",
        failure_reason: null,
      }),
    );

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const card = await screen.findByTestId("keyword-match-card");
    await user.click(
      within(card).getByRole("button", { name: /ats keywords/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /ats keyword breakdown/i,
    });
    await user.click(
      within(dialog).getByRole("button", {
        name: /optimize for missing keywords/i,
      }),
    );

    await waitFor(() =>
      expect(api.triggerKeywordOptimization).toHaveBeenCalledWith("app-1"),
    );
  });

  it("shows keyword extraction updating state and opens the application stream", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        job_keywords: {
          status: "queued",
          source_hash: "hash-1",
          updated_at: "2026-04-07T12:08:00Z",
          keywords: [],
        },
      }),
    );

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const card = await screen.findByTestId("keyword-match-card");
    expect(within(card).getByText(/queued/i)).toBeInTheDocument();
    expect(
      within(card).getByText(/keyword extraction is updating/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.openApplicationEventStream).toHaveBeenCalled(),
    );
  });

  it("shows below-target ATS keyword coverage", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        job_keywords: {
          status: "failed",
          source_hash: "hash-1",
          updated_at: "2026-04-07T12:08:00Z",
          message: "Keyword extraction timed out.",
          keywords: [{ text: "React Native" }, { text: "Kubernetes" }],
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nBuilt React Native apps.",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "high",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary"],
        section_order: ["summary"],
      },
      keyword_match: {
        matched_count: 1,
        total_count: 2,
        percentage: 50,
        target_percentage: 80,
        target_met: false,
        matched_keywords: ["React Native"],
        missing_keywords: ["Kubernetes"],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const card = await screen.findByTestId("keyword-match-card");
    expect(within(card).getByText(/50\.0% matched/i)).toBeInTheDocument();
    expect(within(card).getByText(/below target/i)).toBeInTheDocument();
  });

  it("shows ATS keyword extraction failure text", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        job_keywords: {
          status: "failed",
          source_hash: "hash-1",
          updated_at: "2026-04-07T12:08:00Z",
          message: "Keyword extraction timed out.",
          keywords: [],
        },
      }),
    );
    api.fetchDraft.mockResolvedValue(null);

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const card = await screen.findByTestId("keyword-match-card");
    expect(within(card).getByText(/0 total/i)).toBeInTheDocument();
    expect(
      within(card).getByText(/keyword extraction timed out/i),
    ).toBeInTheDocument();
  });

  it("renders applied status without a misleading timestamp and offers unapplied action", async () => {
    const user = userEvent.setup();
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        applied: true,
        visible_status: "in_progress",
        internal_state: "resume_ready",
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
        updated_at: "2026-04-07T12:00:00Z",
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByText(/^applied$/i)).toBeInTheDocument();
    expect(screen.queryByText(/applied on/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    expect(
      screen.getByRole("menuitem", { name: /mark unapplied instead/i }),
    ).toBeInTheDocument();
  });

  it("downloads DOCX using the server-provided filename", async () => {
    const user = userEvent.setup();
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Default Resume",
        is_default: true,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByRole("tab", { name: /Summary/ });
    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    await user.click(screen.getByRole("menuitem", { name: /export docx/i }));

    await waitFor(() => expect(api.exportDocx).toHaveBeenCalledWith("app-1"));
    const anchor = appendSpy.mock.calls.find(
      ([node]) => node instanceof HTMLAnchorElement,
    )?.[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("Alex_Example_resume_20260412_101500.docx");
    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:mock-url",
    );

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
    const payload = api.updateProfile.mock.calls.at(-1)?.[0];
    expect(payload).not.toHaveProperty("section_preferences");
    expect(payload).not.toHaveProperty("section_order");
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

    await userEvent.type(
      screen.getByRole("textbox", { name: "Search resumes" }),
      "product",
    );

    expect(screen.getByText("Product Resume")).toBeInTheDocument();
    expect(screen.queryByText("Backend Resume")).not.toBeInTheDocument();

    await userEvent.clear(
      screen.getByRole("textbox", { name: "Search resumes" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Search resumes" }),
      "no match",
    );
    expect(await screen.findByText("No matching resumes")).toBeInTheDocument();
    await userEvent.clear(
      screen.getByRole("textbox", { name: "Search resumes" }),
    );
    expect(await screen.findByText("Product Resume")).toBeInTheDocument();
    expect(screen.getByText("Backend Resume")).toBeInTheDocument();
  });

  it.each(["surface", "keyboard", "edit"])(
    "opens resume cards through %s navigation",
    async (interaction) => {
      const user = userEvent.setup();
      api.listBaseResumes.mockResolvedValue([
        {
          id: "resume-1",
          name: "Product Resume",
          is_default: true,
          created_at: "2026-04-07T12:00:00Z",
          updated_at: "2026-04-07T12:00:00Z",
        },
      ]);
      renderWithAppProvider(
        <Routes>
          <Route path="/app/resumes" element={<BaseResumesPage />} />
          <Route path="/app/resumes/resume-1" element={<p>Resume details</p>} />
        </Routes>,
        { initialEntries: ["/app/resumes"] },
      );
      const cardLink = await screen.findByRole("link", {
        name: "Open Product Resume",
      });
      expect(cardLink).toHaveAttribute("href", "/app/resumes/resume-1");
      if (interaction === "keyboard") {
        cardLink.focus();
        await user.keyboard("{Enter}");
      } else if (interaction === "edit") {
        await user.click(
          screen.getByRole("button", { name: "Edit Product Resume" }),
        );
      } else {
        await user.click(screen.getByText("Product Resume"));
      }
      expect(await screen.findByText("Resume details")).toBeInTheDocument();
    },
  );

  it("keeps default and delete actions independent of resume cards", async () => {
    const user = userEvent.setup();
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Product Resume",
        is_default: false,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);
    api.setDefaultBaseResume.mockResolvedValue(undefined);
    api.deleteBaseResume.mockResolvedValue(undefined);
    renderWithAppProvider(
      <Routes>
        <Route path="/app/resumes" element={<BaseResumesPage />} />
        <Route path="/app/resumes/resume-1" element={<p>Resume details</p>} />
      </Routes>,
      { initialEntries: ["/app/resumes"] },
    );
    await user.click(
      await screen.findByRole("button", { name: "Set Default" }),
    );
    await waitFor(() =>
      expect(api.setDefaultBaseResume).toHaveBeenCalledWith("resume-1"),
    );
    expect(screen.queryByText("Resume details")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Delete Product Resume" }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Delete resume?",
    );
    expect(api.deleteBaseResume).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("link", { name: "Open Product Resume" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Delete Product Resume" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete Resume" }));
    await waitFor(() =>
      expect(api.deleteBaseResume).toHaveBeenCalledWith("resume-1"),
    );
    expect(screen.queryByText("Resume details")).not.toBeInTheDocument();
  });

  it("shows resume summaries with icon-only edit and delete controls", async () => {
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Product Resume",
        summary: "Product leader building accessible tools for small teams.",
        is_default: false,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
    ]);

    renderWithAppProvider(<BaseResumesPage />);

    expect(await screen.findByText("Product Resume")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Product leader building accessible tools for small teams.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /edit product resume/i }).textContent,
    ).toBe("");
    expect(
      screen.getByRole("button", { name: /delete product resume/i })
        .textContent,
    ).toBe("");
    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
  });

  it("returns to resume upload without submitting the review form", async () => {
    api.uploadBaseResume.mockResolvedValue({
      id: "resume-uploaded",
      name: "Uploaded Resume",
      content_md: "# Uploaded Resume",
      is_default: false,
      needs_review: true,
      import_warning: "Review formatting.",
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route path="/app/resumes/new" element={<BaseResumeEditorPage />} />
      </Routes>,
      { initialEntries: ["/app/resumes/new?mode=upload"] },
    );

    await userEvent.type(
      screen.getByLabelText(/resume name/i),
      "Uploaded Resume",
    );
    await userEvent.upload(
      screen.getByLabelText(/pdf file/i),
      new File(["resume"], "resume.pdf", { type: "application/pdf" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /upload & parse/i }),
    );

    await userEvent.click(
      await screen.findByRole("tab", { name: "Extracted text" }),
    );
    expect(
      await screen.findByRole("button", { name: /re-upload/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /re-upload/i }));

    expect(
      await screen.findByRole("button", { name: /upload & parse/i }),
    ).toBeInTheDocument();
    expect(api.updateBaseResume).not.toHaveBeenCalled();
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
        <Route
          path="/app/resumes/:resumeId"
          element={<BaseResumeEditorPage />}
        />
      </Routes>,
      { initialEntries: ["/app/resumes/resume-1"] },
    );

    expect(await screen.findByText("Product Resume")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /^delete resume$/i }),
    );
    expect(await screen.findByText(/delete resume\?/i)).toBeInTheDocument();
    await userEvent.click(
      screen
        .getAllByRole("button", { name: /delete resume/i })
        .at(-1) as HTMLElement,
    );

    await waitFor(() =>
      expect(api.deleteBaseResume).toHaveBeenCalledWith("resume-1"),
    );
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(
      await screen.findByText(/blocked automated retrieval/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/9e8afb060bd31117/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry with text/i }),
    ).toBeInTheDocument();
  });

  it.each([
    ["posting_unavailable", "This posting appears to be closed or removed."],
    ["no_job_posting", "No job posting was found on this page."],
  ])("keeps the persisted %s explanation without a live progress response", async (kind, message) => {
    api.fetchApplicationDetail.mockResolvedValue(buildApplicationDetail({
      internal_state: "manual_entry_required", visible_status: "needs_action", failure_reason: "extraction_failed",
      extraction_failure_details: { kind, provider: null, reference_id: null, blocked_url: null, detected_at: "2026-10-04T12:00:00Z" },
    }));
    api.fetchApplicationProgress.mockResolvedValue(null);
    renderWithAppProvider(<Routes><Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} /></Routes>,
      { initialEntries: ["/app/applications/app-1"] });
    expect(await screen.findByText(new RegExp(message.replace(".", "\\.")))).toBeInTheDocument();
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await userEvent.click(await screen.findByRole("button", { name: "Edit Notes" }));
    const notesInput =
      await screen.findByPlaceholderText(/add your own notes/i);
    expect(api.listBaseResumes).toHaveBeenCalledTimes(1);

    fireEvent.change(notesInput, {
      target: { value: "Remember recruiter context" },
    });

    await waitFor(() =>
      expect(api.patchApplication).toHaveBeenCalledWith("app-1", {
        notes: "Remember recruiter context",
      }),
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

    let resolveNotesSave:
      ((value: ReturnType<typeof buildApplicationDetail>) => void) | null =
      null;
    api.patchApplication.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNotesSave = resolve as typeof resolveNotesSave;
        }),
    );

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await userEvent.click(await screen.findByRole("button", { name: "Edit Notes" }));
    const notesInput =
      await screen.findByPlaceholderText(/add your own notes/i);
    await userEvent.click(screen.getByRole("button", { name: "Edit Job Title" }));
    const jobTitleInput = screen.getByRole("textbox", { name: "Job Title" });

    fireEvent.change(notesInput, {
      target: { value: "Remember recruiter context" },
    });
    fireEvent.change(jobTitleInput, {
      target: { value: "Staff Backend Engineer" },
    });

    await waitFor(() =>
      expect(api.patchApplication).toHaveBeenCalledWith("app-1", {
        notes: "Remember recruiter context",
      }),
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

    expect(screen.getByRole("textbox", { name: "Job Title" })).toHaveValue(
      "Staff Backend Engineer",
    );
    expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(1);
  });

  it("invalidates cached admin user filters after a status change", async () => {
    const user = userEvent.setup();
    let isActive = true;

    api.listAdminUsers.mockImplementation(
      async (params?: { search?: string; status?: string }) => {
        const adminUser = buildAdminUser({
          is_active: isActive,
          updated_at: isActive
            ? "2026-04-07T12:05:00Z"
            : "2026-04-07T12:10:00Z",
        });
        if (params?.status === "active") {
          return isActive ? [adminUser] : [];
        }
        if (params?.status === "deactivated") {
          return isActive ? [] : [adminUser];
        }
        return [adminUser];
      },
    );
    api.deactivateAdminUser.mockImplementation(async () => {
      isActive = false;
      return buildAdminUser({
        is_active: false,
        updated_at: "2026-04-07T12:10:00Z",
      });
    });

    renderWithAppProvider(<AdminUsersPage />);

    expect(await screen.findByText("Casey Member")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filter by status" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Active" }));
    expect(await screen.findByText("Casey Member")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filter by status" }));
    await user.click(screen.getByRole("menuitemradio", { name: "All" }));
    expect(await screen.findByText("Casey Member")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /deactivate/i }));
    await waitFor(() =>
      expect(api.deactivateAdminUser).toHaveBeenCalledWith("user-2"),
    );

    await user.click(screen.getByRole("button", { name: "Filter by status" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Active" }));

    expect(await screen.findByText(/no users found/i)).toBeInTheDocument();
    expect(screen.queryByText("Casey Member")).not.toBeInTheDocument();
  });

  it("edits an admin user's subscription tier", async () => {
    const user = userEvent.setup();
    api.listAdminUsers.mockResolvedValue([buildAdminUser()]);
    api.updateAdminUser.mockResolvedValue(
      buildAdminUser({ subscription_tier: "pro" }),
    );

    renderWithAppProvider(<AdminUsersPage />);

    await screen.findByText("Casey Member");
    await user.click(
      screen.getByRole("button", { name: /edit member@example.com/i }),
    );
    await user.click(screen.getByLabelText(/subscription tier/i));
    await user.click(screen.getByRole("menuitemradio", { name: "Pro" }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(api.updateAdminUser).toHaveBeenCalledWith(
        "user-2",
        expect.objectContaining({ subscription_tier: "pro" }),
      ),
    );
  });

  it("submits a trimmed admin invite from the invite modal", async () => {
    const user = userEvent.setup();
    api.listAdminUsers.mockResolvedValue([buildAdminUser()]);
    api.inviteAdminUser.mockResolvedValue(
      buildAdminUser({ email: "new@example.com" }),
    );

    renderWithAppProvider(<AdminUsersPage />);

    await screen.findByText("Casey Member");
    await user.click(screen.getByRole("button", { name: /send invite/i }));
    const inviteDialog = screen.getByRole("dialog", { name: /send invite/i });
    await user.type(
      within(inviteDialog).getByLabelText(/^email$/i),
      "  new@example.com  ",
    );
    await user.type(
      within(inviteDialog).getByLabelText(/first name/i),
      "  New  ",
    );
    await user.type(
      within(inviteDialog).getByLabelText(/last name/i),
      "  Person  ",
    );
    await user.click(
      within(inviteDialog).getByRole("button", { name: /^send invite$/i }),
    );

    await waitFor(() =>
      expect(api.inviteAdminUser).toHaveBeenCalledWith({
        email: "new@example.com",
        first_name: "New",
        last_name: "Person",
      }),
    );
  });

  it("confirms admin user deletion before calling the delete API", async () => {
    const user = userEvent.setup();
    api.listAdminUsers.mockResolvedValue([buildAdminUser()]);
    api.deleteAdminUser.mockResolvedValue(undefined);

    renderWithAppProvider(<AdminUsersPage />);

    await screen.findByText("Casey Member");
    await user.click(
      screen.getByRole("button", { name: /delete member@example.com/i }),
    );
    expect(api.deleteAdminUser).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(api.deleteAdminUser).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: /delete user/i }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /delete member@example.com/i }),
    );
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(api.deleteAdminUser).toHaveBeenCalledWith("user-2"),
    );
  });

  it("updates subscription tier settings from the admin page", async () => {
    const user = userEvent.setup();
    api.listSubscriptionTiers.mockResolvedValue([
      {
        key: "basic",
        name: "Basic",
        monthly_resume_generation_limit: 10,
        is_active: true,
        created_at: "2026-05-23T00:00:00Z",
        updated_at: "2026-05-23T00:00:00Z",
      },
      {
        key: "pro",
        name: "Pro",
        monthly_resume_generation_limit: 100,
        is_active: true,
        created_at: "2026-05-23T00:00:00Z",
        updated_at: "2026-05-23T00:00:00Z",
      },
    ]);
    api.updateSubscriptionTier.mockResolvedValue({
      key: "basic",
      name: "Basic",
      monthly_resume_generation_limit: 12,
      is_active: true,
      created_at: "2026-05-23T00:00:00Z",
      updated_at: "2026-05-23T12:00:00Z",
    });

    renderWithAppProvider(<AdminSubscriptionsPage />);

    await screen.findByRole("heading", { name: /subscription settings/i });
    await screen.findByText("Basic");
    expect(
      screen.queryByLabelText(/primary model|fallback model|reasoning/i),
    ).not.toBeInTheDocument();
    const limitInput = screen.getByDisplayValue("10");
    await user.clear(limitInput);
    await user.type(limitInput, "12");
    await user.click(
      within(limitInput.closest("form") as HTMLFormElement).getByRole(
        "button",
        { name: /save/i },
      ),
    );

    await waitFor(() =>
      expect(api.updateSubscriptionTier).toHaveBeenCalledWith("basic", {
        monthly_resume_generation_limit: 12,
      }),
    );
  });

  it("refreshes request allowances without overwriting unsaved edits", async () => {
    const user = userEvent.setup();
    const tier = {
      key: "basic" as const,
      name: "Basic",
      monthly_resume_generation_limit: 10,
      is_active: true,
      created_at: "2026-09-30T00:00:00Z",
      updated_at: "2026-09-30T00:00:00Z",
    };
    api.listSubscriptionTiers.mockResolvedValue([tier]);
    renderWithAppProvider(<AdminSubscriptionsPage />);
    const input = await screen.findByLabelText("Monthly requests");
    await waitFor(() => expect(input).toHaveValue(10));
    api.listSubscriptionTiers.mockResolvedValue([
      { ...tier, monthly_resume_generation_limit: 20 },
    ]);
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(input).toHaveValue(20));
    await user.clear(input);
    await user.type(input, "15");
    api.listSubscriptionTiers.mockResolvedValue([
      { ...tier, monthly_resume_generation_limit: 25 },
    ]);
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await screen.findByText("25 requests/month");
    expect(input).toHaveValue(15);
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByTitle("Stop extraction")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Reading the job posting" }),
      ).getByRole("button", { name: "Stop extraction" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^delete application$/i }),
    ).not.toBeInTheDocument();
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
          <Route
            path="/app/applications/:applicationId"
            element={<ApplicationDetailPage />}
          />
        </Routes>
      </>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(
      await screen.findByText("Acme — Backend Engineer"),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit Job Title" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Job Title" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Job Title" }),
      "Staff Backend Engineer",
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit Company" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Company" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Company" }), "Beta Labs");
    await userEvent.click(screen.getByRole("button", { name: "Edit Location" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Location" }),
      "British Columbia/Ontario",
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit Compensation" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Compensation" }),
      "$145,000 - $175,000",
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: /^save$/i })[0],
    );

    expect(
      await screen.findByText("Beta Labs — Staff Backend Engineer"),
    ).toBeInTheDocument();
    expect(api.patchApplication).toHaveBeenCalledWith(
      "app-1",
      expect.objectContaining({
        job_title: "Staff Backend Engineer",
        company: "Beta Labs",
        job_location_text: "British Columbia/Ontario",
        compensation_text: "$145,000 - $175,000",
      }),
    );
    await waitFor(() => expect(api.listApplications).toHaveBeenCalledTimes(0));
  });

  it("shows aggressiveness details on hover and preserves the High warning", async () => {
    api.listBaseResumes.mockResolvedValue([
      {
        id: "resume-1",
        name: "Default Resume",
        is_default: true,
        created_at: "2026-04-07T12:00:00Z",
        updated_at: "2026-04-07T12:00:00Z",
      },
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(
      await screen.findByRole("heading", { name: /generation settings/i }),
    ).toBeInTheDocument();

    expect(screen.getByText(/professional experience: aggressively reframe/i)).not.toBeVisible();
    await userEvent.hover(screen.getByRole("button", { name: "High aggressiveness" }));

    const experienceHelp = screen.getByText(/professional experience: aggressively reframe and reprioritize bullets, and add plausible tools, scope, outcomes, and metrics/i);
    await waitFor(() => expect(experienceHelp).toBeVisible());
    const tooltip = experienceHelp.closest('[role="tooltip"]') as HTMLElement;
    expect(
      within(tooltip).getByText(
        /role titles may be rewritten when the new title still matches the demonstrated work\. company, dates, credentials, and education remain fixed\./i,
      ),
    ).toBeVisible();
    expect(
      within(tooltip).getByText(
        /education: no factual rewrites beyond minimal formatting cleanup\./i,
      ),
    ).toBeVisible();
    await userEvent.unhover(screen.getByRole("button", { name: "High aggressiveness" }));
    const slider = screen.getByRole("slider", { name: "Aggressiveness" });
    act(() => slider.focus());
    await userEvent.keyboard("{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuenow", "2");
    expect(
      await screen.findByText(
        /high aggressiveness can add plausible claims, metrics, and tools that are not in your resume/i,
      ),
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
      content_md:
        "# Resume\n\n## Summary\nBuilt backend systems with Kubernetes.\n\n## Professional Experience\n- Built APIs",
      generation_params: {
        base_resume_id: "resume-1",
        page_length: "1_page",
        aggressiveness: "high",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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
      content_md:
        "# Resume\n\n## Summary\nBuilt backend systems.\n\n## Professional Experience\n- Built services",
      is_default: true,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(
      await screen.findByRole("button", { name: /^actions$/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^actions$/i }));
    expect(
      screen.getByRole("menuitem", { name: /^compare$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /^regen section$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /^full regen$/i }),
    ).toBeInTheDocument();
  });

  it("shows a source-limited length warning on the generated draft", async () => {
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
      content_md: "# Resume\n\n## Summary\nBuilt reliable APIs.",
      generation_params: {
        base_resume_id: "resume-1",
        page_length: "2_page",
        aggressiveness: "medium",
        additional_instructions: "",
      },
      sections_snapshot: {
        enabled_sections: ["summary"],
        section_order: ["summary"],
      },
      review_flags: [
        {
          section_name: "length",
          text: "This resume is 720 words, below the selected 2-page target of 900-1400 words. The source resume has 800 words, so the minimum acceptable source-aware length was 720 words without padding.",
          reason: "source_limited_length",
          metadata: {
            target_length: "2_page",
            generated_word_count: 720,
            source_word_count: 800,
            minimum_acceptable_words: 720,
            source_limited_length: true,
          },
        },
      ],
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.fetchBaseResume.mockResolvedValue({
      id: "resume-1",
      name: "Default Resume",
      content_md: "# Resume\n\n## Summary\nBuilt reliable APIs.",
      is_default: true,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:00:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(
      (await screen.findAllByText(/shorter than target/i)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/below the selected 2-page target of 900-1400 words/i)
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("opens compare mode and returns to inline section editing", async () => {
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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
      <>
      <TopBar />
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>
      </>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /^actions$/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /^compare$/i }));

    await userEvent.click(screen.getByRole("button", { name: /^actions$/i }));
    expect(
      screen.getByRole("menuitem", { name: /close comparison/i }),
    ).toBeInTheDocument();
    // Close the dropdown after checking
    await userEvent.click(screen.getByRole("button", { name: /^actions$/i }));

    expect(
      screen.queryByText(
        /tailored draft shown beside the generation-time base resume/i,
      ),
    ).not.toBeInTheDocument();
    const actions = screen.getByRole("group", { name: "Application actions" });
    expect(actions.closest(".app-topbar-page-actions")).not.toBeNull();
    expect(actions.closest(".app-floating-page-actions")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^close comparison$/i })).toHaveLength(1);
    const baseHeading = screen.getByRole("heading", { name: /base resume/i });
    const basePane = baseHeading.closest(".compare-pane-card");
    expect(basePane).not.toBeNull();
    expect(
      within(basePane as HTMLElement).getByText("Default Resume"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/base summary/i).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /^close comparison$/i }));
    await userEvent.click(screen.getByRole("tab", { name: /Summary/ }));
    expect(screen.getByText(/tailored summary/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit Summary" }));
    expect(screen.getByDisplayValue(/tailored summary/i)).toBeInTheDocument();
    const workbench = screen.getByTestId("draft-section-workbench");
    const support = screen.getByRole("complementary", {
      name: "Application details",
    });
    expect(
      workbench.compareDocumentPosition(support) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(support).getByRole("heading", { name: /job description/i }),
    ).toBeInTheDocument();
    expect(
      within(support).getByRole("heading", { name: /generation settings/i }),
    ).toBeInTheDocument();
    expect(
      within(support).getByRole("button", { name: "Edit Notes" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /base resume/i }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      await screen.findByRole("button", { name: /^actions$/i }),
    );
    expect(
      screen.getByRole("menuitem", { name: /^compare$/i }),
    ).toBeInTheDocument();
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /^actions$/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /^compare$/i }));

    const baseHeading = await screen.findByRole("heading", {
      name: "Base Resume",
    });
    const basePane = baseHeading.closest(".compare-pane-card");

    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.queryByText("## Skills")).not.toBeInTheDocument();
    expect(basePane).not.toBeNull();
    expect(
      within(basePane as HTMLElement).getByText("Playwright").tagName,
    ).toBe("LI");
    expect(within(basePane as HTMLElement).getByText("Cypress").tagName).toBe(
      "LI",
    );
  });

  it.each([false, true])("offers the current user's profile in navigation, admin=%s", async (isAdmin) => {
    api.fetchSessionBootstrap.mockResolvedValue({
      ...defaultBootstrap,
      profile: { ...defaultBootstrap.profile, is_admin: isAdmin },
    });
    renderWithAppProvider(<Sidebar />, { initialEntries: ["/app/profile"] });
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    const profile = within(navigation).getByRole("link", { name: "Profile" });
    expect(profile).toHaveAttribute("href", "/app/profile");
    expect(profile).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(api.fetchSessionBootstrap).toHaveBeenCalled());
    if (isAdmin) {
      expect(await within(navigation).findByRole("link", { name: "Admin" })).toBeInTheDocument();
    } else {
      expect(within(navigation).queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    }
  });

  it("opens the mobile navigation drawer and closes it after choosing a destination", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    const showModal = vi
      .spyOn(HTMLDialogElement.prototype, "showModal")
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      });
    const close = vi
      .spyOn(HTMLDialogElement.prototype, "close")
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      });
    const queryClient = createAppQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/app"]}>
          <Routes>
            <Route path="/app" element={<AppShell />}>
              <Route index element={<h1>Mobile dashboard</h1>} />
              <Route path="resumes" element={<h1>Mobile resumes</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    try {
      await screen.findByRole("heading", { name: "Mobile dashboard" });
      const toggle = screen.getByRole("button", { name: "Toggle sidebar" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(toggle);
      const drawer = await screen.findByRole("dialog", { name: "Applix" });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(drawer.id).toBe(toggle.getAttribute("aria-controls"));
      await userEvent.click(
        within(drawer).getByRole("link", { name: "Resumes" }),
      );
      await screen.findByRole("heading", { name: "Mobile resumes" });
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Applix" }),
        ).not.toBeInTheDocument(),
      );
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    } finally {
      view.unmount();
      showModal.mockRestore();
      close.mockRestore();
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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

    const queryClient = createAppQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/app/applications/app-1"]}>
          <Routes>
            <Route path="/app" element={<AppShell />}>
              <Route
                path="applications/:applicationId"
                element={<ApplicationDetailPage />}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const actionsButton = await screen.findByRole("button", {
      name: /^actions$/i,
    });
    const shellRoot = screen.getByRole("main").closest(".app-shell-root");
    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });

    expect(shellRoot).not.toBeNull();
    expect(navigation).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(shellRoot).toHaveAttribute("data-shell-mode", "default");
    expect(screen.queryByLabelText(/toggle sidebar/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit Company" }));
    const company = screen.getByRole("textbox", { name: "Company" });
    fireEvent.change(company, { target: { value: "Unsaved company" } });

    await userEvent.click(actionsButton);
    await userEvent.click(screen.getByRole("menuitem", { name: /^compare$/i }));

    expect(shellRoot).toHaveAttribute("data-shell-mode", "immersive");
    expect(
      screen.queryByRole("navigation", { name: "Primary navigation" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/toggle sidebar/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^actions$/i }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: /close comparison/i }),
    );

    expect(shellRoot).toHaveAttribute("data-shell-mode", "default");
    expect(screen.getByRole("textbox", { name: "Company" })).toBe(company);
    expect(company).toHaveValue("Unsaved company");
    expect(api.patchApplication).not.toHaveBeenCalled();
  });

  it("preserves mounted page edits when the shell crosses its navigation breakpoint", async () => {
    const mediaQueries = new Map<string, MediaQueryList>();
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      if (!mediaQueries.has(query)) {
        mediaQueries.set(query, Object.assign(new EventTarget(), {
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
        }) as MediaQueryList);
      }
      return mediaQueries.get(query)!;
    });
    function UnsavedEditor() {
      const [text, setText] = useState("");
      return (
        <input
          aria-label="Unsaved editor"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      );
    }
    const queryClient = createAppQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/app"]}>
          <Routes>
            <Route path="/app" element={<AppShell />}>
              <Route index element={<UnsavedEditor />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    try {
      const editor = await screen.findByRole("textbox", { name: "Unsaved editor" });
      await userEvent.type(editor, "Unsaved text");
      expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
      const setMobile = (mobile: boolean) => {
        for (const [query, media] of mediaQueries) {
          if (!/width\s*</.test(query)) continue;
          Object.defineProperty(media, "matches", { configurable: true, value: mobile });
          media.dispatchEvent(new Event("change"));
        }
      };
      act(() => setMobile(true));
      expect(screen.queryByRole("navigation", { name: "Primary navigation" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Toggle sidebar" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Unsaved editor" })).toBe(editor);
      expect(editor).toHaveValue("Unsaved text");

      act(() => setMobile(false));
      expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Unsaved editor" })).toBe(editor);
      expect(editor).toHaveValue("Unsaved text");
    } finally {
      view.unmount();
      matchMedia.mockRestore();
    }
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByRole("button", { name: /^actions$/i });
    await userEvent.click(screen.getByRole("button", { name: /^actions$/i }));
    expect(
      screen.getByRole("menuitem", { name: /^compare$/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.fetchBaseResume).toHaveBeenCalledWith("resume-1"),
    );

    await userEvent.click(screen.getByRole("menuitem", { name: /^compare$/i }));
    expect(
      (await screen.findAllByText(/original baseline/i)).length,
    ).toBeGreaterThan(0);
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.fetchBaseResume.mockRejectedValue(new Error("Forbidden"));

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /^actions$/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /^compare$/i }));

    expect(
      await screen.findAllByText(/compare view is unavailable/i),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("heading", { name: /base resume/i }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /Summary/ }));
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
        <Route
          path="/app/applications"
          element={<div>Applications Route</div>}
        />
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByRole("heading", { name: "Backend Engineer" });

    await userEvent.click(
      screen.getByRole("button", { name: /^delete application$/i }),
    );
    expect(
      await screen.findByText(/delete application\?/i),
    ).toBeInTheDocument();
    await userEvent.click(
      screen
        .getAllByRole("button", { name: /delete application/i })
        .at(-1) as HTMLElement,
    );

    await waitFor(() =>
      expect(api.deleteApplication).toHaveBeenCalledWith("app-1"),
    );
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByTitle("Stop extraction")).toBeInTheDocument();

    // The card button opens the same confirmation as the header icon.
    await user.click(
      within(
        screen.getByRole("region", { name: "Reading the job posting" }),
      ).getByRole("button", { name: "Stop extraction" }),
    );
    expect(await screen.findByText(/stop extraction\?/i)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText(/stop extraction\?/i)).not.toBeInTheDocument(),
    );
    await user.click(screen.getByTitle("Stop extraction"));
    expect(await screen.findByText(/stop extraction\?/i)).toBeInTheDocument();
    await user.click(
      screen
        .getAllByRole("button", { name: /stop extraction/i })
        .at(-1) as HTMLElement,
    );

    await waitFor(() =>
      expect(api.cancelExtraction).toHaveBeenCalledWith("app-1"),
    );
    expect(
      await screen.findByRole("heading", { name: /manual entry required/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/extraction was stopped/i)[0],
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry with text/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^delete application$/i }),
    ).toBeInTheDocument();
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

    expect(
      await screen.findByRole("heading", { name: /chrome extension/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no active token/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /connect extension/i }),
    ).toBeInTheDocument();
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(
      await screen.findByRole("heading", { name: /generation failed/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/resume generation/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cancel generation/i }),
    ).not.toBeInTheDocument();
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() =>
      expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByRole("heading", { name: /generation failed/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cancel generation/i }),
    ).not.toBeInTheDocument();
  });

  it("stops generation polling when terminal progress is returned but detail refresh fails", async () => {
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
      .mockRejectedValue(new Error("Application request failed."));
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

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() =>
      expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText(/^draft$/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cancel generation/i }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(3),
    );
    expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1);
  });

  it("stops extraction polling and shows manual-entry fallback when terminal extraction progress cannot sync detail state", async () => {
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

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() =>
      expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.getByRole("heading", { name: /manual entry required/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /automatic extraction failed\. manual entry is required\./i,
      ),
    ).toBeInTheDocument();
  });

  it("maps terminal extraction success progress to generation-pending fallback when detail sync lags", async () => {
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

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() =>
      expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.queryByRole("heading", { name: /manual entry required/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/company is missing from extraction/i),
    ).toBeInTheDocument();
  });

  it("shows subscription quota guidance when full regeneration is capped", async () => {
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.triggerFullRegeneration.mockRejectedValue(
      new Error(
        "Monthly resume generation limit reached. Contact an administrator or upgrade your subscription tier.",
      ),
    );

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const actionsButton = await screen.findByRole("button", {
      name: /^actions$/i,
    });
    await user.click(actionsButton);
    await user.click(
      await screen.findByRole("menuitem", { name: /full regen/i }),
    );

    const confirmButton = await screen.findByRole("button", {
      name: /^regenerate$/i,
    });
    await user.click(confirmButton);

    await waitFor(() =>
      expect(api.triggerFullRegeneration).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByText(/monthly resume generation limit reached/i),
    ).toBeInTheDocument();
  });

  it("keeps custom Full Regen instructions in the modal when regeneration fails to start", async () => {
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });
    api.triggerFullRegeneration.mockRejectedValue(
      new Error("Unable to start regeneration right now."),
    );

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await user.click(await screen.findByRole("button", { name: /^actions$/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /full regen/i }),
    );

    const instructions = await screen.findByLabelText(/custom instructions/i);
    await user.type(instructions, "Preserve senior cloud leadership emphasis.");
    await user.click(screen.getByRole("button", { name: /^regenerate$/i }));

    await waitFor(() =>
      expect(api.triggerFullRegeneration).toHaveBeenCalledTimes(1),
    );
    expect(
      await screen.findByText(/unable to start regeneration right now/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /fully regenerate resume/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/custom instructions/i)).toHaveValue(
      "Preserve senior cloud leadership emphasis.",
    );
  });

  it("merges saved settings instructions with Full Regen modal instructions", async () => {
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
        page_length: "2_page",
        aggressiveness: "high",
        additional_instructions: "Keep infrastructure metrics prominent.",
      },
      sections_snapshot: {
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await user.click(await screen.findByRole("button", { name: /^actions$/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /full regen/i }),
    );
    await user.type(
      await screen.findByLabelText(/custom instructions/i),
      "Also emphasize senior leadership scope.",
    );
    expect(
      screen.getByText(/This legacy draft has no frozen source links/),
    ).toBeInTheDocument();
    const reset = screen.getByRole("checkbox", {
      name: /Use latest base resume/,
    });
    expect(reset).not.toBeChecked();
    await user.click(reset);
    await user.click(screen.getByRole("button", { name: /^regenerate$/i }));

    await waitFor(() =>
      expect(api.triggerFullRegeneration).toHaveBeenCalledWith("app-1", {
        target_length: "2_page",
        aggressiveness: "high",
        additional_instructions:
          "Keep infrastructure metrics prominent.\n\nAlso emphasize senior leadership scope.",
        use_judge_feedback: undefined,
        use_latest_base: true,
      }),
    );
    expect(
      screen.queryByRole("heading", { name: /fully regenerate resume/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the contextual job-details banner when retrying generation without a job title", async () => {
    const user = userEvent.setup();
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "needs_action",
        internal_state: "resume_ready",
        failure_reason: "generation_failed",
        job_title: null,
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
        generation_failure_details: {
          message: "Resume generation encountered errors.",
        },
      }),
    );
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

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await user.click(await screen.findByRole("button", { name: /^retry$/i }));

    expect(api.triggerGeneration).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Job Information Required"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/please supply these under the job details panel/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/details: add a job title before generating\./i),
    ).toBeInTheDocument();
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
      message:
        "Applying deterministic Professional Experience structure checks",
      percent_complete: 62,
      created_at: "2026-04-07T12:00:00Z",
      updated_at: "2026-04-07T12:01:00Z",
      completed_at: null,
      terminal_error_code: null,
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() =>
      expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Resume processing status" }),
      ).toHaveTextContent(
        /applying deterministic professional experience structure checks/i,
      ),
    );
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() =>
      expect(api.openApplicationEventStream).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      latestStreamHandlers().onProgress(
        buildProgressPayload({
          workflow_kind: "generation",
          state: "generating",
          message:
            "Applying deterministic Professional Experience structure checks",
          percent_complete: 62,
          updated_at: "2026-04-07T12:02:00Z",
        }),
      );
    });

    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Resume processing status" }),
      ).toHaveTextContent(
        /applying deterministic professional experience structure checks/i,
      ),
    );
  });

  it("disables repeated watchdog polling while live stream heartbeats are flowing", async () => {
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() =>
      expect(api.openApplicationEventStream).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      latestStreamHandlers().onHeartbeat?.({ sent_at: "2026-04-07T12:01:00Z" });
      await Promise.resolve();
    });

    expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(1);
    expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1);
  });

  it("refreshes the generated draft from a live completion event without a page reload", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "draft",
        internal_state: "generating",
        failure_reason: null,
        base_resume_id: "resume-1",
        base_resume_name: "Default Resume",
      }),
    );
    api.fetchApplicationProgress.mockResolvedValue(
      buildProgressPayload({
        workflow_kind: "generation",
        state: "generating",
        message: "Resume generation is running.",
      }),
    );
    api.fetchDraft.mockResolvedValueOnce(null).mockResolvedValueOnce({
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() =>
      expect(api.openApplicationEventStream).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Resume processing status" }),
      ).toHaveTextContent(/resume generation is running/i),
    );

    await act(async () => {
      latestStreamHandlers().onDetail(
        buildApplicationDetail({
          id: "app-1",
          visible_status: "in_progress",
          internal_state: "resume_ready",
          failure_reason: null,
          base_resume_id: "resume-1",
          base_resume_name: "Default Resume",
          updated_at: "2026-04-07T12:10:00Z",
          resume_judge_result: {
            status: "queued",
            message: "Resume Judge is queued.",
            evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
            job_context_signature: "backend engineer\u001facme\u001fbuild apis",
          },
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/scoring draft/i)).toBeInTheDocument();
  });

  it("refreshes the draft when live completion detail arrives after polling fallback already marked resume ready", async () => {
    api.fetchApplicationDetail
      .mockResolvedValueOnce(
        buildApplicationDetail({
          id: "app-1",
          visible_status: "draft",
          internal_state: "generating",
          failure_reason: null,
          base_resume_id: "resume-1",
          base_resume_name: "Default Resume",
          updated_at: "2026-04-07T12:00:00Z",
        }),
      )
      .mockRejectedValueOnce(new Error("application request failed"));
    api.fetchApplicationProgress.mockResolvedValue(
      buildProgressPayload({
        workflow_kind: "generation",
        state: "resume_ready",
        message: "Resume generation complete.",
        percent_complete: 100,
        updated_at: "2026-04-07T12:10:00Z",
        completed_at: "2026-04-07T12:10:00Z",
        terminal_error_code: null,
      }),
    );
    api.fetchDraft
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
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
          enabled_sections: [
            "summary",
            "professional_experience",
            "education",
            "skills",
          ],
          section_order: [
            "summary",
            "professional_experience",
            "education",
            "skills",
          ],
        },
        last_generated_at: "2026-04-07T12:10:00Z",
        last_exported_at: null,
        updated_at: "2026-04-07T12:10:00Z",
      });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() =>
      expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(2),
    );
    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledTimes(3));
    expect(await screen.findByText(/^in progress$/i)).toBeInTheDocument();
    expect(screen.queryByText(/scoring draft/i)).not.toBeInTheDocument();

    await act(async () => {
      latestStreamHandlers().onDetail(
        buildApplicationDetail({
          id: "app-1",
          visible_status: "in_progress",
          internal_state: "resume_ready",
          failure_reason: null,
          base_resume_id: "resume-1",
          base_resume_name: "Default Resume",
          updated_at: "2026-04-07T12:10:00Z",
          resume_judge_result: {
            status: "queued",
            message: "Resume Judge is queued.",
            evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
            job_context_signature: "backend engineer\u001facme\u001fbuild apis",
          },
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledTimes(4));
    expect(await screen.findByText(/scoring draft/i)).toBeInTheDocument();
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() =>
      expect(api.fetchApplicationProgress).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledWith("app-1"));
    await userEvent.click(await screen.findByRole("tab", { name: /Summary/ }));
    await waitFor(() => {
      expect(screen.getByText("Grounded summary")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Edit Summary" }),
      ).toBeDisabled();
    });
    expect(
      screen.getByRole("status", { name: "Resume processing status" }),
    ).toHaveTextContent(/refreshing experience bullets/i);
    expect(
      screen.queryByText(/no resume generated yet/i),
    ).not.toBeInTheDocument();
  });

  it("locks inline section editors immediately when full regeneration starts", async () => {
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledWith("app-1"));
    await user.click(await screen.findByRole("tab", { name: /Summary/ }));
    await user.click(screen.getByRole("button", { name: "Edit Summary" }));
    expect(screen.getByDisplayValue("Grounded summary")).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /full regen/i }),
    );

    const confirmButton = await screen.findByRole("button", {
      name: /^regenerate$/i,
    });
    await user.click(confirmButton);

    await waitFor(() =>
      expect(api.triggerFullRegeneration).toHaveBeenCalledTimes(1),
    );
    await user.click(screen.getByRole("tab", { name: /Summary/ }));
    expect(screen.getByText("Grounded summary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Summary" })).toBeDisabled();
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("3 Pages")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Aggressiveness" })).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByText("Emphasize architecture leadership.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Additional Instructions" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit Target Length" }));
    expect(screen.getByRole("button", { name: "Target Length" })).toHaveTextContent("3 Pages");
    await userEvent.click(screen.getByRole("button", { name: "Edit Additional Instructions" }));
    expect(screen.getByRole("textbox", { name: "Additional Instructions" })).toHaveValue("Emphasize architecture leadership.");
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() => expect(api.fetchDraft).toHaveBeenCalledTimes(1));

    const settingsHeading = await screen.findByRole("heading", {
      name: /generation settings/i,
    });
    const settingsForm = settingsHeading.closest("form");
    expect(settingsForm).not.toBeNull();

    expect(within(settingsForm as HTMLFormElement).queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit Target Length" }));
    await userEvent.click(screen.getByRole("button", { name: "Target Length" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "2 Pages" }));

    expect(screen.getByRole("button", { name: "Target Length" })).toHaveTextContent("2 Pages");
    expect(within(settingsForm as HTMLFormElement).getByRole("button", { name: /^save$/i })).toBeEnabled();
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
            role_alignment: {
              score: 8,
              weight: 0.25,
              weighted_contribution: 20,
              notes: "Aligned to the JD.",
            },
            specificity_and_concreteness: {
              score: 7,
              weight: 0.2,
              weighted_contribution: 14,
              notes: "Mostly specific.",
            },
            voice_and_human_quality: {
              score: 5,
              weight: 0.2,
              weighted_contribution: 10,
              notes: "Voice still feels templated.",
            },
            grounding_integrity: {
              score: 8,
              weight: 0.2,
              weighted_contribution: 16,
              notes: "Grounded.",
            },
            ats_safety_and_formatting: {
              score: 9,
              weight: 0.1,
              weighted_contribution: 9,
              notes: "ATS-safe.",
            },
            length_and_density: {
              score: 7,
              weight: 0.05,
              weighted_contribution: 3.5,
              notes: "Acceptable length.",
            },
          },
          regeneration_instructions: {
            summary: ["Tighten the summary voice.", null as unknown as string],
          },
          regeneration_priority_dimensions: ["voice_and_human_quality"],
          evaluator_notes:
            "A targeted rewrite should push this above the pass threshold.",
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(screen.getAllByText(/resume judge/i)).toHaveLength(1);
    const jobDescriptionCard = await screen.findByTestId(
      "job-description-card",
    );
    expect(
      judgeCard.compareDocumentPosition(jobDescriptionCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(judgeCard).getByText(/78\/100/i)).toBeInTheDocument();
    expect(
      within(judgeCard).getByText(/strong alignment with a few voice issues/i),
    ).toBeInTheDocument();

    await userEvent.click(judgeCard.closest("button") as HTMLButtonElement);

    expect(
      await screen.findByRole("dialog", { name: /resume judge breakdown/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/verdict: review at 77\.6 \/ 100\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /regenerate with judge feedback/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/aligned to the jd/i)).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /role alignment/i }),
    );
    expect(screen.getByText(/aligned to the jd/i)).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: /resume judge breakdown/i })).getByText(/summary:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/- tighten the summary voice\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /a targeted rewrite should push this above the pass threshold/i,
      ),
    ).toBeInTheDocument();
  });

  it("keeps a completed resume judge score visible after export refresh when the backend marks it current", async () => {
    const user = userEvent.setup();
    api.fetchApplicationDetail
      .mockResolvedValueOnce(
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
              role_alignment: {
                score: 8,
                weight: 0.25,
                weighted_contribution: 20,
                notes: "Aligned to the JD.",
              },
              specificity_and_concreteness: {
                score: 7,
                weight: 0.2,
                weighted_contribution: 14,
                notes: "Mostly specific.",
              },
              voice_and_human_quality: {
                score: 5,
                weight: 0.2,
                weighted_contribution: 10,
                notes: "Voice still feels templated.",
              },
              grounding_integrity: {
                score: 8,
                weight: 0.2,
                weighted_contribution: 16,
                notes: "Grounded.",
              },
              ats_safety_and_formatting: {
                score: 9,
                weight: 0.1,
                weighted_contribution: 9,
                notes: "ATS-safe.",
              },
              length_and_density: {
                score: 7,
                weight: 0.05,
                weighted_contribution: 3.5,
                notes: "Acceptable length.",
              },
            },
            regeneration_instructions: "Tighten the summary voice.",
            regeneration_priority_dimensions: ["voice_and_human_quality"],
            evaluator_notes:
              "A targeted rewrite should push this above the pass threshold.",
            evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
            scored_at: "2026-04-07T12:12:00Z",
            is_stale: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        buildApplicationDetail({
          id: "app-1",
          visible_status: "complete",
          internal_state: "resume_ready",
          resume_judge_result: {
            status: "succeeded",
            final_score: 77.6,
            display_score: 78,
            verdict: "warn",
            pass_threshold: 80,
            score_summary: "Strong alignment with a few voice issues.",
            dimension_scores: {
              role_alignment: {
                score: 8,
                weight: 0.25,
                weighted_contribution: 20,
                notes: "Aligned to the JD.",
              },
              specificity_and_concreteness: {
                score: 7,
                weight: 0.2,
                weighted_contribution: 14,
                notes: "Mostly specific.",
              },
              voice_and_human_quality: {
                score: 5,
                weight: 0.2,
                weighted_contribution: 10,
                notes: "Voice still feels templated.",
              },
              grounding_integrity: {
                score: 8,
                weight: 0.2,
                weighted_contribution: 16,
                notes: "Grounded.",
              },
              ats_safety_and_formatting: {
                score: 9,
                weight: 0.1,
                weighted_contribution: 9,
                notes: "ATS-safe.",
              },
              length_and_density: {
                score: 7,
                weight: 0.05,
                weighted_contribution: 3.5,
                notes: "Acceptable length.",
              },
            },
            regeneration_instructions: "Tighten the summary voice.",
            regeneration_priority_dimensions: ["voice_and_human_quality"],
            evaluator_notes:
              "A targeted rewrite should push this above the pass threshold.",
            evaluated_draft_updated_at: "2026-04-07T12:10:00Z",
            scored_at: "2026-04-07T12:12:00Z",
            is_stale: false,
          },
        }),
      );
    api.fetchDraft
      .mockResolvedValueOnce({
        id: "draft-1",
        application_id: "app-1",
        content_md: "# Resume\n\n## Summary\nGrounded summary",
        generation_params: {
          page_length: "1_page",
          aggressiveness: "medium",
          additional_instructions: "",
        },
        sections_snapshot: {
          enabled_sections: [
            "summary",
            "professional_experience",
            "education",
            "skills",
          ],
          section_order: [
            "summary",
            "professional_experience",
            "education",
            "skills",
          ],
        },
        last_generated_at: "2026-04-07T12:10:00Z",
        last_exported_at: null,
        updated_at: "2026-04-07T12:10:00Z",
      })
      .mockResolvedValueOnce({
        id: "draft-1",
        application_id: "app-1",
        content_md: "# Resume\n\n## Summary\nGrounded summary",
        generation_params: {
          page_length: "1_page",
          aggressiveness: "medium",
          additional_instructions: "",
        },
        sections_snapshot: {
          enabled_sections: [
            "summary",
            "professional_experience",
            "education",
            "skills",
          ],
          section_order: [
            "summary",
            "professional_experience",
            "education",
            "skills",
          ],
        },
        last_generated_at: "2026-04-07T12:10:00Z",
        last_exported_at: "2026-04-07T12:12:00Z",
        updated_at: "2026-04-07T12:12:00Z",
      });
    api.exportPdf.mockResolvedValue({
      blob: new Blob(["pdf"], { type: "application/pdf" }),
      filename: "Alex_Example_resume_20260412_101500.pdf",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(within(judgeCard).getByText(/78\/100/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    await user.click(screen.getByRole("menuitem", { name: /export pdf/i }));

    await waitFor(() => expect(api.exportPdf).toHaveBeenCalledWith("app-1"));
    await waitFor(() =>
      expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByText(/exported .*2026/i)).toBeInTheDocument();

    const refreshedJudgeCard = await screen.findByTestId("resume-judge-card");
    expect(
      within(refreshedJudgeCard).getByText(/78\/100/i),
    ).toBeInTheDocument();
    expect(
      within(refreshedJudgeCard).queryByText(/^stale$/i),
    ).not.toBeInTheDocument();
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    const jobDescriptionCard = await screen.findByTestId(
      "job-description-card",
    );
    expect(
      judgeCard.compareDocumentPosition(jobDescriptionCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(judgeCard).getByText(/pending review/i)).toBeInTheDocument();
    expect(
      within(judgeCard).getByRole("button", { name: /run judge/i }),
    ).toBeInTheDocument();
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(within(judgeCard).getByText(/scoring draft/i)).toBeInTheDocument();
    expect(
      within(judgeCard).getByText(/judge feedback will appear here shortly/i),
    ).toBeInTheDocument();
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await waitFor(() =>
      expect(api.openApplicationEventStream).toHaveBeenCalledTimes(1),
    );

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
              role_alignment: {
                score: 8,
                weight: 0.25,
                weighted_contribution: 20,
                notes: "Aligned.",
              },
              specificity_and_concreteness: {
                score: 8,
                weight: 0.2,
                weighted_contribution: 16,
                notes: "Specific.",
              },
              voice_and_human_quality: {
                score: 6,
                weight: 0.2,
                weighted_contribution: 12,
                notes: "Needs variation.",
              },
              grounding_integrity: {
                score: 8,
                weight: 0.2,
                weighted_contribution: 16,
                notes: "Grounded.",
              },
              ats_safety_and_formatting: {
                score: 9,
                weight: 0.1,
                weighted_contribution: 9,
                notes: "ATS safe.",
              },
              length_and_density: {
                score: 7,
                weight: 0.05,
                weighted_contribution: 3.5,
                notes: "Acceptable.",
              },
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
    expect(
      within(judgeCard).getByText(/strong alignment with a few voice issues/i),
    ).toBeInTheDocument();
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
          is_stale: true,
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(
      within(judgeCard).getByText(/scoring unavailable/i),
    ).toBeInTheDocument();
    expect(within(judgeCard).queryByText(/—\/100/i)).not.toBeInTheDocument();
    expect(
      within(judgeCard).getByRole("button", { name: /re-evaluate/i }),
    ).toBeInTheDocument();
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
            role_alignment: {
              score: 7,
              weight: 0.25,
              weighted_contribution: 17.5,
              notes: "Aligned.",
            },
            specificity_and_concreteness: {
              score: 7,
              weight: 0.2,
              weighted_contribution: 14,
              notes: "Specific.",
            },
            voice_and_human_quality: {
              score: 6,
              weight: 0.2,
              weighted_contribution: 12,
              notes: "Natural enough.",
            },
            grounding_integrity: {
              score: 7,
              weight: 0.2,
              weighted_contribution: 14,
              notes: "Grounded.",
            },
            ats_safety_and_formatting: {
              score: 9,
              weight: 0.1,
              weighted_contribution: 9,
              notes: "ATS-safe.",
            },
            length_and_density: {
              score: 7,
              weight: 0.05,
              weighted_contribution: 3.5,
              notes: "Dense enough.",
            },
          },
          regeneration_instructions: "Refresh the score after edits.",
          regeneration_priority_dimensions: ["role_alignment"],
          evaluator_notes: "This score predates the latest draft edits.",
          evaluated_draft_updated_at: "2026-04-07T12:08:00Z",
          scored_at: "2026-04-07T12:09:00Z",
          is_stale: true,
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    const judgeTile = judgeCard.closest("button");
    expect(judgeTile).not.toBeNull();
    expect(within(judgeCard).getByText(/stale/i)).toBeInTheDocument();

    await userEvent.click(judgeTile as HTMLButtonElement);
    await userEvent.click(
      await screen.findByRole("button", { name: /re-evaluate/i }),
    );

    await waitFor(() =>
      expect(api.triggerResumeJudge).toHaveBeenCalledWith("app-1"),
    );
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
            role_alignment: {
              score: 5,
              weight: 0.25,
              weighted_contribution: 12.5,
              notes: "Misses core priorities.",
            },
            specificity_and_concreteness: {
              score: 5,
              weight: 0.2,
              weighted_contribution: 10,
              notes: "Too generic.",
            },
            voice_and_human_quality: {
              score: 4,
              weight: 0.2,
              weighted_contribution: 8,
              notes: "Reads AI-generated.",
            },
            grounding_integrity: {
              score: 7,
              weight: 0.2,
              weighted_contribution: 14,
              notes: "Mostly grounded.",
            },
            ats_safety_and_formatting: {
              score: 8,
              weight: 0.1,
              weighted_contribution: 8,
              notes: "ATS-safe.",
            },
            length_and_density: {
              score: 7,
              weight: 0.05,
              weighted_contribution: 3.5,
              notes: "Length is okay.",
            },
          },
          regeneration_instructions: {
            summary: ["Rewrite the summary to be candidate-specific."],
            professional_experience: ["Vary bullet openings."],
          },
          regeneration_priority_dimensions: [
            "voice_and_human_quality",
            "role_alignment",
          ],
          evaluator_notes:
            "The draft should be regenerated with targeted feedback.",
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeTile = (await screen.findByTestId("resume-judge-card")).closest(
      "button",
    );
    expect(judgeTile).not.toBeNull();

    await userEvent.click(judgeTile as HTMLButtonElement);
    await userEvent.click(
      await screen.findByRole("button", {
        name: /regenerate with judge feedback/i,
      }),
    );

    await waitFor(() =>
      expect(api.triggerFullRegeneration).toHaveBeenCalledWith("app-1", {
        target_length: "2_page",
        aggressiveness: "high",
        additional_instructions: "Keep infrastructure metrics prominent.",
        use_judge_feedback: true,
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
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
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(
      within(judgeCard).getByText(/scoring unavailable/i),
    ).toBeInTheDocument();
    expect(
      within(judgeCard).getByText(/judge provider timed out/i),
    ).toBeInTheDocument();

    await userEvent.click(
      within(judgeCard).getByRole("button", { name: /try again/i }),
    );

    await waitFor(() =>
      expect(api.triggerResumeJudge).toHaveBeenCalledWith("app-1"),
    );
  });

  it("disables re-evaluation after three failed judge runs for the current draft", async () => {
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        resume_judge_result: {
          status: "failed",
          message:
            "Resume Judge has already reached the maximum of 3 attempts for this draft.",
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
        enabled_sections: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
        section_order: [
          "summary",
          "professional_experience",
          "education",
          "skills",
        ],
      },
      last_generated_at: "2026-04-07T12:10:00Z",
      last_exported_at: null,
      updated_at: "2026-04-07T12:10:00Z",
    });

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(
      within(judgeCard).getByText(/maximum of 3 attempts/i),
    ).toBeInTheDocument();
    expect(
      within(judgeCard).getByRole("button", { name: /max attempts reached/i }),
    ).toBeDisabled();
  });

  it("collapses application details and restores unsaved fields with keyboard activation", async () => {
    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );
    const collapse = await screen.findByRole("button", { name: "Collapse application details" });
    await userEvent.click(screen.getByRole("button", { name: "Edit Company" }));
    const company = screen.getByRole("textbox", { name: "Company" });
    await userEvent.clear(company);
    await userEvent.type(company, "Unsaved company");
    const content = document.getElementById(collapse.getAttribute("aria-controls")!);
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(collapse);
    expect(content).not.toBeVisible();
    expect(company).toBeInTheDocument();
    const expand = screen.getByRole("button", { name: "Expand application details" });
    expect(expand).toHaveFocus();
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{Enter}");
    expect(content).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Company" })).toHaveValue("Unsaved company");
    expect(api.patchApplication).not.toHaveBeenCalled();
  });

  it("shows the activity button in the detail header and fetches activity only when opened", async () => {
    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByRole("heading", { name: "Backend Engineer" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /activity/i }),
    ).toBeInTheDocument();
    expect(api.listApplicationActivity).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /activity/i }));

    expect(
      await screen.findByRole("dialog", { name: /application activity/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.listApplicationActivity).toHaveBeenCalledWith("app-1"),
    );
  });

  it("renders a simplified activity timeline and expands AI details on row click", async () => {
    api.listApplicationActivity.mockResolvedValue([
      {
        id: "evt-2",
        type: "generation_failed",
        status: "failure",
        title: "Generation failed",
        summary: "Resume generation failed.",
        created_at: "2026-05-25T12:13:00Z",
        failure_message: "Validation failed at the post-check stage.",
        details: {
          failure_stage: "validation",
          attempt_count: 2,
          validation_errors: ["summary: content was too generic"],
          length_diagnostics: {
            target_length: "2_page",
            target_min: 900,
            target_max: 1400,
            generated_word_count: 760,
            source_word_count: 1000,
            minimum_acceptable_words: 900,
            source_limited_length: false,
          },
        },
        attempts: [
          {
            model: "openai/gpt-5-mini",
            reasoning_effort: "medium",
            transport_mode: "responses",
            outcome: "invalid_json",
            elapsed_ms: 1200,
            retry_reason: "invalid structured output",
          },
          {
            model: "google/gemini-3.5-flash",
            reasoning_effort: "high",
            transport_mode: "responses",
            outcome: "schema_failed",
            elapsed_ms: 900,
            retry_reason: "schema mismatch",
          },
        ],
      },
      {
        id: "evt-1",
        type: "generation_succeeded",
        status: "success",
        title: "Resume generated",
        summary: "Resume generation completed.",
        created_at: "2026-05-25T12:12:00Z",
        details: {
          model_used: "openai/gpt-5-mini",
          attempt_count: 1,
          duration_ms: 3400,
          length_diagnostics: {
            target_length: "2_page",
            target_min: 900,
            target_max: 1400,
            generated_word_count: 820,
            source_word_count: 1000,
            minimum_acceptable_words: 900,
            source_limited_length: false,
          },
        },
      },
      {
        id: "evt-0",
        type: "job_info_updated",
        status: "info",
        title: "Job details updated",
        summary: "Job details were edited.",
        created_at: "2026-05-25T12:11:00Z",
      },
    ]);

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByRole("heading", { name: "Backend Engineer" });
    await userEvent.click(screen.getByRole("button", { name: /activity/i }));

    expect(await screen.findByText("Generation failed")).toBeInTheDocument();
    expect(
      screen.getByText("Validation failed at the post-check stage."),
    ).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Resume generated")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /generation failed/i }),
    );

    expect(await screen.findByText(/length check:/i)).toBeInTheDocument();
    expect(screen.getByText(/760 words/i)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /generation failed/i }),
    );
    const completedActivity = screen.getByRole("button", { name: /resume generated/i });
    expect(completedActivity).toHaveAttribute("aria-expanded", "false");
    completedActivity.focus();
    await userEvent.keyboard("{Enter}");
    expect(completedActivity).toHaveAttribute("aria-expanded", "true");

    expect(await screen.findByText(/model:/i)).toBeInTheDocument();
    expect(screen.getByText("openai/gpt-5-mini")).toBeInTheDocument();
    expect(screen.getByText(/attempts:/i)).toBeInTheDocument();
    expect(screen.getByText(/duration:/i)).toBeInTheDocument();
    expect(screen.getByText(/length check:/i)).toBeInTheDocument();
    expect(screen.getByText(/generated:/i)).toBeInTheDocument();
    expect(screen.getByText(/820 words/i)).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(completedActivity).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("openai/gpt-5-mini")).not.toBeInTheDocument();
  });

  it("renders a loading state in the activity panel while activity is being fetched", async () => {
    api.listApplicationActivity.mockImplementationOnce(
      () =>
        new Promise(() => {
          // Keep pending so the loading state is visible.
        }),
    );

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByRole("heading", { name: "Backend Engineer" });
    await userEvent.click(screen.getByRole("button", { name: /activity/i }));
    expect(await screen.findByText(/loading activity/i)).toBeInTheDocument();
  });

  it("renders a clean error state in the activity panel", async () => {
    api.listApplicationActivity.mockRejectedValue(
      new Error("Activity feed unavailable."),
    );

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByRole("heading", { name: "Backend Engineer" });
    await userEvent.click(screen.getByRole("button", { name: /activity/i }));
    expect(
      await screen.findByText(/activity unavailable/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/activity feed unavailable/i)).toBeInTheDocument();
  });

  it("renders a clean empty state in the activity panel", async () => {
    api.listApplicationActivity.mockResolvedValueOnce([]);

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByRole("heading", { name: "Backend Engineer" });
    await userEvent.click(screen.getByRole("button", { name: /activity/i }));
    expect(await screen.findByText(/no activity yet/i)).toBeInTheDocument();
  });

  it("dismisses activity on an outside click or Escape and keeps inside clicks open", async () => {
    api.listApplicationActivity.mockResolvedValue([]);

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByRole("heading", { name: "Backend Engineer" });
    const activityButton = screen.getByRole("button", { name: /activity/i });
    await userEvent.click(activityButton);
    const dialog = await screen.findByRole("dialog", { name: /application activity/i });
    await userEvent.click(within(dialog).getByText(/no activity yet/i));
    expect(dialog).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("activity-panel-overlay"));
    expect(screen.queryByRole("dialog", { name: /application activity/i })).not.toBeInTheDocument();
    await waitFor(() => expect(activityButton).toHaveFocus());

    await userEvent.click(activityButton);
    await screen.findByRole("dialog", { name: /application activity/i });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /application activity/i })).not.toBeInTheDocument();
    await waitFor(() => expect(activityButton).toHaveFocus());
  });

  it("restores focus to the activity trigger after closing the panel", async () => {
    api.listApplicationActivity.mockResolvedValueOnce([]);

    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    await screen.findByRole("heading", { name: "Backend Engineer" });
    const activityButton = screen.getByRole("button", { name: /activity/i });
    await userEvent.click(activityButton);

    const dialog = await screen.findByRole("dialog", {
      name: /application activity/i,
    });
    expect(dialog).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: /close activity panel/i }),
    );

    await waitFor(() => expect(activityButton).toHaveFocus());
  });
  it("compares against the saved source revision and regenerates one stable role", async () => {
    const user = userEvent.setup();
    const document = {
      schema_version: 1,
      revision: 3,
      sections: [
        {
          id: "stable-experience",
          kind: "professional_experience",
          heading: "Experience",
          enabled: true,
          review_state: "reviewed",
          confidence: null,
          content_md: "",
          entries: [
            {
              id: "stable-role",
              fields: {
                company: "Acme",
                title: "Engineer",
                date_range: "2022 - Present",
              },
              bullets: [
                {
                  id: "stable-bullet",
                  text: "Built customer APIs",
                  source_ids: ["stable-bullet"],
                },
              ],
            },
          ],
        },
      ],
    };
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        base_resume_id: "resume-1",
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      document,
      source_snapshot: {
        base_resume_id: "resume-1",
        revision: 3,
        document,
        content_md: "## Experience\nAcme",
      },
      content_md: "## Experience\nAcme",
      generation_params: { base_resume_id: "resume-1" },
      sections_snapshot: {},
      last_generated_at: "2026-09-30T00:00:00Z",
      updated_at: "2026-09-30T00:00:00Z",
      last_exported_at: null,
    });
    api.triggerSectionRegeneration.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        internal_state: "regenerating_section",
        visible_status: "in_progress",
      }),
    );
    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );
    await user.click(await screen.findByRole("tab", { name: /Experience/ }));
    await screen.findByRole("button", { name: "Regenerate role" });
    expect(api.fetchBaseResume).not.toHaveBeenCalled();
    const originalWorkbench = screen.getByTestId("draft-section-workbench");
    await user.click(screen.getByRole("button", { name: "Regenerate role" }));
    await user.type(
      screen.getByPlaceholderText("Instructions for regenerating (required)…"),
      "Emphasize customer API delivery.",
    );
    await user.click(screen.getByRole("button", { name: /^regenerate$/i }));
    await waitFor(() =>
      expect(api.triggerSectionRegeneration).toHaveBeenCalledWith(
        "app-1",
        "stable-experience",
        "Emphasize customer API delivery.",
        "stable-role",
      ),
    );
    const loading = await screen.findByTestId("section-regeneration-progress");
    expect(screen.getByTestId("draft-section-workbench")).toBe(originalWorkbench);
    expect(screen.getByRole("tabpanel", { name: "Experience" })).toContainElement(loading);
    expect(screen.queryByRole("heading", { name: "Updating your resume section" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Application details" })).toBeInTheDocument();

  });

  it("uses the frozen source and tailoring level to prevent no-op regeneration requests", async () => {
    const user = userEvent.setup();
    const fixed = {
      enabled: true,
      review_state: "reviewed",
      confidence: null,
      content_md: "",
      entries: [],
    };
    const sourceDocument = {
      schema_version: 1,
      revision: 2,
      sections: [
        {
          ...fixed,
          id: "education",
          kind: "education",
          heading: "Education",
          content_md: "College, BSc",
        },
        {
          ...fixed,
          id: "skills",
          kind: "skills",
          heading: "Skills",
          content_md: "Python",
        },
      ],
    };
    const document = {
      ...sourceDocument,
      sections: [
        ...sourceDocument.sections,
        {
          ...fixed,
          id: "new-project",
          kind: "projects",
          heading: "New project",
          content_md: "Weather app",
        },
      ],
    };
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        id: "app-1",
        visible_status: "in_progress",
        internal_state: "resume_ready",
        base_resume_id: "resume-1",
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      document,
      source_snapshot: {
        base_resume_id: "resume-1",
        revision: 2,
        document: sourceDocument,
        content_md: "",
      },
      content_md: "",
      generation_params: { base_resume_id: "resume-1", aggressiveness: "low" },
      sections_snapshot: {},
      last_generated_at: "2026-09-30T00:00:00Z",
      updated_at: "2026-09-30T00:00:00Z",
      last_exported_at: null,
    });
    renderWithAppProvider(
      <Routes>
        <Route
          path="/app/applications/:applicationId"
          element={<ApplicationDetailPage />}
        />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );
    for (const section of document.sections) {
      await user.click(
        await screen.findByRole("tab", { name: new RegExp(section.heading) }),
      );
      const button = screen.getByRole("button", { name: "Regenerate section" });
      expect(button).toBeDisabled();
      await user.click(button);
    }
    expect(api.triggerSectionRegeneration).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Add this section to your base resume/),
    ).toBeInTheDocument();
  });
});
