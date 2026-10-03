import { PopoverSurface } from "@/components/ui/card";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  CircleStop,
  FileText,
  Gauge,
  History,
  MessageSquare,
  Ruler,
  Sparkles,
  Trash2,
  ExternalLink,
  FileDown,
  Columns,
  RefreshCw,
  Check,
  X,
  Target,
} from "lucide-react";
import { useAppContext } from "@/components/layout/AppContext";
import { useShellLayout } from "@/components/layout/ShellLayoutContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { ApplicationActivityPanel } from "@/components/applications/ApplicationActivityPanel";
import { Button } from "@/components/ui/button";
import { Card, Section } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { InfoPopover } from "@/components/ui/info-popover";
import { useToast } from "@/components/ui/toast";
import { StatusBadge } from "@/components/StatusBadge";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { ResumeRenderPreview } from "@/components/ResumeRenderPreview";
import { DraftSectionWorkbench } from "@/components/resume/DraftSectionWorkbench";
import { CompareWorkspace } from "@/components/diff/CompareWorkspace";
import { formatJudgeInstructions } from "@/lib/judge-helpers";
import { getResumeRegenerationBlocker } from "@/lib/resume-document";
import { GenerationProgress } from "@/components/ui/generation-progress";
import { SkeletonSection } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import {
  cancelExtraction,
  deleteApplication,
  fetchBaseResume,
  patchApplication,
  recoverApplicationFromSource,
  resolveDuplicate,
  retryExtraction,
  submitManualEntry,
  saveDraft,
  triggerFullRegeneration,
  triggerKeywordOptimization,
  triggerResumeJudge,
  triggerSectionRegeneration,
  updateManualKeywords,
  exportDocx,
  exportPdf,
  triggerGeneration,
  cancelGeneration,
  type ApplicationDetail,
  type BaseResumeDetail,
  type BaseResumeSummary,
  type ExtractionProgress,
  type JobKeywordsPayload,
  type KeywordMatch,
  type ResumeDraft,
  type ResumeDocument,
  type ResumeSection,
} from "@/lib/api";
import {
  AGGRESSIVENESS_OPTIONS,
  jobPostingOriginOptions,
  PAGE_LENGTH_OPTIONS,
} from "@/lib/application-options";
import {
  invalidateApplicationDraftQueries,
  invalidateApplicationQueries,
  queryKeys,
  useApplicationDetailQuery,
  useApplicationDraftQuery,
  useApplicationProgressQuery,
  useBaseResumesQuery,
} from "@/lib/queries";
import { useApplicationEventStream } from "@/lib/use-application-event-stream";

type JobFormState = {
  job_title: string;
  company: string;
  job_description: string;
  job_location_text: string;
  compensation_text: string;
  job_posting_origin: string;
  job_posting_origin_other_text: string;
};

type ExportFormat = "pdf" | "docx";

