import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { FileText, Gauge, MessageSquare, Ruler, Sparkles } from "lucide-react";
import { useAppContext } from "@/components/layout/AppContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useToast } from "@/components/ui/toast";
import { StatusBadge } from "@/components/StatusBadge";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { GenerationProgress, ResumeSkeleton } from "@/components/ui/generation-progress";
import { SkeletonCard } from "@/components/ui/skeleton";
import {
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
  exportPdf,
  triggerGeneration,
  cancelGeneration,
  type ApplicationDetail,
  type BaseResumeSummary,
  type ExtractionProgress,
  type ResumeDraft,
} from "@/lib/api";
import { AGGRESSIVENESS_OPTIONS, jobPostingOriginOptions, PAGE_LENGTH_OPTIONS } from "@/lib/application-options";

type JobFormState = {
  job_title: string;
  company: string;
  job_description: string;
  job_posting_origin: string;
  job_posting_origin_other_text: string;
};

const EXTRACTION_POLL_STATES = ["extraction_pending", "extracting"];
const ACTIVE_GENERATION_STATES = ["generating", "regenerating_full", "regenerating_section"];
const ACTIVE_GENERATION_PROGRESS_STATES = [
  "generation_pending",
  "generating",
  "regenerating_full",
  "regenerating_section",
];

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
  const [isExporting, setIsExporting] = useState(false);
  const [showSectionRegen, setShowSectionRegen] = useState(false);
  const [regenSectionName, setRegenSectionName] = useState("");
  const [regenInstructions, setRegenInstructions] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showOptimisticProgress, setShowOptimisticProgress] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showAppliedConfirm, setShowAppliedConfirm] = useState(false);

  // Ref for measuring left column height
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const [leftColumnHeight, setLeftColumnHeight] = useState<number | null>(null);

  // Track last saved values for dirty state detection
  const savedJobForm = useMemo(() => ({
    job_title: detail?.job_title ?? "",
    company: detail?.company ?? "",
    job_description: detail?.job_description ?? "",
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

  function applyDetailState(response: ApplicationDetail, options?: { refreshShell?: boolean }) {
    const generationActive = isGenerationWorkflowActive(response);
    setDetail(response);
    setNotesDraft(response.notes ?? "");
    setJobForm({
      job_title: response.job_title ?? "",
      company: response.company ?? "",
      job_description: response.job_description ?? "",
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
    if (!applicationId) return;
    fetchApplicationDetail(applicationId)
      .then((response) => { applyDetailState(response); setError(null); })
      .catch((err: Error) => setError(err.message));
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
          const response = await fetchApplicationDetail(applicationId);
          if (!isCancelled) applyDetailState(response, { refreshShell: true });
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

  async function handleExportPdf() {
    setIsExporting(true);
    setError(null);
    try {
      const blob = await exportPdf(activeApplicationId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `resume-${detail?.job_title?.replace(/\s+/g, "-").toLowerCase() ?? activeApplicationId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      const updated = await fetchApplicationDetail(activeApplicationId);
      applyDetailState(updated, { refreshShell: true });
      toast("PDF exported successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to export PDF.");
      toast("Failed to export PDF", "error");
    } finally {
      setIsExporting(false);
    }
  }

  // Helper to check if we're past the extraction-only phase.
  const isPastExtraction =
    detail && !["extraction_pending", "extracting", "manual_entry_required"].includes(detail.internal_state);
  const generationActive = isGenerationWorkflowActive(detail);

  // Measure left column height for right column matching
  useLayoutEffect(() => {
    const leftColumn = leftColumnRef.current;
    if (!leftColumn || !isPastExtraction) return;

    const updateHeight = () => {
      const height = leftColumn.offsetHeight;
      setLeftColumnHeight(height > 0 ? height : null);
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      updateHeight();
    });

    resizeObserver.observe(leftColumn);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isPastExtraction]);

  return (
    <div className="page-enter space-y-4">
      {/* Error banner */}
      {error && (
        <Card variant="danger" className="p-4">
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
              <div className="flex items-center gap-2">
                {detail.has_action_required_notification && (
                  <span className="rounded-md px-2 py-1 text-[10px] font-bold uppercase" style={{ background: "var(--color-ember-10)", color: "var(--color-ember)" }}>
                    Action Required
                  </span>
                )}
                <button
                  onClick={handleAppliedButtonClick}
                  className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all"
                  style={{
                    background: detail.applied ? "var(--color-spruce)" : "transparent",
                    color: detail.applied ? "#fff" : "var(--color-ink-50)",
                    border: detail.applied ? "1px solid var(--color-spruce)" : "1px solid var(--color-border)",
                  }}
                  onMouseEnter={(e) => {
                    if (!detail.applied) {
                      e.currentTarget.style.borderColor = "var(--color-spruce)";
                      e.currentTarget.style.color = "var(--color-spruce)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!detail.applied) {
                      e.currentTarget.style.borderColor = "var(--color-border)";
                      e.currentTarget.style.color = "var(--color-ink-50)";
                    }
                  }}
                >
                  {detail.applied ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                      </svg>
                      Applied
                    </>
                  ) : (
                    "Mark Applied"
                  )}
                </button>
                <a className="text-sm font-medium transition-colors" style={{ color: "var(--color-spruce)" }} href={detail.job_url} rel="noreferrer" target="_blank">
                  View Posting ↗
                </a>
              </div>
            }
          />

          {/* ── Alert Banners (full width, above two-column layout) ── */}
          
          {/* Extraction Progress */}
          {progress && ["extraction_pending", "extracting"].includes(detail.internal_state) && (
            <Card variant="success" className="p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-spruce)" }}>Extraction Progress</h3>
              <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--color-spruce-10)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${progress.percent_complete}%`, background: "var(--color-spruce)" }} />
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--color-ink)" }}>{progress.message}</p>
            </Card>
          )}

          {/* Blocked Source */}
          {detail.extraction_failure_details?.kind === "blocked_source" && (
            <Card variant="danger" className="p-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>Blocked Source</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>The job site blocked automated retrieval. Use pasted text or manual entry below.</p>
              <div className="mt-3 grid gap-2 rounded-lg border p-3 text-xs sm:grid-cols-2" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-50)" }}>
                <div><span className="font-semibold" style={{ color: "var(--color-ink)" }}>Provider:</span> {detail.extraction_failure_details.provider ?? "Unknown"}</div>
                <div><span className="font-semibold" style={{ color: "var(--color-ink)" }}>Ref ID:</span> {detail.extraction_failure_details.reference_id ?? "N/A"}</div>
                <div className="sm:col-span-2 break-all"><span className="font-semibold" style={{ color: "var(--color-ink)" }}>URL:</span> {detail.extraction_failure_details.blocked_url ?? detail.job_url}</div>
              </div>
            </Card>
          )}

          {/* Duplicate Warning */}
          {detail.duplicate_warning && (
            <Card variant="warning" className="p-4">
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
            <Card variant="success" className="p-4">
              <p className="text-sm font-medium" style={{ color: "var(--color-spruce)" }}>Company is missing from extraction. Add it to enable duplicate review.</p>
            </Card>
          )}

          {/* Generation Timeout */}
          {detail.failure_reason === "generation_timeout" && (
            <Card variant="warning" className="p-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-amber)" }}>Generation Timed Out</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{detail.generation_failure_details?.message ?? "The AI provider may be experiencing delays."}</p>
              <Button className="mt-3" size="sm" onClick={() => void handleTriggerGeneration()}>Retry</Button>
            </Card>
          )}

          {/* Generation Cancelled */}
          {detail.failure_reason === "generation_cancelled" && (
            <Card variant="success" className="p-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-spruce)" }}>Generation Cancelled</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{detail.generation_failure_details?.message ?? "You can adjust settings and try again."}</p>
              <Button className="mt-3" size="sm" onClick={() => void handleTriggerGeneration()}>Retry</Button>
            </Card>
          )}

          {/* Generation Failed */}
          {(detail.failure_reason === "generation_failed" || detail.failure_reason === "regeneration_failed") && (
            <Card variant="danger" className="p-4">
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
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Job Information */}
              <Card className="p-4">
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
                <Card className="p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Notes</h3>
                  <Textarea className="mt-3 min-h-24" placeholder="Add your own notes…" value={notesDraft} onChange={(e) => { setNotesDraft(e.target.value); setNotesState("idle"); }} />
                  <p className="mt-2 text-xs" style={{ color: "var(--color-ink-40)" }}>
                    {notesState === "saving" ? "Saving…" : notesState === "saved" ? "Saved." : "Autosaves when you pause typing."}
                  </p>
                </Card>

                <Card variant="danger" className="p-4">
                  <h3 className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>Manual Entry Required</h3>
                  <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
                    {detail.extraction_failure_details?.kind === "blocked_source"
                      ? "Source blocked. Paste text or enter details manually."
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
            <div className="flex gap-4 items-start">
              {/* LEFT COLUMN - Settings & Controls */}
              <div ref={leftColumnRef} className="flex-1 space-y-4 min-w-0" style={{ flex: "1 1 25%", maxWidth: "320px" }}>
                {/* Job Description Card */}
                <Card className="p-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Job Description</h3>
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
                  </div>
                </Card>

                {/* Generation Settings Card */}
                {detail.internal_state !== "duplicate_review_required" && (
                  <Card className="p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Generation Settings</h3>
                    <form className="mt-3 space-y-3" onSubmit={handleSaveSettings}>
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
                              <div className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>{o.label}</div>
                              <div className="text-[10px]" style={{ color: "var(--color-ink-50)" }}>{o.description}</div>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Additional Instructions */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <MessageSquare size={14} className="flex-shrink-0" style={{ color: "var(--color-ink-40)" }} />
                          <Label className="inline text-xs font-medium">Additional Instructions</Label>
                        </div>
                        <Textarea className="text-sm min-h-16" placeholder="e.g., emphasize API architecture…" value={additionalInstructions} onChange={(e) => setAdditionalInstructions(e.target.value)} />
                      </div>

                      {/* Save Button */}
                      <div className="pt-2">
                        <Button
                          size="sm"
                          disabled={isSavingSettings || !selectedResumeId || baseResumes.length === 0 || !settingsDirty}
                          type="submit"
                          className={!settingsDirty ? "opacity-50 cursor-not-allowed" : ""}
                        >
                          {isSavingSettings ? "Saving…" : "Save Settings"}
                        </Button>
                      </div>
                    </form>
                  </Card>
                )}

                {/* Notes Card */}
                <Card className="p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Notes</h3>
                  <Textarea className="mt-3 text-sm min-h-24" placeholder="Add your own notes…" value={notesDraft} onChange={(e) => { setNotesDraft(e.target.value); setNotesState("idle"); }} />
                  <p className="mt-2 text-xs" style={{ color: "var(--color-ink-40)" }}>
                    {notesState === "saving" ? "Saving…" : notesState === "saved" ? "Saved." : "Autosaves when you pause typing."}
                  </p>
                </Card>
              </div>

              {/* RIGHT COLUMN - Resume Preview */}
              <div className="flex-1 min-w-0" style={{ flex: "3 1 75%", height: leftColumnHeight ? `${leftColumnHeight}px` : undefined }}>
                {/* Resume Content Area */}
                {generationActive || showOptimisticProgress ? (
                  /* Resume Skeleton during generation with overlay */
                  <Card className="h-full flex flex-col p-0 overflow-hidden relative">
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
                  <Card className="h-full flex flex-col p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
                      <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Generated Resume</h3>
                      <div className="flex items-center gap-3 text-xs" style={{ color: "var(--color-ink-40)" }}>
                        {draft.last_exported_at && <span>Exported {new Date(draft.last_exported_at).toLocaleString()}</span>}
                        <span>Generated {new Date(draft.last_generated_at).toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 flex-shrink-0">
                      <button className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors" style={{ background: !editMode ? "var(--color-ink)" : "transparent", color: !editMode ? "#fff" : "var(--color-ink-50)", border: editMode ? "1px solid var(--color-border)" : "none" }} type="button" onClick={() => { if (editMode) handleCancelEdit(); }}>Preview</button>
                      <button className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors" style={{ background: editMode ? "var(--color-ink)" : "transparent", color: editMode ? "#fff" : "var(--color-ink-50)", border: !editMode ? "1px solid var(--color-border)" : "none" }} type="button" onClick={() => { if (!editMode) handleEnterEditMode(); }}>Edit</button>

                      <div className="ml-auto flex items-center gap-2">
                        {!generationActive && (
                          <>
                            <Button size="sm" variant="secondary" disabled={isRegenerating || isExporting} onClick={() => setShowSectionRegen(true)}>Regen Section</Button>
                            <button
                              type="button"
                              disabled={isRegenerating || isExporting}
                              className="ai-button inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => void handleFullRegeneration()}
                            >
                              <Sparkles size={12} />
                              {isRegenerating ? "Starting…" : "Full Regen"}
                            </button>
                            <Button size="sm" disabled={isExporting || isRegenerating} onClick={() => void handleExportPdf()}>
                              {isExporting ? "Exporting…" : "Export PDF"}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {editMode ? (
                      <div className="mt-4 flex-1 flex flex-col min-h-0 overflow-hidden">
                        <textarea
                          className="markdown-editor no-bottom-radius flex-1 overflow-y-auto min-h-0"
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
                        <MarkdownPreview content={draft.content_md} />
                      </div>
                    )}
                  </Card>
                ) : (
                  /* Empty State - No resume generated yet */
                  <Card className="h-full flex flex-col p-8 items-center justify-center text-center">
                    <div className="rounded-full p-4 mb-4" style={{ background: "var(--color-ink-05)" }}>
                      <FileText size={32} style={{ color: "var(--color-ink-40)" }} />
                    </div>
                    <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--color-ink)" }}>No Resume Generated Yet</h3>
                    <p className="text-sm mb-4" style={{ color: "var(--color-ink-50)" }}>
                      Configure your settings on the left and click "Generate Resume" to get started.
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
