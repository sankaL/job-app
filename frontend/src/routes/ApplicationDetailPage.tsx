import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { ChevronDown, CircleStop, FileText, Gauge, MessageSquare, Ruler, Sparkles, Trash2 } from "lucide-react";
import { useAppContext } from "@/components/layout/AppContext";
import { useShellLayout } from "@/components/layout/ShellLayoutContext";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { AppliedToggleButton } from "@/components/AppliedToggleButton";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { GenerationProgress, ResumeSkeleton } from "@/components/ui/generation-progress";
import { SkeletonCard } from "@/components/ui/skeleton";
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
  triggerResumeJudge,
  triggerSectionRegeneration,
  exportDocx,
  exportPdf,
  triggerGeneration,
  cancelGeneration,
  type ApplicationDetail,
  type BaseResumeDetail,
  type BaseResumeSummary,
  type ExtractionProgress,
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

const EXTRACTION_POLL_STATES = ["extraction_pending", "extracting"];
const ACTIVE_GENERATION_STATES = ["generating", "regenerating_full", "regenerating_section"];
const ACTIVE_GENERATION_PROGRESS_STATES = [
  "generation_pending",
  "generating",
  "regenerating_full",
  "regenerating_section",
];
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

function appendResumeJudgeFeedback(
  baseInstructions: string,
  judgeInstructions: string | null | undefined,
) {
  const feedback = judgeInstructions?.trim();
  if (!feedback) return baseInstructions.trim();
  const header = "Resume Judge Feedback:";
  const trimmedBase = baseInstructions.trim();
  if (!trimmedBase) return `${header}\n${feedback}`;
  return `${trimmedBase}\n\n${header}\n${feedback}`;
}

