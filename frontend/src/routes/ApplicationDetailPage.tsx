import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { ChevronDown, CircleStop, FileText, Gauge, MessageSquare, Ruler, Sparkles, Trash2 } from "lucide-react";
import { useAppContext } from "@/components/layout/AppContext";
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
  fetchDraft,
  listBaseResumes,
  patchApplication,
  recoverApplicationFromSource,
  resolveDuplicate,
  retryExtraction,
  submitManualEntry,
  saveDraft,
  triggerFullRegeneration,
  triggerSectionRegeneration,
  exportDocx,
  exportPdf,
  triggerGeneration,
  cancelGeneration,
  type ApplicationDetail,
  type BaseResumeSummary,
  type ExtractionProgress,
  type ResumeDraft,
} from "@/lib/api";
import { AGGRESSIVENESS_OPTIONS, jobPostingOriginOptions, PAGE_LENGTH_OPTIONS } from "@/lib/application-options";
import { NOTIFICATIONS_CLEARED_EVENT } from "@/lib/events";

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

export function ApplicationDetailPage() {
  const navigate = useNavigate();
  const { refreshApplications } = useAppContext();
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
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [leftColumnHeight, setLeftColumnHeight] = useState<number | null>(null);
  const [jobDescriptionCollapsed, setJobDescriptionCollapsed] = useState(false);

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
  }), [detail, draft]);

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

  function applyDetailState(response: ApplicationDetail, options?: { refreshShell?: boolean }) {
    const generationActive = isGenerationWorkflowActive(response);
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
    if (!generationActive) {
      setIsCancelling(false);
      setShowOptimisticProgress(false);
    }
    if (options?.refreshShell) {
      void refreshApplications();
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
    setDraft(response);
    if (!response) return;
    const generationParams = response.generation_params ?? {};
    if (isAllowedPageLength(generationParams.page_length)) setPageLength(generationParams.page_length);
    if (isAllowedAggressiveness(generationParams.aggressiveness)) setAggressiveness(generationParams.aggressiveness);
    setAdditionalInstructions(
      typeof generationParams.additional_instructions === "string" ? generationParams.additional_instructions : "",
    );
  }

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
    if (!applicationId) return;
    fetchApplicationDetail(applicationId)
      .then((response) => { applyDetailState(response); setError(null); })
      .catch((err: Error) => setError(err.message));
  }, [applicationId]);

  useEffect(() => {
    if (!applicationId) return;
    const currentApplicationId = applicationId;

    function handleNotificationsCleared() {
      fetchApplicationDetail(currentApplicationId)
        .then((response) => {
          applyDetailState(response);
          setError(null);
        })
        .catch((err: Error) => setError(err.message));
    }

    window.addEventListener(NOTIFICATIONS_CLEARED_EVENT, handleNotificationsCleared);
    return () => window.removeEventListener(NOTIFICATIONS_CLEARED_EVENT, handleNotificationsCleared);
  }, [applicationId]);

  useEffect(() => {
    if (!applicationId) return;
    const shouldPoll = detail && EXTRACTION_POLL_STATES.includes(detail.internal_state);
    if (!shouldPoll) { setProgress(null); return; }
    let isCancelled = false;
    const pollProgress = async () => {
      if (isCancelled) return;
      try {
        const nextProgress = await fetchApplicationProgress(applicationId);
        if (isCancelled) return;
        setProgress(nextProgress);
        if (!EXTRACTION_POLL_STATES.includes(nextProgress.state) || nextProgress.completed_at || nextProgress.terminal_error_code) {
          if (isCancelled) return;
          try {
            const response = await fetchApplicationDetail(applicationId);
            if (isCancelled) return;
            applyDetailState(response, { refreshShell: true });
            if (EXTRACTION_POLL_STATES.includes(response.internal_state) && response.failure_reason === null) {
              applyTerminalExtractionFallback(nextProgress);
              if (isTerminalExtractionSuccess(nextProgress)) {
                setError(null);
              } else {
                setError(extractionFallbackMessage(nextProgress));
              }
            } else {
              setError(null);
            }
          } catch (requestError) {
            if (isCancelled) return;
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
          }
        }
      } catch { /* retry on next interval */ }
    };
    void pollProgress();
    const interval = window.setInterval(() => void pollProgress(), 2000);
    return () => { isCancelled = true; window.clearInterval(interval); };
  }, [applicationId, detail?.internal_state]);

  useEffect(() => {
    if (!applicationId) return;
    const shouldPoll = isGenerationWorkflowActive(detail);
    if (!shouldPoll) { setGenerationProgress(null); return; }
    let isCancelled = false;
    const pollProgress = async () => {
      if (isCancelled) return;
      try {
        const nextProgress = await fetchApplicationProgress(applicationId);
        if (isCancelled) return;
        setShowOptimisticProgress(false);
        setGenerationProgress(nextProgress);
        const stillGenerating = isGenerationProgressActive(nextProgress);
        if (!stillGenerating) {
          if (isCancelled) return;
          try {
            const response = await fetchApplicationDetail(applicationId);
            if (!isCancelled) {
              applyDetailState(response, { refreshShell: true });
              if (nextProgress.state === "resume_ready" && !nextProgress.terminal_error_code) {
                void fetchDraft(applicationId).then(applyDraftState).catch(() => {});
              }
              setError(null);
            }
          } catch (requestError) {
            if (isCancelled) return;
            applyTerminalGenerationFallback(nextProgress);
            setError(requestError instanceof Error ? requestError.message : "Generation finished, but the application could not be refreshed.");
          }
        }
      } catch { /* retry on next interval */ }
    };
    void pollProgress();
    const interval = window.setInterval(() => void pollProgress(), 2000);
    return () => { isCancelled = true; window.clearInterval(interval); };
  }, [applicationId, detail?.internal_state, detail?.failure_reason]);

  useEffect(() => {
    if (!applicationId || !detail) return;
    if (!["resume_ready", "regenerating_full", "regenerating_section"].includes(detail.internal_state)) return;
    fetchDraft(applicationId).then(applyDraftState).catch(() => {});
  }, [applicationId, detail?.internal_state]);

  useEffect(() => {
    if (!applicationId || !detail) return;
    if (notesDraft === (detail.notes ?? "")) return;
    const timeout = window.setTimeout(() => {
      setNotesState("saving");
      patchApplication(applicationId, { notes: notesDraft })
        .then((response) => { setDetail(response); setNotesState("saved"); })
        .catch((err: Error) => { setError(err.message); setNotesState("idle"); });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [applicationId, detail, notesDraft]);

  useEffect(() => {
    if (!detail) return;
    const extractionStates = ["extraction_pending", "extracting", "manual_entry_required", "duplicate_review_required"];
    if (extractionStates.includes(detail.internal_state)) return;
    listBaseResumes()
      .then((resumes) => {
        setBaseResumes(resumes);
        if (!selectedResumeId && resumes.length > 0) {
          const defaultResume = resumes.find((r) => r.is_default);
          if (defaultResume) setSelectedResumeId(defaultResume.id);
        }
      })
      .catch(() => {});
  }, [detail, selectedResumeId]);

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
      void refreshApplications();
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
    if (!selectedResumeId || !detail) return;
    if (isGenerationWorkflowActive(detail)) return;
    setIsGenerating(true);
    setShowOptimisticProgress(true);
    setError(null);
    try {
      const response = await triggerGeneration(activeApplicationId, {
        base_resume_id: selectedResumeId,
        target_length: pageLength,
        aggressiveness,
        additional_instructions: additionalInstructions || undefined,
      });
      applyDetailState(response, { refreshShell: true });
      setGenerationProgress(null);
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
      applyDraftState(updated);
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
    setEditMode(false);
    setEditContent("");
  }

  async function handleFullRegeneration() {
    if (!detail) return;
    if (isGenerationWorkflowActive(detail)) return;
    setIsRegenerating(true);
    setShowOptimisticProgress(true);
    setError(null);
    try {
      const response = await triggerFullRegeneration(activeApplicationId, {
        target_length: pageLength,
        aggressiveness,
        additional_instructions: additionalInstructions || undefined,
      });
      applyDetailState(response, { refreshShell: true });
      setGenerationProgress(null);
    } catch (err) {
      setShowOptimisticProgress(false);
      setIsRegenerating(false);
      setError(err instanceof Error ? err.message : "Unable to start regeneration.");
    }
  }

  async function handleSectionRegeneration() {
    if (!regenSectionName || !regenInstructions.trim()) return;
    if (!detail) return;
    if (isGenerationWorkflowActive(detail)) return;
    setIsRegenerating(true);
    setShowOptimisticProgress(true);
    setError(null);
    try {
      const response = await triggerSectionRegeneration(activeApplicationId, regenSectionName, regenInstructions);
      applyDetailState(response, { refreshShell: true });
      setGenerationProgress(null);
      setShowSectionRegen(false);
      setRegenSectionName("");
      setRegenInstructions("");
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
      const updated = await fetchApplicationDetail(activeApplicationId);
      applyDetailState(updated, { refreshShell: true });
      toast(`${format.toUpperCase()} exported successfully`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to export ${format.toUpperCase()}.`);
      toast(`Failed to export ${format.toUpperCase()}`, "error");
    } finally {
      setExportingFormat(null);
    }
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
    if (!leftColumn || !isPastExtraction) {
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
  }, [isPastExtraction, detail?.internal_state, draft, editMode, notesDraft, additionalInstructions, pageLength, aggressiveness, selectedResumeId, baseResumes.length, jobForm.job_description, jobForm.job_location_text, jobForm.compensation_text, jobForm.job_posting_origin, jobForm.job_posting_origin_other_text, jobForm.job_title, jobForm.company]);

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
            <div className="grid gap-4 xl:items-start xl:[grid-template-columns:minmax(300px,340px)_minmax(0,1fr)] 2xl:[grid-template-columns:minmax(320px,340px)_minmax(0,1fr)]">
              {/* LEFT COLUMN - Settings & Controls (shown second on mobile via order) */}
              <div ref={leftColumnRef} className="order-2 min-w-0 space-y-4 xl:order-1 xl:sticky xl:top-[calc(var(--topbar-height)+1.5rem)] xl:self-start">
                {/* Job Description Card */}
                <Card density="compact" className="p-4">
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
                              <input checked={pageLength === o.value} className="sr-only" name="pageLength" type="radio" value={o.value} onChange={() => setPageLength(o.value)} />
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
                              <input checked={aggressiveness === o.value} className="sr-only" name="aggressiveness" type="radio" value={o.value} onChange={() => setAggressiveness(o.value)} />
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
                        <Textarea className="text-sm min-h-16" placeholder="e.g., emphasize API architecture…" value={additionalInstructions} onChange={(e) => setAdditionalInstructions(e.target.value)} />
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
              <div className="order-1 min-w-0 xl:order-2">
                {/* Resume Content Area */}
                {generationActive || showOptimisticProgress ? (
                  /* Resume Skeleton during generation with overlay */
                  <Card className={`${workspaceCardClass} relative p-0`} style={workspaceCardStyle}>
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
                ) : draft ? (
                  /* Generated Resume Preview/Editor */
                  <Card className={`${workspaceCardClass} p-4`} style={workspaceCardStyle}>
                    <div className="flex min-w-0 items-center justify-between gap-3 overflow-hidden">
                      <h3 className="shrink-0 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Generated Resume</h3>
                      <div className="flex min-w-0 items-center gap-3 text-xs" style={{ color: "var(--color-ink-40)" }}>
                        {draft.last_exported_at && <span className="hidden sm:inline shrink-0">Exported {new Date(draft.last_exported_at).toLocaleString()}</span>}
                        <span className="truncate">Generated {new Date(draft.last_generated_at).toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
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
                          onClick={() => {
                            if (!editMode) handleEnterEditMode();
                          }}
                        >
                          Edit
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {!generationActive && (
                          <>
                            <Button size="sm" variant="secondary" disabled={isRegenerating || exportingFormat !== null} onClick={() => setShowSectionRegen(true)}>Regen Section</Button>
                            <button
                              type="button"
                              disabled={isRegenerating || exportingFormat !== null}
                              className="ai-button inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => void handleFullRegeneration()}
                            >
                              <Sparkles size={12} />
                              {isRegenerating ? "Starting…" : "Full Regen"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {editMode ? (
                      <div className="mt-4 flex-1 flex flex-col min-h-0 overflow-hidden" style={{ minHeight: "50vh" }}>
                        <MarkdownEditor
                          className="no-bottom-radius flex-1 min-h-0"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                        />
                        <div className="markdown-editor-footer flex-shrink-0">
                          <span>Markdown · {editContent.length.toLocaleString()} characters</span>
                          <span>Tab = 2 spaces</span>
                        </div>
                        <div className="mt-3 flex items-center gap-3 flex-shrink-0">
                          <Button size="sm" loading={isSavingDraft} disabled={isSavingDraft || !editContent.trim()} onClick={() => void handleSaveDraft()}>
                            {isSavingDraft ? "Saving…" : "Save Draft"}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={handleCancelEdit}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 flex-1 overflow-y-auto min-h-0 rounded-lg border bg-white px-5 py-4" style={{ borderColor: "var(--color-border)" }}>
                        <MarkdownPreview content={draft.content_md} className="resume-preview-markdown" />
                      </div>
                    )}
                  </Card>
                ) : (
                  /* Empty State - No resume generated yet */
                  <Card className={`${workspaceCardClass} items-center justify-center p-8 text-center`} style={workspaceCardStyle}>
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
                        !selectedResumeId ||
                        baseResumes.length === 0 ||
                        !detail.job_title ||
                        !detail.job_description ||
                        detail.duplicate_resolution_status === "pending"
                      }
                      className="ai-button inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void handleTriggerGeneration()}
                    >
                      <Sparkles size={16} />
                      Generate Resume
                    </button>
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
        </>
      )}
    </div>
  );
}
