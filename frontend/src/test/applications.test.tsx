import type { ReactNode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/components/layout/AppContext";
import { TopBar } from "@/components/layout/TopBar";
import { ToastProvider } from "@/components/ui/toast";
import { AppBreadcrumbs } from "@/components/layout/Breadcrumbs";
import { AppShell } from "@/routes/AppShell";
import { ApplicationDetailPage } from "@/routes/ApplicationDetailPage";
import { ApplicationsListPage } from "@/routes/ApplicationsListPage";
import { BaseResumeEditorPage } from "@/routes/BaseResumeEditorPage";
import { BaseResumesPage } from "@/routes/BaseResumesPage";
import { DashboardPage } from "@/routes/DashboardPage";
import { ExtensionPage } from "@/routes/ExtensionPage";
import { NOTIFICATIONS_CLEARED_EVENT } from "@/lib/events";

const api = vi.hoisted(() => ({
  cancelExtraction: vi.fn(),
  cancelGeneration: vi.fn(),
  createApplication: vi.fn(),
  createBaseResume: vi.fn(),
  clearNotifications: vi.fn(),
  deleteApplication: vi.fn(),
  deleteBaseResume: vi.fn(),
  exportPdf: vi.fn(),
  fetchExtensionStatus: vi.fn(),
  fetchApplicationDetail: vi.fn(),
  fetchApplicationProgress: vi.fn(),
  fetchBaseResume: vi.fn(),
  fetchDraft: vi.fn(),
  fetchSessionBootstrap: vi.fn(),
  issueExtensionToken: vi.fn(),
  listBaseResumes: vi.fn(),
  listApplications: vi.fn(),
  listNotifications: vi.fn(),
  patchApplication: vi.fn(),
  recoverApplicationFromSource: vi.fn(),
  resolveDuplicate: vi.fn(),
  revokeExtensionToken: vi.fn(),
  retryExtraction: vi.fn(),
  saveDraft: vi.fn(),
  setDefaultBaseResume: vi.fn(),
  submitManualEntry: vi.fn(),
  triggerFullRegeneration: vi.fn(),
  triggerGeneration: vi.fn(),
  triggerSectionRegeneration: vi.fn(),
  updateBaseResume: vi.fn(),
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
  profile: null,
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

describe("phase 1 applications UI", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.fetchDraft.mockResolvedValue(null);
    api.fetchSessionBootstrap.mockResolvedValue(defaultBootstrap);
    api.listBaseResumes.mockResolvedValue([]);
    api.listApplications.mockResolvedValue([]);
    api.listNotifications.mockResolvedValue([]);
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

  it("opens the notifications dropdown and keeps the badge count tied to attention items", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", visible_status: "needs_action" }),
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

  it("refreshes the applications list when notifications are cleared elsewhere", async () => {
    api.listApplications
      .mockResolvedValueOnce([buildApplicationSummary({ id: "app-1", has_action_required_notification: true })])
      .mockResolvedValueOnce([buildApplicationSummary({ id: "app-1", has_action_required_notification: true })])
      .mockResolvedValueOnce([buildApplicationSummary({ id: "app-1", has_action_required_notification: false })]);

    renderWithAppProvider(<ApplicationsListPage />);

    expect(await screen.findByText(/action required/i)).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event(NOTIFICATIONS_CLEARED_EVENT));
    });

    await waitFor(() => expect(api.listApplications).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(/action required/i)).not.toBeInTheDocument();
  });

  it("clears all notifications from the inbox and refreshes shell attention state", async () => {
    api.listApplications
      .mockResolvedValueOnce([buildApplicationSummary({ id: "app-1", has_action_required_notification: true })])
      .mockResolvedValueOnce([]);
    api.listNotifications.mockResolvedValue([
      buildNotificationSummary({
        id: "notif-clear",
        application_id: "app-1",
        message: "Resume needs manual review.",
        action_required: true,
        type: "warning",
      }),
    ]);
    api.clearNotifications.mockResolvedValue(undefined);

    renderTopBar();

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await userEvent.click(await screen.findByRole("button", { name: /clear all/i }));

    await waitFor(() => expect(api.clearNotifications).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listApplications).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
    expect(screen.getByText("Notifications cleared.")).toBeInTheDocument();
  });

  it("shows a sanitized error state when notifications fail to load", async () => {
    api.listNotifications.mockRejectedValueOnce(new Error("Failed to load notifications."));

    renderTopBar();

    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));

    expect(await screen.findByText(/notifications unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("Failed to load notifications.")).toBeInTheDocument();
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

  it("renders top-aligned application table cells for the compact list layout", async () => {
    api.listApplications.mockResolvedValue([
      buildApplicationSummary({ id: "app-1", job_title: "Backend Engineer" }),
    ]);

    renderWithAppProvider(<ApplicationsListPage />);

    const titleCell = await screen.findByText("Backend Engineer");
    const row = titleCell.closest("tr");
    const firstCell = row?.querySelector("td");

    expect(firstCell?.className).toContain("align-top");
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

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

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

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

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
      </MemoryRouter>,
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

  it("renders the wide detail workspace with settings and generated resume panels", async () => {
    api.listBaseResumes.mockResolvedValue([{ id: "resume-1", name: "Default Resume", is_default: true, created_at: "2026-04-07T12:00:00Z", updated_at: "2026-04-07T12:00:00Z" }]);
    api.fetchApplicationDetail.mockResolvedValue({
      id: "app-1",
      job_url: "https://example.com/job",
      job_title: "AI & Data Senior Manager",
      company: "Accenture",
      job_description: "Lead AI delivery programs.",
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
    expect(screen.getByText(/grounded summary/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export pdf/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete application/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark applied/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view posting/i })).toBeInTheDocument();
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

  it("refreshes the detail header attention state when notifications are cleared elsewhere", async () => {
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
        has_action_required_notification: true,
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
        updated_at: "2026-04-07T12:06:00Z",
        has_action_required_notification: false,
        duplicate_warning: null,
      });
    api.fetchDraft.mockResolvedValue(null);

    renderWithAppProvider(
      <Routes>
        <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
      </Routes>,
      { initialEntries: ["/app/applications/app-1"] },
    );

    expect(await screen.findByText(/action required/i)).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event(NOTIFICATIONS_CLEARED_EVENT));
    });

    await waitFor(() => expect(api.fetchApplicationDetail).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/action required/i)).not.toBeInTheDocument();
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
    await userEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]);

    expect(await screen.findByText("Beta Labs — Staff Backend Engineer")).toBeInTheDocument();
    await waitFor(() => expect(api.listApplications).toHaveBeenCalledTimes(2));
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
    expect(await screen.findByRole("heading", { name: /extraction stopped/i })).toBeInTheDocument();
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