function normalizeResumeJudgeContextValue(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function getCurrentResumeJudgeJobContextSignature(detail: ApplicationDetail | null) {
  if (!detail) return null;
  return [
    normalizeResumeJudgeContextValue(detail.job_title),
    normalizeResumeJudgeContextValue(detail.company),
    normalizeResumeJudgeContextValue(detail.job_description),
  ].join("\u001f");
}

function isResumeJudgePending(detail: ApplicationDetail | null, draft: ResumeDraft | null) {
  const judge = detail?.resume_judge_result;
  if (!judge || !["queued", "running"].includes(judge.status)) return false;
  if (draft && judge.evaluated_draft_updated_at && judge.evaluated_draft_updated_at !== draft.updated_at) return false;
  const currentJobSignature = getCurrentResumeJudgeJobContextSignature(detail);
  if (judge.job_context_signature && currentJobSignature && judge.job_context_signature !== currentJobSignature) return false;
  return true;
}

function isResumeJudgeStale(detail: ApplicationDetail | null, draft: ResumeDraft | null) {
  const judge = detail?.resume_judge_result;
  if (!judge) return false;
  if (draft && judge.evaluated_draft_updated_at && judge.evaluated_draft_updated_at !== draft.updated_at) return true;
  const currentJobSignature = getCurrentResumeJudgeJobContextSignature(detail);
  if (judge.job_context_signature && currentJobSignature && judge.job_context_signature !== currentJobSignature) return true;
  return false;
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

function applyTerminalGenerationProgress(
  current: ApplicationDetail,
  progress: ExtractionProgress,
): ApplicationDetail {
  const isRegeneration = ["regenerating_full", "regenerating_section"].includes(current.internal_state);
  const failureReason =
    progress.terminal_error_code === "generation_timeout" || progress.terminal_error_code === "generation_cancelled"
      ? progress.terminal_error_code
      : progress.terminal_error_code
        ? (isRegeneration ? "regeneration_failed" : "generation_failed")
        : null;
  const internalState =
    progress.state === "resume_ready" && !progress.terminal_error_code
      ? "resume_ready"
      : isRegeneration
        ? "resume_ready"
        : "generation_pending";

  return {
    ...current,
    internal_state: internalState,
    visible_status: deriveVisibleStatus(current.visible_status, internalState, failureReason),
    failure_reason: failureReason,
    generation_failure_details: failureReason
      ? {
          message: progress.message,
          validation_errors: current.generation_failure_details?.validation_errors ?? null,
          failure_stage: current.generation_failure_details?.failure_stage ?? null,
          attempt_count: current.generation_failure_details?.attempt_count ?? null,
          attempts: current.generation_failure_details?.attempts ?? null,
          terminal_error_code: progress.terminal_error_code,
        }
      : null,
    has_action_required_notification: failureReason ? true : current.has_action_required_notification,
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
    blocked_url: current.job_url,
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
  if (!detail) return "Application details are still loading.";
  if (isGenerationWorkflowActive(detail)) return "Generation is already in progress.";
  if (!selectedResumeId) return "Select a base resume before generating.";
  if (baseResumeCount === 0) return "Create a base resume before generating.";
  if (!detail.job_title) return "Add a job title before generating.";
  if (!detail.job_description) return "Add a job description before generating.";
  if (detail.duplicate_resolution_status === "pending") return "Resolve the duplicate warning before generating.";
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
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [regenMenuOpen, setRegenMenuOpen] = useState(false);
  const [showSectionRegen, setShowSectionRegen] = useState(false);
  const [regenSectionName, setRegenSectionName] = useState("");
  const [regenInstructions, setRegenInstructions] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showOptimisticProgress, setShowOptimisticProgress] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isCancellingExtraction, setIsCancellingExtraction] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showAppliedConfirm, setShowAppliedConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCancelExtractionConfirm, setShowCancelExtractionConfirm] = useState(false);
  const [showResumeJudgeDialog, setShowResumeJudgeDialog] = useState(false);
  const [expandedResumeJudgeDimension, setExpandedResumeJudgeDimension] = useState<string | null>(null);
  const [isTriggeringResumeJudge, setIsTriggeringResumeJudge] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareBaseline, setCompareBaseline] = useState<BaseResumeDetail | null>(null);
  const [isCompareBaselineLoading, setIsCompareBaselineLoading] = useState(false);
  const [compareBaselineError, setCompareBaselineError] = useState<string | null>(null);
  const lastHandledExtractionProgressRef = useRef<string | null>(null);
  const lastHandledGenerationProgressRef = useRef<string | null>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const regenMenuRef = useRef<HTMLDivElement>(null);
  const [leftColumnHeight, setLeftColumnHeight] = useState<number | null>(null);
  const [jobDescriptionCollapsed, setJobDescriptionCollapsed] = useState(false);
  const [hasUserModifiedSettings, setHasUserModifiedSettings] = useState(false);
  const resumeJudgePending = isResumeJudgePending(detail, draft);
  const shouldWatchApplication = Boolean(
    applicationId &&
      detail &&
      (EXTRACTION_POLL_STATES.includes(detail.internal_state) || isGenerationWorkflowActive(detail) || resumeJudgePending),
  );
  const detailQuery = useApplicationDetailQuery(applicationId, {
    refetchInterval: shouldWatchApplication ? 5000 : false,
  });
  const shouldLoadDraft = Boolean(applicationId);
  const draftQuery = useApplicationDraftQuery(applicationId, shouldLoadDraft);
  const shouldPollProgress = Boolean(
    applicationId &&
      detail &&
      (EXTRACTION_POLL_STATES.includes(detail.internal_state) || isGenerationWorkflowActive(detail)),
  );
  const progressQuery = useApplicationProgressQuery(applicationId, {
    enabled: shouldPollProgress,
    refetchInterval: shouldPollProgress ? 5000 : false,
  });
  useApplicationEventStream(applicationId, shouldWatchApplication);
  const extractionStates = ["extraction_pending", "extracting", "manual_entry_required", "duplicate_review_required"];
  const baseResumesQuery = useBaseResumesQuery(Boolean(detail && !extractionStates.includes(detail.internal_state)));

  // Track last saved values for dirty state detection
  const savedJobForm = useMemo(() => ({
    job_title: detail?.job_title ?? "",
    company: detail?.company ?? "",
    job_description: detail?.job_description ?? "",
    job_location_text: detail?.job_location_text ?? "",
    compensation_text: detail?.compensation_text ?? "",
    job_posting_origin: detail?.job_posting_origin ?? "",
    job_posting_origin_other_text: detail?.job_posting_origin_other_text ?? "",
  }), [detail]);

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
  const resumeJudgeStale = isResumeJudgeStale(detail, draft);
  const resumeJudge = detail?.resume_judge_result ?? null;
  const resumeJudgeRunLimitReached = Boolean(
    draft &&
      resumeJudge &&
      !resumeJudgeStale &&
      (resumeJudge.run_attempt_count ?? 0) >= 3 &&
      resumeJudge.evaluated_draft_updated_at === draft.updated_at,
  );
  const resumeJudgeDimensionEntries = useMemo(() => getResumeJudgeDimensionEntries(resumeJudge), [resumeJudge]);
  const defaultExpandedResumeJudgeDimension = useMemo(
    () => getDefaultExpandedResumeJudgeDimension(resumeJudge),
    [resumeJudge],
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
    queryClient.setQueryData(queryKeys.application(response.id), response);
    setDetail(response);
    setNotesDraft(response.notes ?? "");
    setJobForm({
      job_title: response.job_title ?? "",
      company: response.company ?? "",
      job_description: response.job_description ?? "",
      job_location_text: response.job_location_text ?? "",
      compensation_text: response.compensation_text ?? "",
      job_posting_origin: response.job_posting_origin ?? "",
      job_posting_origin_other_text: response.job_posting_origin_other_text ?? "",
    });
    setSelectedResumeId(response.base_resume_id);
    setIsGenerating(response.internal_state === "generating" && response.failure_reason === null);
    setIsRegenerating(
      ["regenerating_full", "regenerating_section"].includes(response.internal_state) &&
        response.failure_reason === null,
    );
    if (generationActive) {
      dismissDraftEditor();
    }
    if (!generationActive) {
      setIsCancelling(false);
      setShowOptimisticProgress(false);
    }
    if (options?.refreshShell) {
      void invalidateApplicationQueries(queryClient, response.id);
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
    if (!showResumeJudgeDialog) {
      setExpandedResumeJudgeDimension(null);
      return;
    }
    setExpandedResumeJudgeDimension(defaultExpandedResumeJudgeDimension);
  }, [showResumeJudgeDialog, defaultExpandedResumeJudgeDimension]);

  useEffect(() => {
    if (!exportMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!regenMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (regenMenuRef.current && !regenMenuRef.current.contains(event.target as Node)) {
        setRegenMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [regenMenuOpen]);

  useEffect(() => {
    if (!detailQuery.data) return;
    applyDetailState(detailQuery.data);
    setError(null);
  }, [detailQuery.data]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save job information.");
    } finally {
      setIsSavingJobInfo(false);
    }
  }

  async function handleManualEntrySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit manual entry.");
    } finally {
      setIsSubmittingManualEntry(false);
    }
  }

  async function handleRetryExtraction() {
    try {
      const response = await retryExtraction(activeApplicationId);
      applyDetailState(response, { refreshShell: true });
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to retry extraction.");
    }
  }

  async function handleCancelExtraction() {
    setIsCancellingExtraction(true);
    setError(null);
    try {
      const response = await cancelExtraction(activeApplicationId);
      applyDetailState(response, { refreshShell: true });
      setProgress(null);
      setShowCancelExtractionConfirm(false);
      toast("Extraction stopped.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to stop extraction.");
      toast("Failed to stop extraction", "error");
    } finally {
      setIsCancellingExtraction(false);
    }
  }

  async function handleDeleteApplication() {
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
      setIsDeleting(false);
    }
  }

  async function handleRecoverFromSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRecoveringFromSource(true);
    setError(null);
    try {
      const response = await recoverApplicationFromSource(activeApplicationId, {
        source_text: sourceTextDraft,
        source_url: detail?.extraction_failure_details?.blocked_url ?? detail?.job_url,
        page_title: detail?.job_title ?? undefined,
      });
      applyDetailState(response, { refreshShell: true });
      setProgress(null);
      setSourceTextDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to recover from pasted source text.");
    } finally {
      setIsRecoveringFromSource(false);
    }
  }

  async function handleDuplicateDismissal() {
    try {
      const response = await resolveDuplicate(activeApplicationId, "dismissed");
      applyDetailState(response, { refreshShell: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to dismiss duplicate warning.");
    }
  }

  async function handleOpenExistingApplication() {
    if (!detail?.duplicate_warning) return;
    try {
      const response = await resolveDuplicate(activeApplicationId, "redirected");
      applyDetailState(response, { refreshShell: true });
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

  async function handleFullRegeneration(overrideInstructions?: string) {
    if (fullRegenerationBlocker) {
      console.warn("[generation-ui]", {
        event: "blocked_before_request",
        workflow_kind: "regeneration_full",
        application_id: activeApplicationId,
        reason: fullRegenerationBlocker,
      });
      setError(fullRegenerationBlocker);
      return;
    }
    setIsRegenerating(true);
    setShowOptimisticProgress(true);
    dismissDraftEditor();
    setError(null);
    try {
      const response = await triggerFullRegeneration(activeApplicationId, {
        target_length: pageLength,
        aggressiveness,
        additional_instructions: (overrideInstructions ?? additionalInstructions) || undefined,
      });
      applyDetailState(response, { refreshShell: true });
      setGenerationProgress(null);
      setHasUserModifiedSettings(false);
    } catch (err) {
      setShowOptimisticProgress(false);
      setIsRegenerating(false);
      setError(err instanceof Error ? err.message : "Unable to start regeneration.");
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
      toast(resumeJudgeStale ? "Resume re-evaluation queued" : "Resume Judge queued");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run Resume Judge.");
      toast("Failed to run Resume Judge", "error");
    } finally {
      setIsTriggeringResumeJudge(false);
    }
  }

  async function handleExport(format: ExportFormat) {
    setExportMenuOpen(false);
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
        resumeJudge.regeneration_instructions &&
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

            {!generationActive && (
              <div ref={regenMenuRef} className="relative">
                <button
                  type="button"
                  disabled={isRegenerating || exportingFormat !== null}
                  className="ai-button inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  aria-haspopup="menu"
                  aria-expanded={regenMenuOpen}
                  onClick={() => setRegenMenuOpen((open) => !open)}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  Regenerate
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {regenMenuOpen && !isRegenerating && exportingFormat === null && (
                  <div
                    className="animate-scaleIn absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-xl border py-1 shadow-lg"
                    style={{
                      borderColor: "var(--color-border)",
                      background: "var(--color-white)",
                      maxHeight: "calc(100vh - 200px)",
                      overflowY: "auto",
                    }}
                    role="menu"
                    aria-label="Regenerate options"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-black/5"
                      style={{ color: "var(--color-ink)" }}
                      onClick={() => {
                        setRegenMenuOpen(false);
                        setShowSectionRegen(true);
                      }}
                    >
                      Regen Section
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-black/5"
                      style={{ color: "var(--color-ink)" }}
                      onClick={() => {
                        setRegenMenuOpen(false);
                        void handleFullRegeneration();
                      }}
                    >
                      {isRegenerating ? "Starting…" : "Full Regen"}
                    </button>
                  </div>
                )}
              </div>
            )}

            <Button size="sm" onClick={handleToggleCompareMode}>
              {compareMode ? "Close comparison" : "Compare"}
            </Button>
          </div>
        </div>

        {!compareMode && (isCompareBaselineLoading || compareBaselineError) ? (
          <p className="mt-3 text-xs" style={{ color: "var(--color-ink-50)" }}>
            {isCompareBaselineLoading
              ? "Loading the generation-time base resume for compare."
              : compareBaselineError}
          </p>
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
            <MarkdownPreview content={draft?.content_md ?? ""} className="resume-preview-markdown" />
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
      {error && (
        <Card variant="danger" density="compact" className="p-4">
          <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>Request failed</p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{error}</p>
        </Card>
      )}

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
                {draft && (
                  <div ref={exportMenuRef} className="relative">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={exportingFormat !== null || isRegenerating || generationActive}
                      aria-haspopup="menu"
                      aria-expanded={exportMenuOpen}
                      onClick={() => setExportMenuOpen((open) => !open)}
                    >
                      {exportingFormat === "pdf" ? "Exporting PDF…" : exportingFormat === "docx" ? "Exporting DOCX…" : "Export"}
                      <ChevronDown size={14} aria-hidden="true" />
                    </Button>
                    {exportMenuOpen && exportingFormat === null && !isRegenerating && !generationActive && (
                      <div
                        className="animate-scaleIn absolute right-0 top-full z-30 mt-2 w-40 overflow-hidden rounded-xl border py-1 shadow-lg"
                        style={{ borderColor: "var(--color-border)", background: "var(--color-white)", maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}
                        role="menu"
                        aria-label="Export options"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-black/5"
                          style={{ color: "var(--color-ink)" }}
                          onClick={() => void handleExport("pdf")}
                        >
                          Export PDF
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-black/5"
                          style={{ color: "var(--color-ink)" }}
                          onClick={() => void handleExport("docx")}
                        >
                          Export DOCX
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <AppliedToggleButton applied={detail.applied} onClick={() => handleAppliedButtonClick()} />
                {/* View Posting - icon only on mobile, with text on desktop */}
                <a
                  className="inline-flex h-9 items-center justify-center rounded-lg border px-3.5 text-xs font-semibold transition-colors"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-spruce)", background: "var(--color-white)" }}
                  href={detail.job_url}
                  rel="noreferrer"
                  target="_blank"
                  title="View Posting"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="sm:hidden">
                    <path d="M6 3H3v10h10v-3M10 2h4v4M7 9l7-7" />
                  </svg>
                  <span className="hidden sm:inline">View Posting ↗</span>
                </a>
                {/* Stop Extraction / Delete - icon button */}
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
                <div className="h-full rounded-full transition-all" style={{ width: `${progress.percent_complete}%`, background: "var(--color-spruce)" }} />
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
                <div className="sm:col-span-2 break-all"><span className="font-semibold" style={{ color: "var(--color-ink)" }}>URL:</span> {detail.extraction_failure_details.blocked_url ?? detail.job_url}</div>
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
                  <div>
                    <Label htmlFor="job-title">Job Title</Label>
                    <Input id="job-title" placeholder="Job title" value={jobForm.job_title} onChange={(e) => setJobForm((c) => ({ ...c, job_title: e.target.value }))} />
                  </div>
                  <div>
                    <Label htmlFor="company">Company</Label>
                    <Input id="company" placeholder="Company" value={jobForm.company} onChange={(e) => setJobForm((c) => ({ ...c, company: e.target.value }))} />
                  </div>
                  <div>
                    <Label htmlFor="origin">Posting Source</Label>
                    <Select id="origin" value={jobForm.job_posting_origin} onChange={(e) => setJobForm((c) => ({ ...c, job_posting_origin: e.target.value }))}>
                      <option value="">Unknown</option>
                      {jobPostingOriginOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </div>
                  {jobForm.job_posting_origin === "other" && (
                    <Input placeholder="Other source label" value={jobForm.job_posting_origin_other_text} onChange={(e) => setJobForm((c) => ({ ...c, job_posting_origin_other_text: e.target.value }))} />
                  )}
                  <div>
                    <Label htmlFor="jd">Job Description</Label>
                    <Textarea id="jd" className="min-h-32" placeholder="Job description" value={jobForm.job_description} onChange={(e) => setJobForm((c) => ({ ...c, job_description: e.target.value }))} />
                  </div>
                  <div>
                    <Label htmlFor="job-location">Location</Label>
                    <Input
                      id="job-location"
                      placeholder="e.g. British Columbia/Ontario or Toronto, Ontario"
                      value={jobForm.job_location_text}
                      onChange={(e) => setJobForm((c) => ({ ...c, job_location_text: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="compensation">Compensation</Label>
                    <Input
                      id="compensation"
                      placeholder="e.g. $140,000 - $175,000 base salary"
                      value={jobForm.compensation_text}
                      onChange={(e) => setJobForm((c) => ({ ...c, compensation_text: e.target.value }))}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button loading={isSavingJobInfo} disabled={isSavingJobInfo} type="submit">
                      {isSavingJobInfo ? "Saving…" : "Save"}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void handleRetryExtraction()}>Retry Extraction</Button>
                  </div>
                </form>
              </Card>

              {/* Notes + Manual Entry */}
              <div className="space-y-4">
                <Card density="compact" className="p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Notes</h3>
                  <Textarea className="mt-3 min-h-24" placeholder="Add your own notes…" value={notesDraft} onChange={(e) => { setNotesDraft(e.target.value); setNotesState("idle"); }} />
                  <p className="mt-2 text-xs" style={{ color: "var(--color-ink-40)" }}>
                    {notesState === "saving" ? "Saving…" : notesState === "saved" ? "Saved." : "Autosaves when you pause typing."}
                  </p>
                </Card>

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
                      <Button type="button" variant="secondary" onClick={() => void handleRetryExtraction()}>Retry URL</Button>
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
                    <div>
                      <Label htmlFor="job-title" className="text-xs">Job Title</Label>
                      <Input id="job-title" className="text-sm" placeholder="Job title" value={jobForm.job_title} onChange={(e) => setJobForm((c) => ({ ...c, job_title: e.target.value }))} />
                    </div>
                    <div>
                      <Label htmlFor="company" className="text-xs">Company</Label>
                      <Input id="company" className="text-sm" placeholder="Company" value={jobForm.company} onChange={(e) => setJobForm((c) => ({ ...c, company: e.target.value }))} />
                    </div>
                    <div>
                      <Label htmlFor="origin" className="text-xs">Posting Source</Label>
                      <Select id="origin" className="text-sm" value={jobForm.job_posting_origin} onChange={(e) => setJobForm((c) => ({ ...c, job_posting_origin: e.target.value }))}>
                        <option value="">Unknown</option>
                        {jobPostingOriginOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </div>
                    {jobForm.job_posting_origin === "other" && (
                      <Input className="text-sm" placeholder="Other source label" value={jobForm.job_posting_origin_other_text} onChange={(e) => setJobForm((c) => ({ ...c, job_posting_origin_other_text: e.target.value }))} />
                    )}
                    <div>
                      <Label htmlFor="jd" className="text-xs">Job Description</Label>
                      <Textarea id="jd" className="text-sm min-h-32" placeholder="Job description" value={jobForm.job_description} onChange={(e) => setJobForm((c) => ({ ...c, job_description: e.target.value }))} />
                    </div>
                    <div>
                      <Label htmlFor="job-location-detail" className="text-xs">Location</Label>
                      <Input
                        id="job-location-detail"
                        className="text-sm"
                        placeholder="e.g. British Columbia/Ontario or Toronto, Ontario"
                        value={jobForm.job_location_text}
                        onChange={(e) => setJobForm((c) => ({ ...c, job_location_text: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="compensation-detail" className="text-xs">Compensation</Label>
                      <Input
                        id="compensation-detail"
                        className="text-sm"
                        placeholder="e.g. $140,000 - $175,000 base salary"
                        value={jobForm.compensation_text}
                        onChange={(e) => setJobForm((c) => ({ ...c, compensation_text: e.target.value }))}
                      />
                    </div>
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
                <Card density="compact" className="p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Notes</h3>
                  <Textarea className="mt-3 text-sm min-h-24" placeholder="Add your own notes…" value={notesDraft} onChange={(e) => { setNotesDraft(e.target.value); setNotesState("idle"); }} />
                  <p className="mt-2 text-xs" style={{ color: "var(--color-ink-40)" }}>
                    {notesState === "saving" ? "Saving…" : notesState === "saved" ? "Saved." : "Autosaves when you pause typing."}
                  </p>
                </Card>
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
                      <option value="certifications">Certifications</option>
                      <option value="projects">Projects</option>
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
                  <button
                    onClick={() => { setShowSectionRegen(false); setRegenSectionName(""); setRegenInstructions(""); }}
                    disabled={isRegenerating}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "var(--radius-md)",
                      border: "none",
                      background: "transparent",
                      color: "var(--color-ink-50)",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: isRegenerating ? "not-allowed" : "pointer",
                      opacity: isRegenerating ? 0.5 : 1,
                      transition: "color 150ms, background 150ms",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-ink-05)"; e.currentTarget.style.color = "var(--color-ink)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--color-ink-50)"; }}
                  >
                    Cancel
                  </button>
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
                          {resumeJudge.regeneration_instructions}
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
                                void handleFullRegeneration(
                                  appendResumeJudgeFeedback(additionalInstructions, resumeJudge.regeneration_instructions),
                                );
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
        </>
      )}
    </div>
  );
}
