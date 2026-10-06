import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "@/components/layout/AppContext";
import { ShellLayoutProvider } from "@/components/layout/ShellLayoutContext";
import { ToastProvider } from "@/components/ui/toast";
import { ApplicationDetailPage } from "@/routes/ApplicationDetailPage";
import { createAppQueryClient } from "@/lib/query-client";
import type { ApplicationDetail } from "@/lib/api";

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
    monthly_resume_generations_used: 0,
    remaining_resume_generations: 10,
    reset_at: "2026-05-01T00:00:00Z",
  },
  notifications: [],
};

function buildApplicationDetail(overrides: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    id: "app-1",
    job_url: "https://example.com/jobs/staff-sdet",
    job_title: "Staff SDET",
    company: "Acme",
    job_description: "Build robust test frameworks and lead quality strategy.",
    job_location_text: null,
    compensation_text: null,
    extracted_reference_id: null,
    job_posting_origin: null,
    job_posting_origin_other_text: null,
    base_resume_id: null,
    base_resume_name: null,
    visible_status: "in_progress",
    internal_state: "resume_ready",
    failure_reason: null,
    extraction_failure_details: null,
    generation_failure_details: null,
    generation_preferences: { aggressiveness: "high", page_length: "1_page", additional_instructions: null },
    applied: false,
    duplicate_similarity_score: null,
    duplicate_resolution_status: null,
    duplicate_matched_application_id: null,
    notes: "",
    created_at: "2026-04-07T12:00:00Z",
    updated_at: "2026-04-07T12:10:00Z",
    has_action_required_notification: false,
    duplicate_warning: null,
    job_keywords: {
      status: "succeeded",
      source_hash: "hash-1",
      updated_at: "2026-04-07T12:05:00Z",
      keywords: [
        { text: "SDET", source: "extracted" },
        { text: "CI stability", source: "extracted" },
      ],
    },
    resume_judge_result: {
      status: "succeeded",
      verdict: "pass",
      final_score: 85.0,
      display_score: 85,
      pass_threshold: 80,
      score_summary: "Strong alignment with the SDET leadership role.",
      scored_at: "2026-04-07T12:09:00Z",
      dimension_scores: {
        skills_fit: { score: 90, weight: 1, weighted_contribution: 90, notes: "Matches role." },
      },
      regeneration_priority_dimensions: [],
      regeneration_instructions: {},
      is_stale: false,
      message: null,
    },
    ...overrides,
  };
}

function renderDetailPage() {
  const queryClient = createAppQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <ShellLayoutProvider>
          <ToastProvider>
            <MemoryRouter initialEntries={["/app/applications/app-1"]}>
              <Routes>
                <Route path="/app/applications/:applicationId" element={<ApplicationDetailPage />} />
              </Routes>
            </MemoryRouter>
          </ToastProvider>
        </ShellLayoutProvider>
      </AppProvider>
    </QueryClientProvider>,
  );
}

