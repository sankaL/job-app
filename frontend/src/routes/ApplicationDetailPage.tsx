import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { ChevronDown, CircleStop, FileText, Gauge, History, MessageSquare, Ruler, Sparkles, Trash2, ExternalLink, FileDown, Columns, RefreshCw, Check, X, Target } from "lucide-react";
import { useAppContext } from "@/components/layout/AppContext";
import { useShellLayout } from "@/components/layout/ShellLayoutContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { ApplicationActivityPanel } from "@/components/applications/ApplicationActivityPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { formatJudgeInstructions } from "@/lib/judge-helpers";
import { GenerationProgress, ResumeSkeleton } from "@/components/ui/generation-progress";
import { SkeletonCard } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import {
  cancelExtraction,
  deleteApplication,
  fetchApplicationDetail,
  fetchApplicationProgress,
  fetchBaseResume,
  fetchDraft,
  listBaseResumes,
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
} from "@/lib/api";
import { AGGRESSIVENESS_OPTIONS, jobPostingOriginOptions, PAGE_LENGTH_OPTIONS } from "@/lib/application-options";
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
  const setField = (field: keyof JobFormState, value: string) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <>
      <div>
        <Label htmlFor="job-title" className={labelClass}>Job Title</Label>
        <Input id="job-title" className={controlClass} placeholder="Job title" value={form.job_title} onChange={(event) => setField("job_title", event.target.value)} />
      </div>
      <div>
        <Label htmlFor="company" className={labelClass}>Company</Label>
        <Input id="company" className={controlClass} placeholder="Company" value={form.company} onChange={(event) => setField("company", event.target.value)} />
      </div>
      <div>
        <Label htmlFor="origin" className={labelClass}>Posting Source</Label>
        <Select id="origin" className={controlClass} value={form.job_posting_origin} onChange={(event) => setField("job_posting_origin", event.target.value)}>
          <option value="">Unknown</option>
          {jobPostingOriginOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </div>
      {form.job_posting_origin === "other" ? (
        <Input className={controlClass} placeholder="Other source label" value={form.job_posting_origin_other_text} onChange={(event) => setField("job_posting_origin_other_text", event.target.value)} />
      ) : null}
      <div>
        <Label htmlFor="jd" className={labelClass}>Job Description</Label>
        <Textarea id="jd" className={`${controlClass ?? ""} min-h-32`.trim()} placeholder="Job description" value={form.job_description} onChange={(event) => setField("job_description", event.target.value)} />
      </div>
      <div>
        <Label htmlFor="job-location-detail" className={labelClass}>Location</Label>
        <Input id="job-location-detail" className={controlClass} placeholder="e.g. British Columbia/Ontario or Toronto, Ontario" value={form.job_location_text} onChange={(event) => setField("job_location_text", event.target.value)} />
      </div>
      <div>
        <Label htmlFor="compensation-detail" className={labelClass}>Compensation</Label>
        <Input id="compensation-detail" className={controlClass} placeholder="e.g. $140,000 - $175,000 base salary" value={form.compensation_text} onChange={(event) => setField("compensation_text", event.target.value)} />
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
  const status = state === "saving" ? "Saving…" : state === "saved" ? "Saved." : "Autosaves when you pause typing.";
  return (
    <Card density="compact" className="p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Notes</h3>
      <Textarea className={`mt-3 min-h-24${compact ? " text-sm" : ""}`} placeholder="Add your own notes…" value={value} onChange={(event) => onChange(event.target.value)} />
      <p className="mt-2 text-xs" style={{ color: "var(--color-ink-40)" }}>{status}</p>
    </Card>
  );
}

const EXTRACTION_POLL_STATES = ["extraction_pending", "extracting"];
const ACTIVE_GENERATION_STATES = ["generating", "regenerating_full", "regenerating_section"];
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

function getResumeJudgeDimensionEntries(result: ApplicationDetail["resume_judge_result"]) {
  if (!result?.dimension_scores) return [];
  const priorities = new Set(result.regeneration_priority_dimensions ?? []);
  return Object.entries(result.dimension_scores).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const leftPriority = priorities.has(leftKey) ? 0 : 1;
    const rightPriority = priorities.has(rightKey) ? 0 : 1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    if (leftValue.score !== rightValue.score) return leftValue.score - rightValue.score;
    return leftKey.localeCompare(rightKey);
  });
}