function JobInformationFields({
  form,
  setForm,
  compact = false,
}: {
  form: JobFormState;
  setForm: Dispatch<SetStateAction<JobFormState>>;
  compact?: boolean;
}) {
  const controlClass = compact ? "text-sm" : undefined;
  const labelClass = compact ? "text-xs" : undefined;
  const setField = (field: keyof JobFormState, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  return (
    <>
      <div>
        <Label htmlFor="job-title" className={labelClass}>
          Job Title
        </Label>
        <Input
          id="job-title"
          className={controlClass}
          placeholder="Job title"
          value={form.job_title}
          onChange={(event) => setField("job_title", event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="company" className={labelClass}>
          Company
        </Label>
        <Input
          id="company"
          className={controlClass}
          placeholder="Company"
          value={form.company}
          onChange={(event) => setField("company", event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="origin" className={labelClass}>
          Posting Source
        </Label>
        <Select
          id="origin"
          className={controlClass}
          value={form.job_posting_origin}
          onChange={(event) =>
            setField("job_posting_origin", event.target.value)
          }
        >
          <option value="">Unknown</option>
          {jobPostingOriginOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      {form.job_posting_origin === "other" ? (
        <Input
          className={controlClass}
          placeholder="Other source label"
          value={form.job_posting_origin_other_text}
          onChange={(event) =>
            setField("job_posting_origin_other_text", event.target.value)
          }
        />
      ) : null}
      <div>
        <Label htmlFor="jd" className={labelClass}>
          Job Description
        </Label>
        <Textarea
          id="jd"
          className={`${controlClass ?? ""} min-h-32`.trim()}
          placeholder="Job description"
          value={form.job_description}
          onChange={(event) => setField("job_description", event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="job-location-detail" className={labelClass}>
          Location
        </Label>
        <Input
          id="job-location-detail"
          className={controlClass}
          placeholder="e.g. British Columbia/Ontario or Toronto, Ontario"
          value={form.job_location_text}
          onChange={(event) =>
            setField("job_location_text", event.target.value)
          }
        />
      </div>
      <div>
        <Label htmlFor="compensation-detail" className={labelClass}>
          Compensation
        </Label>
        <Input
          id="compensation-detail"
          className={controlClass}
          placeholder="e.g. $140,000 - $175,000 base salary"
          value={form.compensation_text}
          onChange={(event) =>
            setField("compensation_text", event.target.value)
          }
        />
      </div>
    </>
  );
}

function NotesCard({
  value,
  state,
  onChange,
  compact = false,
}: {
  value: string;
  state: "idle" | "saving" | "saved";
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const status =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved."
        : "Autosaves when you pause typing.";
  return (
    <Section density="compact" className="p-4">
      <h3
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Notes
      </h3>
      <Textarea
        className={`mt-3 min-h-24${compact ? " text-sm" : ""}`}
        placeholder="Add your own notes…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p
        className="mt-2 text-xs"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {status}
      </p>
    </Section>
  );
}

const EXTRACTION_POLL_STATES = ["extraction_pending", "extracting"];
const ACTIVE_GENERATION_STATES = [
  "generating",
  "regenerating_full",
  "regenerating_section",
];
const ACTIVE_GENERATION_PROGRESS_STATES = [
  "generation_pending",
  "generating",
  "regenerating_full",
  "regenerating_section",
];
const EXTRACTION_FAKE_PROGRESS_CAP = 88;
const EXTRACTION_DETAIL_REFRESH_FALLBACK_MESSAGE =
  "Extraction finished, but results could not be synchronized. Retry extraction or complete manual entry.";
const RESUME_JUDGE_DIMENSION_LABELS: Record<string, string> = {
  role_alignment: "Role Alignment",
  specificity_and_concreteness: "Specificity",
  voice_and_human_quality: "Voice",
  grounding_integrity: "Grounding",
  ats_safety_and_formatting: "ATS Safety",
  length_and_density: "Length",
};

function extractionFakeStep(percent: number) {
  if (percent < 30) return 2.0;
  if (percent < 55) return 1.2;
  if (percent < 75) return 0.7;
  return 0.3;
}

function getResumeJudgeDimensionEntries(
  result: ApplicationDetail["resume_judge_result"],
) {
  if (!result?.dimension_scores) return [];
  const priorities = new Set(result.regeneration_priority_dimensions ?? []);
  return Object.entries(result.dimension_scores).sort(
    ([leftKey, leftValue], [rightKey, rightValue]) => {
      const leftPriority = priorities.has(leftKey) ? 0 : 1;
      const rightPriority = priorities.has(rightKey) ? 0 : 1;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      if (leftValue.score !== rightValue.score)
        return leftValue.score - rightValue.score;
      return leftKey.localeCompare(rightKey);
    },
  );
}

function getDefaultExpandedResumeJudgeDimension(
  result: ApplicationDetail["resume_judge_result"],
) {
  const entries = getResumeJudgeDimensionEntries(result);
  if (!entries.length) return null;
  const priorities = result?.regeneration_priority_dimensions ?? [];
  if (priorities.length) {
    const prioritizedEntries = entries.filter(([key]) =>
      priorities.includes(key),
    );
    if (prioritizedEntries.length) {
      return prioritizedEntries.reduce((lowest, current) =>
        current[1].score < lowest[1].score ? current : lowest,
      )[0];
    }
  }
  return entries.reduce((lowest, current) =>
    current[1].score < lowest[1].score ? current : lowest,
  )[0];
}

function isResumeJudgePending(detail: ApplicationDetail | null) {
  const judge = detail?.resume_judge_result;
  if (!judge || !["queued", "running"].includes(judge.status)) return false;
  return !judge.is_stale;
}

function isResumeJudgeStale(detail: ApplicationDetail | null) {
  const judge = detail?.resume_judge_result;
  if (!judge) return false;
  return Boolean(judge.is_stale);
}

function resumeJudgeTone(verdict: string | null | undefined) {
  if (verdict === "pass") {
    return {
      accent: "var(--color-accent)",
      bg: "var(--color-accent-muted)",
      border: "var(--color-accent-muted)",
      muted: "var(--color-text-secondary)",
    };
  }
  if (verdict === "warn") {
    return {
      accent: "var(--color-warning)",
      bg: "var(--color-warning-muted)",
      border: "var(--color-warning-muted)",
      muted: "var(--color-text-secondary)",
    };
  }
  return {
    accent: "var(--color-error)",
    bg: "var(--color-error-muted)",
    border: "var(--color-error-muted)",
    muted: "var(--color-text-secondary)",
  };
}

function resumeJudgeVerdictLabel(verdict: string | null | undefined) {
  if (verdict === "pass") return "Pass";
  if (verdict === "warn") return "Review";
  if (verdict === "fail") return "Needs work";
  return "Unavailable";
}

type KeywordEntry = {
  text: string;
  source: "extracted" | "manual";
  added_at?: string | null;
};

function normalizeLegacyKeyword(item: string): KeywordEntry | null {
  const text = item.trim().replace(/\s+/g, " ");
  return text ? { text, source: "extracted", added_at: null } : null;
}

function normalizeKeywordEntry(
  item: NonNullable<JobKeywordsPayload["keywords"]>[number],
): KeywordEntry | null {
  if (typeof item === "string") return normalizeLegacyKeyword(item);
  if (typeof item?.text !== "string") return null;
  const text = item.text.trim().replace(/\s+/g, " ");
  if (!text) return null;
  return {
    text,
    source: item.source === "manual" ? "manual" : "extracted",
    added_at: item.added_at ?? null,
  };
}

function getKeywordEntries(
  payload: JobKeywordsPayload | null | undefined,
): KeywordEntry[] {
  const rawKeywords = payload?.keywords;
  if (!Array.isArray(rawKeywords)) return [];
  const seen = new Set<string>();
  const keywords: KeywordEntry[] = [];
  for (const item of rawKeywords) {
    const entry = normalizeKeywordEntry(item);
    if (!entry) continue;
    const key = entry.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(entry);
  }
  return keywords;
}

function getKeywordTexts(
  payload: JobKeywordsPayload | null | undefined,
): string[] {
  return getKeywordEntries(payload).map((entry) => entry.text);
}

function getManualKeywordTexts(
  payload: JobKeywordsPayload | null | undefined,
): string[] {
  return getKeywordEntries(payload)
    .filter((entry) => entry.source === "manual")
    .map((entry) => entry.text);
}

function keywordStatusLabel(status: string | null | undefined) {
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "succeeded") return "Ready";
  if (status === "failed") return "Failed";
  return "Unavailable";
}

function keywordTone(
  match: KeywordMatch | null | undefined,
  status: string | null | undefined,
) {
  if (status === "failed") {
    return {
      accent: "var(--color-error)",
      bg: "var(--color-error-muted)",
      border: "var(--color-error-muted)",
    };
  }
  if (!match) {
    return {
      accent: "var(--color-text-secondary)",
      bg: "var(--color-background-muted)",
      border: "var(--color-border)",
    };
  }
  if (match.target_met) {
    return {
      accent: "var(--color-accent)",
      bg: "var(--color-accent-muted)",
      border: "var(--color-accent-muted)",
    };
  }
  return {
    accent: "var(--color-warning)",
    bg: "var(--color-warning-muted)",
    border: "var(--color-warning-muted)",
  };
}

function isGenerationWorkflowActive(detail: ApplicationDetail | null) {
  return Boolean(
    detail &&
    !detail.failure_reason &&
    ACTIVE_GENERATION_STATES.includes(detail.internal_state),
  );
}

function isGenerationProgressActive(progress: ExtractionProgress | null) {
  return Boolean(
    progress &&
    !progress.completed_at &&
    !progress.terminal_error_code &&
    ACTIVE_GENERATION_PROGRESS_STATES.includes(progress.state),
  );
}

function deriveVisibleStatus(
  fallbackStatus: ApplicationDetail["visible_status"],
  internalState: string,
  failureReason: string | null,
): ApplicationDetail["visible_status"] {
  if (failureReason) return "needs_action";
  if (internalState === "resume_ready") return "in_progress";
  if (
    ACTIVE_GENERATION_STATES.includes(internalState) ||
    internalState === "generation_pending"
  )
    return "draft";
  return fallbackStatus;
}

function getGenerationFailureReason(
  progress: ExtractionProgress,
  isRegeneration: boolean,
) {
  const code = progress.terminal_error_code;
  if (!code) return null;
  if (code === "generation_timeout" || code === "generation_cancelled")
    return code;
  return isRegeneration ? "regeneration_failed" : "generation_failed";
}

function getTerminalGenerationState(
  progress: ExtractionProgress,
  isRegeneration: boolean,
) {
  if (progress.state === "resume_ready" && !progress.terminal_error_code)
    return "resume_ready";
  return isRegeneration ? "resume_ready" : "generation_pending";
}

function getGenerationFailureDetails(
  current: ApplicationDetail,
  progress: ExtractionProgress,
  failureReason: string | null,
): ApplicationDetail["generation_failure_details"] {
  if (!failureReason) return null;
  const existing = current.generation_failure_details;
  return {
    message: progress.message,
    validation_errors: existing ? existing.validation_errors : null,
    failure_stage: existing ? existing.failure_stage : null,
    attempt_count: existing ? existing.attempt_count : null,
    attempts: existing ? existing.attempts : null,
    terminal_error_code: progress.terminal_error_code,
  };
}

function applyTerminalGenerationProgress(
  current: ApplicationDetail,
  progress: ExtractionProgress,
): ApplicationDetail {
  const isRegeneration = ["regenerating_full", "regenerating_section"].includes(
    current.internal_state,
  );
  const failureReason = getGenerationFailureReason(progress, isRegeneration);
  const internalState = getTerminalGenerationState(progress, isRegeneration);

  return {
    ...current,
    internal_state: internalState,
    visible_status: deriveVisibleStatus(
      current.visible_status,
      internalState,
      failureReason,
    ),
    failure_reason: failureReason,
    generation_failure_details: getGenerationFailureDetails(
      current,
      progress,
      failureReason,
    ),
    has_action_required_notification: failureReason
      ? true
      : current.has_action_required_notification,
  };
}

function stringOrEmpty(value: string | null | undefined) {
  return value || "";
}

function getSavedJobForm(detail: ApplicationDetail | null) {
  const {
    job_title = "",
    company = "",
    job_description = "",
    job_location_text = "",
    compensation_text = "",
    job_posting_origin = "",
    job_posting_origin_other_text = "",
  } = detail ?? {};
  return {
    job_title: stringOrEmpty(job_title),
    company: stringOrEmpty(company),
    job_description: stringOrEmpty(job_description),
    job_location_text: stringOrEmpty(job_location_text),
    compensation_text: stringOrEmpty(compensation_text),
    job_posting_origin: stringOrEmpty(job_posting_origin),
    job_posting_origin_other_text: stringOrEmpty(job_posting_origin_other_text),
  };
}

function inferExtractionFailureDetails(
  current: ApplicationDetail,
  progress: ExtractionProgress,
): ApplicationDetail["extraction_failure_details"] {
  if (current.extraction_failure_details)
    return current.extraction_failure_details;

  const isBlockedSource = progress.terminal_error_code === "blocked_source";
  return {
    kind: isBlockedSource ? "blocked_source" : "callback_delivery_failed",
    provider: isBlockedSource ? current.job_posting_origin : null,
    reference_id: null,
    blocked_url: current.job_url ?? null,
    detected_at: progress.updated_at,
  };
}

function extractionFallbackMessage(progress: ExtractionProgress): string {
  if (
    progress.terminal_error_code === null &&
    progress.state === "generation_pending"
  ) {
    return EXTRACTION_DETAIL_REFRESH_FALLBACK_MESSAGE;
  }
  return progress.message || EXTRACTION_DETAIL_REFRESH_FALLBACK_MESSAGE;
}

function isTerminalExtractionSuccess(progress: ExtractionProgress): boolean {
  return (
    progress.terminal_error_code === null &&
    progress.state === "generation_pending"
  );
}

function progressEventKey(progress: ExtractionProgress) {
  return [
    progress.job_id,
    progress.workflow_kind,
    progress.state,
    progress.updated_at,
    progress.completed_at ?? "",
    progress.terminal_error_code ?? "",
  ].join(":");
}

function applyTerminalExtractionProgress(
  current: ApplicationDetail,
  progress: ExtractionProgress,
): ApplicationDetail {
  if (
    progress.terminal_error_code === null &&
    progress.state === "generation_pending"
  ) {
    return {
      ...current,
      internal_state: "generation_pending",
      visible_status: deriveVisibleStatus(
        current.visible_status,
        "generation_pending",
        null,
      ),
      failure_reason: null,
      extraction_failure_details: null,
    };
  }

  const failureReason = "extraction_failed";
  const internalState = "manual_entry_required";

  return {
    ...current,
    internal_state: internalState,
    visible_status: deriveVisibleStatus(
      current.visible_status,
      internalState,
      failureReason,
    ),
    failure_reason: failureReason,
    extraction_failure_details: inferExtractionFailureDetails(
      current,
      progress,
    ),
    has_action_required_notification: true,
  };
}

function isAllowedPageLength(value: unknown): value is string {
  return (
    typeof value === "string" &&
    PAGE_LENGTH_OPTIONS.some((option) => option.value === value)
  );
}

function isAllowedAggressiveness(value: unknown): value is string {
  return (
    typeof value === "string" &&
    AGGRESSIVENESS_OPTIONS.some((option) => option.value === value)
  );
}

function getGenerationStartBlocker(
  detail: ApplicationDetail | null,
  selectedResumeId: string | null,
  baseResumeCount: number,
): string | null {
  const duplicateBlocker =
    "This looks like a duplicate application. Review the duplicate warning and choose Proceed Anyway before generating.";
  if (!detail) return "Application details are still loading.";
  const workflowBlocker = getGenerationWorkflowBlocker(
    detail,
    duplicateBlocker,
  );
  if (workflowBlocker) return workflowBlocker;
  return getGenerationInputBlocker(
    detail,
    selectedResumeId,
    baseResumeCount,
    duplicateBlocker,
  );
}

function getGenerationWorkflowBlocker(
  detail: ApplicationDetail,
  duplicateBlocker: string,
) {
  if (isGenerationWorkflowActive(detail))
    return "Generation is already in progress.";
  if (detail.internal_state === "manual_entry_required")
    return "Submit manual entry before generating.";
  if (detail.internal_state === "duplicate_review_required")
    return duplicateBlocker;
  if (["extraction_pending", "extracting"].includes(detail.internal_state))
    return "Wait until extraction finishes before generating.";
  if (!["generation_pending", "resume_ready"].includes(detail.internal_state))
    return "This application is not ready for generation yet.";
  return null;
}

function getGenerationInputBlocker(
  detail: ApplicationDetail,
  selectedResumeId: string | null,
  baseResumeCount: number,
  duplicateBlocker: string,
) {
  if (!selectedResumeId) return "Select a base resume before generating.";
  if (baseResumeCount === 0) return "Create a base resume before generating.";
  if (!detail.job_title) return "Add a job title before generating.";
  if (!detail.job_description)
    return "Add a job description before generating.";
  if (detail.duplicate_resolution_status === "pending") return duplicateBlocker;
  return null;
}

function getFullRegenerationBlocker(
  detail: ApplicationDetail | null,
): string | null {
  if (!detail) return "Application details are still loading.";
  if (isGenerationWorkflowActive(detail))
    return "Generation is already in progress.";
  if (detail.internal_state !== "resume_ready")
    return "Generate a resume draft before running full regeneration.";
  return null;
}

function getSectionRegenerationBlocker(
  detail: ApplicationDetail | null,
  sectionName: string,
  instructions: string,
): string | null {
  if (!detail) return "Application details are still loading.";
  if (isGenerationWorkflowActive(detail))
    return "Generation is already in progress.";
  if (detail.internal_state !== "resume_ready")
    return "Generate a resume draft before regenerating a section.";
  if (!sectionName) return "Select a section to regenerate.";
  if (!instructions.trim())
    return "Enter regeneration instructions before continuing.";
  return null;
}

function keywordEmptyMessage(
  jobKeywords: JobKeywordsPayload | null,
  updating: boolean,
) {
  if (jobKeywords?.status === "failed")
    return (
      jobKeywords.message ??
      "Keyword extraction is unavailable for this job description."
    );
  if (updating)
    return "Keyword extraction is updating from the latest job description.";
  return "Keywords will appear after the job description is extracted, saved, or added manually.";
}

function KeywordCoverageBody({
  match,
  manualCount,
  percentage,
  tone,
}: {
  match: KeywordMatch | null;
  manualCount: number;
  percentage: number;
  tone: ReturnType<typeof keywordTone>;
}) {
  if (!match) return null;
  const manualLabel =
    manualCount === 0
      ? "No manual keywords"
      : `${manualCount} manual keyword${manualCount === 1 ? "" : "s"}`;
  return (
    <div className="mt-3">
      <div
        className="flex items-center justify-between gap-3 text-[11px]"
        style={{ color: "var(--color-text-secondary)" }}
      >
        <span>Target {match.target_percentage}%</span>
        <span style={{ color: tone.accent }}>
          {match.target_met ? "Target met" : "Below target"}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full"
        style={{ background: "var(--color-border)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(100, Math.max(0, percentage))}%`,
            background: tone.accent,
          }}
        />
      </div>
      <p
        className="mt-2 text-[11px]"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {manualLabel}
      </p>
    </div>
  );
}

function KeywordMatchCard({
  jobKeywords,
  match,
  onOpen,
}: {
  jobKeywords: JobKeywordsPayload | null;
  match: KeywordMatch | null;
  onOpen: () => void;
}) {
  const entries = getKeywordEntries(jobKeywords);
  const status = jobKeywords?.status ?? null;
  const manualCount = entries.filter(
    (entry) => entry.source === "manual",
  ).length;
  const tone = keywordTone(match, status);
  const updating = status === "queued" || status === "running";
  const percentage = match ? match.percentage : 0;
  const coverage = match
    ? `${match.matched_count}/${match.total_count}`
    : `${entries.length}`;
  const summary = match
    ? `${percentage.toFixed(1)}% matched`
    : `${entries.length} total`;
  return (
    <Card
      density="compact"
      className="p-0"
      data-testid="keyword-match-card"
      style={{
        borderColor: tone.border,
        background: `linear-gradient(145deg, ${tone.bg} 0%, var(--color-background-surface) 88%)`,
      }}
    >
      <Button
        contentLayout="block"
        variant="ghost"
        type="button"
        className="w-full p-3 text-left"
        onClick={onOpen}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ background: tone.bg, color: tone.accent }}
            >
              <Target size={14} aria-hidden="true" />
            </span>
            <div>
              <p
                className="text-[10px] font-semibold uppercase tracking-[0.22em]"
                style={{ color: "var(--color-text-secondary)" }}
              >
                ATS Keywords
              </p>
              <p
                className="mt-1 text-sm font-semibold"
                style={{ color: "var(--color-text-primary)" }}
              >
                {summary}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: "var(--color-background-surface)",
                color: tone.accent,
              }}
            >
              {updating ? keywordStatusLabel(status) : coverage}
            </span>
            <ExternalLink
              size={14}
              aria-hidden="true"
              style={{ color: "var(--color-text-secondary)" }}
            />
          </div>
        </div>
        {match ? (
          <KeywordCoverageBody
            match={match}
            manualCount={manualCount}
            percentage={percentage}
            tone={tone}
          />
        ) : (
          <p
            className="mt-3 text-xs leading-5"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {keywordEmptyMessage(jobKeywords, updating)}
          </p>
        )}
      </Button>
    </Card>
  );
}

function getKeywordPillPresentation(
  entry: KeywordEntry,
  matched: boolean,
  missing: boolean,
) {
  if (matched)
    return {
      label: "matched keyword",
      color: "var(--color-accent)",
      border: "var(--color-accent-muted)",
      background: "var(--color-accent-muted)",
    };
  if (missing)
    return {
      label: "missing keyword",
      color: "var(--color-error)",
      border: "var(--color-error-muted)",
      background: "var(--color-error-muted)",
    };
  return {
    label: `${entry.source} keyword`,
    color: "var(--color-text-primary)",
    border: "var(--color-border)",
    background: "var(--color-background-muted)",
  };
}

function ManualKeywordRemove({
  entry,
  saving,
  onRemove,
}: {
  entry: KeywordEntry;
  saving: boolean;
  onRemove: (text: string) => void;
}) {
  if (entry.source !== "manual") return null;
  return (
    <Button
      variant="ghost"
      type="button"
      className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center"
      aria-label={`Remove ${entry.text}`}
      disabled={saving}
      onClick={() => onRemove(entry.text)}
    >
      <X size={11} aria-hidden="true" />
    </Button>
  );
}

function KeywordPill({
  entry,
  matched,
  missing,
  saving,
  onRemove,
}: {
  entry: KeywordEntry;
  matched: boolean;
  missing: boolean;
  saving: boolean;
  onRemove: (text: string) => void;
}) {
  const presentation = getKeywordPillPresentation(entry, matched, missing);
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium"
      aria-label={`${entry.text}, ${presentation.label}`}
      style={{
        borderColor: presentation.border,
        background: presentation.background,
        color: presentation.color,
      }}
    >
      <span className="min-w-0 truncate">{entry.text}</span>
      <ManualKeywordRemove entry={entry} saving={saving} onRemove={onRemove} />
    </span>
  );
}

function KeywordGroup({
  label,
  entries,
  matched,
  missing,
  saving,
  onRemove,
  limit,
}: {
  label: string;
  entries: KeywordEntry[];
  matched: Set<string>;
  missing: Set<string>;
  saving: boolean;
  onRemove: (text: string) => void;
  limit?: number;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {label}
        </p>
        <span
          className="text-xs font-semibold"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {entries.length}
          {limit ? `/${limit}` : ""}
        </span>
      </div>
      <div className="mt-3 flex max-h-52 flex-wrap gap-1.5 overflow-y-auto pr-1">
        {entries.length ? (
          entries.map((entry) => (
            <KeywordPill
              key={`${entry.source}-${entry.text}`}
              entry={entry}
              matched={matched.has(entry.text.toLowerCase())}
              missing={missing.has(entry.text.toLowerCase())}
              saving={saving}
              onRemove={onRemove}
            />
          ))
        ) : (
          <p
            className="text-xs leading-5"
            style={{ color: "var(--color-text-secondary)" }}
          >
            No {label.toLowerCase()} keywords.
          </p>
        )}
      </div>
    </section>
  );
}

function keywordOptimizeBlocker(
  active: boolean,
  updating: boolean,
  hasDraft: boolean,
  entries: KeywordEntry[],
  match: KeywordMatch | null,
) {
  if (active) return "Generation is already running.";
  if (updating) return "Keyword extraction is still updating.";
  if (!hasDraft) return "Generate a draft before optimizing keywords.";
  if (entries.length === 0) return "Add or extract keywords before optimizing.";
  if (!match || match.missing_keywords.length === 0)
    return "All available keywords are already matched.";
  return null;
}

type KeywordDialogProps = {
  open: boolean;
  jobKeywords: JobKeywordsPayload | null;
  match: KeywordMatch | null;
  generationActive: boolean;
  hasDraft: boolean;
  input: string;
  saving: boolean;
  optimizing: boolean;
  onInputChange: (value: string) => void;
  onClose: () => void;
  onAdd: (event: FormEvent<HTMLFormElement>) => void;
  onRemove: (text: string) => void;
  onOptimize: () => void;
};

function keywordMatchSet(values: string[] | undefined) {
  return new Set((values ?? []).map((keyword) => keyword.toLowerCase()));
}

function KeywordDialogHeader({
  match,
  status,
  tone,
  entryCount,
  onClose,
}: {
  match: KeywordMatch | null;
  status: string | null;
  tone: ReturnType<typeof keywordTone>;
  entryCount: number;
  onClose: () => void;
}) {
  const score = match
    ? `${match.matched_count}/${match.total_count}`
    : `${entryCount}`;
  const badge = match
    ? `${match.percentage.toFixed(1)}%`
    : keywordStatusLabel(status);
  return (
    <div className="px-6 pb-5 pt-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.24em]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            ATS Keywords
          </p>
          <h2
            className="mt-2 text-xl font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Keyword breakdown
          </h2>
          <p
            className="mt-2 text-sm font-semibold"
            style={{ color: tone.accent }}
          >
            {score}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-3 py-1.5 text-sm font-semibold"
            style={{ background: tone.bg, color: tone.accent }}
          >
            {badge}
          </span>
          <Button
            variant="ghost"
            type="button"
            className="px-3 py-1.5 text-sm"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function KeywordOptimization({
  missingCount,
  blocker,
  optimizing,
  onOptimize,
}: {
  missingCount: number;
  blocker: string | null;
  optimizing: boolean;
  onOptimize: () => void;
}) {
  return (
    <section
      className="border-t pt-5"
      style={{ borderColor: "var(--color-border)" }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Optimization
      </p>
      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
        <span>Missing keywords</span>
        <span className="font-semibold">{missingCount}</span>
      </div>
      <Button
        variant="ghost"
        type="button"
        disabled={Boolean(blocker) || optimizing}
        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
        onClick={onOptimize}
      >
        <Sparkles size={14} />
        {optimizing ? "Starting..." : "Optimize for missing keywords"}
      </Button>
      {blocker && (
        <p
          className="mt-2 text-xs leading-5"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {blocker}
        </p>
      )}
    </section>
  );
}

function KeywordDialogSidebar(
  props: Pick<
    KeywordDialogProps,
    "input" | "saving" | "optimizing" | "onInputChange" | "onAdd" | "onOptimize"
  > & { missingCount: number; blocker: string | null },
) {
  return (
    <aside
      className="space-y-6 border-t px-6 py-5 lg:border-l lg:border-t-0"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-background-muted)",
      }}
    >
      <form onSubmit={props.onAdd}>
        <Label htmlFor="manual-keyword-input">Add Keyword</Label>
        <div className="mt-2 flex gap-2">
          <Input
            id="manual-keyword-input"
            value={props.input}
            maxLength={80}
            onChange={(event) => props.onInputChange(event.target.value)}
            placeholder="Exact keyword phrase"
            disabled={props.saving}
          />
          <Button type="submit" size="sm" disabled={props.saving}>
            Add
          </Button>
        </div>
      </form>
      <KeywordOptimization
        missingCount={props.missingCount}
        blocker={props.blocker}
        optimizing={props.optimizing}
        onOptimize={props.onOptimize}
      />
    </aside>
  );
}

function KeywordDialogContent(
  props: KeywordDialogProps & {
    entries: KeywordEntry[];
    matched: Set<string>;
    missing: Set<string>;
    blocker: string | null;
    status: string | null;
    tone: ReturnType<typeof keywordTone>;
  },
) {
  const extracted = props.entries.filter((entry) => entry.source !== "manual");
  const manual = props.entries.filter((entry) => entry.source === "manual");
  const missingCount = props.match ? props.match.missing_keywords.length : 0;
  return (
    <div
      className="animate-scaleIn"
      style={{
        position: "relative",
        zIndex: 1,
        width: "min(920px, 100%)",
        maxHeight: "calc(100vh - 48px)",
        overflowY: "auto",
        borderRadius: "var(--radius-container)",
        background: "white",
        boxShadow: "var(--shadow-high)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="ATS keyword breakdown"
    >
      <KeywordDialogHeader
        match={props.match}
        status={props.status}
        tone={props.tone}
        entryCount={props.entries.length}
        onClose={props.onClose}
      />
      <div
        className="grid border-t lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="space-y-6 px-6 py-5">
          <KeywordGroup
            label="Extracted"
            entries={extracted}
            matched={props.matched}
            missing={props.missing}
            saving={props.saving}
            onRemove={props.onRemove}
          />
          <KeywordGroup
            label="Manual"
            entries={manual}
            matched={props.matched}
            missing={props.missing}
            saving={props.saving}
            onRemove={props.onRemove}
            limit={30}
          />
        </div>
        <KeywordDialogSidebar
          input={props.input}
          saving={props.saving}
          optimizing={props.optimizing}
          onInputChange={props.onInputChange}
          onAdd={props.onAdd}
          onOptimize={props.onOptimize}
          missingCount={missingCount}
          blocker={props.blocker}
        />
      </div>
    </div>
  );
}

function KeywordDialog(props: KeywordDialogProps) {
  if (!props.open) return null;
  const entries = getKeywordEntries(props.jobKeywords);
  const status = props.jobKeywords ? props.jobKeywords.status : null;
  const updating = status === "queued" || status === "running";
  const blocker = keywordOptimizeBlocker(
    props.generationActive,
    updating,
    props.hasDraft,
    entries,
    props.match,
  );
  const content = (
    <KeywordDialogContent
      {...props}
      entries={entries}
      status={status}
      tone={keywordTone(props.match, status)}
      matched={keywordMatchSet(props.match?.matched_keywords)}
      missing={keywordMatchSet(props.match?.missing_keywords)}
      blocker={blocker}
    />
  );
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        onClick={props.onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--color-overlay)",
          backdropFilter: "blur(8px)",
        }}
      />
      {content}
    </div>,
    document.body,
  );
}

type ResumeJudgeResult = ApplicationDetail["resume_judge_result"];

function PendingResumeJudgeCard() {
  return (
    <Card
      density="compact"
      className="w-full p-3"
      data-testid="resume-judge-card"
      style={{
        borderColor: "var(--color-accent-muted)",
        background:
          "linear-gradient(145deg, color-mix(in srgb, var(--color-accent) 8%, white) 0%, var(--color-background-surface) 88%)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Resume Judge
          </span>
          <p
            className="mt-1.5 text-sm font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Scoring draft
          </p>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            background: "var(--color-accent-muted)",
            color: "var(--color-accent)",
          }}
        >
          Running
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{
            background: "var(--color-accent)",
            boxShadow: "0 0 0 6px var(--color-accent-muted)",
          }}
        />
        <span
          className="text-xs leading-5"
          style={{ color: "var(--color-text-secondary)" }}
        >
          The draft is ready. Judge feedback will appear here shortly.
        </span>
      </div>
    </Card>
  );
}

type UnavailableJudgeState =
  "maxed" | "stale_pending" | "stale" | "failed" | "pending";

const UNAVAILABLE_JUDGE_COPY: Record<
  UnavailableJudgeState,
  {
    title: string;
    badge: string;
    message: string;
    action: string;
    alert: boolean;
  }
> = {
  maxed: {
    title: "Scoring unavailable",
    badge: "Maxed",
    message: "Resume Judge reached the maximum of 3 attempts for this draft.",
    action: "Max Attempts Reached",
    alert: true,
  },
  stale_pending: {
    title: "Scoring unavailable",
    badge: "Stale",
    message:
      "The in-flight review no longer matches the current draft or job details. Run Resume Judge again for a fresh score.",
    action: "Re-evaluate",
    alert: true,
  },
  stale: {
    title: "Scoring unavailable",
    badge: "Stale",
    message:
      "The saved score no longer matches the current draft or job details. Run Resume Judge again to refresh it.",
    action: "Re-evaluate",
    alert: true,
  },
  failed: {
    title: "Scoring unavailable",
    badge: "Retry",
    message:
      "The latest scoring attempt failed. Retry when you want a fresh review.",
    action: "Try Again",
    alert: true,
  },
  pending: {
    title: "Pending review",
    badge: "Pending",
    message:
      "This draft has not been reviewed yet. Run Resume Judge any time after generation.",
    action: "Run Judge",
    alert: false,
  },
};

function unavailableJudgeState(
  result: ResumeJudgeResult,
  stale: boolean,
  runLimit: boolean,
): UnavailableJudgeState {
  const status = result ? result.status : null;
  if (runLimit && status === "failed") return "maxed";
  if (stale)
    return ["queued", "running"].includes(status ?? "")
      ? "stale_pending"
      : "stale";
  if (status === "failed") return "failed";
  return "pending";
}

function getUnavailableJudgeCopy(
  result: ResumeJudgeResult,
  stale: boolean,
  runLimit: boolean,
  triggering: boolean,
) {
  const state = unavailableJudgeState(result, stale, runLimit);
  const base = UNAVAILABLE_JUDGE_COPY[state];
  const message =
    (state === "maxed" || state === "failed") && result && result.message
      ? result.message
      : base.message;
  const action = triggering && state !== "maxed" ? "Starting…" : base.action;
  return { ...base, message, action };
}

function UnavailableResumeJudgeCard({
  result,
  stale,
  runLimit,
  triggering,
  canRun,
  onTrigger,
}: {
  result: ResumeJudgeResult;
  stale: boolean;
  runLimit: boolean;
  triggering: boolean;
  canRun: boolean;
  onTrigger: () => void;
}) {
  const copy = getUnavailableJudgeCopy(result, stale, runLimit, triggering);
  const accent = copy.alert
    ? "var(--color-error)"
    : "var(--color-text-secondary)";
  return (
    <Card
      density="compact"
      className="w-full p-3"
      data-testid="resume-judge-card"
      style={{
        borderColor: copy.alert
          ? "var(--color-error-muted)"
          : "var(--color-border)",
        background: copy.alert
          ? "linear-gradient(145deg, var(--color-error-muted) 0%, white 86%)"
          : "linear-gradient(145deg, var(--color-background-muted) 0%, white 86%)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Resume Judge
          </span>
          <p
            className="mt-1.5 text-sm font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            {copy.title}
          </p>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            background: copy.alert
              ? "var(--color-error-muted)"
              : "var(--color-background-muted)",
            color: accent,
          }}
        >
          {copy.badge}
        </span>
      </div>
      <p
        className="mt-2.5 text-xs leading-5"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {copy.message}
      </p>
      <div className="mt-3">
        <Button
          size="sm"
          variant="secondary"
          disabled={!canRun}
          onClick={onTrigger}
        >
          {copy.action}
        </Button>
      </div>
    </Card>
  );
}

function CompletedResumeJudgeCard({
  result,
  stale,
  tone,
  summary,
  onOpen,
}: {
  result: NonNullable<ResumeJudgeResult>;
  stale: boolean;
  tone: ReturnType<typeof resumeJudgeTone>;
  summary: string;
  onOpen: () => void;
}) {
  return (
    <Button
      variant="ghost"
      type="button"
      className="block w-full text-left transition-transform duration-150 hover:-translate-y-0.5"
      data-testid="resume-judge-card"
      onClick={onOpen}
    >
      <Card
        density="compact"
        className="p-3"
        style={{
          borderColor: stale ? "var(--color-warning)" : tone.border,
          background: stale
            ? "linear-gradient(145deg, var(--color-warning-muted) 0%, white 90%)"
            : `linear-gradient(145deg, ${tone.bg} 0%, var(--color-background-surface) 88%)`,
          boxShadow: "var(--shadow-med)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.22em]"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Resume Judge
            </span>
            <p
              className="mt-2 text-[11px] leading-5"
              title={summary}
              style={{
                color: "var(--color-text-secondary)",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
              }}
            >
              {summary}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: stale
                  ? "var(--color-warning-muted)"
                  : "var(--color-background-surface)",
                color: stale ? "var(--color-warning)" : tone.accent,
              }}
            >
              {stale ? "Stale" : resumeJudgeVerdictLabel(result.verdict)}
            </span>
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
              style={{
                background: "var(--color-background-surface)",
                color: stale ? "var(--color-warning)" : tone.accent,
              }}
            >
              {result.display_score ?? "—"}/100
            </span>
          </div>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <span
            className="text-[10px]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Hover to read more.
          </span>
          <span
            className="text-[10px] font-semibold"
            style={{ color: "var(--color-error)" }}
          >
            Click for details.
          </span>
        </div>
      </Card>
    </Button>
  );
}

function ResumeJudgeCard({
  hasDraft,
  result,
  pending,
  completed,
  stale,
  runLimit,
  triggering,
  canRun,
  tone,
  summary,
  onTrigger,
  onOpen,
}: {
  hasDraft: boolean;
  result: ResumeJudgeResult;
  pending: boolean;
  completed: boolean;
  stale: boolean;
  runLimit: boolean;
  triggering: boolean;
  canRun: boolean;
  tone: ReturnType<typeof resumeJudgeTone>;
  summary: string;
  onTrigger: () => void;
  onOpen: () => void;
}) {
  if (!hasDraft) return null;
  if (pending) return <PendingResumeJudgeCard />;
  if (!result || !completed)
    return (
      <UnavailableResumeJudgeCard
        result={result}
        stale={stale}
        runLimit={runLimit}
        triggering={triggering}
        canRun={canRun}
        onTrigger={onTrigger}
      />
    );
  return (
    <CompletedResumeJudgeCard
      result={result}
      stale={stale}
      tone={tone}
      summary={summary}
      onOpen={onOpen}
    />
  );
}

const WORKSPACE_META_CHIP_CLASS =
  "inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none";
const WORKSPACE_META_CHIP_STYLE = {
  borderColor: "var(--color-border)",
  background: "var(--color-background-muted)",
  color: "var(--color-text-secondary)",
};
const RESUME_PREVIEW_SURFACE_CLASS =
  "mt-0.5 flex min-h-0 flex-1 overflow-y-auto px-3 pb-1 sm:px-4";

function GeneratedWorkspaceHeader({
  generated,
  exported,
  editing,
  locked,
  onPreview,
  onEdit,
}: {
  generated: string | null;
  exported: string | null;
  editing: boolean;
  locked: boolean;
  onPreview: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 overflow-visible sm:min-h-8 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <h3
          className="shrink-0 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Generated Resume
        </h3>
        {generated && (
          <span
            className={WORKSPACE_META_CHIP_CLASS}
            style={WORKSPACE_META_CHIP_STYLE}
          >
            {generated}
          </span>
        )}
        {exported && (
          <span
            className={`${WORKSPACE_META_CHIP_CLASS} hidden sm:inline-flex`}
            style={WORKSPACE_META_CHIP_STYLE}
          >
            {exported}
          </span>
        )}
      </div>
      <div
        className="inline-flex items-center rounded-full border p-1"
        style={{
          borderColor: editing
            ? "var(--color-accent-muted)"
            : "var(--color-border)",
          background: editing
            ? "var(--color-accent-muted)"
            : "var(--color-background-muted)",
        }}
      >
        <Button
          variant="ghost"
          className="px-3 py-1.5 text-xs"
          type="button"
          disabled={locked}
          onClick={onPreview}
        >
          Preview
        </Button>
        <Button
          variant="ghost"
          className="px-3 py-1.5 text-xs"
          type="button"
          disabled={locked}
          onClick={onEdit}
        >
          Edit
        </Button>
      </div>
    </div>
  );
}

function GeneratedWorkspaceNotices({
  comparing,
  loadingBaseline,
  baselineError,
  sourceLimitedText,
  resumeReady,
}: {
  comparing: boolean;
  loadingBaseline: boolean;
  baselineError: string | null;
  sourceLimitedText: string | null;
  resumeReady: boolean;
}) {
  const baselineMessage = loadingBaseline
    ? "Loading the generation-time base resume for compare."
    : baselineError;
  return (
    <>
      {!comparing && baselineMessage && (
        <p
          className="mt-3 text-xs"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {baselineMessage}
        </p>
      )}
      {!comparing && sourceLimitedText && resumeReady && (
        <div
          className="mt-3 rounded-md border px-3 py-2 text-xs"
          style={{
            borderColor: "var(--color-warning)",
            background: "var(--color-warning-muted)",
            color: "var(--color-text-secondary)",
          }}
        >
          <div
            className="font-semibold"
            style={{ color: "var(--color-warning)" }}
          >
            Shorter Than Target
          </div>
          <p className="mt-1">{sourceLimitedText}</p>
        </div>
      )}
    </>
  );
}

function GeneratedDraftEditor({
  content,
  comparing,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  content: string;
  comparing: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="mt-0.5 flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ minHeight: comparing ? "60vh" : "50vh" }}
    >
      <MarkdownEditor
        className="no-bottom-radius flex-1 min-h-0"
        value={content}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="markdown-editor-footer flex-shrink-0">
        <span>Markdown · {content.length.toLocaleString()} characters</span>
        <span>Tab = 2 spaces</span>
      </div>
      <div className="mt-3 flex flex-shrink-0 items-center gap-3">
        <Button
          size="sm"
          loading={saving}
          disabled={saving || !content.trim()}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save Draft"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function GeneratedDraftPreview({
  draft,
}: {
  draft: ResumeDraft | null | undefined;
}) {
  return (
    <div className={RESUME_PREVIEW_SURFACE_CLASS}>
      {draft?.render_model ? (
        <ResumeRenderPreview
          model={draft.render_model}
          className="resume-preview-markdown"
        />
      ) : (
        <MarkdownPreview
          content={draft?.content_md ?? ""}
          className="resume-preview-markdown"
        />
      )}
    </div>
  );
}

type GeneratedWorkspacePaneProps = {
  className: string;
  compareMode: boolean;
  lockInteractions: boolean;
  generatedTimestamp: string | null;
  exportedTimestamp: string | null;
  editMode: boolean;
  baselineLoading: boolean;
  baselineError: string | null;
  sourceLimitedText: string | null;
  resumeReady: boolean;
  editContent: string;
  saving: boolean;
  draft: ResumeDraft | null | undefined;
  onEnterEdit: () => void;
  onCancelEdit: () => void;
  onContentChange: (value: string) => void;
  onSave: () => void;
};

function GeneratedWorkspacePane(props: GeneratedWorkspacePaneProps) {
  return (
    <Section
      className={`${props.className} ${props.compareMode ? "compare-pane-card compare-generated-pane" : ""} px-4 pb-4 pt-2`}
    >
      <GeneratedWorkspaceHeader
        generated={props.generatedTimestamp}
        exported={props.exportedTimestamp}
        editing={props.editMode}
        locked={props.lockInteractions}
        onPreview={() => {
          if (props.editMode) props.onCancelEdit();
        }}
        onEdit={() => {
          if (!props.editMode) props.onEnterEdit();
        }}
      />
      <GeneratedWorkspaceNotices
        comparing={props.compareMode}
        loadingBaseline={props.baselineLoading}
        baselineError={props.baselineError}
        sourceLimitedText={props.sourceLimitedText}
        resumeReady={props.resumeReady}
      />
      {props.editMode ? (
        <GeneratedDraftEditor
          content={props.editContent}
          comparing={props.compareMode}
          saving={props.saving}
          onChange={props.onContentChange}
          onSave={props.onSave}
          onCancel={props.onCancelEdit}
        />
      ) : (
        <GeneratedDraftPreview draft={props.draft} />
      )}
    </Section>
  );
}

type GenerationFailureDetails = NonNullable<
  ApplicationDetail["generation_failure_details"]
>;

function GenerationAttempts({
  attempts,
}: {
  attempts: GenerationFailureDetails["attempts"];
}) {
  if (!attempts?.length) return null;
  return (
    <ul
      className="mt-2 space-y-1"
      style={{ color: "var(--color-text-secondary)" }}
    >
      {attempts.map((attempt, index) => (
        <li key={`${attempt.model ?? "model"}-${index}`}>
          {attempt.model ?? "unknown model"} /{" "}
          {attempt.transport_mode ?? "unknown mode"} /{" "}
          {attempt.outcome ?? "unknown outcome"}
          {typeof attempt.elapsed_ms === "number"
            ? ` / ${attempt.elapsed_ms}ms`
            : ""}
        </li>
      ))}
    </ul>
  );
}

function GenerationFailureDiagnostics({
  details,
  showAttempts = false,
}: {
  details: ApplicationDetail["generation_failure_details"];
  showAttempts?: boolean;
}) {
  if (!details) return null;
  const attempts = details.attempts ?? [];
  if (!details.failure_stage && attempts.length === 0) return null;
  return (
    <div
      className="mt-2 border-l p-3 text-xs"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div>Failure stage: {details.failure_stage ?? "unknown"}</div>
      <div>LLM attempts: {details.attempt_count ?? attempts.length}</div>
      {showAttempts ? <GenerationAttempts attempts={attempts} /> : null}
    </div>
  );
}

export function ApplicationDetailPage() {
  const navigate = useNavigate();
  const { bootstrap } = useAppContext();
  const queryClient = useQueryClient();
  const { setMode: setShellLayoutMode, clearMode: clearShellLayoutMode } =
    useShellLayout();
  const { toast } = useToast();
  const { applicationId } = useParams<{ applicationId: string }>();
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [extractionDisplayPercent, setExtractionDisplayPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesState, setNotesState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [jobForm, setJobForm] = useState<JobFormState>({
    job_title: "",
    company: "",
    job_description: "",
    job_location_text: "",
    compensation_text: "",
    job_posting_origin: "",
    job_posting_origin_other_text: "",
  });
  const [isSavingJobInfo, setIsSavingJobInfo] = useState(false);
  const [isSubmittingManualEntry, setIsSubmittingManualEntry] = useState(false);
  const [sourceTextDraft, setSourceTextDraft] = useState("");
  const [isRecoveringFromSource, setIsRecoveringFromSource] = useState(false);
  const [baseResumes, setBaseResumes] = useState<BaseResumeSummary[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [pageLength, setPageLength] = useState<string>("1_page");
  const [aggressiveness, setAggressiveness] = useState<string>("medium");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [draft, setDraft] = useState<ResumeDraft | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [generationProgress, setGenerationProgress] =
    useState<ExtractionProgress | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(
    null,
  );
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [showSectionRegen, setShowSectionRegen] = useState(false);
  const [regenSectionName, setRegenSectionName] = useState("");
  const [regenEntryId, setRegenEntryId] = useState<string | undefined>();
  const [regenInstructions, setRegenInstructions] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showOptimisticProgress, setShowOptimisticProgress] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isCancellingExtraction, setIsCancellingExtraction] = useState(false);
  const [isRetryingExtraction, setIsRetryingExtraction] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isSavingJobInfoRef = useRef(false);
  const isSubmittingManualEntryRef = useRef(false);
  const isRecoveringFromSourceRef = useRef(false);
  const isCancellingExtractionRef = useRef(false);
  const isRetryingExtractionRef = useRef(false);
  const isDeletingRef = useRef(false);
  const [showAppliedConfirm, setShowAppliedConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCancelExtractionConfirm, setShowCancelExtractionConfirm] =
    useState(false);
  const [showFullRegenConfirm, setShowFullRegenConfirm] = useState(false);
  const [fullRegenInstructions, setFullRegenInstructions] = useState("");
  const [fullRegenUseLatestBase, setFullRegenUseLatestBase] = useState(false);
  const [activityPanelOpen, setActivityPanelOpen] = useState(false);
  const [showResumeJudgeDialog, setShowResumeJudgeDialog] = useState(false);
  const [expandedResumeJudgeDimension, setExpandedResumeJudgeDimension] =
    useState<string | null>(null);
  const [isTriggeringResumeJudge, setIsTriggeringResumeJudge] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareBaseline, setCompareBaseline] =
    useState<BaseResumeDetail | null>(null);
  const [isCompareBaselineLoading, setIsCompareBaselineLoading] =
    useState(false);
  const [compareBaselineError, setCompareBaselineError] = useState<
    string | null
  >(null);
  const lastHandledExtractionProgressRef = useRef<string | null>(null);
  const lastHandledGenerationProgressRef = useRef<string | null>(null);
  const lastDraftSyncDetailRef = useRef<string | null>(null);
  const lastKeywordSignatureRef = useRef<string | null>(null);
  const previousDetailRef = useRef<ApplicationDetail | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [jobDescriptionCollapsed, setJobDescriptionCollapsed] = useState(false);
  const [showKeywordDialog, setShowKeywordDialog] = useState(false);
  const [manualKeywordInput, setManualKeywordInput] = useState("");
  const [isSavingManualKeywords, setIsSavingManualKeywords] = useState(false);
  const [isOptimizingKeywords, setIsOptimizingKeywords] = useState(false);
  const [hasUserModifiedSettings, setHasUserModifiedSettings] = useState(false);
  const resumeJudgePending = isResumeJudgePending(detail);
  const keywordExtractionPending =
    detail?.job_keywords?.status === "queued" ||
    detail?.job_keywords?.status === "running";
  const shouldWatchApplication = Boolean(
    applicationId &&
    detail &&
    (EXTRACTION_POLL_STATES.includes(detail.internal_state) ||
      isGenerationWorkflowActive(detail) ||
      resumeJudgePending ||
      keywordExtractionPending),
  );
  const { isStale: isApplicationStreamStale } = useApplicationEventStream(
    applicationId,
    shouldWatchApplication,
  );
  const detailQuery = useApplicationDetailQuery(applicationId, {
    refetchInterval:
      shouldWatchApplication && isApplicationStreamStale ? 5000 : false,
  });
  const shouldLoadDraft = Boolean(applicationId);
  const draftQuery = useApplicationDraftQuery(applicationId, shouldLoadDraft);
  const shouldPollProgress = Boolean(
    applicationId &&
    detail &&
    (EXTRACTION_POLL_STATES.includes(detail.internal_state) ||
      isGenerationWorkflowActive(detail)) &&
    isApplicationStreamStale,
  );
  const progressQuery = useApplicationProgressQuery(applicationId, {
    enabled: shouldPollProgress,
    refetchInterval: shouldPollProgress ? 5000 : false,
  });
  const extractionStates = [
    "extraction_pending",
    "extracting",
    "manual_entry_required",
    "duplicate_review_required",
  ];
  const baseResumesQuery = useBaseResumesQuery(
    Boolean(detail && !extractionStates.includes(detail.internal_state)),
  );

  // Track last saved values for dirty state detection
  const savedJobForm = useMemo(() => getSavedJobForm(detail), [detail]);

  const savedSettings = useMemo(
    () => ({
      base_resume_id: detail?.base_resume_id ?? null,
      page_length: draft?.generation_params?.page_length ?? pageLength,
      aggressiveness:
        draft?.generation_params?.aggressiveness ?? aggressiveness,
      additional_instructions:
        draft?.generation_params?.additional_instructions ?? "",
    }),
    [detail, draft, pageLength, aggressiveness, additionalInstructions],
  );

  // Compute dirty states
  const jobFormDirty = useMemo(() => {
    return (
      jobForm.job_title !== savedJobForm.job_title ||
      jobForm.company !== savedJobForm.company ||
      jobForm.job_description !== savedJobForm.job_description ||
      jobForm.job_location_text !== savedJobForm.job_location_text ||
      jobForm.compensation_text !== savedJobForm.compensation_text ||
      jobForm.job_posting_origin !== savedJobForm.job_posting_origin ||
      (jobForm.job_posting_origin === "other" &&
        jobForm.job_posting_origin_other_text !==
          savedJobForm.job_posting_origin_other_text)
    );
  }, [jobForm, savedJobForm]);

  const settingsDirty = useMemo(() => {
    return (
      selectedResumeId !== savedSettings.base_resume_id ||
      pageLength !== savedSettings.page_length ||
      aggressiveness !== savedSettings.aggressiveness ||
      additionalInstructions !== (savedSettings.additional_instructions || "")
    );
  }, [
    selectedResumeId,
    pageLength,
    aggressiveness,
    additionalInstructions,
    savedSettings,
  ]);
  const selectedAggressivenessOption = useMemo(
    () =>
      AGGRESSIVENESS_OPTIONS.find(
        (option) => option.value === aggressiveness,
      ) ?? null,
    [aggressiveness],
  );
  const generationStartBlocker = getGenerationStartBlocker(
    detail,
    selectedResumeId,
    baseResumes.length,
  );
  const fullRegenerationBlocker = getFullRegenerationBlocker(detail);
  function sectionRegenerationReason(
    section: ResumeSection,
    entryId?: string,
  ): string | null {
    return getResumeRegenerationBlocker(
      section,
      draft?.source_snapshot?.document,
      draft?.generation_params.aggressiveness,
      entryId,
    );
  }
  const selectedRegenSection = draft?.document?.sections.find(
    (section) => section.id === regenSectionName,
  );
  const sectionSourceBlocker = selectedRegenSection
    ? sectionRegenerationReason(selectedRegenSection, regenEntryId)
    : null;
  const sectionRegenerationBlocker =
    sectionSourceBlocker ??
    getSectionRegenerationBlocker(detail, regenSectionName, regenInstructions);
  const resumeJudgeStale = isResumeJudgeStale(detail);
  const resumeJudge = detail?.resume_judge_result ?? null;
  const resumeJudgeRunLimitReached = Boolean(
    draft &&
    resumeJudge &&
    !resumeJudgeStale &&
    (resumeJudge.run_attempt_count ?? 0) >= 3,
  );
  const resumeJudgeDimensionEntries = useMemo(
    () => getResumeJudgeDimensionEntries(resumeJudge),
    [resumeJudge],
  );
  const defaultExpandedResumeJudgeDimension = useMemo(
    () => getDefaultExpandedResumeJudgeDimension(resumeJudge),
    [resumeJudge],
  );
  const sourceLimitedLengthFlag = useMemo(
    () =>
      draft?.review_flags?.find(
        (flag) => flag.reason === "source_limited_length",
      ) ?? null,
    [draft],
  );
  const comparisonBaseResumeId = useMemo(() => {
    const generationResumeId =
      draft?.source_snapshot?.base_resume_id ??
      draft?.generation_params?.base_resume_id;
    if (typeof generationResumeId === "string" && generationResumeId.trim()) {
      return generationResumeId;
    }
    return detail?.base_resume_id ?? null;
  }, [draft, detail?.base_resume_id]);
  const compareReady =
    Boolean(draft) &&
    Boolean(comparisonBaseResumeId) &&
    Boolean(compareBaseline) &&
    compareBaseline?.id === comparisonBaseResumeId &&
    !compareBaselineError;

  function dismissDraftEditor() {
    setEditMode(false);
    setEditContent("");
  }

  function applyDetailState(
    response: ApplicationDetail,
    options?: { refreshShell?: boolean },
  ) {
    const generationActive = isGenerationWorkflowActive(response);
    const regenerationActive = [
      "regenerating_full",
      "regenerating_section",
    ].includes(response.internal_state);
    queryClient.setQueryData(queryKeys.application(response.id), response);
    setDetail(response);
    setNotesDraft(response.notes ?? "");
    setJobForm(getSavedJobForm(response));
    setSelectedResumeId(response.base_resume_id);
    setIsGenerating(
      response.internal_state === "generating" &&
        response.failure_reason === null,
    );
    setIsRegenerating(regenerationActive && response.failure_reason === null);
    if (generationActive) {
      dismissDraftEditor();
    }
    if (!generationActive) {
      setIsCancelling(false);
      setShowOptimisticProgress(false);
    }
    if (options?.refreshShell) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
        queryClient.invalidateQueries({ queryKey: queryKeys.applications }),
      ]);
    }
  }

  function applyTerminalGenerationFallback(nextProgress: ExtractionProgress) {
    setDetail((current) =>
      current
        ? applyTerminalGenerationProgress(current, nextProgress)
        : current,
    );
    setIsGenerating(false);
    setIsRegenerating(false);
    setIsCancelling(false);
    setShowOptimisticProgress(false);
  }

  function applyTerminalExtractionFallback(nextProgress: ExtractionProgress) {
    setDetail((current) =>
      current
        ? applyTerminalExtractionProgress(current, nextProgress)
        : current,
    );
    setIsCancellingExtraction(false);
  }

  function applyDraftState(response: ResumeDraft | null) {
    if (applicationId) {
      queryClient.setQueryData(
        queryKeys.applicationDraft(applicationId),
        response,
      );
    }
    setDraft(response);
    if (!response) return;
    // Only apply draft generation params if:
    // 1. User hasn't explicitly modified settings, AND
    // 2. Generation is not currently active (to prevent overwriting user settings during regeneration)
    const isGenerationActive = isGenerating || isRegenerating;
    if (!hasUserModifiedSettings && !isGenerationActive) {
      const generationParams = response.generation_params ?? {};
      if (isAllowedPageLength(generationParams.page_length))
        setPageLength(generationParams.page_length);
      if (isAllowedAggressiveness(generationParams.aggressiveness))
        setAggressiveness(generationParams.aggressiveness);
      setAdditionalInstructions(
        typeof generationParams.additional_instructions === "string"
          ? generationParams.additional_instructions
          : "",
      );
    }
  }

  useEffect(() => {
    setActivityPanelOpen(false);
  }, [applicationId]);

  useEffect(() => {
    if (!showResumeJudgeDialog) {
      setExpandedResumeJudgeDimension(null);
      return;
    }
    setExpandedResumeJudgeDimension(defaultExpandedResumeJudgeDimension);
  }, [showResumeJudgeDialog, defaultExpandedResumeJudgeDimension]);

  useEffect(() => {
    if (!actionsMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (
        actionsMenuRef.current &&
        !actionsMenuRef.current.contains(event.target as Node)
      ) {
        setActionsMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActionsMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [actionsMenuOpen]);

  useEffect(() => {
    if (!detailQuery.data) return;
    applyDetailState(detailQuery.data);
    setError(null);
  }, [detailQuery.data]);

  useEffect(() => {
    if (!applicationId || !detail) {
      previousDetailRef.current = detail;
      return;
    }

    const previousDetail = previousDetailRef.current;
    previousDetailRef.current = detail;

    const completedGeneration =
      detail.internal_state === "resume_ready" &&
      detail.failure_reason === null;
    const completedGenerationFromActiveState = Boolean(
      previousDetail &&
      isGenerationWorkflowActive(previousDetail) &&
      completedGeneration,
    );
    const draftMissingOrStale =
      completedGeneration &&
      draft !== undefined &&
      (draft === null || draft.updated_at < detail.updated_at);
    if (!completedGenerationFromActiveState && !draftMissingOrStale) {
      return;
    }

    const syncKey = `${detail.id}:${detail.updated_at}`;
    if (lastDraftSyncDetailRef.current === syncKey) {
      return;
    }
    lastDraftSyncDetailRef.current = syncKey;

    void invalidateApplicationDraftQueries(queryClient, applicationId);
  }, [applicationId, detail, draft, queryClient]);

  useEffect(() => {
    if (!(detailQuery.error instanceof Error)) return;
    setError(detailQuery.error.message);
  }, [detailQuery.error]);

  useEffect(() => {
    if (!applicationId || !detail || !progressQuery.data) return;
    if (!EXTRACTION_POLL_STATES.includes(detail.internal_state)) {
      setProgress(null);
      return;
    }
    const nextProgress = progressQuery.data;
    const nextKey = progressEventKey(nextProgress);
    if (lastHandledExtractionProgressRef.current === nextKey) {
      return;
    }
    lastHandledExtractionProgressRef.current = nextKey;
    setProgress(nextProgress);
    if (
      EXTRACTION_POLL_STATES.includes(nextProgress.state) &&
      !nextProgress.completed_at &&
      !nextProgress.terminal_error_code
    ) {
      return;
    }
    detailQuery
      .refetch()
      .then((result) => {
        const response = result.data;
        if (!response) {
          applyTerminalExtractionFallback(nextProgress);
          if (isTerminalExtractionSuccess(nextProgress)) {
            setError(null);
          } else {
            setError(extractionFallbackMessage(nextProgress));
          }
          return;
        }
        applyDetailState(response, { refreshShell: true });
        refreshActivityTimeline();
        if (
          EXTRACTION_POLL_STATES.includes(response.internal_state) &&
          response.failure_reason === null
        ) {
          applyTerminalExtractionFallback(nextProgress);
          if (isTerminalExtractionSuccess(nextProgress)) {
            setError(null);
          } else {
            setError(extractionFallbackMessage(nextProgress));
          }
          return;
        }
        setError(null);
      })
      .catch((requestError) => {
        applyTerminalExtractionFallback(nextProgress);
        if (isTerminalExtractionSuccess(nextProgress)) {
          setError(null);
        } else {
          setError(
            requestError instanceof Error
              ? requestError.message
              : extractionFallbackMessage(nextProgress),
          );
        }
      });
  }, [applicationId, detail, detailQuery, progressQuery.data]);

  useEffect(() => {
    if (!progress || !EXTRACTION_POLL_STATES.includes(progress.state)) {
      setExtractionDisplayPercent(0);
      return;
    }
    setExtractionDisplayPercent(progress.percent_complete);
  }, [progress?.job_id, progress?.state, progress?.workflow_kind]);

  useEffect(() => {
    if (!progress || !EXTRACTION_POLL_STATES.includes(progress.state)) {
      return;
    }
    if (
      progress.completed_at ||
      progress.terminal_error_code ||
      progress.percent_complete >= 100
    ) {
      setExtractionDisplayPercent(progress.percent_complete);
      return;
    }

    const interval = window.setInterval(() => {
      setExtractionDisplayPercent((current) => {
        const floor = Math.max(current, progress.percent_complete);
        if (floor >= EXTRACTION_FAKE_PROGRESS_CAP) {
          return floor;
        }
        return Math.min(
          EXTRACTION_FAKE_PROGRESS_CAP,
          Number((floor + extractionFakeStep(floor)).toFixed(1)),
        );
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    progress?.completed_at,
    progress?.job_id,
    progress?.percent_complete,
    progress?.state,
    progress?.terminal_error_code,
  ]);

  useEffect(() => {
    if (!applicationId || !detail || !progressQuery.data) return;
    if (!isGenerationWorkflowActive(detail)) {
      setGenerationProgress(null);
      return;
    }
    const nextProgress = progressQuery.data;
    const nextKey = progressEventKey(nextProgress);
    if (lastHandledGenerationProgressRef.current === nextKey) {
      return;
    }
    lastHandledGenerationProgressRef.current = nextKey;
    setShowOptimisticProgress(false);
    setGenerationProgress(nextProgress);
    if (isGenerationProgressActive(nextProgress)) {
      return;
    }
    detailQuery
      .refetch()
      .then(async (result) => {
        const response = result.data;
        if (!response) {
          applyTerminalGenerationFallback(nextProgress);
          setError(
            "Generation finished, but the application could not be refreshed.",
          );
          return;
        }
        applyDetailState(response, { refreshShell: true });
        refreshActivityTimeline();
        if (
          nextProgress.state === "resume_ready" &&
          !nextProgress.terminal_error_code
        ) {
          await invalidateApplicationDraftQueries(queryClient, applicationId);
        }
        setError(null);
      })
      .catch((requestError) => {
        applyTerminalGenerationFallback(nextProgress);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Generation finished, but the application could not be refreshed.",
        );
      });
  }, [applicationId, detail, detailQuery, progressQuery.data, queryClient]);

  useEffect(() => {
    if (draftQuery.data === undefined && shouldLoadDraft) {
      return;
    }
    applyDraftState(draftQuery.data ?? null);
  }, [draftQuery.data, shouldLoadDraft]);

  useEffect(() => {
    if (!applicationId || !draft || !detail?.job_keywords) {
      lastKeywordSignatureRef.current = null;
      return;
    }
    const keywordSignature = [
      applicationId,
      detail.job_keywords.updated_at ?? "",
      detail.job_keywords.status ?? "",
    ].join(":");
    if (lastKeywordSignatureRef.current === null) {
      lastKeywordSignatureRef.current = keywordSignature;
      return;
    }
    if (lastKeywordSignatureRef.current === keywordSignature) return;
    lastKeywordSignatureRef.current = keywordSignature;
    void invalidateApplicationDraftQueries(queryClient, applicationId);
  }, [
    applicationId,
    detail?.job_keywords?.updated_at,
    detail?.job_keywords?.status,
    draft?.id,
    queryClient,
  ]);

  useEffect(() => {
    if (!draft || !comparisonBaseResumeId) {
      setCompareBaseline(null);
      setCompareBaselineError(null);
      setIsCompareBaselineLoading(false);
      setCompareMode(false);
      return;
    }

    if (draft.source_snapshot) {
      setCompareBaseline({
        id: draft.source_snapshot.base_resume_id,
        name: `Source revision ${draft.source_snapshot.revision}`,
        document: draft.source_snapshot.document,
        content_md: draft.source_snapshot.content_md,
        is_default: false,
        created_at: draft.last_generated_at,
        updated_at: draft.last_generated_at,
      });
      setCompareBaselineError(null);
      setIsCompareBaselineLoading(false);
      return;
    }

    let cancelled = false;
    setIsCompareBaselineLoading(true);
    setCompareBaselineError(null);

    fetchBaseResume(comparisonBaseResumeId)
      .then((response) => {
        if (cancelled) return;
        setCompareBaseline(response);
      })
      .catch(() => {
        if (cancelled) return;
        setCompareBaseline(null);
        setCompareBaselineError(
          "The base resume used for this draft could not be loaded. Compare view is unavailable.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsCompareBaselineLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [draft?.id, draft?.source_snapshot, comparisonBaseResumeId]);

  useEffect(() => {
    if (compareMode) {
      setShellLayoutMode("immersive");
    } else {
      clearShellLayoutMode();
    }

    return () => {
      clearShellLayoutMode();
    };
  }, [compareMode, setShellLayoutMode, clearShellLayoutMode]);

  useEffect(() => {
    if (compareMode && !compareReady) {
      setCompareMode(false);
    }
  }, [compareMode, compareReady]);

  useEffect(() => {
    if (!applicationId || !detail) return;
    if (notesDraft === (detail.notes ?? "")) return;
    const timeout = window.setTimeout(() => {
      setNotesState("saving");
      patchApplication(applicationId, { notes: notesDraft })
        .then((response) => {
          setDetail(response);
          setNotesState("saved");
          refreshActivityTimeline();
        })
        .catch((err: Error) => {
          setError(err.message);
          setNotesState("idle");
        });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [applicationId, detail, notesDraft]);

  useEffect(() => {
    if (!baseResumesQuery.data) return;
    setBaseResumes(baseResumesQuery.data);
    if (!selectedResumeId && baseResumesQuery.data.length > 0) {
      const defaultResume = baseResumesQuery.data.find(
        (resume) => resume.is_default,
      );
      if (defaultResume) {
        setSelectedResumeId(defaultResume.id);
      }
    }
  }, [baseResumesQuery.data, selectedResumeId]);

  if (!applicationId) return null;
  const activeApplicationId = applicationId;

  async function handleAppliedToggle(applied: boolean) {
    if (!detail) return;
    const previous = detail;
    setDetail({ ...detail, applied });
    try {
      const response = await patchApplication(activeApplicationId, { applied });
      applyDetailState(response, { refreshShell: true });
      refreshActivityTimeline();
      toast(applied ? "Marked as applied" : "Unmarked as applied");
    } catch (err) {
      setDetail(previous);
      setError(
        err instanceof Error ? err.message : "Unable to update applied state.",
      );
      toast("Failed to update applied status", "error");
    }
  }

  function handleAppliedButtonClick() {
    if (!detail) return;
    if (detail.applied) {
      void handleAppliedToggle(false);
    } else {
      setShowAppliedConfirm(true);
    }
  }

  async function handleSaveJobInfo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingJobInfoRef.current) return;
    isSavingJobInfoRef.current = true;
    setIsSavingJobInfo(true);
    setError(null);
    try {
      const response = await patchApplication(activeApplicationId, {
        job_title: jobForm.job_title,
        company: jobForm.company || null,
        job_description: jobForm.job_description || null,
        job_location_text: jobForm.job_location_text || null,
        compensation_text: jobForm.compensation_text || null,
        job_posting_origin: jobForm.job_posting_origin || null,
        job_posting_origin_other_text:
          jobForm.job_posting_origin === "other"
            ? jobForm.job_posting_origin_other_text
            : null,
      });
      toast("Job information saved");
      applyDetailState(response, { refreshShell: true });
      refreshActivityTimeline();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save job information.",
      );
    } finally {
      isSavingJobInfoRef.current = false;
      setIsSavingJobInfo(false);
    }
  }

  async function handleManualEntrySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingManualEntryRef.current) return;
    isSubmittingManualEntryRef.current = true;
    setIsSubmittingManualEntry(true);
    setError(null);
    try {
      const response = await submitManualEntry(activeApplicationId, {
        ...jobForm,
        job_location_text: jobForm.job_location_text || null,
        compensation_text: jobForm.compensation_text || null,
        job_posting_origin: jobForm.job_posting_origin || null,
        job_posting_origin_other_text:
          jobForm.job_posting_origin === "other"
            ? jobForm.job_posting_origin_other_text
            : null,
        notes: notesDraft || null,
      });
      applyDetailState(response, { refreshShell: true });
      refreshActivityTimeline();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to submit manual entry.",
      );
    } finally {
      isSubmittingManualEntryRef.current = false;
      setIsSubmittingManualEntry(false);
    }
  }

  async function handleRetryExtraction() {
    if (isRetryingExtractionRef.current) return;
    isRetryingExtractionRef.current = true;
    setIsRetryingExtraction(true);
    setError(null);
    try {
      const response = await retryExtraction(activeApplicationId);
      applyDetailState(response, { refreshShell: true });
      setProgress(null);
      refreshActivityTimeline();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to retry extraction.",
      );
    } finally {
      isRetryingExtractionRef.current = false;
      setIsRetryingExtraction(false);
    }
  }

  async function handleCancelExtraction() {
    if (isCancellingExtractionRef.current) return;
    isCancellingExtractionRef.current = true;
    setIsCancellingExtraction(true);
    setError(null);
    try {
      const response = await cancelExtraction(activeApplicationId);
      applyDetailState(response, { refreshShell: true });
      setProgress(null);
      setShowCancelExtractionConfirm(false);
      refreshActivityTimeline();
      toast("Extraction stopped.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to stop extraction.",
      );
      toast("Failed to stop extraction", "error");
    } finally {
      isCancellingExtractionRef.current = false;
      setIsCancellingExtraction(false);
    }
  }

  async function handleDeleteApplication() {
    if (isDeletingRef.current) return;
    isDeletingRef.current = true;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteApplication(activeApplicationId);
      await invalidateApplicationQueries(queryClient, activeApplicationId);
      setShowDeleteConfirm(false);
      toast("Application deleted.");
      navigate("/app/applications");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to delete application.",
      );
      toast("Failed to delete application", "error");
    } finally {
      isDeletingRef.current = false;
      setIsDeleting(false);
    }
  }

  async function handleRecoverFromSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRecoveringFromSourceRef.current) return;
    isRecoveringFromSourceRef.current = true;
    setIsRecoveringFromSource(true);
    setError(null);
    try {
      const response = await recoverApplicationFromSource(activeApplicationId, {
        source_text: sourceTextDraft,
        source_url:
          detail?.extraction_failure_details?.blocked_url ??
          detail?.job_url ??
          undefined,
        page_title: detail?.job_title ?? undefined,
      });
      applyDetailState(response, { refreshShell: true });
      setProgress(null);
      setSourceTextDraft("");
      refreshActivityTimeline();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to recover from pasted source text.",
      );
    } finally {
      isRecoveringFromSourceRef.current = false;
      setIsRecoveringFromSource(false);
    }
  }

  async function handleDuplicateDismissal() {
    try {
      const response = await resolveDuplicate(activeApplicationId, "dismissed");
      applyDetailState(response, { refreshShell: true });
      refreshActivityTimeline();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to dismiss duplicate warning.",
      );
    }
  }

  async function handleOpenExistingApplication() {
    if (!detail?.duplicate_warning) return;
    try {
      const response = await resolveDuplicate(
        activeApplicationId,
        "redirected",
      );
      applyDetailState(response, { refreshShell: true });
      refreshActivityTimeline();
      navigate(
        `/app/applications/${detail.duplicate_warning.matched_application.id}`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to open matched application.",
      );
    }
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedResumeId) return;
    setIsSavingSettings(true);
    setError(null);
    try {
      const response = await patchApplication(activeApplicationId, {
        base_resume_id: selectedResumeId,
      });
      applyDetailState(response, { refreshShell: true });
      refreshActivityTimeline();
      toast("Settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save settings.");
      toast("Failed to save settings", "error");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleTriggerGeneration() {
    if (generationStartBlocker) {
      setError(generationStartBlocker);
      return;
    }
    setIsGenerating(true);
    setShowOptimisticProgress(true);
    dismissDraftEditor();
    setError(null);
    try {
      const response = await triggerGeneration(activeApplicationId, {
        base_resume_id: selectedResumeId!,
        target_length: pageLength,
        aggressiveness,
        additional_instructions: additionalInstructions || undefined,
      });
      applyDetailState(response, { refreshShell: true });
      setGenerationProgress(null);
      setHasUserModifiedSettings(false);
      refreshActivityTimeline();
    } catch (err) {
      setShowOptimisticProgress(false);
      setIsGenerating(false);
      setError(
        err instanceof Error ? err.message : "Unable to start generation.",
      );
    }
  }

  async function handleSaveDraft() {
    if (!editContent.trim()) return;
    setIsSavingDraft(true);
    setError(null);
    try {
      const updated = await saveDraft(activeApplicationId, editContent);
      queryClient.setQueryData(
        queryKeys.applicationDraft(activeApplicationId),
        updated,
      );
      applyDraftState(updated);
      await invalidateApplicationDraftQueries(queryClient, activeApplicationId);
      setEditMode(false);
      refreshActivityTimeline();
      toast("Draft saved successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save draft.");
      toast("Failed to save draft", "error");
    } finally {
      setIsSavingDraft(false);
    }
  }

  async function handleSaveSectionDocument(
    document: ResumeDocument,
    expectedRevision: number,
  ): Promise<boolean> {
    setIsSavingDraft(true);
    setError(null);
    try {
      const updated = await saveDraft(activeApplicationId, {
        document,
        expected_revision: expectedRevision,
      });
      applyDraftState(updated);
      await invalidateApplicationDraftQueries(queryClient, activeApplicationId);
      refreshActivityTimeline();
      toast("Draft saved successfully");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save draft.");
      toast("Failed to save draft", "error");
      return false;
    } finally {
      setIsSavingDraft(false);
    }
  }

  function openSectionRegeneration(section: ResumeSection, entryId?: string) {
    const blocker = sectionRegenerationReason(section, entryId);
    if (blocker) {
      setError(blocker);
      return;
    }
    setRegenSectionName(section.id);
    setRegenEntryId(entryId);
    setRegenInstructions("");
    setShowSectionRegen(true);
  }

  function handleEnterEditMode() {
    if (draft) {
      setEditContent(draft.content_md);
      setEditMode(true);
    }
  }

  function handleCancelEdit() {
    dismissDraftEditor();
  }

  async function handleFullRegeneration(
    overrideInstructions?: string,
    useJudgeFeedback?: boolean,
    useLatestBase = false,
  ): Promise<boolean> {
    if (draftDirty) {
      setError("Save or discard your section edits before regenerating.");
      return false;
    }
    if (fullRegenerationBlocker) {
      setError(fullRegenerationBlocker);
      return false;
    }
    setIsRegenerating(true);
    setShowOptimisticProgress(true);
    dismissDraftEditor();
    setError(null);
    try {
      const combined = [];
      if (additionalInstructions && additionalInstructions.trim()) {
        combined.push(additionalInstructions.trim());
      }
      if (
        overrideInstructions &&
        overrideInstructions.trim() &&
        overrideInstructions.trim() !== additionalInstructions.trim()
      ) {
        combined.push(overrideInstructions.trim());
      }
      const finalInstructions = combined.join("\n\n") || undefined;

      const response = await triggerFullRegeneration(activeApplicationId, {
        target_length: pageLength,
        aggressiveness,
        additional_instructions: finalInstructions,
        use_judge_feedback: useJudgeFeedback,
        ...(useLatestBase ? { use_latest_base: true } : {}),
      });
      applyDetailState(response, { refreshShell: true });
      setGenerationProgress(null);
      setHasUserModifiedSettings(false);
      refreshActivityTimeline();
      return true;
    } catch (err) {
      setShowOptimisticProgress(false);
      setIsRegenerating(false);
      setError(
        err instanceof Error ? err.message : "Unable to start regeneration.",
      );
      return false;
    }
  }

  async function handleSectionRegeneration() {
    if (draftDirty) {
      setError("Save or discard your section edits before regenerating.");
      return;
    }
    if (sectionRegenerationBlocker) {
      setError(sectionRegenerationBlocker);
      return;
    }
    setIsRegenerating(true);
    setShowOptimisticProgress(true);
    dismissDraftEditor();
    setError(null);
    try {
      const response = await triggerSectionRegeneration(
        activeApplicationId,
        regenSectionName,
        regenInstructions,
        regenEntryId,
      );
      applyDetailState(response, { refreshShell: true });
      setGenerationProgress(null);
      setShowSectionRegen(false);
      setRegenSectionName("");
      setRegenEntryId(undefined);
      setRegenInstructions("");
      setHasUserModifiedSettings(false);
      refreshActivityTimeline();
    } catch (err) {
      setShowOptimisticProgress(false);
      setIsRegenerating(false);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to start section regeneration.",
      );
    }
  }

  async function handleCancelGeneration() {
    setIsCancelling(true);
    setError(null);
    try {
      const response = await cancelGeneration(activeApplicationId);
      applyDetailState(response, { refreshShell: true });
      setGenerationProgress(null);
      setShowOptimisticProgress(false);
      refreshActivityTimeline();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to cancel generation.",
      );
    } finally {
      setIsCancelling(false);
    }
  }

  async function handleTriggerResumeJudge() {
    if (!draft || generationActive || isTriggeringResumeJudge) return;
    setIsTriggeringResumeJudge(true);
    setError(null);
    try {
      const response = await triggerResumeJudge(activeApplicationId);
      applyDetailState(response);
      await invalidateApplicationQueries(queryClient, activeApplicationId);
      refreshActivityTimeline();
      toast(
        resumeJudgeStale
          ? "Resume re-evaluation queued"
          : "Resume Judge queued",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to run Resume Judge.",
      );
      toast("Failed to run Resume Judge", "error");
    } finally {
      setIsTriggeringResumeJudge(false);
    }
  }

  async function persistManualKeywords(nextKeywords: string[]) {
    setIsSavingManualKeywords(true);
    setError(null);
    try {
      const response = await updateManualKeywords(
        activeApplicationId,
        nextKeywords,
      );
      applyDetailState(response);
      await invalidateApplicationDraftQueries(queryClient, activeApplicationId);
      refreshActivityTimeline();
      toast("ATS keywords updated");
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to update ATS keywords.";
      setError(message);
      toast("Failed to update ATS keywords", "error");
      return false;
    } finally {
      setIsSavingManualKeywords(false);
    }
  }

  async function handleAddManualKeyword(event?: FormEvent) {
    event?.preventDefault();
    const cleaned = manualKeywordInput.trim().replace(/\s+/g, " ");
    if (!cleaned) {
      toast("Enter a keyword first", "error");
      return;
    }
    if (cleaned.length > 80) {
      toast("Manual keywords must be 80 characters or fewer", "error");
      return;
    }
    const manualKeywords = getManualKeywordTexts(detail?.job_keywords);
    const allKeywords = getKeywordTexts(detail?.job_keywords);
    if (
      manualKeywords.length >= 30 &&
      !manualKeywords.some(
        (keyword) => keyword.toLowerCase() === cleaned.toLowerCase(),
      )
    ) {
      toast("Manual keywords are limited to 30", "error");
      return;
    }
    if (
      allKeywords.some(
        (keyword) => keyword.toLowerCase() === cleaned.toLowerCase(),
      )
    ) {
      setManualKeywordInput("");
      toast("Keyword already exists");
      return;
    }
    const saved = await persistManualKeywords([...manualKeywords, cleaned]);
    if (saved) {
      setManualKeywordInput("");
    }
  }

  async function handleRemoveManualKeyword(keyword: string) {
    const nextKeywords = getManualKeywordTexts(detail?.job_keywords).filter(
      (item) => item.toLowerCase() !== keyword.toLowerCase(),
    );
    await persistManualKeywords(nextKeywords);
  }

  async function handleKeywordOptimization() {
    if (draftDirty) {
      setError(
        "Save or discard your section edits before optimizing keywords.",
      );
      return;
    }
    if (!draft || generationActive || isOptimizingKeywords) return;
    setIsOptimizingKeywords(true);
    setShowOptimisticProgress(true);
    dismissDraftEditor();
    setError(null);
    try {
      const response = await triggerKeywordOptimization(activeApplicationId);
      applyDetailState(response, { refreshShell: true });
      setGenerationProgress(null);
      setShowKeywordDialog(false);
      refreshActivityTimeline();
      toast("Keyword optimization queued");
    } catch (err) {
      setShowOptimisticProgress(false);
      setIsRegenerating(false);
      const message =
        err instanceof Error
          ? err.message
          : "Unable to start keyword optimization.";
      setError(message);
      toast("Failed to optimize keywords", "error");
    } finally {
      setIsOptimizingKeywords(false);
    }
  }

  async function handleExport(format: ExportFormat) {
    if (draftDirty) {
      setError("Save or discard your section edits before exporting.");
      return;
    }
    setActionsMenuOpen(false);
    setExportingFormat(format);
    setError(null);
    try {
      const download =
        format === "pdf"
          ? await exportPdf(activeApplicationId)
          : await exportDocx(activeApplicationId);
      const url = URL.createObjectURL(download.blob);
      const link = document.createElement("a");
      let linkAttached = false;
      try {
        link.href = url;
        link.download =
          download.filename ??
          `resume-${detail?.job_title?.replace(/\s+/g, "-").toLowerCase() ?? activeApplicationId}.${format}`;
        document.body.appendChild(link);
        linkAttached = true;
        link.click();
      } finally {
        if (linkAttached) {
          document.body.removeChild(link);
        }
        URL.revokeObjectURL(url);
      }
      await invalidateApplicationDraftQueries(queryClient, activeApplicationId);
      const updated = await detailQuery.refetch();
      if (updated.data) {
        applyDetailState(updated.data, { refreshShell: true });
      }
      refreshActivityTimeline();
      toast(`${format.toUpperCase()} exported successfully`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Unable to export ${format.toUpperCase()}.`,
      );
      toast(`Failed to export ${format.toUpperCase()}`, "error");
    } finally {
      setExportingFormat(null);
    }
  }

  function handleToggleCompareMode() {
    if (draftDirty) {
      setError("Save or discard your section edits before opening comparison.");
      return;
    }
    if (compareMode) {
      setCompareMode(false);
      return;
    }

    if (!compareReady) {
      setError(
        compareBaselineError ??
          "Compare view is unavailable until the generation-time base resume finishes loading.",
      );
      return;
    }

    setError(null);
    setCompareMode(true);
  }

  // Helper to check if we're past the extraction-only phase.
  const isPastExtraction =
    detail &&
    !["extraction_pending", "extracting", "manual_entry_required"].includes(
      detail.internal_state,
    );
  const generationActive = isGenerationWorkflowActive(detail);
  const extractionActive = detail
    ? EXTRACTION_POLL_STATES.includes(detail.internal_state)
    : false;
  const extractionPercent = progress
    ? Math.min(
        100,
        Math.max(progress.percent_complete, extractionDisplayPercent),
      )
    : 0;
  const deleteBlocked = detail
    ? ACTIVE_GENERATION_STATES.includes(detail.internal_state)
    : false;
  const workspaceRegionClass = "flex min-h-[32rem] flex-col overflow-hidden";
  const generatedTimestampLabel = draft
    ? `Generated ${new Date(draft.last_generated_at).toLocaleString()}`
    : null;
  const exportedTimestampLabel = draft?.last_exported_at
    ? `Exported ${new Date(draft.last_exported_at).toLocaleString()}`
    : null;
  const resumeJudgeToneStyle = resumeJudgeTone(resumeJudge?.verdict);
  const resumeJudgeHasCompletedScore = Boolean(
    resumeJudge &&
    resumeJudge.status === "succeeded" &&
    resumeJudge.final_score != null &&
    resumeJudge.dimension_scores &&
    Object.keys(resumeJudge.dimension_scores).length > 0,
  );
  const resumeJudgeCanRegenerateWithFeedback =
    Boolean(
      resumeJudge &&
      resumeJudge.status === "succeeded" &&
      formatJudgeInstructions(resumeJudge.regeneration_instructions) &&
      !resumeJudgeStale,
    ) && !generationActive;
  const resumeJudgeCanRun =
    Boolean(draft) &&
    !generationActive &&
    !isRegenerating &&
    !isTriggeringResumeJudge &&
    !resumeJudgePending &&
    !resumeJudgeRunLimitReached;
  const resumeJudgeSummary =
    resumeJudge?.score_summary?.trim() ?? "Review available";

  function refreshActivityTimeline() {
    if (!applicationId) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.applicationActivity(applicationId),
    });
  }

  function renderKeywordCard() {
    return (
      <KeywordMatchCard
        jobKeywords={detail?.job_keywords ?? null}
        match={draft?.keyword_match ?? null}
        onOpen={() => setShowKeywordDialog(true)}
      />
    );
  }

  function renderKeywordDialog() {
    return (
      <KeywordDialog
        open={showKeywordDialog}
        jobKeywords={detail?.job_keywords ?? null}
        match={draft?.keyword_match ?? null}
        generationActive={generationActive}
        hasDraft={Boolean(draft)}
        input={manualKeywordInput}
        saving={isSavingManualKeywords}
        optimizing={isOptimizingKeywords}
        onInputChange={setManualKeywordInput}
        onClose={() => setShowKeywordDialog(false)}
        onAdd={handleAddManualKeyword}
        onRemove={(text) => void handleRemoveManualKeyword(text)}
        onOptimize={() => void handleKeywordOptimization()}
      />
    );
  }

  function renderResumeJudgeCard() {
    return (
      <ResumeJudgeCard
        hasDraft={Boolean(draft)}
        result={resumeJudge}
        pending={resumeJudgePending}
        completed={resumeJudgeHasCompletedScore}
        stale={resumeJudgeStale}
        runLimit={resumeJudgeRunLimitReached}
        triggering={isTriggeringResumeJudge}
        canRun={resumeJudgeCanRun}
        tone={resumeJudgeToneStyle}
        summary={resumeJudgeSummary}
        onTrigger={() => void handleTriggerResumeJudge()}
        onOpen={() => setShowResumeJudgeDialog(true)}
      />
    );
  }

  function renderGeneratedWorkspacePane(options?: {
    lockInteractions?: boolean;
  }) {
    if (draft)
      return (
        <Section className="draft-workbench-region flex min-h-0 min-w-0 flex-col px-4 py-4">
          <DraftSectionWorkbench
            key={`${activeApplicationId}:${draft.id}`}
            draft={draft}
            profile={bootstrap?.profile ?? null}
            locked={options?.lockInteractions ?? false}
            saving={isSavingDraft}
            onSave={handleSaveSectionDocument}
            onDirtyChange={setDraftDirty}
            onRegenerate={openSectionRegeneration}
            canRegenerate={(section, entryId) =>
              !sectionRegenerationReason(section, entryId)
            }
            regenerationReason={sectionRegenerationReason}
          />
        </Section>
      );
    return (
      <GeneratedWorkspacePane
        className={workspaceRegionClass}
        compareMode={compareMode}
        lockInteractions={options?.lockInteractions ?? false}
        generatedTimestamp={generatedTimestampLabel}
        exportedTimestamp={exportedTimestampLabel}
        editMode={editMode}
        baselineLoading={isCompareBaselineLoading}
        baselineError={compareBaselineError}
        sourceLimitedText={sourceLimitedLengthFlag?.text ?? null}
        resumeReady={detail?.internal_state === "resume_ready"}
        editContent={editContent}
        saving={isSavingDraft}
        draft={draft}
        onEnterEdit={handleEnterEditMode}
        onCancelEdit={handleCancelEdit}
        onContentChange={setEditContent}
        onSave={() => void handleSaveDraft()}
      />
    );
  }

  return (
    <div
      className={`application-detail-page page-enter ${isPastExtraction && detail?.internal_state !== "manual_entry_required" && !compareMode ? "application-detail-page--workspace" : "space-y-4"}`}
    >
      {/* Error banner */}
      <ErrorBanner
        error={error}
        className="mb-4"
        onClear={() => setError(null)}
      />

      {/* Loading skeleton */}
      {!detail ? (
        <div className="space-y-4">
          <SkeletonSection />
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonSection />
            <SkeletonSection />
          </div>
        </div>
      ) : (
        <>
          {/* ── Page Header ── */}
          <PageHeader
            title={detail.job_title ?? "Awaiting extracted title"}
            subtitle={detail.company ?? "Company pending extraction"}
            badge={<StatusBadge status={detail.visible_status} size="md" />}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {detail.has_action_required_notification &&
                  detail.visible_status !== "needs_action" && (
                    <span
                      className="rounded-md px-2 py-1 text-[10px] font-bold uppercase"
                      style={{
                        background: "var(--color-error-muted)",
                        color: "var(--color-error)",
                      }}
                    >
                      Action Required
                    </span>
                  )}
                {detail.applied && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full border shrink-0"
                    style={{
                      background: "var(--color-accent-muted)",
                      color: "var(--color-accent)",
                      borderColor: "var(--color-success-muted)",
                    }}
                  >
                    <Check
                      size={12}
                      className="shrink-0"
                      style={{ color: "var(--color-accent)" }}
                      aria-hidden="true"
                    />
                    Applied
                  </span>
                )}
                {compareMode && (
                  <Button size="sm" onClick={handleToggleCompareMode}>
                    Close Comparison
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setActivityPanelOpen(true)}
                >
                  <History size={14} aria-hidden="true" />
                  Activity
                </Button>
                <div ref={actionsMenuRef} className="relative">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-haspopup="menu"
                    aria-expanded={actionsMenuOpen}
                    aria-controls="application-actions-menu"
                    onClick={() => setActionsMenuOpen((open) => !open)}
                  >
                    Actions
                    <ChevronDown size={14} aria-hidden="true" />
                  </Button>
                  {actionsMenuOpen && (
                    <PopoverSurface
                      id="application-actions-menu"
                      className="animate-scaleIn absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border py-1 shadow-[var(--shadow-high)]"
                      style={{
                        maxHeight: "calc(100vh - 200px)",
                        overflowY: "auto",
                      }}
                      role="menu"
                      aria-label="Application actions"
                    >
                      {detail.job_url && (
                        <a
                          href={detail.job_url}
                          target="_blank"
                          rel="noreferrer"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors hover:bg-[var(--color-background-muted)]"
                          style={{ color: "var(--color-text-primary)" }}
                          onClick={() => setActionsMenuOpen(false)}
                        >
                          <ExternalLink
                            size={16}
                            className="shrink-0"
                            style={{ color: "var(--color-accent)" }}
                            aria-hidden="true"
                          />
                          <span>View Posting</span>
                        </a>
                      )}
                      <Button
                        variant="ghost"
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors"
                        onClick={() => {
                          setActionsMenuOpen(false);
                          handleAppliedButtonClick();
                        }}
                      >
                        {detail.applied ? (
                          <>
                            <X
                              size={16}
                              className="shrink-0"
                              style={{ color: "var(--color-error)" }}
                              aria-hidden="true"
                            />
                            <span>Mark unapplied instead</span>
                          </>
                        ) : (
                          <>
                            <Check
                              size={16}
                              className="shrink-0"
                              style={{
                                color: "var(--color-text-disabled)",
                                opacity: 0.3,
                              }}
                              aria-hidden="true"
                            />
                            <span>Mark Applied</span>
                          </>
                        )}
                      </Button>
                      {draft && (
                        <div
                          className="my-1 border-t"
                          style={{ borderColor: "var(--color-border)" }}
                        />
                      )}
                      {draft && (
                        <Button
                          variant="ghost"
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={
                            exportingFormat !== null ||
                            isRegenerating ||
                            generationActive
                          }
                          onClick={() => void handleExport("pdf")}
                        >
                          <FileDown
                            size={16}
                            className="shrink-0"
                            style={{ color: "var(--color-text-secondary)" }}
                            aria-hidden="true"
                          />
                          <span>
                            {exportingFormat === "pdf"
                              ? "Exporting PDF…"
                              : "Export PDF"}
                          </span>
                        </Button>
                      )}
                      {draft && (
                        <Button
                          variant="ghost"
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={
                            exportingFormat !== null ||
                            isRegenerating ||
                            generationActive
                          }
                          onClick={() => void handleExport("docx")}
                        >
                          <FileDown
                            size={16}
                            className="shrink-0"
                            style={{ color: "var(--color-text-secondary)" }}
                            aria-hidden="true"
                          />
                          <span>
                            {exportingFormat === "docx"
                              ? "Exporting DOCX…"
                              : "Export DOCX"}
                          </span>
                        </Button>
                      )}
                      {draft && (
                        <Button
                          variant="ghost"
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={
                            isRegenerating ||
                            exportingFormat !== null ||
                            generationActive
                          }
                          onClick={() => {
                            setActionsMenuOpen(false);
                            handleToggleCompareMode();
                          }}
                        >
                          <Columns
                            size={16}
                            className="shrink-0"
                            style={{ color: "var(--color-text-secondary)" }}
                            aria-hidden="true"
                          />
                          <span>
                            {compareMode ? "Close comparison" : "Compare"}
                          </span>
                        </Button>
                      )}
                      {draft && !generationActive && (
                        <Button
                          variant="ghost"
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={isRegenerating || exportingFormat !== null}
                          onClick={() => {
                            setActionsMenuOpen(false);
                            setRegenEntryId(undefined);
                            setRegenSectionName("");
                            setShowSectionRegen(true);
                          }}
                        >
                          <Sparkles
                            size={16}
                            className="shrink-0"
                            style={{ color: "var(--color-text-secondary)" }}
                            aria-hidden="true"
                          />
                          <span>Regen Section</span>
                        </Button>
                      )}
                      {draft && !generationActive && (
                        <Button
                          variant="ghost"
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={isRegenerating || exportingFormat !== null}
                          onClick={() => {
                            setActionsMenuOpen(false);
                            setFullRegenInstructions("");
                            setFullRegenUseLatestBase(false);
                            setShowFullRegenConfirm(true);
                          }}
                        >
                          <RefreshCw
                            size={16}
                            className={`shrink-0 ${isRegenerating ? "animate-spin" : ""}`}
                            style={{ color: "var(--color-text-secondary)" }}
                            aria-hidden="true"
                          />
                          <span>
                            {isRegenerating ? "Starting…" : "Full Regen"}
                          </span>
                        </Button>
                      )}
                    </PopoverSurface>
                  )}
                </div>
                {extractionActive ? (
                  <IconButton
                    variant="danger"
                    aria-label="Stop extraction"
                    title="Stop extraction"
                    disabled={isCancellingExtraction}
                    onClick={() => setShowCancelExtractionConfirm(true)}
                  >
                    <CircleStop size={16} aria-hidden="true" />
                  </IconButton>
                ) : (
                  <IconButton
                    variant="danger"
                    aria-label={
                      deleteBlocked
                        ? "Delete unavailable while background work is still running"
                        : "Delete application"
                    }
                    title={
                      deleteBlocked
                        ? "Delete unavailable while background work is still running."
                        : "Delete application"
                    }
                    disabled={deleteBlocked || isDeleting}
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </IconButton>
                )}
              </div>
            }
          />

          {/* ── Alert Banners (full width, above two-column layout) ── */}

          {/* Extraction Progress */}
          {progress &&
            ["extraction_pending", "extracting"].includes(
              detail.internal_state,
            ) && (
              <Section variant="success" density="compact" className="p-4">
                <h3
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--color-accent)" }}
                >
                  Extraction Progress
                </h3>
                <div
                  className="mt-3 h-2 overflow-hidden rounded-full"
                  style={{ background: "var(--color-accent-muted)" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${extractionPercent}%`,
                      background: "var(--color-accent)",
                    }}
                  />
                </div>
                <p
                  className="mt-2 text-sm"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {progress.message}
                </p>
              </Section>
            )}

          {/* Blocked Source */}
          {detail.extraction_failure_details?.kind === "blocked_source" && (
            <Section variant="danger" density="compact" className="p-4">
              <h3
                className="text-sm font-semibold"
                style={{ color: "var(--color-error)" }}
              >
                Blocked Source
              </h3>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                The job site blocked automated retrieval. Use pasted text or
                manual entry below.
              </p>
              <div
                className="mt-3 grid gap-2 border-l p-3 text-xs sm:grid-cols-2"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-secondary)",
                }}
              >
                <div>
                  <span
                    className="font-semibold"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Provider:
                  </span>{" "}
                  {detail.extraction_failure_details.provider ?? "Unknown"}
                </div>
                <div>
                  <span
                    className="font-semibold"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Ref ID:
                  </span>{" "}
                  {detail.extraction_failure_details.reference_id ?? "N/A"}
                </div>
                <div className="sm:col-span-2 break-all">
                  <span
                    className="font-semibold"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    URL:
                  </span>{" "}
                  {detail.extraction_failure_details.blocked_url ??
                    detail.job_url ??
                    "Not provided"}
                </div>
              </div>
            </Section>
          )}

          {detail.extraction_failure_details?.kind === "user_cancelled" && (
            <Section variant="warning" density="compact" className="p-4">
              <h3
                className="text-sm font-semibold"
                style={{ color: "var(--color-warning)" }}
              >
                Extraction Stopped
              </h3>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Extraction was stopped. Retry from the URL, retry with pasted
                text, or delete this application.
              </p>
            </Section>
          )}

          {/* Duplicate Warning */}
          {detail.duplicate_warning && (
            <Section variant="warning" density="compact" className="p-4">
              <h3
                className="text-sm font-semibold"
                style={{ color: "var(--color-warning)" }}
              >
                Duplicate Detected
              </h3>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Confidence{" "}
                {detail.duplicate_warning.similarity_score.toFixed(2)} based on{" "}
                {detail.duplicate_warning.matched_fields.join(", ")}.
              </p>
              <div
                className="mt-2 border-l p-3 text-sm"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div
                  className="font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {detail.duplicate_warning.matched_application.job_title ??
                    "Existing application"}
                </div>
                <div
                  className="text-xs"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {detail.duplicate_warning.matched_application.company ??
                    "Unknown"}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void handleDuplicateDismissal()}
                >
                  Proceed Anyway
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleOpenExistingApplication()}
                >
                  Open Existing
                </Button>
              </div>
            </Section>
          )}

          {/* Company Missing Warning */}
          {!detail.company &&
            detail.internal_state === "generation_pending" &&
            !detail.failure_reason && (
              <Section variant="success" density="compact" className="p-4">
                <p
                  className="text-sm font-medium"
                  style={{ color: "var(--color-accent)" }}
                >
                  Company is missing from extraction. Add it to enable duplicate
                  review.
                </p>
              </Section>
            )}

          {sourceLimitedLengthFlag &&
            detail.internal_state === "resume_ready" && (
              <Section variant="warning" density="compact" className="p-4">
                <h3
                  className="text-sm font-semibold"
                  style={{ color: "var(--color-warning)" }}
                >
                  Shorter Than Target
                </h3>
                <p
                  className="mt-1 text-sm"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {sourceLimitedLengthFlag.text}
                </p>
              </Section>
            )}

          {/* Generation Timeout */}
          {detail.failure_reason === "generation_timeout" && (
            <Section variant="warning" density="compact" className="p-4">
              <h3
                className="text-sm font-semibold"
                style={{ color: "var(--color-warning)" }}
              >
                Generation Timed Out
              </h3>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {detail.generation_failure_details?.message ??
                  "The AI provider may be experiencing delays."}
              </p>
              <GenerationFailureDiagnostics
                details={detail.generation_failure_details}
              />
              <Button
                className="mt-3"
                size="sm"
                onClick={() => void handleTriggerGeneration()}
              >
                Retry
              </Button>
            </Section>
          )}

          {/* Generation Cancelled */}
          {detail.failure_reason === "generation_cancelled" && (
            <Section variant="success" density="compact" className="p-4">
              <h3
                className="text-sm font-semibold"
                style={{ color: "var(--color-accent)" }}
              >
                Generation Cancelled
              </h3>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {detail.generation_failure_details?.message ??
                  "You can adjust settings and try again."}
              </p>
              <Button
                className="mt-3"
                size="sm"
                onClick={() => void handleTriggerGeneration()}
              >
                Retry
              </Button>
            </Section>
          )}

          {/* Generation Failed */}
          {(detail.failure_reason === "generation_failed" ||
            detail.failure_reason === "regeneration_failed") && (
            <Section variant="danger" density="compact" className="p-4">
              <h3
                className="text-sm font-semibold"
                style={{ color: "var(--color-error)" }}
              >
                Generation Failed
              </h3>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {detail.generation_failure_details?.message ??
                  "Resume generation encountered errors."}
              </p>
              {detail.generation_failure_details?.validation_errors?.length ? (
                <ul
                  className="mt-2 list-disc space-y-1 pl-5 text-xs"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {detail.generation_failure_details.validation_errors.map(
                    (err, i) => (
                      <li key={i}>{err}</li>
                    ),
                  )}
                </ul>
              ) : null}
              <GenerationFailureDiagnostics
                details={detail.generation_failure_details}
                showAttempts
              />
              <Button
                className="mt-3"
                size="sm"
                disabled={isGenerating || !selectedResumeId}
                onClick={() => void handleTriggerGeneration()}
              >
                {isGenerating ? "Starting…" : "Retry"}
              </Button>
            </Section>
          )}

          {/* ── Manual Entry Required (shown when in manual_entry_required state, replaces two-column) ── */}
          {detail.internal_state === "manual_entry_required" && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] 2xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)]">
              {/* Job Information */}
              <Section density="compact" className="p-4">
                <h3
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Job Information
                </h3>
                <form className="mt-3 space-y-3" onSubmit={handleSaveJobInfo}>
                  <JobInformationFields form={jobForm} setForm={setJobForm} />
                  <div className="flex gap-2">
                    <Button
                      loading={isSavingJobInfo}
                      disabled={isSavingJobInfo}
                      type="submit"
                    >
                      {isSavingJobInfo ? "Saving…" : "Save"}
                    </Button>
                    {detail.job_url && (
                      <Button
                        type="button"
                        variant="secondary"
                        loading={isRetryingExtraction}
                        disabled={isRetryingExtraction}
                        onClick={() => void handleRetryExtraction()}
                      >
                        Retry Extraction
                      </Button>
                    )}
                  </div>
                </form>
              </Section>

              {/* Notes + Manual Entry */}
              <div className="space-y-4">
                <NotesCard
                  value={notesDraft}
                  state={notesState}
                  onChange={(value) => {
                    setNotesDraft(value);
                    setNotesState("idle");
                  }}
                />

                <Section variant="danger" density="compact" className="p-4">
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: "var(--color-error)" }}
                  >
                    Manual Entry Required
                  </h3>
                  <p
                    className="mt-1 text-sm"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {detail.extraction_failure_details?.kind ===
                    "blocked_source"
                      ? "Source blocked. Paste text or enter details manually."
                      : detail.extraction_failure_details?.kind ===
                          "user_cancelled"
                        ? "Extraction was stopped. Retry with text, retry the URL, or delete this application."
                        : "Extraction incomplete. Paste text or fill in details."}
                  </p>
                  <form
                    className="mt-3 space-y-3"
                    onSubmit={handleRecoverFromSource}
                  >
                    <Textarea
                      className="min-h-24"
                      placeholder="Paste job posting text to retry extraction…"
                      value={sourceTextDraft}
                      onChange={(e) => setSourceTextDraft(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        loading={isRecoveringFromSource}
                        disabled={
                          isRecoveringFromSource || !sourceTextDraft.trim()
                        }
                        type="submit"
                      >
                        Retry with Text
                      </Button>
                      {detail.job_url && (
                        <Button
                          type="button"
                          variant="secondary"
                          loading={isRetryingExtraction}
                          disabled={isRetryingExtraction}
                          onClick={() => void handleRetryExtraction()}
                        >
                          Retry URL
                        </Button>
                      )}
                    </div>
                  </form>
                  <form
                    className="mt-4 space-y-3 border-t pt-4"
                    style={{ borderColor: "var(--color-border)" }}
                    onSubmit={handleManualEntrySubmit}
                  >
                    <Label>Or submit manually</Label>
                    <Input
                      placeholder="Job title"
                      value={jobForm.job_title}
                      onChange={(e) =>
                        setJobForm((c) => ({ ...c, job_title: e.target.value }))
                      }
                      required
                    />
                    <Input
                      placeholder="Company"
                      value={jobForm.company}
                      onChange={(e) =>
                        setJobForm((c) => ({ ...c, company: e.target.value }))
                      }
                      required
                    />
                    <Textarea
                      className="min-h-24"
                      placeholder="Job description"
                      value={jobForm.job_description}
                      onChange={(e) =>
                        setJobForm((c) => ({
                          ...c,
                          job_description: e.target.value,
                        }))
                      }
                      required
                    />
                    <Button
                      loading={isSubmittingManualEntry}
                      disabled={isSubmittingManualEntry}
                      type="submit"
                    >
                      {isSubmittingManualEntry
                        ? "Saving…"
                        : "Submit Manual Entry"}
                    </Button>
                  </form>
                </Section>
              </div>
            </div>
          )}

          {/* ── Two-Column Layout (when past extraction and not in manual_entry_required) ── */}
          {isPastExtraction &&
            detail.internal_state !== "manual_entry_required" && (
              <div
                className={
                  compareMode
                    ? "space-y-4"
                    : "application-workspace grid gap-4 xl:items-start xl:[grid-template-columns:minmax(0,1fr)_minmax(300px,340px)]"
                }
                data-compare-mode={compareMode ? "open" : "closed"}
              >
                {/* Resume tabs and content occupy the left side of the workspace. */}
                <div
                  className={
                    compareMode
                      ? "min-w-0"
                      : "application-resume-column min-w-0"
                  }
                >
                  {/* Resume Content Area */}
                  {generationActive || showOptimisticProgress ? (
                    <div
                      className="application-resume-placeholder min-h-0 overflow-y-auto"
                      aria-label="Resume generation workspace"
                    >
                      <GenerationProgress
                        progress={generationProgress}
                        isOptimistic={showOptimisticProgress}
                        isActive={generationActive}
                        isCancelling={isCancelling}
                        onCancel={() => void handleCancelGeneration()}
                      />
                      {draft &&
                        renderGeneratedWorkspacePane({
                          lockInteractions: true,
                        })}
                    </div>
                  ) : draft ? (
                    compareMode ? (
                      <CompareWorkspace
                        baseResume={compareBaseline}
                        draft={draft}
                        editMode={editMode}
                        editContent={editContent}
                        isSavingDraft={isSavingDraft}
                        onEnterEdit={() => setCompareMode(false)}
                        onCancelEdit={handleCancelEdit}
                        onContentChange={setEditContent}
                        onSaveDraft={() => void handleSaveDraft()}
                        onCloseCompare={handleToggleCompareMode}
                        onExportPdf={() => void handleExport("pdf")}
                        isExporting={exportingFormat === "pdf"}
                        pageLength={pageLength}
                        aggressiveness={aggressiveness}
                      />
                    ) : (
                      renderGeneratedWorkspacePane()
                    )
                  ) : (
                    /* Empty State - No resume generated yet */
                    <Section
                      className={`${workspaceRegionClass} application-resume-placeholder items-center justify-center p-8 text-center`}
                    >
                      <div
                        className="rounded-full p-4 mb-4"
                        style={{ background: "var(--color-background-muted)" }}
                      >
                        <FileText
                          size={32}
                          style={{ color: "var(--color-text-secondary)" }}
                        />
                      </div>
                      <h3
                        className="text-lg font-semibold mb-2"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        No Resume Generated Yet
                      </h3>
                      <p
                        className="text-sm mb-4"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        Configure your settings and click "Generate Resume" to
                        get started.
                      </p>
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={generationStartBlocker !== null}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void handleTriggerGeneration()}
                      >
                        <Sparkles size={16} />
                        Generate Resume
                      </Button>
                      {generationStartBlocker ? (
                        <p
                          className="mt-3 text-xs"
                          style={{ color: "var(--color-text-secondary)" }}
                        >
                          {generationStartBlocker}
                        </p>
                      ) : null}
                    </Section>
                  )}
                </div>
                {/* Supporting panels follow the resume and sit on its right on desktop. */}
                <aside
                  aria-label="Application details"
                  tabIndex={compareMode ? -1 : 0}
                  className={
                    compareMode
                      ? "hidden"
                      : "application-support-column min-w-0 space-y-4"
                  }
                  aria-hidden={compareMode}
                >
                  {renderResumeJudgeCard()}
                  {renderKeywordCard()}

                  {/* Job Description */}
                  <Section
                    density="compact"
                    className="p-4"
                    data-testid="job-description-card"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5">
                        <h3
                          className="text-xs font-semibold uppercase tracking-wider"
                          style={{ color: "var(--color-text-secondary)" }}
                        >
                          Job Description
                        </h3>
                        <Button
                          variant="ghost"
                          type="button"
                          className="sm:hidden p-0.5"
                          onClick={() => setJobDescriptionCollapsed((v) => !v)}
                          aria-label={
                            jobDescriptionCollapsed
                              ? "Expand job description"
                              : "Collapse job description"
                          }
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            className="transition-transform"
                            style={{
                              transform: jobDescriptionCollapsed
                                ? "rotate(0deg)"
                                : "rotate(180deg)",
                            }}
                          >
                            <path
                              d="M3 5l4 4 4-4"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </Button>
                      </div>
                      <form onSubmit={handleSaveJobInfo}>
                        <Button
                          size="sm"
                          loading={isSavingJobInfo}
                          disabled={isSavingJobInfo || !jobFormDirty}
                          type="submit"
                          className={
                            !jobFormDirty ? "opacity-50 cursor-not-allowed" : ""
                          }
                        >
                          {isSavingJobInfo ? "Saving…" : "Save"}
                        </Button>
                      </form>
                    </div>
                    {!jobDescriptionCollapsed && (
                      <div className="mt-3 space-y-2.5">
                        <JobInformationFields
                          form={jobForm}
                          setForm={setJobForm}
                          compact
                        />
                      </div>
                    )}
                  </Section>

                  {/* Generation Settings Card */}
                  {detail.internal_state !== "duplicate_review_required" && (
                    <Section density="compact" className="p-4">
                      <form className="space-y-3" onSubmit={handleSaveSettings}>
                        <div className="flex items-start justify-between gap-3">
                          <h3
                            className="text-xs font-semibold uppercase tracking-wider"
                            style={{ color: "var(--color-text-secondary)" }}
                          >
                            Generation Settings
                          </h3>
                          <Button
                            size="sm"
                            disabled={
                              isSavingSettings ||
                              !selectedResumeId ||
                              baseResumes.length === 0 ||
                              !settingsDirty
                            }
                            type="submit"
                            className={
                              !settingsDirty
                                ? "opacity-50 cursor-not-allowed"
                                : ""
                            }
                          >
                            {isSavingSettings ? "Saving…" : "Save"}
                          </Button>
                        </div>

                        {/* Base Resume */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-1">
                            <FileText
                              size={14}
                              className="flex-shrink-0"
                              style={{ color: "var(--color-text-secondary)" }}
                            />
                            <Label className="inline text-xs font-medium">
                              Base Resume
                            </Label>
                          </div>
                          {baseResumes.length === 0 ? (
                            <div
                              className="border-l p-2 text-xs"
                              style={{
                                borderColor: "var(--color-border)",
                                color: "var(--color-text-secondary)",
                              }}
                            >
                              No base resumes yet.{" "}
                              <Link
                                className="font-medium"
                                style={{ color: "var(--color-accent)" }}
                                to="/app/resumes"
                              >
                                Create one
                              </Link>
                            </div>
                          ) : (
                            <Select
                              className="text-sm"
                              value={selectedResumeId ?? ""}
                              onChange={(e) =>
                                setSelectedResumeId(e.target.value || null)
                              }
                            >
                              <option value="">Select a base resume</option>
                              {baseResumes.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                  {r.is_default ? " (default)" : ""}
                                </option>
                              ))}
                            </Select>
                          )}
                        </div>

                        {/* Target Length */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-1">
                            <Ruler
                              size={14}
                              className="flex-shrink-0"
                              style={{ color: "var(--color-text-secondary)" }}
                            />
                            <Label className="inline text-xs font-medium">
                              Target Length
                            </Label>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {PAGE_LENGTH_OPTIONS.map((o) => (
                              <label
                                key={o.value}
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors"
                                style={{
                                  borderColor:
                                    pageLength === o.value
                                      ? "var(--color-accent)"
                                      : "var(--color-border)",
                                  background:
                                    pageLength === o.value
                                      ? "var(--color-accent-muted)"
                                      : "var(--color-background-surface)",
                                  color:
                                    pageLength === o.value
                                      ? "var(--color-accent)"
                                      : "var(--color-text-primary)",
                                }}
                              >
                                <Input
                                  checked={pageLength === o.value}
                                  className="sr-only"
                                  name="pageLength"
                                  type="radio"
                                  value={o.value}
                                  onChange={() => {
                                    setPageLength(o.value);
                                    setHasUserModifiedSettings(true);
                                  }}
                                />
                                {o.label}
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Aggressiveness */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-1">
                            <Gauge
                              size={14}
                              className="flex-shrink-0"
                              style={{ color: "var(--color-text-secondary)" }}
                            />
                            <Label className="inline text-xs font-medium">
                              Aggressiveness
                            </Label>
                          </div>
                          <div className="space-y-1.5">
                            {AGGRESSIVENESS_OPTIONS.map((o) => (
                              <label
                                key={o.value}
                                className="cursor-pointer rounded-md border p-2 transition-colors block"
                                style={{
                                  borderColor:
                                    aggressiveness === o.value
                                      ? "var(--color-accent)"
                                      : "var(--color-border)",
                                  background:
                                    aggressiveness === o.value
                                      ? "var(--color-accent-muted)"
                                      : "var(--color-background-surface)",
                                }}
                              >
                                <Input
                                  checked={aggressiveness === o.value}
                                  className="sr-only"
                                  name="aggressiveness"
                                  type="radio"
                                  value={o.value}
                                  onChange={() => {
                                    setAggressiveness(o.value);
                                    setHasUserModifiedSettings(true);
                                  }}
                                />
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div
                                      className="text-xs font-medium"
                                      style={{
                                        color: "var(--color-text-primary)",
                                      }}
                                    >
                                      {o.label}
                                    </div>
                                    <div
                                      className="text-[10px]"
                                      style={{
                                        color: "var(--color-text-secondary)",
                                      }}
                                    >
                                      {o.description}
                                    </div>
                                  </div>
                                  <div className="shrink-0">
                                    <InfoPopover
                                      label={`${o.label} aggressiveness details`}
                                    >
                                      <div className="space-y-2">
                                        <p
                                          className="text-xs font-semibold"
                                          style={{
                                            color: "var(--color-text-primary)",
                                          }}
                                        >
                                          {o.label} affects:
                                        </p>
                                        <ul
                                          className="space-y-1 text-[11px]"
                                          style={{
                                            color:
                                              "var(--color-text-secondary)",
                                          }}
                                        >
                                          {o.details.map((detailLine) => (
                                            <li key={detailLine}>
                                              {detailLine}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    </InfoPopover>
                                  </div>
                                </div>
                              </label>
                            ))}
                          </div>
                          {selectedAggressivenessOption?.warning ? (
                            <div
                              role="alert"
                              className="mt-2 rounded-md border px-3 py-2 text-[11px]"
                              style={{
                                borderColor: "var(--color-warning)",
                                background: "var(--color-warning-muted)",
                                color: "var(--color-text-primary)",
                              }}
                            >
                              {selectedAggressivenessOption.warning}
                            </div>
                          ) : null}
                        </div>

                        {/* Additional Instructions */}
                        <div>
                          <div className="flex items-center gap-1.5 mb-1">
                            <MessageSquare
                              size={14}
                              className="flex-shrink-0"
                              style={{ color: "var(--color-text-secondary)" }}
                            />
                            <Label className="inline text-xs font-medium">
                              Additional Instructions
                            </Label>
                          </div>
                          <Textarea
                            className="text-sm min-h-16"
                            placeholder="e.g., emphasize API architecture…"
                            value={additionalInstructions}
                            onChange={(e) => {
                              setAdditionalInstructions(e.target.value);
                              setHasUserModifiedSettings(true);
                            }}
                          />
                        </div>
                      </form>
                    </Section>
                  )}

                  {/* Notes Card */}
                  <NotesCard
                    compact
                    value={notesDraft}
                    state={notesState}
                    onChange={(value) => {
                      setNotesDraft(value);
                      setNotesState("idle");
                    }}
                  />
                </aside>
              </div>
            )}

          {/* Confirmation modal for marking as applied */}
          <ConfirmModal
            open={showAppliedConfirm}
            title="Mark as Applied?"
            message="This will mark the application as submitted. You can always change this later."
            confirmLabel="Yes, Mark Applied"
            onConfirm={() => {
              void handleAppliedToggle(true);
              setShowAppliedConfirm(false);
            }}
            onCancel={() => setShowAppliedConfirm(false)}
          />

          <ConfirmModal
            open={showDeleteConfirm}
            title="Delete application?"
            message="This will permanently remove this application and its current draft. This action cannot be undone."
            confirmLabel="Delete Application"
            variant="danger"
            loading={isDeleting}
            onConfirm={() => {
              void handleDeleteApplication();
            }}
            onCancel={() => {
              if (!isDeleting) {
                setShowDeleteConfirm(false);
              }
            }}
          />

          <ConfirmModal
            open={showCancelExtractionConfirm}
            title="Stop extraction?"
            message="This will stop the active extraction and move the application into manual recovery so it can be retried or deleted."
            confirmLabel="Stop Extraction"
            variant="danger"
            loading={isCancellingExtraction}
            onConfirm={() => {
              void handleCancelExtraction();
            }}
            onCancel={() => {
              if (!isCancellingExtraction) {
                setShowCancelExtractionConfirm(false);
              }
            }}
          />

          <ConfirmModal
            open={showFullRegenConfirm}
            title="Fully Regenerate Resume?"
            message={
              <div className="flex flex-col gap-3">
                <p style={{ margin: 0 }}>
                  Regenerate source-backed sections using your saved section
                  inclusion, order and headings. Fixed sections and sections
                  with added or reordered entries keep their current content.
                  This may take up to four minutes.
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <Input
                    type="checkbox"
                    className="mt-1"
                    checked={fullRegenUseLatestBase}
                    onChange={(event) =>
                      setFullRegenUseLatestBase(event.target.checked)
                    }
                  />
                  <span>
                    Use latest base resume. Replace draft content and layout
                    with the linked base's reviewed sections. This also
                    refreshes source links for comparison and future
                    regeneration.
                  </span>
                </label>
                {(!draft?.document || !draft?.source_snapshot) && (
                  <p className="text-xs">
                    This legacy draft has no frozen source links. Select Use
                    latest base resume to replace it. The existing draft stays
                    available if generation fails.
                  </p>
                )}
                <div className="flex flex-col gap-1.5 mt-2">
                  <label
                    htmlFor="full-regen-instr"
                    className="text-xs font-semibold"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    Custom Instructions (Optional)
                  </label>
                  <Textarea
                    id="full-regen-instr"
                    className="text-sm min-h-[80px] w-full"
                    placeholder="e.g., Highlight my cloud computing skills, or keep the focus on senior leadership experience."
                    value={fullRegenInstructions}
                    onChange={(e) => setFullRegenInstructions(e.target.value)}
                  />
                </div>
              </div>
            }
            confirmLabel={isRegenerating ? "Regenerating..." : "Regenerate"}
            loading={isRegenerating}
            onConfirm={async () => {
              const started = await handleFullRegeneration(
                fullRegenInstructions || undefined,
                undefined,
                fullRegenUseLatestBase,
              );
              if (started) {
                setShowFullRegenConfirm(false);
                setFullRegenInstructions("");
                setFullRegenUseLatestBase(false);
              }
            }}
            onCancel={() => {
              if (!isRegenerating) {
                setShowFullRegenConfirm(false);
                setFullRegenInstructions("");
                setFullRegenUseLatestBase(false);
              }
            }}
          />

          {/* Section Regeneration Modal */}
          {showSectionRegen &&
            createPortal(
              <div
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  zIndex: 99999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* Backdrop */}
                <div
                  onClick={() => {
                    setShowSectionRegen(false);
                    setRegenSectionName("");
                    setRegenInstructions("");
                  }}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    background: "var(--color-overlay)",
                    backdropFilter: "blur(6px)",
                    animation: "fadeIn 200ms var(--ease-out) both",
                  }}
                />

                {/* Dialog */}
                <div
                  className="animate-scaleIn"
                  style={{
                    position: "relative",
                    zIndex: 1,
                    background: "var(--color-background-surface)",
                    borderRadius: "var(--radius-container)",
                    boxShadow: "var(--shadow-high)",
                    padding: "24px",
                    maxWidth: "440px",
                    width: "calc(100% - 48px)",
                  }}
                >
                  <h3
                    style={{
                      fontSize: "17px",
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                      margin: 0,
                      lineHeight: 1.3,
                    }}
                  >
                    Regenerate a Section
                  </h3>
                  <p
                    style={{
                      marginTop: "8px",
                      fontSize: "14px",
                      color: "var(--color-text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {regenEntryId
                      ? "Only this role will be regenerated. Other roles and sections stay as they are."
                      : "Select a section and describe how you want to improve it."}
                  </p>

                  <div className="mt-4 space-y-3">
                    <div>
                      <Label
                        className="text-xs font-medium"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        Section
                      </Label>
                      <Select
                        className="mt-1 text-sm"
                        value={regenSectionName}
                        onChange={(e) => {
                          setRegenSectionName(e.target.value);
                          setRegenEntryId(undefined);
                        }}
                      >
                        <option value="">Select section…</option>
                        {draft?.document ? (
                          draft.document.sections
                            .filter((section) => section.enabled)
                            .map((section) => (
                              <option
                                key={section.id}
                                value={section.id}
                                disabled={Boolean(
                                  sectionRegenerationReason(
                                    section,
                                    section.id === regenSectionName
                                      ? regenEntryId
                                      : undefined,
                                  ),
                                )}
                              >
                                {section.heading}
                              </option>
                            ))
                        ) : (
                          <>
                            <option value="summary">Summary</option>
                            <option value="professional_experience">
                              Professional Experience
                            </option>
                            <option value="education">Education</option>
                            <option value="skills">Skills</option>
                            <option value="projects">Projects</option>
                            <option value="certifications">
                              Certifications
                            </option>
                          </>
                        )}
                      </Select>
                      {sectionSourceBlocker && (
                        <p
                          className="mt-2 text-xs"
                          style={{ color: "var(--color-text-secondary)" }}
                        >
                          {sectionSourceBlocker}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label
                        className="text-xs font-medium"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        Instructions
                      </Label>
                      <Textarea
                        className="mt-1 text-sm min-h-16"
                        placeholder="Instructions for regenerating (required)…"
                        value={regenInstructions}
                        onChange={(e) => setRegenInstructions(e.target.value)}
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "10px",
                      marginTop: "20px",
                    }}
                  >
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setShowSectionRegen(false);
                        setRegenSectionName("");
                        setRegenEntryId(undefined);
                        setRegenInstructions("");
                      }}
                      disabled={isRegenerating}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={
                        isRegenerating ||
                        Boolean(sectionRegenerationBlocker) ||
                        !regenSectionName ||
                        !regenInstructions.trim()
                      }
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void handleSectionRegeneration()}
                    >
                      <Sparkles size={14} />
                      {isRegenerating ? "Regenerating…" : "Regenerate"}
                    </Button>
                  </div>
                </div>
              </div>,
              document.body,
            )}

          {renderKeywordDialog()}

          {showResumeJudgeDialog &&
            resumeJudge &&
            resumeJudgeHasCompletedScore &&
            createPortal(
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 100000,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "24px",
                }}
              >
                <div
                  onClick={() => setShowResumeJudgeDialog(false)}
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "var(--color-overlay)",
                    backdropFilter: "blur(8px)",
                    animation: "fadeIn 200ms var(--ease-out) both",
                  }}
                />
                <div
                  className="animate-scaleIn"
                  style={{
                    position: "relative",
                    zIndex: 1,
                    width: "min(920px, 100%)",
                    maxHeight: "calc(100vh - 48px)",
                    overflowY: "auto",
                    borderRadius: "var(--radius-container)",
                    background:
                      "linear-gradient(180deg, color-mix(in srgb, var(--color-text-primary) 2%, white) 0%, white 24%, white 100%)",
                    boxShadow: "var(--shadow-high)",
                    padding: "24px",
                  }}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Resume Judge breakdown"
                >
                  <div
                    className="border-b pb-5"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p
                        className="text-[11px] font-semibold uppercase tracking-[0.24em]"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        Resume Judge
                      </p>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span
                          className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold"
                          style={{
                            background: resumeJudgeStale
                              ? "var(--color-warning-muted)"
                              : resumeJudgeToneStyle.bg,
                            color: resumeJudgeStale
                              ? "var(--color-warning)"
                              : resumeJudgeToneStyle.accent,
                          }}
                        >
                          {resumeJudge.display_score ?? "—"}/100
                        </span>
                        <Button
                          variant="ghost"
                          type="button"
                          className="px-3 py-1.5 text-sm transition-colors"
                          onClick={() => setShowResumeJudgeDialog(false)}
                        >
                          Close
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 min-w-0">
                      <p
                        className="text-xs font-semibold uppercase tracking-[0.16em]"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        Summary
                      </p>
                      <p
                        className="mt-2 text-[15px] leading-6"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {resumeJudge.score_summary ?? "Resume score breakdown"}
                      </p>
                    </div>
                    <div
                      className="mt-3 flex flex-wrap items-center gap-2 text-xs"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      <span
                        className="rounded-full px-2.5 py-1 font-semibold uppercase tracking-wide"
                        style={{
                          background: resumeJudgeStale
                            ? "var(--color-warning-muted)"
                            : resumeJudgeToneStyle.bg,
                          color: resumeJudgeStale
                            ? "var(--color-warning)"
                            : resumeJudgeToneStyle.accent,
                        }}
                      >
                        {resumeJudgeStale
                          ? "Stale"
                          : resumeJudgeVerdictLabel(resumeJudge.verdict)}
                      </span>
                      <span>
                        Pass threshold: {resumeJudge.pass_threshold ?? 80}
                      </span>
                      {resumeJudge.scored_at ? (
                        <span>
                          Scored{" "}
                          {new Date(resumeJudge.scored_at).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                    <p
                      className="mt-3 text-xs leading-5"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {resumeJudgeStale
                        ? "This score was calculated for an older draft. Re-evaluate after reviewing the breakdown."
                        : `Verdict: ${resumeJudgeVerdictLabel(resumeJudge.verdict)} at ${resumeJudge.final_score?.toFixed(1) ?? "0.0"} / 100.`}
                    </p>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                    <div className="space-y-3">
                      {resumeJudgeDimensionEntries.map(([key, value]) => {
                        const expanded = expandedResumeJudgeDimension === key;
                        return (
                          <div
                            key={key}
                            className="overflow-hidden rounded-[var(--radius-container)] border"
                            style={{
                              borderColor: expanded
                                ? resumeJudgeToneStyle.border
                                : "var(--color-border)",
                              background: "var(--color-background-surface)",
                            }}
                          >
                            <Button
                              variant="ghost"
                              type="button"
                              className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left"
                              aria-expanded={expanded}
                              aria-controls={`resume-judge-dimension-${key}`}
                              onClick={() =>
                                setExpandedResumeJudgeDimension((current) =>
                                  current === key ? null : key,
                                )
                              }
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p
                                    className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                                    style={{
                                      color: "var(--color-text-secondary)",
                                    }}
                                  >
                                    {RESUME_JUDGE_DIMENSION_LABELS[key] ?? key}
                                  </p>
                                  {(
                                    resumeJudge.regeneration_priority_dimensions ??
                                    []
                                  ).includes(key) ? (
                                    <span
                                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                                      style={{
                                        background: "var(--color-error-muted)",
                                        color: "var(--color-error)",
                                      }}
                                    >
                                      Priority
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                                  <div>
                                    <div
                                      style={{
                                        color: "var(--color-text-secondary)",
                                      }}
                                    >
                                      Score
                                    </div>
                                    <div
                                      className="mt-1 font-semibold"
                                      style={{
                                        color: "var(--color-text-primary)",
                                      }}
                                    >
                                      {value.score.toFixed(1)} / 10
                                    </div>
                                  </div>
                                  <div>
                                    <div
                                      style={{
                                        color: "var(--color-text-secondary)",
                                      }}
                                    >
                                      Weight
                                    </div>
                                    <div
                                      className="mt-1 font-semibold"
                                      style={{
                                        color: "var(--color-text-primary)",
                                      }}
                                    >
                                      {(value.weight * 100).toFixed(0)}%
                                    </div>
                                  </div>
                                  <div>
                                    <div
                                      style={{
                                        color: "var(--color-text-secondary)",
                                      }}
                                    >
                                      Weighted impact
                                    </div>
                                    <div
                                      className="mt-1 font-semibold"
                                      style={{
                                        color: "var(--color-text-primary)",
                                      }}
                                    >
                                      {value.weighted_contribution.toFixed(1)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <ChevronDown
                                size={18}
                                aria-hidden="true"
                                className="mt-1 shrink-0 transition-transform"
                                style={{
                                  color: "var(--color-text-secondary)",
                                  transform: expanded
                                    ? "rotate(180deg)"
                                    : "rotate(0deg)",
                                }}
                              />
                            </Button>
                            {expanded ? (
                              <div
                                id={`resume-judge-dimension-${key}`}
                                className="border-t px-4 py-4 text-xs leading-5"
                                style={{
                                  borderColor: "var(--color-border)",
                                  color: "var(--color-text-secondary)",
                                  background: "var(--color-background-muted)",
                                }}
                              >
                                {value.notes}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-4">
                      <div
                        className="border-t p-4"
                        style={{
                          borderColor: "var(--color-border)",
                          background: "var(--color-background-surface)",
                        }}
                      >
                        <p
                          className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                          style={{ color: "var(--color-text-secondary)" }}
                        >
                          Verdict
                        </p>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span
                            className="text-sm font-semibold"
                            style={{ color: "var(--color-text-primary)" }}
                          >
                            {resumeJudgeStale
                              ? "Out of date"
                              : resumeJudgeVerdictLabel(resumeJudge.verdict)}
                          </span>
                          <span
                            className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                            style={{
                              background: resumeJudgeStale
                                ? "var(--color-warning-muted)"
                                : resumeJudgeToneStyle.bg,
                              color: resumeJudgeStale
                                ? "var(--color-warning)"
                                : resumeJudgeToneStyle.accent,
                            }}
                          >
                            {resumeJudge.verdict ?? "n/a"}
                          </span>
                        </div>
                        {resumeJudge.regeneration_priority_dimensions
                          ?.length ? (
                          <div className="mt-4">
                            <p
                              className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                              style={{ color: "var(--color-text-secondary)" }}
                            >
                              Priority Dimensions
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {resumeJudge.regeneration_priority_dimensions.map(
                                (dimension) => (
                                  <span
                                    key={dimension}
                                    className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                                    style={{
                                      background:
                                        "var(--color-background-muted)",
                                      color: "var(--color-text-secondary)",
                                    }}
                                  >
                                    {RESUME_JUDGE_DIMENSION_LABELS[dimension] ??
                                      dimension}
                                  </span>
                                ),
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {(resumeJudgeStale ||
                        resumeJudge.status === "failed" ||
                        resumeJudge.final_score == null) && (
                        <div
                          className="border-t p-4"
                          style={{
                            borderColor: "var(--color-border)",
                            background: "var(--color-warning-muted)",
                          }}
                        >
                          <p
                            className="text-sm font-semibold"
                            style={{ color: "var(--color-text-primary)" }}
                          >
                            {resumeJudgeStale
                              ? "This score is stale."
                              : "Resume Judge needs another run."}
                          </p>
                          <p
                            className="mt-2 text-xs leading-5"
                            style={{ color: "var(--color-text-secondary)" }}
                          >
                            {resumeJudgeStale
                              ? "You edited the draft after it was scored. Re-evaluate to refresh the breakdown."
                              : (resumeJudge.message ??
                                "Run Resume Judge again to restore the score.")}
                          </p>
                          <Button
                            className="mt-4"
                            size="sm"
                            variant="secondary"
                            disabled={!resumeJudgeCanRun}
                            onClick={() => void handleTriggerResumeJudge()}
                          >
                            {isTriggeringResumeJudge
                              ? "Starting…"
                              : "Re-evaluate"}
                          </Button>
                        </div>
                      )}

                      {resumeJudge.regeneration_instructions ? (
                        <div
                          className="border-t p-4"
                          style={{
                            borderColor: "var(--color-border)",
                            background: "var(--color-background-muted)",
                          }}
                        >
                          <p
                            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                            style={{ color: "var(--color-text-secondary)" }}
                          >
                            Regeneration Instructions
                          </p>
                          <p
                            className="mt-3 text-xs leading-5"
                            style={{ color: "var(--color-text-primary)" }}
                          >
                            {formatJudgeInstructions(
                              resumeJudge.regeneration_instructions,
                            )}
                          </p>
                          {resumeJudgeCanRegenerateWithFeedback ? (
                            <>
                              <p
                                className="mt-3 text-xs"
                                style={{ color: "var(--color-text-secondary)" }}
                              >
                                Full regeneration will keep your current
                                instructions and append the judge’s corrective
                                guidance.
                              </p>
                              <Button
                                variant="ghost"
                                type="button"
                                disabled={Boolean(fullRegenerationBlocker)}
                                className="mt-4 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => {
                                  setShowResumeJudgeDialog(false);
                                  void handleFullRegeneration(
                                    additionalInstructions,
                                    true,
                                  );
                                }}
                              >
                                <Sparkles size={14} />
                                Regenerate with Judge Feedback
                              </Button>
                            </>
                          ) : null}
                          {fullRegenerationBlocker &&
                          resumeJudgeCanRegenerateWithFeedback ? (
                            <p
                              className="mt-2 text-xs"
                              style={{ color: "var(--color-text-secondary)" }}
                            >
                              {fullRegenerationBlocker}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {resumeJudge.evaluator_notes ? (
                        <div
                          className="border-t p-4"
                          style={{
                            borderColor: "var(--color-border)",
                            background: "var(--color-background-surface)",
                          }}
                        >
                          <p
                            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                            style={{ color: "var(--color-text-secondary)" }}
                          >
                            Evaluator Notes
                          </p>
                          <p
                            className="mt-3 text-xs leading-5"
                            style={{ color: "var(--color-text-secondary)" }}
                          >
                            {resumeJudge.evaluator_notes}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>,
              document.body,
            )}

          <ApplicationActivityPanel
            applicationId={activeApplicationId}
            open={activityPanelOpen}
            onClose={() => setActivityPanelOpen(false)}
          />
        </>
      )}
    </div>
  );
}