describe("Resume Judge and ATS Keywords UI enhancements", () => {
  beforeEach(() => {
    api.fetchSessionBootstrap.mockResolvedValue(defaultBootstrap);
    api.listBaseResumes.mockResolvedValue([
      { id: "resume-1", title: "Principal SDET Base", updated_at: "2026-04-07T12:00:00Z" },
    ]);
    api.listApplicationActivity.mockResolvedValue([]);
    api.listNotifications.mockResolvedValue([]);
    api.openApplicationEventStream.mockReturnValue(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders Resume Judge with traffic light colors on score and removes the Pass pill", async () => {
    api.fetchApplicationDetail.mockResolvedValue(buildApplicationDetail());
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nSDET leader.",
      generation_params: {
        page_length: "1_page",
        aggressiveness: "high",
        additional_instructions: "",
      },
      sections_snapshot: { enabled_sections: ["summary"], section_order: ["summary"] },
      last_generated_at: "2026-04-07T12:08:00Z",
    });

    renderDetailPage();

    const judgeCard = await screen.findByTestId("resume-judge-card");
    expect(within(judgeCard).getByText("Resume Judge")).toBeInTheDocument();

    // 1. Pass pill must NOT be rendered in the card
    expect(within(judgeCard).queryByText(/^pass$/i)).not.toBeInTheDocument();

    // 2. Score 85/100 (80-100 = green)
    const scorePill = within(judgeCard).getByText(/85\/100/i);
    expect(scorePill).toBeInTheDocument();
    expect(scorePill).toHaveAttribute(
      "style",
      expect.stringContaining("var(--color-success)"),
    );
  });

  it("applies yellow to Resume Judge for 50-79 and red for 0-49", async () => {
    // Score 65 -> yellow
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        resume_judge_result: {
          status: "succeeded",
          verdict: "warn",
          final_score: 65.0,
          display_score: 65,
          pass_threshold: 80,
          score_summary: "Review summary.",
          scored_at: "2026-04-07T12:09:00Z",
          dimension_scores: { tone: { score: 65, weight: 1, weighted_contribution: 65, notes: "" } },
          regeneration_priority_dimensions: [],
          regeneration_instructions: {},
          is_stale: false,
          message: null,
        },
      }),
    );
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume",
      generation_params: { page_length: "1_page", aggressiveness: "medium", additional_instructions: "" },
      sections_snapshot: { enabled_sections: ["summary"], section_order: ["summary"] },
      last_generated_at: "2026-04-07T12:08:00Z",
    });

    const { unmount } = renderDetailPage();

    const judgeCardYellow = await screen.findByTestId("resume-judge-card");
    const scorePillYellow = within(judgeCardYellow).getByText(/65\/100/i);
    expect(scorePillYellow).toHaveAttribute(
      "style",
      expect.stringContaining("var(--color-warning)"),
    );

    unmount();

    // Score 40 -> red
    api.fetchApplicationDetail.mockResolvedValue(
      buildApplicationDetail({
        resume_judge_result: {
          status: "succeeded",
          verdict: "fail",
          final_score: 40.0,
          display_score: 40,
          pass_threshold: 80,
          score_summary: "Needs work.",
          scored_at: "2026-04-07T12:09:00Z",
          dimension_scores: { tone: { score: 65, weight: 1, weighted_contribution: 65, notes: "" } },
          regeneration_priority_dimensions: [],
          regeneration_instructions: {},
          is_stale: false,
          message: null,
        },
      }),
    );

    renderDetailPage();

    const judgeCardRed = await screen.findByTestId("resume-judge-card");
    const scorePillRed = within(judgeCardRed).getByText(/40\/100/i);
    expect(scorePillRed).toHaveAttribute(
      "style",
      expect.stringContaining("var(--color-error)"),
    );
  });

  it("applies traffic light colors to ATS keywords, respects >= 80% target, removes 'no manual keywords', and removes external icon", async () => {
    // 90.9% match with 80% target
    api.fetchApplicationDetail.mockResolvedValue(buildApplicationDetail());
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nSDET leader.",
      generation_params: { page_length: "1_page", aggressiveness: "high", additional_instructions: "" },
      sections_snapshot: { enabled_sections: ["summary"], section_order: ["summary"] },
      keyword_match: {
        matched_count: 20,
        total_count: 22,
        percentage: 90.9,
        target_percentage: 80,
        target_met: true,
        matched_keywords: ["SDET"],
        missing_keywords: ["telemetry infrastructure"],
      },
      last_generated_at: "2026-04-07T12:08:00Z",
    });

    renderDetailPage();

    const keywordCard = await screen.findByTestId("keyword-match-card");
    expect(within(keywordCard).getByText("ATS Keywords")).toBeInTheDocument();
    expect(within(keywordCard).getByText("90.9% matched")).toBeInTheDocument();
    expect(within(keywordCard).getByText("Target 80%")).toBeInTheDocument();
    expect(within(keywordCard).getByText("Target met")).toBeInTheDocument();

    // 1. "no manual keywords" is removed
    expect(within(keywordCard).queryByText(/no manual keywords/i)).not.toBeInTheDocument();

    // 2. Count pill 20/22 has green traffic light color
    const countBadge = within(keywordCard).getByText("20/22");
    expect(countBadge).toHaveAttribute(
      "style",
      expect.stringContaining("var(--color-success)"),
    );

    // 3. No external link SVG icon in the card
    expect(keywordCard.querySelector("svg.lucide-external-link")).toBeNull();
  });

  it("shows confirmation modal with mascot and orange Generate button on keyword optimize click", async () => {
    const user = userEvent.setup();
    api.fetchApplicationDetail.mockResolvedValue(buildApplicationDetail());
    api.fetchDraft.mockResolvedValue({
      id: "draft-1",
      application_id: "app-1",
      content_md: "# Resume\n\n## Summary\nSDET leader.",
      generation_params: { page_length: "1_page", aggressiveness: "high", additional_instructions: "" },
      sections_snapshot: { enabled_sections: ["summary"], section_order: ["summary"] },
      keyword_match: {
        matched_count: 20,
        total_count: 22,
        percentage: 90.9,
        target_percentage: 80,
        target_met: true,
        matched_keywords: ["SDET"],
        missing_keywords: ["telemetry infrastructure", "CI stability"],
      },
      last_generated_at: "2026-04-07T12:08:00Z",
    });
    api.triggerKeywordOptimization.mockResolvedValue(
      buildApplicationDetail({ internal_state: "regenerating_full" }),
    );

    renderDetailPage();

    const keywordCard = await screen.findByTestId("keyword-match-card");
    await user.click(within(keywordCard).getByRole("button", { name: /ats keywords/i }));

    const dialog = await screen.findByRole("dialog", { name: /keyword breakdown/i });
    expect(dialog).toBeInTheDocument();

    // Keywords modal sidebar has the mascot in optimization section
    const optimizeSection = within(dialog).getByText(/optimization/i).closest("section");
    expect(optimizeSection).not.toBeNull();
    expect(optimizeSection!.querySelector("svg")).not.toBeNull(); // The mascot avatar

    // The optimize button is orange
    const optimizeBtn = within(dialog).getByRole("button", { name: /optimize for missing keywords/i });
    expect(optimizeBtn).toHaveClass("app-button-orange");

    // Clicking optimize does NOT trigger right away
    await user.click(optimizeBtn);
    expect(api.triggerKeywordOptimization).not.toHaveBeenCalled();

    // Confirmation modal opens
    const confirmModal = await screen.findByRole("dialog", { name: /optimize for missing keywords\?/i });
    expect(confirmModal).toBeInTheDocument();
    expect(confirmModal.querySelector("svg")).not.toBeNull(); // Mascot in confirm modal
    expect(within(confirmModal).getByText(/trigger a full resume regeneration/i)).toBeInTheDocument();

    // The Generate button in confirm modal is orange
    const generateBtn = within(confirmModal).getByRole("button", { name: /^generate$/i });
    expect(generateBtn).toHaveClass("app-button-orange");

    // Clicking cancel closes confirm without triggering
    const cancelBtn = within(confirmModal).getByRole("button", { name: /^cancel$/i });
    await user.click(cancelBtn);
    expect(screen.queryByRole("dialog", { name: /optimize for missing keywords\?/i })).not.toBeInTheDocument();
    expect(api.triggerKeywordOptimization).not.toHaveBeenCalled();

    // Reopen and confirm
    await user.click(optimizeBtn);
    const reopenConfirm = await screen.findByRole("dialog", { name: /optimize for missing keywords\?/i });
    const confirmGenerateBtn = within(reopenConfirm).getByRole("button", { name: /^generate$/i });
    await user.click(confirmGenerateBtn);

    await waitFor(() => {
      expect(api.triggerKeywordOptimization).toHaveBeenCalledWith("app-1");
    });
  });
});