function getDefaultExpandedResumeJudgeDimension(result: ApplicationDetail["resume_judge_result"]) {
  const entries = getResumeJudgeDimensionEntries(result);
  if (!entries.length) return null;
  const priorities = result?.regeneration_priority_dimensions ?? [];
  if (priorities.length) {
    const prioritizedEntries = entries.filter(([key]) => priorities.includes(key));
    if (prioritizedEntries.length) {
      return prioritizedEntries.reduce((lowest, current) => (current[1].score < lowest[1].score ? current : lowest))[0];
    }
  }
  return entries.reduce((lowest, current) => (current[1].score < lowest[1].score ? current : lowest))[0];
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
      accent: "var(--color-spruce)",
      bg: "var(--color-spruce-05)",
      border: "var(--color-spruce-10)",
      muted: "var(--color-ink-65)",
    };
  }
  if (verdict === "warn") {
    return {
      accent: "var(--color-amber)",
      bg: "var(--color-amber-10)",
      border: "rgba(180,83,9,0.2)",
      muted: "var(--color-ink-65)",
    };
  }
  return {
    accent: "var(--color-ember)",
    bg: "var(--color-ember-05)",
    border: "var(--color-ember-10)",
    muted: "var(--color-ink-65)",
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

function normalizeKeywordEntry(item: NonNullable<JobKeywordsPayload["keywords"]>[number]): KeywordEntry | null {
  const isLegacyKeyword = typeof item === "string";
  const rawText = isLegacyKeyword ? item : item?.text;
  if (typeof rawText !== "string") return null;
  const text = rawText.trim().replace(/\s+/g, " ");
  if (!text) return null;
  return {
    text,
    source: !isLegacyKeyword && item?.source === "manual" ? "manual" : "extracted",
    added_at: isLegacyKeyword ? null : item?.added_at ?? null,
  };
}

function getKeywordEntries(payload: JobKeywordsPayload | null | undefined): KeywordEntry[] {
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

function getKeywordTexts(payload: JobKeywordsPayload | null | undefined): string[] {
  return getKeywordEntries(payload).map((entry) => entry.text);
}

function getManualKeywordTexts(payload: JobKeywordsPayload | null | undefined): string[] {
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

function keywordTone(match: KeywordMatch | null | undefined, status: string | null | undefined) {
  if (status === "failed") {
    return { accent: "var(--color-ember)", bg: "var(--color-ember-05)", border: "var(--color-ember-10)" };
  }
  if (!match) {
    return { accent: "var(--color-ink-50)", bg: "var(--color-ink-05)", border: "var(--color-border)" };
  }
  if (match.target_met) {
    return { accent: "var(--color-spruce)", bg: "var(--color-spruce-05)", border: "var(--color-spruce-10)" };
  }
  return { accent: "var(--color-amber)", bg: "var(--color-amber-10)", border: "rgba(180,83,9,0.2)" };
}

function isGenerationWorkflowActive(detail: ApplicationDetail | null) {
  return Boolean(detail && !detail.failure_reason && ACTIVE_GENERATION_STATES.includes(detail.internal_state));
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
  if (ACTIVE_GENERATION_STATES.includes(internalState) || internalState === "generation_pending") return "draft";
  return fallbackStatus;
}

function getGenerationFailureReason(progress: ExtractionProgress, isRegeneration: boolean) {
  const code = progress.terminal_error_code;
  if (!code) return null;
  if (code === "generation_timeout" || code === "generation_cancelled") return code;
  return isRegeneration ? "regeneration_failed" : "generation_failed";
}

function getTerminalGenerationState(progress: ExtractionProgress, isRegeneration: boolean) {
  if (progress.state === "resume_ready" && !progress.terminal_error_code) return "resume_ready";
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
    validation_errors: existing?.validation_errors ?? null,
    failure_stage: existing?.failure_stage ?? null,
    attempt_count: existing?.attempt_count ?? null,
    attempts: existing?.attempts ?? null,
    terminal_error_code: progress.terminal_error_code,
  };
}

function applyTerminalGenerationProgress(
  current: ApplicationDetail,
  progress: ExtractionProgress,
): ApplicationDetail {
  const isRegeneration = ["regenerating_full", "regenerating_section"].includes(current.internal_state);
  const failureReason = getGenerationFailureReason(progress, isRegeneration);
  const internalState = getTerminalGenerationState(progress, isRegeneration);

  return {
    ...current,
    internal_state: internalState,
    visible_status: deriveVisibleStatus(current.visible_status, internalState, failureReason),
    failure_reason: failureReason,
    generation_failure_details: getGenerationFailureDetails(current, progress, failureReason),
    has_action_required_notification: failureReason ? true : current.has_action_required_notification,
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
  if (current.extraction_failure_details) return current.extraction_failure_details;

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
  if (progress.terminal_error_code === null && progress.state === "generation_pending") {
    return EXTRACTION_DETAIL_REFRESH_FALLBACK_MESSAGE;
  }
  return progress.message || EXTRACTION_DETAIL_REFRESH_FALLBACK_MESSAGE;
}

function isTerminalExtractionSuccess(progress: ExtractionProgress): boolean {
  return progress.terminal_error_code === null && progress.state === "generation_pending";
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
  if (progress.terminal_error_code === null && progress.state === "generation_pending") {
    return {
      ...current,
      internal_state: "generation_pending",
      visible_status: deriveVisibleStatus(current.visible_status, "generation_pending", null),
      failure_reason: null,
      extraction_failure_details: null,
    };
  }

  const failureReason = "extraction_failed";
  const internalState = "manual_entry_required";

  return {
    ...current,
    internal_state: internalState,
    visible_status: deriveVisibleStatus(current.visible_status, internalState, failureReason),
    failure_reason: failureReason,
    extraction_failure_details: inferExtractionFailureDetails(current, progress),
    has_action_required_notification: true,
  };
}

function isAllowedPageLength(value: unknown): value is string {
  return typeof value === "string" && PAGE_LENGTH_OPTIONS.some((option) => option.value === value);
}

function isAllowedAggressiveness(value: unknown): value is string {
  return typeof value === "string" && AGGRESSIVENESS_OPTIONS.some((option) => option.value === value);
}

function getGenerationStartBlocker(
  detail: ApplicationDetail | null,
  selectedResumeId: string | null,
  baseResumeCount: number,
): string | null {
  const duplicateBlocker =
    "This looks like a duplicate application. Review the duplicate warning and choose Proceed Anyway before generating.";
  if (!detail) return "Application details are still loading.";
  if (isGenerationWorkflowActive(detail)) return "Generation is already in progress.";
  if (detail.internal_state === "manual_entry_required") return "Submit manual entry before generating.";
  if (detail.internal_state === "duplicate_review_required") return duplicateBlocker;
  if (["extraction_pending", "extracting"].includes(detail.internal_state)) return "Wait until extraction finishes before generating.";
  if (!["generation_pending", "resume_ready"].includes(detail.internal_state)) return "This application is not ready for generation yet.";
  if (!selectedResumeId) return "Select a base resume before generating.";
  if (baseResumeCount === 0) return "Create a base resume before generating.";
  if (!detail.job_title) return "Add a job title before generating.";
  if (!detail.job_description) return "Add a job description before generating.";
  if (detail.duplicate_resolution_status === "pending") return duplicateBlocker;
  return null;
}

function getFullRegenerationBlocker(detail: ApplicationDetail | null): string | null {
  if (!detail) return "Application details are still loading.";
  if (isGenerationWorkflowActive(detail)) return "Generation is already in progress.";
  if (detail.internal_state !== "resume_ready") return "Generate a resume draft before running full regeneration.";
  return null;
}

function getSectionRegenerationBlocker(
  detail: ApplicationDetail | null,
  sectionName: string,
  instructions: string,
): string | null {
  if (!detail) return "Application details are still loading.";
  if (isGenerationWorkflowActive(detail)) return "Generation is already in progress.";
  if (detail.internal_state !== "resume_ready") return "Generate a resume draft before regenerating a section.";
  if (!sectionName) return "Select a section to regenerate.";
  if (!instructions.trim()) return "Enter regeneration instructions before continuing.";
  return null;
}

export function ApplicationDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setMode: setShellLayoutMode, clearMode: clearShellLayoutMode } = useShellLayout();
  const { toast } = useToast();
  const { applicationId } = useParams<{ applicationId: string }>();
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [extractionDisplayPercent, setExtractionDisplayPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesState, setNotesState] = useState<"idle" | "saving" | "saved">("idle");
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
  const [generationProgress, setGenerationProgress] = useState<ExtractionProgress | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [showSectionRegen, setShowSectionRegen] = useState(false);
  const [regenSectionName, setRegenSectionName] = useState("");
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
  const [showCancelExtractionConfirm, setShowCancelExtractionConfirm] = useState(false);
  const [showFullRegenConfirm, setShowFullRegenConfirm] = useState(false);
  const [fullRegenInstructions, setFullRegenInstructions] = useState("");
  const [activityPanelOpen, setActivityPanelOpen] = useState(false);
  const [showResumeJudgeDialog, setShowResumeJudgeDialog] = useState(false);
  const [expandedResumeJudgeDimension, setExpandedResumeJudgeDimension] = useState<string | null>(null);
  const [isTriggeringResumeJudge, setIsTriggeringResumeJudge] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareBaseline, setCompareBaseline] = useState<BaseResumeDetail | null>(null);
  const [isCompareBaselineLoading, setIsCompareBaselineLoading] = useState(false);
  const [compareBaselineError, setCompareBaselineError] = useState<string | null>(null);
  const lastHandledExtractionProgressRef = useRef<string | null>(null);
  const lastHandledGenerationProgressRef = useRef<string | null>(null);
  const lastDraftSyncDetailRef = useRef<string | null>(null);
  const lastKeywordSignatureRef = useRef<string | null>(null);
  const previousDetailRef = useRef<ApplicationDetail | null>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const [leftColumnHeight, setLeftColumnHeight] = useState<number | null>(null);
  const [jobDescriptionCollapsed, setJobDescriptionCollapsed] = useState(false);
  const [showKeywordDialog, setShowKeywordDialog] = useState(false);
  const [manualKeywordInput, setManualKeywordInput] = useState("");
  const [isSavingManualKeywords, setIsSavingManualKeywords] = useState(false);
  const [isOptimizingKeywords, setIsOptimizingKeywords] = useState(false);
  const [hasUserModifiedSettings, setHasUserModifiedSettings] = useState(false);
  const resumeJudgePending = isResumeJudgePending(detail);
  const keywordExtractionPending = detail?.job_keywords?.status === "queued" || detail?.job_keywords?.status === "running";
  const shouldWatchApplication = Boolean(
    applicationId &&
      detail &&
      (EXTRACTION_POLL_STATES.includes(detail.internal_state) ||
        isGenerationWorkflowActive(detail) ||
        resumeJudgePending ||
        keywordExtractionPending),
  );
  const { isStale: isApplicationStreamStale } = useApplicationEventStream(applicationId, shouldWatchApplication);
  const detailQuery = useApplicationDetailQuery(applicationId, {
    refetchInterval: shouldWatchApplication && isApplicationStreamStale ? 5000 : false,
  });
  const shouldLoadDraft = Boolean(applicationId);
  const draftQuery = useApplicationDraftQuery(applicationId, shouldLoadDraft);
  const shouldPollProgress = Boolean(
    applicationId &&
      detail &&
      (EXTRACTION_POLL_STATES.includes(detail.internal_state) || isGenerationWorkflowActive(detail)) &&
      isApplicationStreamStale,
  );
  const progressQuery = useApplicationProgressQuery(applicationId, {
    enabled: shouldPollProgress,
    refetchInterval: shouldPollProgress ? 5000 : false,
  });
  const extractionStates = ["extraction_pending", "extracting", "manual_entry_required", "duplicate_review_required"];
  const baseResumesQuery = useBaseResumesQuery(Boolean(detail && !extractionStates.includes(detail.internal_state)));

  // Track last saved values for dirty state detection
  const savedJobForm = useMemo(() => getSavedJobForm(detail), [detail]);

  const savedSettings = useMemo(() => ({
    base_resume_id: detail?.base_resume_id ?? null,
    page_length: draft?.generation_params?.page_length ?? pageLength,
    aggressiveness: draft?.generation_params?.aggressiveness ?? aggressiveness,
    additional_instructions: draft?.generation_params?.additional_instructions ?? "",
  }), [detail, draft, pageLength, aggressiveness, additionalInstructions]);

  // Compute dirty states
  const jobFormDirty = useMemo(() => {
    return (
      jobForm.job_title !== savedJobForm.job_title ||
      jobForm.company !== savedJobForm.company ||
      jobForm.job_description !== savedJobForm.job_description ||
      jobForm.job_location_text !== savedJobForm.job_location_text ||
      jobForm.compensation_text !== savedJobForm.compensation_text ||
      jobForm.job_posting_origin !== savedJobForm.job_posting_origin ||
      (jobForm.job_posting_origin === "other" && jobForm.job_posting_origin_other_text !== savedJobForm.job_posting_origin_other_text)
    );
  }, [jobForm, savedJobForm]);

  const settingsDirty = useMemo(() => {
    return (
      selectedResumeId !== savedSettings.base_resume_id ||
      pageLength !== savedSettings.page_length ||
      aggressiveness !== savedSettings.aggressiveness ||
      additionalInstructions !== (savedSettings.additional_instructions || "")
    );
  }, [selectedResumeId, pageLength, aggressiveness, additionalInstructions, savedSettings]);
  const selectedAggressivenessOption = useMemo(
    () => AGGRESSIVENESS_OPTIONS.find((option) => option.value === aggressiveness) ?? null,
    [aggressiveness],
  );
  const generationStartBlocker = getGenerationStartBlocker(detail, selectedResumeId, baseResumes.length);
  const fullRegenerationBlocker = getFullRegenerationBlocker(detail);
  const sectionRegenerationBlocker = getSectionRegenerationBlocker(detail, regenSectionName, regenInstructions);
  const resumeJudgeStale = isResumeJudgeStale(detail);
  const resumeJudge = detail?.resume_judge_result ?? null;
  const resumeJudgeRunLimitReached = Boolean(
    draft &&
      resumeJudge &&
      !resumeJudgeStale &&
      (resumeJudge.run_attempt_count ?? 0) >= 3,
  );
  const resumeJudgeDimensionEntries = useMemo(() => getResumeJudgeDimensionEntries(resumeJudge), [resumeJudge]);
  const defaultExpandedResumeJudgeDimension = useMemo(
    () => getDefaultExpandedResumeJudgeDimension(resumeJudge),
    [resumeJudge],
  );
  const sourceLimitedLengthFlag = useMemo(
    () => draft?.review_flags?.find((flag) => flag.reason === "source_limited_length") ?? null,
    [draft],
  );
  const comparisonBaseResumeId = useMemo(() => {
    const generationResumeId = draft?.generation_params?.base_resume_id;
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

  function applyDetailState(response: ApplicationDetail, options?: { refreshShell?: boolean }) {
    const generationActive = isGenerationWorkflowActive(response);
    const regenerationActive = ["regenerating_full", "regenerating_section"].includes(response.internal_state);
    queryClient.setQueryData(queryKeys.application(response.id), response);
    setDetail(response);
    setNotesDraft(response.notes ?? "");
    setJobForm(getSavedJobForm(response));
    setSelectedResumeId(response.base_resume_id);
    setIsGenerating(response.internal_state === "generating" && response.failure_reason === null);
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
    setDetail((current) => (current ? applyTerminalGenerationProgress(current, nextProgress) : current));
    setIsGenerating(false);
    setIsRegenerating(false);
    setIsCancelling(false);
    setShowOptimisticProgress(false);
  }

  function applyTerminalExtractionFallback(nextProgress: ExtractionProgress) {
    setDetail((current) => (current ? applyTerminalExtractionProgress(current, nextProgress) : current));
    setIsCancellingExtraction(false);
  }

  function applyDraftState(response: ResumeDraft | null) {
    if (applicationId) {
      queryClient.setQueryData(queryKeys.applicationDraft(applicationId), response);
    }
    setDraft(response);
    if (!response) return;
    // Only apply draft generation params if:
    // 1. User hasn't explicitly modified settings, AND
    // 2. Generation is not currently active (to prevent overwriting user settings during regeneration)
    const isGenerationActive = isGenerating || isRegenerating;
    if (!hasUserModifiedSettings && !isGenerationActive) {
      const generationParams = response.generation_params ?? {};
      if (isAllowedPageLength(generationParams.page_length)) setPageLength(generationParams.page_length);
      if (isAllowedAggressiveness(generationParams.aggressiveness)) setAggressiveness(generationParams.aggressiveness);
      setAdditionalInstructions(
        typeof generationParams.additional_instructions === "string" ? generationParams.additional_instructions : "",
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
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setActionsMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
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

    const completedGeneration = detail.internal_state === "resume_ready" && detail.failure_reason === null;
    const completedGenerationFromActiveState = Boolean(
      previousDetail && isGenerationWorkflowActive(previousDetail) && completedGeneration,
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
    if (EXTRACTION_POLL_STATES.includes(nextProgress.state) && !nextProgress.completed_at && !nextProgress.terminal_error_code) {
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
        if (EXTRACTION_POLL_STATES.includes(response.internal_state) && response.failure_reason === null) {
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
    if (progress.completed_at || progress.terminal_error_code || progress.percent_complete >= 100) {
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
          setError("Generation finished, but the application could not be refreshed.");
          return;
        }
        applyDetailState(response, { refreshShell: true });
        refreshActivityTimeline();
        if (nextProgress.state === "resume_ready" && !nextProgress.terminal_error_code) {
          await invalidateApplicationDraftQueries(queryClient, applicationId);
        }
        setError(null);
      })
      .catch((requestError) => {
        applyTerminalGenerationFallback(nextProgress);
        setError(requestError instanceof Error ? requestError.message : "Generation finished, but the application could not be refreshed.");
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
  }, [applicationId, detail?.job_keywords?.updated_at, detail?.job_keywords?.status, draft?.id, queryClient]);

  useEffect(() => {
    if (!draft || !comparisonBaseResumeId) {
      setCompareBaseline(null);
      setCompareBaselineError(null);
      setIsCompareBaselineLoading(false);
      setCompareMode(false);
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
        setCompareBaselineError("The base resume used for this draft could not be loaded. Compare view is unavailable.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsCompareBaselineLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [draft?.id, comparisonBaseResumeId]);

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
        .catch((err: Error) => { setError(err.message); setNotesState("idle"); });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [applicationId, detail, notesDraft]);

  useEffect(() => {
    if (!baseResumesQuery.data) return;
    setBaseResumes(baseResumesQuery.data);
    if (!selectedResumeId && baseResumesQuery.data.length > 0) {
      const defaultResume = baseResumesQuery.data.find((resume) => resume.is_default);
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
      setError(err instanceof Error ? err.message : "Unable to update applied state.");
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
        job_posting_origin_other_text: jobForm.job_posting_origin === "other" ? jobForm.job_posting_origin_other_text : null,
      });
      toast("Job information saved");
      applyDetailState(response, { refreshShell: true });
      refreshActivityTimeline();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save job information.");
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
        job_posting_origin_other_text: jobForm.job_posting_origin === "other" ? jobForm.job_posting_origin_other_text : null,
        notes: notesDraft || null,
      });
      applyDetailState(response, { refreshShell: true });
      refreshActivityTimeline();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit manual entry.");
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
      setError(err instanceof Error ? err.message : "Unable to retry extraction.");
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
      setError(err instanceof Error ? err.message : "Unable to stop extraction.");
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
      setError(err instanceof Error ? err.message : "Unable to delete application.");
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
        source_url: detail?.extraction_failure_details?.blocked_url ?? detail?.job_url ?? undefined,
        page_title: detail?.job_title ?? undefined,
      });
      applyDetailState(response, { refreshShell: true });
      setProgress(null);
      setSourceTextDraft("");
      refreshActivityTimeline();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to recover from pasted source text.");
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
      setError(err instanceof Error ? err.message : "Unable to dismiss duplicate warning.");
    }
  }

  async function handleOpenExistingApplication() {
    if (!detail?.duplicate_warning) return;
    try {
      const response = await resolveDuplicate(activeApplicationId, "redirected");
      applyDetailState(response, { refreshShell: true });
      refreshActivityTimeline();
      navigate(`/app/applications/${detail.duplicate_warning.matched_application.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open matched application.");
    }
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedResumeId) return;
    setIsSavingSettings(true);
    setError(null);
    try {
      const response = await patchApplication(activeApplicationId, { base_resume_id: selectedResumeId });
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
      console.warn("[generation-ui]", {
        event: "blocked_before_request",
        workflow_kind: "generation",
        application_id: activeApplicationId,
        reason: generationStartBlocker,
      });
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
      setError(err instanceof Error ? err.message : "Unable to start generation.");
    }
  }

  async function handleSaveDraft() {
    if (!editContent.trim()) return;
    setIsSavingDraft(true);
    setError(null);
    try {
      const updated = await saveDraft(activeApplicationId, editContent);
      queryClient.setQueryData(queryKeys.applicationDraft(activeApplicationId), updated);
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

  function handleEnterEditMode() {
    if (draft) { setEditContent(draft.content_md); setEditMode(true); }
  }

  function handleCancelEdit() {
    dismissDraftEditor();
  }

  async function handleFullRegeneration(overrideInstructions?: string, useJudgeFeedback?: boolean): Promise<boolean> {
    if (fullRegenerationBlocker) {
      console.warn("[generation-ui]", {
        event: "blocked_before_request",
        workflow_kind: "regeneration_full",
        application_id: activeApplicationId,
        reason: fullRegenerationBlocker,
      });
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
      if (overrideInstructions && overrideInstructions.trim() && overrideInstructions.trim() !== additionalInstructions.trim()) {
        combined.push(overrideInstructions.trim());
      }
      const finalInstructions = combined.join("\n\n") || undefined;

      const response = await triggerFullRegeneration(activeApplicationId, {
        target_length: pageLength,
        aggressiveness,
        additional_instructions: finalInstructions,
        use_judge_feedback: useJudgeFeedback,
      });
      applyDetailState(response, { refreshShell: true });
      setGenerationProgress(null);
      setHasUserModifiedSettings(false);
      refreshActivityTimeline();
      return true;
    } catch (err) {
      setShowOptimisticProgress(false);
      setIsRegenerating(false);
      setError(err instanceof Error ? err.message : "Unable to start regeneration.");
      return false;
    }
  }

  async function handleSectionRegeneration() {
    if (sectionRegenerationBlocker) {
      console.warn("[generation-ui]", {
        event: "blocked_before_request",
        workflow_kind: "regeneration_section",
        application_id: activeApplicationId,
        section_name: regenSectionName,
        reason: sectionRegenerationBlocker,
      });
      setError(sectionRegenerationBlocker);
      return;
    }
    setIsRegenerating(true);
    setShowOptimisticProgress(true);
    dismissDraftEditor();
    setError(null);
    try {
      const response = await triggerSectionRegeneration(activeApplicationId, regenSectionName, regenInstructions);
      applyDetailState(response, { refreshShell: true });
      setGenerationProgress(null);
      setShowSectionRegen(false);
      setRegenSectionName("");
      setRegenInstructions("");
      setHasUserModifiedSettings(false);
      refreshActivityTimeline();
    } catch (err) {
      setShowOptimisticProgress(false);
      setIsRegenerating(false);
      setError(err instanceof Error ? err.message : "Unable to start section regeneration.");
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
      setError(err instanceof Error ? err.message : "Unable to cancel generation.");
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
      toast(resumeJudgeStale ? "Resume re-evaluation queued" : "Resume Judge queued");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run Resume Judge.");
      toast("Failed to run Resume Judge", "error");
    } finally {
      setIsTriggeringResumeJudge(false);
    }
  }

  async function persistManualKeywords(nextKeywords: string[]) {
    setIsSavingManualKeywords(true);
    setError(null);
    try {
      const response = await updateManualKeywords(activeApplicationId, nextKeywords);
      applyDetailState(response);
      await invalidateApplicationDraftQueries(queryClient, activeApplicationId);
      refreshActivityTimeline();
      toast("ATS keywords updated");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update ATS keywords.";
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
    if (manualKeywords.length >= 30 && !manualKeywords.some((keyword) => keyword.toLowerCase() === cleaned.toLowerCase())) {
      toast("Manual keywords are limited to 30", "error");
      return;
    }
    if (allKeywords.some((keyword) => keyword.toLowerCase() === cleaned.toLowerCase())) {
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
      const message = err instanceof Error ? err.message : "Unable to start keyword optimization.";
      setError(message);
      toast("Failed to optimize keywords", "error");
    } finally {
      setIsOptimizingKeywords(false);
    }
  }

  async function handleExport(format: ExportFormat) {
    setActionsMenuOpen(false);
    setExportingFormat(format);
    setError(null);
    try {
      const download = format === "pdf" ? await exportPdf(activeApplicationId) : await exportDocx(activeApplicationId);
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
      setError(err instanceof Error ? err.message : `Unable to export ${format.toUpperCase()}.`);
      toast(`Failed to export ${format.toUpperCase()}`, "error");
    } finally {
      setExportingFormat(null);
    }
  }

  function handleToggleCompareMode() {
    if (compareMode) {
      setCompareMode(false);
      return;
    }

    if (!compareReady) {
      setError(compareBaselineError ?? "Compare view is unavailable until the generation-time base resume finishes loading.");
      return;
    }

    setError(null);
    setCompareMode(true);
  }

  // Helper to check if we're past the extraction-only phase.
  const isPastExtraction =
    detail && !["extraction_pending", "extracting", "manual_entry_required"].includes(detail.internal_state);
  const generationActive = isGenerationWorkflowActive(detail);
  const extractionActive = detail ? EXTRACTION_POLL_STATES.includes(detail.internal_state) : false;
  const extractionPercent = progress
    ? Math.min(100, Math.max(progress.percent_complete, extractionDisplayPercent))
    : 0;
  const deleteBlocked = detail ? ACTIVE_GENERATION_STATES.includes(detail.internal_state) : false;
  const workspaceCardClass = "flex min-h-[32rem] flex-col overflow-hidden";
  const workspaceCardStyle = leftColumnHeight ? { height: `${leftColumnHeight}px` } : undefined;

  useLayoutEffect(() => {
    const leftColumn = leftColumnRef.current;
    if (!leftColumn || !isPastExtraction || compareMode) {
      setLeftColumnHeight(null);
      return;
    }

    const updateHeight = () => {
      if (window.innerWidth < 1280) {
        setLeftColumnHeight(null);
        return;
      }

      const height = leftColumn.getBoundingClientRect().height;
      setLeftColumnHeight(height > 0 ? Math.ceil(height) : null);
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }

    const resizeObserver = new ResizeObserver(() => {
      updateHeight();
    });

    resizeObserver.observe(leftColumn);
    window.addEventListener("resize", updateHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [isPastExtraction, compareMode, detail?.internal_state, draft, editMode, notesDraft, additionalInstructions, pageLength, aggressiveness, selectedResumeId, baseResumes.length, jobForm.job_description, jobForm.job_location_text, jobForm.compensation_text, jobForm.job_posting_origin, jobForm.job_posting_origin_other_text, jobForm.job_title, jobForm.company]);

  const activeWorkspaceCardStyle = compareMode ? undefined : workspaceCardStyle;
  const generatedTimestampLabel = draft ? `Generated ${new Date(draft.last_generated_at).toLocaleString()}` : null;
  const exportedTimestampLabel = draft?.last_exported_at
    ? `Exported ${new Date(draft.last_exported_at).toLocaleString()}`
    : null;
  const compareBaselineLabel = compareBaseline?.name ?? "Generation-time baseline";
  const workspaceMetaChipClass =
    "inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none";
  const workspaceMetaChipStyle = {
    borderColor: "var(--color-border)",
    background: "var(--color-ink-05)",
    color: "var(--color-ink-50)",
  };
  const resumePreviewSurfaceClass = "mt-0.5 flex min-h-0 flex-1 overflow-y-auto px-3 pb-1 sm:px-4";
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
  const resumeJudgeSummary = resumeJudge?.score_summary?.trim() ?? "Review available";

  const clampedResumeJudgeSummaryStyle = {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical" as const,
    WebkitLineClamp: 2,
    overflow: "hidden",
  };

  function refreshActivityTimeline() {
    if (!applicationId) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.applicationActivity(applicationId),
    });
  }

  function renderKeywordCard() {
    const jobKeywords = detail?.job_keywords ?? null;
    const status = jobKeywords?.status ?? null;
    const keywordEntries = getKeywordEntries(jobKeywords);
    const keywords = keywordEntries.map((entry) => entry.text);
    const manualCount = keywordEntries.filter((entry) => entry.source === "manual").length;
    const match = draft?.keyword_match ?? null;
    const tone = keywordTone(match, status);
    const isUpdating = status === "queued" || status === "running";
    const coverageLabel = match ? `${match.matched_count}/${match.total_count}` : `${keywords.length}`;
    const percentage = match?.percentage ?? 0;

    return (
      <Card
        density="compact"
        className="p-0"
        data-testid="keyword-match-card"
        style={{
          borderColor: tone.border,
          background: `linear-gradient(145deg, ${tone.bg} 0%, white 88%)`,
        }}
      >
        <button
          type="button"
          className="w-full p-3 text-left"
          onClick={() => setShowKeywordDialog(true)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: tone.bg, color: tone.accent }}
                >
                  <Target size={14} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: "var(--color-ink-50)" }}>
                    ATS Keywords
                  </p>
                  <p className="mt-1 text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                    {match ? `${percentage.toFixed(1)}% matched` : `${keywords.length} total`}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: "rgba(255,255,255,0.72)", color: tone.accent }}
              >
                {isUpdating ? keywordStatusLabel(status) : coverageLabel}
              </span>
              <ExternalLink size={14} aria-hidden="true" style={{ color: "var(--color-ink-50)" }} />
            </div>
          </div>

          {match ? (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-3 text-[11px]" style={{ color: "var(--color-ink-50)" }}>
                <span>Target {match.target_percentage}%</span>
                <span style={{ color: tone.accent }}>{match.target_met ? "Target met" : "Below target"}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "rgba(15,23,42,0.08)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, percentage))}%`, background: tone.accent }}
                />
              </div>
              <p className="mt-2 text-[11px]" style={{ color: "var(--color-ink-50)" }}>
                {manualCount ? `${manualCount} manual keyword${manualCount === 1 ? "" : "s"}` : "No manual keywords"}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs leading-5" style={{ color: "var(--color-ink-65)" }}>
              {status === "failed"
                ? jobKeywords?.message ?? "Keyword extraction is unavailable for this job description."
                : isUpdating
                  ? "Keyword extraction is updating from the latest job description."
                  : "Keywords will appear after the job description is extracted, saved, or added manually."}
            </p>
          )}
        </button>
      </Card>
    );
  }

  function renderKeywordDialog() {
    if (!showKeywordDialog) return null;
    const jobKeywords = detail?.job_keywords ?? null;
    const status = jobKeywords?.status ?? null;
    const keywordEntries = getKeywordEntries(jobKeywords);
    const extractedEntries = keywordEntries.filter((entry) => entry.source !== "manual");
    const manualEntries = keywordEntries.filter((entry) => entry.source === "manual");
    const match = draft?.keyword_match ?? null;
    const tone = keywordTone(match, status);
    const isUpdating = status === "queued" || status === "running";
    const matchedSet = new Set((match?.matched_keywords ?? []).map((keyword) => keyword.toLowerCase()));
    const missingSet = new Set((match?.missing_keywords ?? []).map((keyword) => keyword.toLowerCase()));
    const percentage = match?.percentage ?? 0;
    const optimizeBlocker = generationActive
      ? "Generation is already running."
      : isUpdating
        ? "Keyword extraction is still updating."
        : !draft
          ? "Generate a draft before optimizing keywords."
          : keywordEntries.length === 0
            ? "Add or extract keywords before optimizing."
            : !match || match.missing_keywords.length === 0
              ? "All available keywords are already matched."
              : null;

    const renderKeywordPill = (entry: KeywordEntry) => {
      const key = entry.text.toLowerCase();
      const matched = matchedSet.has(key);
      const missing = missingSet.has(key);
      const statusLabel = matched ? "matched keyword" : missing ? "missing keyword" : `${entry.source} keyword`;
      return (
        <span
          key={`${entry.source}-${entry.text}`}
          className="inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium"
          aria-label={`${entry.text}, ${statusLabel}`}
          style={{
            borderColor: matched ? "var(--color-spruce-10)" : missing ? "var(--color-ember-10)" : "var(--color-border)",
            background: matched ? "var(--color-spruce-05)" : missing ? "var(--color-ember-05)" : "var(--color-ink-05)",
            color: matched ? "var(--color-spruce)" : missing ? "var(--color-ember)" : "var(--color-ink)",
          }}
        >
          <span className="min-w-0 truncate">{entry.text}</span>
          {entry.source === "manual" ? (
            <button
              type="button"
              className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
              style={{ background: "rgba(15,23,42,0.08)", color: "var(--color-ink-50)" }}
              aria-label={`Remove ${entry.text}`}
              disabled={isSavingManualKeywords}
              onClick={() => void handleRemoveManualKeyword(entry.text)}
            >
              <X size={11} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      );
    };

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
          onClick={() => setShowKeywordDialog(false)}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(16, 24, 40, 0.52)",
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
            borderRadius: "24px",
            background: "linear-gradient(180deg, color-mix(in srgb, var(--color-ink) 2%, white) 0%, white 24%, white 100%)",
            boxShadow: "var(--shadow-panel)",
          }}
          role="dialog"
          aria-modal="true"
          aria-label="ATS keyword breakdown"
        >
          <div className="px-6 pt-6 pb-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: "var(--color-ink-50)" }}>
                  ATS Keywords
                </p>
                <h2 className="mt-2 text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
                  Keyword breakdown
                </h2>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span
                  className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold"
                  style={{ background: tone.bg, color: tone.accent }}
                >
                  {match ? `${percentage.toFixed(1)}%` : keywordStatusLabel(status)}
                </span>
                <button
                  type="button"
                  className="rounded-full px-3 py-1.5 text-sm font-semibold transition-colors"
                  style={{ color: "var(--color-ink-50)", background: "var(--color-ink-05)" }}
                  onClick={() => setShowKeywordDialog(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                  Matched
                </p>
                <p className="mt-2 text-2xl font-semibold" style={{ color: tone.accent }}>
                  {match ? `${match.matched_count}/${match.total_count}` : `${keywordEntries.length}`}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                  Target
                </p>
                <p className="mt-2 text-2xl font-semibold" style={{ color: "var(--color-ink)" }}>
                  {match ? `${match.target_percentage}%` : "-"}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                  Status
                </p>
                <p className="mt-2 text-sm font-semibold" style={{ color: tone.accent }}>
                  {isUpdating ? keywordStatusLabel(status) : match?.target_met ? "Target met" : match ? "Below target" : keywordStatusLabel(status)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid border-t lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]" style={{ borderColor: "var(--color-border)" }}>
            <div className="space-y-6 px-6 py-5">
              <section>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                    Extracted
                  </p>
                  <span className="text-xs font-semibold" style={{ color: "var(--color-ink-50)" }}>
                    {extractedEntries.length}
                  </span>
                </div>
                <div className="mt-3 flex max-h-52 flex-wrap gap-1.5 overflow-y-auto pr-1">
                  {extractedEntries.length ? extractedEntries.map(renderKeywordPill) : (
                    <p className="text-xs leading-5" style={{ color: "var(--color-ink-50)" }}>
                      No extracted keywords.
                    </p>
                  )}
                </div>
              </section>

              <section className="border-t pt-5" style={{ borderColor: "var(--color-border)" }}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                    Manual
                  </p>
                  <span className="text-xs font-semibold" style={{ color: "var(--color-ink-50)" }}>
                    {manualEntries.length}/30
                  </span>
                </div>
                <div className="mt-3 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto pr-1">
                  {manualEntries.length ? manualEntries.map(renderKeywordPill) : (
                    <p className="text-xs leading-5" style={{ color: "var(--color-ink-50)" }}>
                      No manual keywords.
                    </p>
                  )}
                </div>
              </section>
            </div>

            <aside className="space-y-6 border-t px-6 py-5 lg:border-l lg:border-t-0" style={{ borderColor: "var(--color-border)", background: "var(--color-ink-05)" }}>
              <section>
                <form onSubmit={(event) => void handleAddManualKeyword(event)}>
                  <Label htmlFor="manual-keyword-input">Add Keyword</Label>
                  <div className="mt-2 flex gap-2">
                    <Input
                      id="manual-keyword-input"
                      value={manualKeywordInput}
                      maxLength={80}
                      onChange={(event) => setManualKeywordInput(event.target.value)}
                      placeholder="Exact keyword phrase"
                      disabled={isSavingManualKeywords}
                    />
                    <Button type="submit" size="sm" disabled={isSavingManualKeywords}>
                      Add
                    </Button>
                  </div>
                </form>
              </section>

              <section className="border-t pt-5" style={{ borderColor: "var(--color-border)" }}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                  Optimization
                </p>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                  <span style={{ color: "var(--color-ink-65)" }}>Missing keywords</span>
                  <span className="font-semibold" style={{ color: "var(--color-ink)" }}>
                    {match?.missing_keywords.length ?? 0}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={Boolean(optimizeBlocker) || isOptimizingKeywords}
                  className="ai-button mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void handleKeywordOptimization()}
                >
                  <Sparkles size={14} />
                  {isOptimizingKeywords ? "Starting..." : "Optimize for missing keywords"}
                </button>
                {optimizeBlocker ? (
                  <p className="mt-2 text-xs leading-5" style={{ color: "var(--color-ink-50)" }}>
                    {optimizeBlocker}
                  </p>
                ) : null}
              </section>
            </aside>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  function renderResumeJudgeCard() {
    if (!draft) return null;

    if (resumeJudgePending) {
      return (
        <Card
          density="compact"
          className="w-full p-3"
          data-testid="resume-judge-card"
          style={{
            borderColor: "var(--color-spruce-10)",
            background:
              "linear-gradient(145deg, color-mix(in srgb, var(--color-spruce) 8%, white) 0%, white 88%)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: "var(--color-ink-50)" }}>
                Resume Judge
              </span>
              <p className="mt-1.5 text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                Scoring draft
              </p>
            </div>
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: "var(--color-spruce-05)", color: "var(--color-spruce)" }}
            >
              Running
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: "var(--color-spruce)", boxShadow: "0 0 0 6px var(--color-spruce-05)" }}
            />
            <span className="text-xs leading-5" style={{ color: "var(--color-ink-65)" }}>
              The draft is ready. Judge feedback will appear here shortly.
            </span>
          </div>
        </Card>
      );
    }

    if (!resumeJudge || !resumeJudgeHasCompletedScore) {
      const staleNonTerminalResult =
        Boolean(resumeJudgeStale && resumeJudge && ["queued", "running"].includes(resumeJudge.status));
      const limitReachedResult = Boolean(resumeJudgeRunLimitReached && resumeJudge?.status === "failed");
      const unavailableTitle =
        resumeJudgeStale || resumeJudge?.status === "failed" || staleNonTerminalResult || limitReachedResult
          ? "Scoring unavailable"
          : "Pending review";
      const unavailableBadge =
        limitReachedResult
          ? "Maxed"
          : resumeJudgeStale || staleNonTerminalResult
          ? "Stale"
          : resumeJudge?.status === "failed"
            ? "Retry"
            : "Pending";
      const unavailableMessage = limitReachedResult
        ? resumeJudge?.message ?? "Resume Judge reached the maximum of 3 attempts for this draft."
        : resumeJudgeStale
        ? "The saved score no longer matches the current draft or job details. Run Resume Judge again to refresh it."
        : staleNonTerminalResult
          ? "The in-flight review no longer matches the current draft or job details. Run Resume Judge again for a fresh score."
          : resumeJudge?.status === "failed"
            ? resumeJudge.message ?? "The latest scoring attempt failed. Retry when you want a fresh review."
            : "This draft has not been reviewed yet. Run Resume Judge any time after generation.";
      const actionLabel = isTriggeringResumeJudge
        ? "Starting…"
        : limitReachedResult
          ? "Max Attempts Reached"
        : resumeJudgeStale || staleNonTerminalResult
          ? "Re-evaluate"
          : resumeJudge?.status === "failed"
            ? "Try Again"
            : "Run Judge";
      return (
        <Card
          density="compact"
          className="w-full p-3"
          data-testid="resume-judge-card"
          style={{
            borderColor:
              resumeJudgeStale || staleNonTerminalResult || resumeJudge?.status === "failed"
                ? "var(--color-ember-10)"
                : "var(--color-border)",
            background:
              resumeJudgeStale || staleNonTerminalResult || resumeJudge?.status === "failed"
                ? "linear-gradient(145deg, var(--color-ember-05) 0%, white 86%)"
                : "linear-gradient(145deg, var(--color-ink-05) 0%, white 86%)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: "var(--color-ink-50)" }}>
                Resume Judge
              </span>
              <p className="mt-1.5 text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                {unavailableTitle}
              </p>
            </div>
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background:
                  resumeJudgeStale || staleNonTerminalResult || resumeJudge?.status === "failed"
                    ? "var(--color-ember-05)"
                    : "var(--color-ink-05)",
                color:
                  resumeJudgeStale || staleNonTerminalResult || resumeJudge?.status === "failed"
                    ? "var(--color-ember)"
                    : "var(--color-ink-50)",
              }}
            >
              {unavailableBadge}
            </span>
          </div>
          <p className="mt-2.5 text-xs leading-5" style={{ color: "var(--color-ink-65)" }}>
            {unavailableMessage}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={!resumeJudgeCanRun} onClick={() => void handleTriggerResumeJudge()}>
              {actionLabel}
            </Button>
          </div>
        </Card>
      );
    }

    return (
      <button
        type="button"
        className="block w-full rounded-[1.35rem] text-left transition-transform duration-150 hover:-translate-y-0.5"
        data-testid="resume-judge-card"
        onClick={() => setShowResumeJudgeDialog(true)}
      >
        <Card
          density="compact"
          className="p-3"
          style={{
            borderColor: resumeJudgeStale ? "var(--color-amber)" : resumeJudgeToneStyle.border,
            background: resumeJudgeStale
              ? "linear-gradient(145deg, var(--color-amber-10) 0%, white 90%)"
              : `linear-gradient(145deg, ${resumeJudgeToneStyle.bg} 0%, white 88%)`,
            boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: "var(--color-ink-50)" }}>
                Resume Judge
              </span>
              <p
                className="mt-2 text-[11px] leading-5"
                title={resumeJudgeSummary}
                style={{ color: "var(--color-ink-65)", ...clampedResumeJudgeSummaryStyle }}
              >
                {resumeJudgeSummary}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                style={{
                  background: resumeJudgeStale ? "rgba(180, 83, 9, 0.12)" : "rgba(255,255,255,0.7)",
                  color: resumeJudgeStale ? "var(--color-amber)" : resumeJudgeToneStyle.accent,
                }}
              >
                {resumeJudgeStale ? "Stale" : resumeJudgeVerdictLabel(resumeJudge.verdict)}
              </span>
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
                style={{
                  background: "rgba(255,255,255,0.82)",
                  color: resumeJudgeStale ? "var(--color-amber)" : resumeJudgeToneStyle.accent,
                }}
              >
                {resumeJudge.display_score ?? "—"}/100
              </span>
            </div>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <span className="text-[10px]" style={{ color: "var(--color-ink-50)" }}>
              Hover to read more.
            </span>
            <span
              className="text-[10px] font-semibold"
              style={{ color: "var(--color-ember)" }}
            >
              Click for details.
            </span>
          </div>
        </Card>
      </button>
    );
  }

  function renderGeneratedWorkspacePane(options?: { lockInteractions?: boolean }) {
    const lockInteractions = options?.lockInteractions ?? false;

    return (
      <Card
        className={`${workspaceCardClass} ${compareMode ? "compare-pane-card compare-generated-pane" : ""} px-4 pb-4 pt-2`}
        style={activeWorkspaceCardStyle}
      >
        <div className="flex min-w-0 flex-col gap-2 overflow-visible sm:min-h-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <h3 className="shrink-0 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
              Generated Resume
            </h3>
            {generatedTimestampLabel ? (
              <span className={workspaceMetaChipClass} style={workspaceMetaChipStyle}>
                {generatedTimestampLabel}
              </span>
            ) : null}
            {exportedTimestampLabel ? (
              <span className={`${workspaceMetaChipClass} hidden sm:inline-flex`} style={workspaceMetaChipStyle}>
                {exportedTimestampLabel}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div
              className="inline-flex items-center rounded-full border p-1"
              style={{
                borderColor: editMode ? "var(--color-spruce-10)" : "var(--color-border)",
                background: editMode ? "var(--color-spruce-05)" : "var(--color-ink-05)",
              }}
            >
              <button
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  background: !editMode ? "var(--color-ink)" : "transparent",
                  color: !editMode ? "#fff" : "var(--color-ink-50)",
                }}
                type="button"
                disabled={lockInteractions}
                onClick={() => {
                  if (editMode) handleCancelEdit();
                }}
              >
                Preview
              </button>
              <button
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  background: editMode ? "var(--color-sidebar-bg-active)" : "transparent",
                  color: editMode ? "#fff" : "var(--color-ink-50)",
                }}
                type="button"
                disabled={lockInteractions}
                onClick={() => {
                  if (!editMode) handleEnterEditMode();
                }}
              >
                Edit
              </button>
            </div>
          </div>
        </div>

        {!compareMode && (isCompareBaselineLoading || compareBaselineError) ? (
          <p className="mt-3 text-xs" style={{ color: "var(--color-ink-50)" }}>
            {isCompareBaselineLoading
              ? "Loading the generation-time base resume for compare."
              : compareBaselineError}
          </p>
        ) : null}

        {!compareMode && sourceLimitedLengthFlag && detail?.internal_state === "resume_ready" ? (
          <div
            className="mt-3 rounded-md border px-3 py-2 text-xs"
            style={{
              borderColor: "var(--color-amber)",
              background: "var(--color-amber-10)",
              color: "var(--color-ink-65)",
            }}
          >
            <div className="font-semibold" style={{ color: "var(--color-amber)" }}>Shorter Than Target</div>
            <p className="mt-1">{sourceLimitedLengthFlag.text}</p>
          </div>
        ) : null}

        {editMode ? (
          <div className="mt-0.5 flex min-h-0 flex-1 flex-col overflow-hidden" style={{ minHeight: compareMode ? "60vh" : "50vh" }}>
            <MarkdownEditor
              className="no-bottom-radius flex-1 min-h-0"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
            />
            <div className="markdown-editor-footer flex-shrink-0">
              <span>Markdown · {editContent.length.toLocaleString()} characters</span>
              <span>Tab = 2 spaces</span>
            </div>
            <div className="mt-3 flex flex-shrink-0 items-center gap-3">
              <Button size="sm" loading={isSavingDraft} disabled={isSavingDraft || !editContent.trim()} onClick={() => void handleSaveDraft()}>
                {isSavingDraft ? "Saving…" : "Save Draft"}
              </Button>
              <Button size="sm" variant="secondary" onClick={handleCancelEdit}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className={resumePreviewSurfaceClass}>
            {draft?.render_model ? (
              <ResumeRenderPreview model={draft.render_model} className="resume-preview-markdown" />
            ) : (
              <MarkdownPreview content={draft?.content_md ?? ""} className="resume-preview-markdown" />
            )}
          </div>
        )}
      </Card>
    );
  }

  function renderBaseWorkspacePane() {
    return (
      <Card className={`${workspaceCardClass} compare-pane-card compare-base-pane px-4 pb-4 pt-2`}>
        <div className="flex min-w-0 flex-col gap-2 overflow-hidden sm:min-h-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>
              Base Resume
            </h3>
            <span className={workspaceMetaChipClass} style={workspaceMetaChipStyle}>
              {compareBaselineLabel}
            </span>
          </div>
        </div>

        <div className={resumePreviewSurfaceClass}>
          <MarkdownPreview content={compareBaseline?.content_md ?? ""} className="resume-preview-markdown" />
        </div>
      </Card>
    );
  }

  return (
    <div className="page-enter space-y-4">
      {/* Error banner */}
      <ErrorBanner error={error} className="mb-4" onClear={() => setError(null)} />

      {/* Loading skeleton */}
      {!detail ? (
        <div className="space-y-4">
          <SkeletonCard />
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
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
                {detail.has_action_required_notification && detail.visible_status !== "needs_action" && (
                  <span className="rounded-md px-2 py-1 text-[10px] font-bold uppercase" style={{ background: "var(--color-ember-10)", color: "var(--color-ember)" }}>
                    Action Required
                  </span>
                )}
                {detail.applied && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full border shrink-0"
                    style={{
                      background: "var(--color-spruce-05)",
                      color: "var(--color-spruce)",
                      borderColor: "rgba(24, 74, 69, 0.18)",
                    }}
                  >
                    <Check size={12} className="shrink-0" style={{ color: "var(--color-spruce)" }} aria-hidden="true" />
                    Applied
                  </span>
                )}
                {compareMode && (
                  <Button
                    size="sm"
                    onClick={handleToggleCompareMode}
                    style={{
                      background: "var(--color-spruce)",
                      color: "#fff",
                      borderColor: "var(--color-spruce)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#133c38";
                      e.currentTarget.style.borderColor = "#133c38";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--color-spruce)";
                      e.currentTarget.style.borderColor = "var(--color-spruce)";
                    }}
                  >
                    Close Comparison
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => setActivityPanelOpen(true)}>
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
	                    <div
	                      id="application-actions-menu"
	                      className="animate-scaleIn absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border py-1 shadow-lg"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-white)", maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}
                      role="menu"
                      aria-label="Application actions"
                    >
                      {detail.job_url && (
                        <a
                          href={detail.job_url}
                          target="_blank"
                          rel="noreferrer"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors hover:bg-black/5"
                          style={{ color: "var(--color-ink)" }}
                          onClick={() => setActionsMenuOpen(false)}
                        >
	                          <ExternalLink size={16} className="shrink-0" style={{ color: "var(--color-spruce)" }} aria-hidden="true" />
                          <span>View Posting</span>
                        </a>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors hover:bg-black/5"
                        style={{ color: "var(--color-ink)" }}
                        onClick={() => {
                          setActionsMenuOpen(false);
                          handleAppliedButtonClick();
                        }}
                      >
                        {detail.applied ? (
                          <>
	                            <X size={16} className="shrink-0" style={{ color: "var(--color-ember)" }} aria-hidden="true" />
                            <span>Mark unapplied instead</span>
                          </>
                        ) : (
                          <>
	                            <Check size={16} className="shrink-0" style={{ color: "var(--color-ink-30)", opacity: 0.3 }} aria-hidden="true" />
                            <span>Mark Applied</span>
                          </>
                        )}
                      </button>
                      {draft && (
                        <div className="my-1 border-t" style={{ borderColor: "var(--color-border)" }} />
                      )}
                      {draft && (
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ color: "var(--color-ink)" }}
                          disabled={exportingFormat !== null || isRegenerating || generationActive}
                          onClick={() => void handleExport("pdf")}
                        >
	                          <FileDown size={16} className="shrink-0" style={{ color: "var(--color-ink-50)" }} aria-hidden="true" />
                          <span>{exportingFormat === "pdf" ? "Exporting PDF…" : "Export PDF"}</span>
                        </button>
                      )}
                      {draft && (
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ color: "var(--color-ink)" }}
                          disabled={exportingFormat !== null || isRegenerating || generationActive}
                          onClick={() => void handleExport("docx")}
                        >
	                          <FileDown size={16} className="shrink-0" style={{ color: "var(--color-ink-50)" }} aria-hidden="true" />
                          <span>{exportingFormat === "docx" ? "Exporting DOCX…" : "Export DOCX"}</span>
                        </button>
                      )}
                      {draft && (
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ color: "var(--color-ink)" }}
                          disabled={isRegenerating || exportingFormat !== null || generationActive}
                          onClick={() => {
                            setActionsMenuOpen(false);
                            handleToggleCompareMode();
                          }}
                        >
	                          <Columns size={16} className="shrink-0" style={{ color: "var(--color-ink-50)" }} aria-hidden="true" />
                          <span>{compareMode ? "Close comparison" : "Compare"}</span>
                        </button>
                      )}
                      {draft && !generationActive && (
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ color: "var(--color-ink)" }}
                          disabled={isRegenerating || exportingFormat !== null}
                          onClick={() => {
                            setActionsMenuOpen(false);
                            setShowSectionRegen(true);
                          }}
                        >
	                          <Sparkles size={16} className="shrink-0" style={{ color: "var(--color-ink-50)" }} aria-hidden="true" />
                          <span>Regen Section</span>
                        </button>
                      )}
                      {draft && !generationActive && (
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ color: "var(--color-ink)" }}
                          disabled={isRegenerating || exportingFormat !== null}
                          onClick={() => {
                            setActionsMenuOpen(false);
                            setFullRegenInstructions("");
                            setShowFullRegenConfirm(true);
                          }}
                        >
	                          <RefreshCw size={16} className={`shrink-0 ${isRegenerating ? "animate-spin" : ""}`} style={{ color: "var(--color-ink-50)" }} aria-hidden="true" />
                          <span>{isRegenerating ? "Starting…" : "Full Regen"}</span>
                        </button>
                      )}
                    </div>
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
                      deleteBlocked ? "Delete unavailable while background work is still running" : "Delete application"
                    }
                    title={deleteBlocked ? "Delete unavailable while background work is still running." : "Delete application"}
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
          {progress && ["extraction_pending", "extracting"].includes(detail.internal_state) && (
            <Card variant="success" density="compact" className="p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-spruce)" }}>Extraction Progress</h3>
              <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--color-spruce-10)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${extractionPercent}%`, background: "var(--color-spruce)" }} />
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--color-ink)" }}>{progress.message}</p>
            </Card>
          )}

          {/* Blocked Source */}
          {detail.extraction_failure_details?.kind === "blocked_source" && (
            <Card variant="danger" density="compact" className="p-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>Blocked Source</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>The job site blocked automated retrieval. Use pasted text or manual entry below.</p>
              <div className="mt-3 grid gap-2 rounded-lg border p-3 text-xs sm:grid-cols-2" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-50)" }}>
                <div><span className="font-semibold" style={{ color: "var(--color-ink)" }}>Provider:</span> {detail.extraction_failure_details.provider ?? "Unknown"}</div>
                <div><span className="font-semibold" style={{ color: "var(--color-ink)" }}>Ref ID:</span> {detail.extraction_failure_details.reference_id ?? "N/A"}</div>
                <div className="sm:col-span-2 break-all"><span className="font-semibold" style={{ color: "var(--color-ink)" }}>URL:</span> {detail.extraction_failure_details.blocked_url ?? detail.job_url ?? "Not provided"}</div>
              </div>
            </Card>
          )}

          {detail.extraction_failure_details?.kind === "user_cancelled" && (
            <Card variant="warning" density="compact" className="p-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-amber)" }}>Extraction Stopped</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
                Extraction was stopped. Retry from the URL, retry with pasted text, or delete this application.
              </p>
            </Card>
          )}

          {/* Duplicate Warning */}
          {detail.duplicate_warning && (
            <Card variant="warning" density="compact" className="p-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-amber)" }}>Duplicate Detected</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
                Confidence {detail.duplicate_warning.similarity_score.toFixed(2)} based on {detail.duplicate_warning.matched_fields.join(", ")}.
              </p>
              <div className="mt-2 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--color-border)" }}>
                <div className="font-medium" style={{ color: "var(--color-ink)" }}>{detail.duplicate_warning.matched_application.job_title ?? "Existing application"}</div>
                <div className="text-xs" style={{ color: "var(--color-ink-50)" }}>{detail.duplicate_warning.matched_application.company ?? "Unknown"}</div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => void handleDuplicateDismissal()}>Proceed Anyway</Button>
                <Button size="sm" variant="secondary" onClick={() => void handleOpenExistingApplication()}>Open Existing</Button>
              </div>
            </Card>
          )}

          {/* Company Missing Warning */}
          {!detail.company && detail.internal_state === "generation_pending" && !detail.failure_reason && (
            <Card variant="success" density="compact" className="p-4">
              <p className="text-sm font-medium" style={{ color: "var(--color-spruce)" }}>Company is missing from extraction. Add it to enable duplicate review.</p>
            </Card>
          )}

          {sourceLimitedLengthFlag && detail.internal_state === "resume_ready" && (
            <Card variant="warning" density="compact" className="p-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-amber)" }}>Shorter Than Target</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{sourceLimitedLengthFlag.text}</p>
            </Card>
          )}

          {/* Generation Timeout */}
          {detail.failure_reason === "generation_timeout" && (
            <Card variant="warning" density="compact" className="p-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-amber)" }}>Generation Timed Out</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{detail.generation_failure_details?.message ?? "The AI provider may be experiencing delays."}</p>
              {detail.generation_failure_details?.failure_stage || detail.generation_failure_details?.attempts?.length ? (
                <div className="mt-2 rounded-lg border p-3 text-xs" style={{ borderColor: "var(--color-border)" }}>
                  <div>Failure stage: {detail.generation_failure_details?.failure_stage ?? "unknown"}</div>
                  <div>LLM attempts: {detail.generation_failure_details?.attempt_count ?? detail.generation_failure_details?.attempts?.length ?? 0}</div>
                </div>
              ) : null}
              <Button className="mt-3" size="sm" onClick={() => void handleTriggerGeneration()}>Retry</Button>
            </Card>
          )}

          {/* Generation Cancelled */}
          {detail.failure_reason === "generation_cancelled" && (
            <Card variant="success" density="compact" className="p-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-spruce)" }}>Generation Cancelled</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{detail.generation_failure_details?.message ?? "You can adjust settings and try again."}</p>
              <Button className="mt-3" size="sm" onClick={() => void handleTriggerGeneration()}>Retry</Button>
            </Card>
          )}

          {/* Generation Failed */}
          {(detail.failure_reason === "generation_failed" || detail.failure_reason === "regeneration_failed") && (
            <Card variant="danger" density="compact" className="p-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>Generation Failed</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{detail.generation_failure_details?.message ?? "Resume generation encountered errors."}</p>
              {detail.generation_failure_details?.validation_errors?.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs" style={{ color: "var(--color-ink-50)" }}>
                  {detail.generation_failure_details.validation_errors.map((err, i) => <li key={i}>{err}</li>)}
                </ul>
              ) : null}
              {detail.generation_failure_details?.failure_stage || detail.generation_failure_details?.attempts?.length ? (
                <div className="mt-2 rounded-lg border p-3 text-xs" style={{ borderColor: "var(--color-border)" }}>
                  <div>Failure stage: {detail.generation_failure_details?.failure_stage ?? "unknown"}</div>
                  <div>LLM attempts: {detail.generation_failure_details?.attempt_count ?? detail.generation_failure_details?.attempts?.length ?? 0}</div>
                  {detail.generation_failure_details?.attempts?.length ? (
                    <ul className="mt-2 space-y-1" style={{ color: "var(--color-ink-50)" }}>
                      {detail.generation_failure_details.attempts.map((attempt, index) => (
                        <li key={`${attempt.model ?? "model"}-${index}`}>
                          {attempt.model ?? "unknown model"} / {attempt.transport_mode ?? "unknown mode"} / {attempt.outcome ?? "unknown outcome"}
                          {typeof attempt.elapsed_ms === "number" ? ` / ${attempt.elapsed_ms}ms` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <Button className="mt-3" size="sm" disabled={isGenerating || !selectedResumeId} onClick={() => void handleTriggerGeneration()}>
                {isGenerating ? "Starting…" : "Retry"}
              </Button>
            </Card>
          )}

          {/* ── Manual Entry Required (shown when in manual_entry_required state, replaces two-column) ── */}
          {detail.internal_state === "manual_entry_required" && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] 2xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)]">
              {/* Job Information */}
              <Card density="compact" className="p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Job Information</h3>
                <form className="mt-3 space-y-3" onSubmit={handleSaveJobInfo}>
                  <JobInformationFields form={jobForm} setForm={setJobForm} />
                  <div className="flex gap-2">
                    <Button loading={isSavingJobInfo} disabled={isSavingJobInfo} type="submit">
                      {isSavingJobInfo ? "Saving…" : "Save"}
                    </Button>
                    {detail.job_url && (
                      <Button type="button" variant="secondary" loading={isRetryingExtraction} disabled={isRetryingExtraction} onClick={() => void handleRetryExtraction()}>Retry Extraction</Button>
                    )}
                  </div>
                </form>
              </Card>

              {/* Notes + Manual Entry */}
              <div className="space-y-4">
                <NotesCard value={notesDraft} state={notesState} onChange={(value) => { setNotesDraft(value); setNotesState("idle"); }} />

                <Card variant="danger" density="compact" className="p-4">
                  <h3 className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>Manual Entry Required</h3>
                  <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
                    {detail.extraction_failure_details?.kind === "blocked_source"
                      ? "Source blocked. Paste text or enter details manually."
                      : detail.extraction_failure_details?.kind === "user_cancelled"
                        ? "Extraction was stopped. Retry with text, retry the URL, or delete this application."
                        : "Extraction incomplete. Paste text or fill in details."}
                  </p>
                  <form className="mt-3 space-y-3" onSubmit={handleRecoverFromSource}>
                    <Textarea className="min-h-24" placeholder="Paste job posting text to retry extraction…" value={sourceTextDraft} onChange={(e) => setSourceTextDraft(e.target.value)} />
                    <div className="flex gap-2">
                      <Button loading={isRecoveringFromSource} disabled={isRecoveringFromSource || !sourceTextDraft.trim()} type="submit">Retry with Text</Button>
                      {detail.job_url && (
                        <Button type="button" variant="secondary" loading={isRetryingExtraction} disabled={isRetryingExtraction} onClick={() => void handleRetryExtraction()}>Retry URL</Button>
                      )}
                    </div>
                  </form>
                  <form className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: "var(--color-border)" }} onSubmit={handleManualEntrySubmit}>
                    <Label>Or submit manually</Label>
                    <Input placeholder="Job title" value={jobForm.job_title} onChange={(e) => setJobForm((c) => ({ ...c, job_title: e.target.value }))} required />
                    <Input placeholder="Company" value={jobForm.company} onChange={(e) => setJobForm((c) => ({ ...c, company: e.target.value }))} required />
                    <Textarea className="min-h-24" placeholder="Job description" value={jobForm.job_description} onChange={(e) => setJobForm((c) => ({ ...c, job_description: e.target.value }))} required />
                    <Button loading={isSubmittingManualEntry} disabled={isSubmittingManualEntry} type="submit">
                      {isSubmittingManualEntry ? "Saving…" : "Submit Manual Entry"}
                    </Button>
                  </form>
                </Card>
              </div>
            </div>
          )}

          {/* ── Two-Column Layout (when past extraction and not in manual_entry_required) ── */}
          {isPastExtraction && detail.internal_state !== "manual_entry_required" && (
            <div
              className={
                compareMode
                  ? "space-y-4"
                  : "grid gap-4 xl:items-start xl:[grid-template-columns:minmax(300px,340px)_minmax(0,1fr)] 2xl:[grid-template-columns:minmax(320px,340px)_minmax(0,1fr)]"
              }
              data-compare-mode={compareMode ? "open" : "closed"}
            >
              {/* LEFT COLUMN - Settings & Controls (shown second on mobile via order) */}
              <div
                ref={leftColumnRef}
                className={
                  compareMode
                    ? "hidden"
                    : "order-2 min-w-0 space-y-4 xl:order-1 xl:sticky xl:top-[calc(var(--topbar-height)+1.5rem)] xl:self-start"
                }
                aria-hidden={compareMode}
              >
                {renderResumeJudgeCard()}
                {renderKeywordCard()}

                {/* Job Description Card */}
                <Card density="compact" className="p-4" data-testid="job-description-card">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Job Description</h3>
                      <button
                        type="button"
                        className="sm:hidden p-0.5"
                        style={{ color: "var(--color-ink-40)" }}
                        onClick={() => setJobDescriptionCollapsed((v) => !v)}
                        aria-label={jobDescriptionCollapsed ? "Expand job description" : "Collapse job description"}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          className="transition-transform"
                          style={{ transform: jobDescriptionCollapsed ? "rotate(0deg)" : "rotate(180deg)" }}
                        >
                          <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                    <form onSubmit={handleSaveJobInfo}>
                      <Button
                        size="sm"
                        loading={isSavingJobInfo}
                        disabled={isSavingJobInfo || !jobFormDirty}
                        type="submit"
                        className={!jobFormDirty ? "opacity-50 cursor-not-allowed" : ""}
                      >
                        {isSavingJobInfo ? "Saving…" : "Save"}
                      </Button>
                    </form>
                  </div>
                  {!jobDescriptionCollapsed && (
                    <div className="mt-3 space-y-2.5">
                      <JobInformationFields form={jobForm} setForm={setJobForm} compact />
                  </div>
                  )}
                </Card>

                {/* Generation Settings Card */}
                {detail.internal_state !== "duplicate_review_required" && (
                  <Card density="compact" className="p-4">
                    <form className="space-y-3" onSubmit={handleSaveSettings}>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Generation Settings</h3>
                        <Button
                          size="sm"
                          disabled={isSavingSettings || !selectedResumeId || baseResumes.length === 0 || !settingsDirty}
                          type="submit"
                          className={!settingsDirty ? "opacity-50 cursor-not-allowed" : ""}
                        >
                          {isSavingSettings ? "Saving…" : "Save"}
                        </Button>
                      </div>

                      {/* Base Resume */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <FileText size={14} className="flex-shrink-0" style={{ color: "var(--color-ink-40)" }} />
                          <Label className="inline text-xs font-medium">Base Resume</Label>
                        </div>
                        {baseResumes.length === 0 ? (
                          <div className="rounded-lg border p-2 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-50)" }}>
                            No base resumes yet. <Link className="font-medium" style={{ color: "var(--color-spruce)" }} to="/app/resumes">Create one</Link>
                          </div>
                        ) : (
                          <Select className="text-sm" value={selectedResumeId ?? ""} onChange={(e) => setSelectedResumeId(e.target.value || null)}>
                            <option value="">Select a base resume</option>
                            {baseResumes.map((r) => <option key={r.id} value={r.id}>{r.name}{r.is_default ? " (default)" : ""}</option>)}
                          </Select>
                        )}
                      </div>

                      {/* Target Length */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Ruler size={14} className="flex-shrink-0" style={{ color: "var(--color-ink-40)" }} />
                          <Label className="inline text-xs font-medium">Target Length</Label>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {PAGE_LENGTH_OPTIONS.map((o) => (
                            <label key={o.value} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors" style={{ borderColor: pageLength === o.value ? "var(--color-spruce)" : "var(--color-border)", background: pageLength === o.value ? "var(--color-spruce-05)" : "var(--color-white)", color: pageLength === o.value ? "var(--color-spruce)" : "var(--color-ink)" }}>
                              <input checked={pageLength === o.value} className="sr-only" name="pageLength" type="radio" value={o.value} onChange={() => { setPageLength(o.value); setHasUserModifiedSettings(true); }} />
                              {o.label}
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Aggressiveness */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Gauge size={14} className="flex-shrink-0" style={{ color: "var(--color-ink-40)" }} />
                          <Label className="inline text-xs font-medium">Aggressiveness</Label>
                        </div>
                        <div className="space-y-1.5">
                          {AGGRESSIVENESS_OPTIONS.map((o) => (
                            <label key={o.value} className="cursor-pointer rounded-md border p-2 transition-colors block" style={{ borderColor: aggressiveness === o.value ? "var(--color-spruce)" : "var(--color-border)", background: aggressiveness === o.value ? "var(--color-spruce-05)" : "var(--color-white)" }}>
                              <input checked={aggressiveness === o.value} className="sr-only" name="aggressiveness" type="radio" value={o.value} onChange={() => { setAggressiveness(o.value); setHasUserModifiedSettings(true); }} />
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>{o.label}</div>
                                  <div className="text-[10px]" style={{ color: "var(--color-ink-50)" }}>{o.description}</div>
                                </div>
                                <div className="shrink-0">
                                  <InfoPopover label={`${o.label} aggressiveness details`}>
                                    <div className="space-y-2">
                                      <p className="text-xs font-semibold" style={{ color: "var(--color-ink)" }}>{o.label} affects:</p>
                                      <ul className="space-y-1 text-[11px]" style={{ color: "var(--color-ink-65)" }}>
                                        {o.details.map((detailLine) => (
                                          <li key={detailLine}>{detailLine}</li>
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
                              borderColor: "var(--color-amber)",
                              background: "var(--color-amber-10)",
                              color: "var(--color-ink)",
                            }}
                          >
                            {selectedAggressivenessOption.warning}
                          </div>
                        ) : null}
                      </div>

                      {/* Additional Instructions */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <MessageSquare size={14} className="flex-shrink-0" style={{ color: "var(--color-ink-40)" }} />
                          <Label className="inline text-xs font-medium">Additional Instructions</Label>
                        </div>
                        <Textarea className="text-sm min-h-16" placeholder="e.g., emphasize API architecture…" value={additionalInstructions} onChange={(e) => { setAdditionalInstructions(e.target.value); setHasUserModifiedSettings(true); }} />
                      </div>
                    </form>
                  </Card>
                )}

                {/* Notes Card */}
                <NotesCard compact value={notesDraft} state={notesState} onChange={(value) => { setNotesDraft(value); setNotesState("idle"); }} />
              </div>

              {/* RIGHT COLUMN - Resume Preview (shown first on mobile via order) */}
              <div className={compareMode ? "min-w-0" : "order-1 min-w-0 xl:order-2"}>
                {/* Resume Content Area */}
                {generationActive || showOptimisticProgress ? (
                  draft ? (
                    <div className="relative">
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 z-[1] rounded-[1.5rem]"
                        style={{ background: "rgba(255, 255, 255, 0.45)", backdropFilter: "blur(1px)" }}
                      />
                      {renderGeneratedWorkspacePane({ lockInteractions: true })}
                      <GenerationProgress
                        progress={generationProgress}
                        isOptimistic={showOptimisticProgress}
                        isActive={generationActive}
                        isCancelling={isCancelling}
                        onCancel={() => void handleCancelGeneration()}
                      />
                    </div>
                  ) : (
                    /* Resume Skeleton during first-time generation */
                    <Card className={`${workspaceCardClass} relative p-0`} style={activeWorkspaceCardStyle}>
                      <div className="flex-1 h-full overflow-hidden">
                        <ResumeSkeleton />
                      </div>
                      <GenerationProgress
                        progress={generationProgress}
                        isOptimistic={showOptimisticProgress}
                        isActive={generationActive}
                        isCancelling={isCancelling}
                        onCancel={() => void handleCancelGeneration()}
                      />
                    </Card>
                  )
                ) : draft ? (
                  compareMode ? (
                    <div className="compare-layout-grid grid gap-4 lg:grid-cols-2">
                      {renderGeneratedWorkspacePane()}
                      {renderBaseWorkspacePane()}
                    </div>
                  ) : (
                    renderGeneratedWorkspacePane()
                  )
                ) : (
                  /* Empty State - No resume generated yet */
                  <Card className={`${workspaceCardClass} items-center justify-center p-8 text-center`} style={activeWorkspaceCardStyle}>
                    <div className="rounded-full p-4 mb-4" style={{ background: "var(--color-ink-05)" }}>
                      <FileText size={32} style={{ color: "var(--color-ink-40)" }} />
                    </div>
                    <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--color-ink)" }}>No Resume Generated Yet</h3>
                    <p className="text-sm mb-4" style={{ color: "var(--color-ink-50)" }}>
                      Configure your settings and click "Generate Resume" to get started.
                    </p>
                    <button
                      type="button"
                      disabled={
                        generationStartBlocker !== null
                      }
                      className="ai-button inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void handleTriggerGeneration()}
                    >
                      <Sparkles size={16} />
                      Generate Resume
                    </button>
                    {generationStartBlocker ? (
                      <p className="mt-3 text-xs" style={{ color: "var(--color-ink-50)" }}>
                        {generationStartBlocker}
                      </p>
                    ) : null}
                  </Card>
                )}
              </div>
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
                  This will fully regenerate the resume based on your current settings (base resume, page length, and aggressiveness). This may take up to a minute.
                </p>
                <div className="flex flex-col gap-1.5 mt-2">
                  <label htmlFor="full-regen-instr" className="text-xs font-semibold" style={{ color: "var(--color-ink-65)" }}>
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
	              const started = await handleFullRegeneration(fullRegenInstructions || undefined);
	              if (started) {
	                setShowFullRegenConfirm(false);
	                setFullRegenInstructions("");
	              }
	            }}
            onCancel={() => {
              if (!isRegenerating) {
                setShowFullRegenConfirm(false);
                setFullRegenInstructions("");
              }
            }}
          />

          {/* Section Regeneration Modal */}
          {showSectionRegen && createPortal(
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
                onClick={() => { setShowSectionRegen(false); setRegenSectionName(""); setRegenInstructions(""); }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  background: "rgba(16, 24, 40, 0.5)",
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
                  background: "var(--color-white)",
                  borderRadius: "var(--radius-xl)",
                  boxShadow: "var(--shadow-panel)",
                  padding: "24px",
                  maxWidth: "440px",
                  width: "calc(100% - 48px)",
                }}
              >
                <h3 style={{ fontSize: "17px", fontWeight: 600, color: "var(--color-ink)", margin: 0, lineHeight: 1.3 }}>
                  Regenerate a Section
                </h3>
                <p style={{ marginTop: "8px", fontSize: "14px", color: "var(--color-ink-65)", lineHeight: 1.5 }}>
                  Select a section and provide instructions for how to regenerate it.
                </p>

                <div className="mt-4 space-y-3">
                  <div>
                    <Label className="text-xs font-medium" style={{ color: "var(--color-ink-65)" }}>Section</Label>
                    <Select
                      className="mt-1 text-sm"
                      value={regenSectionName}
                      onChange={(e) => setRegenSectionName(e.target.value)}
                    >
                      <option value="">Select section…</option>
                      <option value="summary">Summary</option>
                      <option value="professional_experience">Professional Experience</option>
                      <option value="education">Education</option>
                      <option value="skills">Skills</option>
                      <option value="projects">Projects</option>
                      <option value="certifications">Certifications</option>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium" style={{ color: "var(--color-ink-65)" }}>Instructions</Label>
                    <Textarea
                      className="mt-1 text-sm min-h-16"
                      placeholder="Instructions for regenerating (required)…"
                      value={regenInstructions}
                      onChange={(e) => setRegenInstructions(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => { setShowSectionRegen(false); setRegenSectionName(""); setRegenInstructions(""); }}
                    disabled={isRegenerating}
                  >
                    Cancel
                  </Button>
                  <button
                    type="button"
                    disabled={isRegenerating || !regenSectionName || !regenInstructions.trim()}
                    className="ai-button inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleSectionRegeneration()}
                  >
                    <Sparkles size={14} />
                    {isRegenerating ? "Regenerating…" : "Regenerate"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

          {renderKeywordDialog()}

          {showResumeJudgeDialog && resumeJudge && resumeJudgeHasCompletedScore && createPortal(
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
                  background: "rgba(16, 24, 40, 0.52)",
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
                  borderRadius: "24px",
                  background:
                    "linear-gradient(180deg, color-mix(in srgb, var(--color-ink) 2%, white) 0%, white 24%, white 100%)",
                  boxShadow: "var(--shadow-panel)",
                  padding: "24px",
                }}
                role="dialog"
                aria-modal="true"
                aria-label="Resume Judge breakdown"
              >
                <div className="border-b pb-5" style={{ borderColor: "var(--color-border)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: "var(--color-ink-50)" }}>
                      Resume Judge
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span
                        className="inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold"
                        style={{
                          background: resumeJudgeStale ? "var(--color-amber-10)" : resumeJudgeToneStyle.bg,
                          color: resumeJudgeStale ? "var(--color-amber)" : resumeJudgeToneStyle.accent,
                        }}
                      >
                        {resumeJudge.display_score ?? "—"}/100
                      </span>
                      <button
                        type="button"
                        className="rounded-full px-3 py-1.5 text-sm font-semibold transition-colors"
                        style={{ color: "var(--color-ink-50)", background: "var(--color-ink-05)" }}
                        onClick={() => setShowResumeJudgeDialog(false)}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-50)" }}>
                      Summary
                    </p>
                    <p className="mt-2 text-[15px] leading-6" style={{ color: "var(--color-ink)" }}>
                      {resumeJudge.score_summary ?? "Resume score breakdown"}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--color-ink-50)" }}>
                    <span
                      className="rounded-full px-2.5 py-1 font-semibold uppercase tracking-wide"
                      style={{
                        background: resumeJudgeStale ? "var(--color-amber-10)" : resumeJudgeToneStyle.bg,
                        color: resumeJudgeStale ? "var(--color-amber)" : resumeJudgeToneStyle.accent,
                      }}
                    >
                      {resumeJudgeStale ? "Stale" : resumeJudgeVerdictLabel(resumeJudge.verdict)}
                    </span>
                    <span>Pass threshold: {resumeJudge.pass_threshold ?? 80}</span>
                    {resumeJudge.scored_at ? <span>Scored {new Date(resumeJudge.scored_at).toLocaleString()}</span> : null}
                  </div>
                  <p className="mt-3 text-xs leading-5" style={{ color: "var(--color-ink-65)" }}>
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
                          className="overflow-hidden rounded-[1.25rem] border"
                          style={{ borderColor: expanded ? resumeJudgeToneStyle.border : "var(--color-border)", background: "rgba(255,255,255,0.92)" }}
                        >
                          <button
                            type="button"
                            className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left"
                            aria-expanded={expanded}
                            aria-controls={`resume-judge-dimension-${key}`}
                            onClick={() =>
                              setExpandedResumeJudgeDimension((current) => (current === key ? null : key))
                            }
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                                  {RESUME_JUDGE_DIMENSION_LABELS[key] ?? key}
                                </p>
                                {(resumeJudge.regeneration_priority_dimensions ?? []).includes(key) ? (
                                  <span
                                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                                    style={{ background: "var(--color-ember-05)", color: "var(--color-ember)" }}
                                  >
                                    Priority
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                                <div>
                                  <div style={{ color: "var(--color-ink-50)" }}>Score</div>
                                  <div className="mt-1 font-semibold" style={{ color: "var(--color-ink)" }}>
                                    {value.score.toFixed(1)} / 10
                                  </div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--color-ink-50)" }}>Weight</div>
                                  <div className="mt-1 font-semibold" style={{ color: "var(--color-ink)" }}>
                                    {(value.weight * 100).toFixed(0)}%
                                  </div>
                                </div>
                                <div>
                                  <div style={{ color: "var(--color-ink-50)" }}>Weighted impact</div>
                                  <div className="mt-1 font-semibold" style={{ color: "var(--color-ink)" }}>
                                    {value.weighted_contribution.toFixed(1)}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <ChevronDown
                              size={18}
                              aria-hidden="true"
                              className="mt-1 shrink-0 transition-transform"
                              style={{ color: "var(--color-ink-50)", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
                            />
                          </button>
                          {expanded ? (
                            <div
                              id={`resume-judge-dimension-${key}`}
                              className="border-t px-4 py-4 text-xs leading-5"
                              style={{ borderColor: "var(--color-border)", color: "var(--color-ink-65)", background: "var(--color-ink-05)" }}
                            >
                              {value.notes}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[1.25rem] border p-4" style={{ borderColor: "var(--color-border)", background: "rgba(255,255,255,0.88)" }}>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                        Verdict
                      </p>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                          {resumeJudgeStale ? "Out of date" : resumeJudgeVerdictLabel(resumeJudge.verdict)}
                        </span>
                        <span
                          className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                          style={{
                            background: resumeJudgeStale ? "var(--color-amber-10)" : resumeJudgeToneStyle.bg,
                            color: resumeJudgeStale ? "var(--color-amber)" : resumeJudgeToneStyle.accent,
                          }}
                        >
                          {resumeJudge.verdict ?? "n/a"}
                        </span>
                      </div>
                      {resumeJudge.regeneration_priority_dimensions?.length ? (
                        <div className="mt-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                            Priority Dimensions
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {resumeJudge.regeneration_priority_dimensions.map((dimension) => (
                              <span
                                key={dimension}
                                className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                                style={{ background: "var(--color-ink-05)", color: "var(--color-ink-65)" }}
                              >
                                {RESUME_JUDGE_DIMENSION_LABELS[dimension] ?? dimension}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {(resumeJudgeStale || resumeJudge.status === "failed" || resumeJudge.final_score == null) && (
                      <div className="rounded-[1.25rem] border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-amber-10)" }}>
                        <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                          {resumeJudgeStale ? "This score is stale." : "Resume Judge needs another run."}
                        </p>
                        <p className="mt-2 text-xs leading-5" style={{ color: "var(--color-ink-65)" }}>
                          {resumeJudgeStale
                            ? "You edited the draft after it was scored. Re-evaluate to refresh the breakdown."
                            : resumeJudge.message ?? "Run Resume Judge again to restore the score."}
                        </p>
                        <Button className="mt-4" size="sm" variant="secondary" disabled={!resumeJudgeCanRun} onClick={() => void handleTriggerResumeJudge()}>
                          {isTriggeringResumeJudge ? "Starting…" : "Re-evaluate"}
                        </Button>
                      </div>
                    )}

                    {resumeJudge.regeneration_instructions ? (
                      <div className="rounded-[1.25rem] border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-ink-05)" }}>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                          Regeneration Instructions
                        </p>
                        <p className="mt-3 text-xs leading-5" style={{ color: "var(--color-ink)" }}>
                          {formatJudgeInstructions(resumeJudge.regeneration_instructions)}
                        </p>
                        {resumeJudgeCanRegenerateWithFeedback ? (
                          <>
                            <p className="mt-3 text-xs" style={{ color: "var(--color-ink-50)" }}>
                              Full regeneration will keep your current instructions and append the judge’s corrective guidance.
                            </p>
                            <button
                              type="button"
                              disabled={Boolean(fullRegenerationBlocker)}
                              className="ai-button mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => {
                                setShowResumeJudgeDialog(false);
                                void handleFullRegeneration(additionalInstructions, true);
                              }}
                            >
                              <Sparkles size={14} />
                              Regenerate with Judge Feedback
                            </button>
                          </>
                        ) : null}
                        {fullRegenerationBlocker && resumeJudgeCanRegenerateWithFeedback ? (
                          <p className="mt-2 text-xs" style={{ color: "var(--color-ink-50)" }}>
                            {fullRegenerationBlocker}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {resumeJudge.evaluator_notes ? (
                      <div className="rounded-[1.25rem] border p-4" style={{ borderColor: "var(--color-border)", background: "rgba(255,255,255,0.88)" }}>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                          Evaluator Notes
                        </p>
                        <p className="mt-3 text-xs leading-5" style={{ color: "var(--color-ink-65)" }}>
                          {resumeJudge.evaluator_notes}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>,
            document.body
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
