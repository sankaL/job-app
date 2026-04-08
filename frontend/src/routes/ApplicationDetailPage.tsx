import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { MarkdownPreview } from "@/components/MarkdownPreview";
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
  if (failureReason) {
    return "needs_action";
  }
  if (internalState === "resume_ready") {
    return "in_progress";
  }
  if (ACTIVE_GENERATION_STATES.includes(internalState) || internalState === "generation_pending") {
    return "draft";
  }
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

  function applyDetailState(response: ApplicationDetail) {
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
    if (!response) {
      return;
    }

    const generationParams = response.generation_params ?? {};
    if (isAllowedPageLength(generationParams.page_length)) {
      setPageLength(generationParams.page_length);
    }
    if (isAllowedAggressiveness(generationParams.aggressiveness)) {
      setAggressiveness(generationParams.aggressiveness);
    }
    setAdditionalInstructions(
      typeof generationParams.additional_instructions === "string" ? generationParams.additional_instructions : "",
    );
  }

  useEffect(() => {
    if (!applicationId) {
      return;
    }

    fetchApplicationDetail(applicationId)
      .then((response) => {
        applyDetailState(response);
        setError(null);
      })
      .catch((requestError: Error) => setError(requestError.message));
  }, [applicationId]);

  // Extraction progress polling
  useEffect(() => {
    if (!applicationId) {
      return;
    }

    const shouldPoll = detail && EXTRACTION_POLL_STATES.includes(detail.internal_state);
    if (!shouldPoll) {
      setProgress(null);
      return;
    }

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
          if (!isCancelled) {
            applyDetailState(response);
          }
        }
      } catch {
        // Silently fail, will retry on next interval
      }
    };

    void pollProgress();
    const interval = window.setInterval(() => void pollProgress(), 2000);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [applicationId, detail?.internal_state]);

  // Generation progress polling
  useEffect(() => {
    if (!applicationId) {
      return;
    }
    const shouldPoll = isGenerationWorkflowActive(detail);
    if (!shouldPoll) {
      setGenerationProgress(null);
      return;
    }

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
              applyDetailState(response);
              if (nextProgress.state === "resume_ready" && !nextProgress.terminal_error_code) {
                void fetchDraft(applicationId).then(applyDraftState).catch(() => {});
              }
              setError(null);
            }
          } catch (requestError) {
            if (isCancelled) return;
            applyTerminalGenerationFallback(nextProgress);
            setError(
              requestError instanceof Error
                ? requestError.message
                : "Generation finished, but the application could not be refreshed.",
            );
          }
        }
      } catch {
        // Silently fail, will retry on next interval
      }
    };

    void pollProgress();
    const interval = window.setInterval(() => void pollProgress(), 2000);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [applicationId, detail?.internal_state, detail?.failure_reason]);

  // Fetch draft when resume is ready
  useEffect(() => {
    if (!applicationId || !detail) {
      return;
    }
    if (!["resume_ready", "regenerating_full", "regenerating_section"].includes(detail.internal_state)) {
      return;
    }
    fetchDraft(applicationId).then(applyDraftState).catch(() => {});
  }, [applicationId, detail?.internal_state]);

  useEffect(() => {
    if (!applicationId || !detail) {
      return;
    }
    if (notesDraft === (detail.notes ?? "")) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNotesState("saving");
      patchApplication(applicationId, { notes: notesDraft })
        .then((response) => {
          setDetail(response);
          setNotesState("saved");
        })
        .catch((requestError: Error) => {
          setError(requestError.message);
          setNotesState("idle");
        });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [applicationId, detail, notesDraft]);

  // Fetch base resumes when generation settings should be visible
  useEffect(() => {
    if (!detail) {
      return;
    }
    const extractionStates = ["extraction_pending", "extracting", "manual_entry_required", "duplicate_review_required"];
    if (extractionStates.includes(detail.internal_state)) {
      return;
    }

    listBaseResumes()
      .then((resumes) => {
        setBaseResumes(resumes);
        // Set default resume if not already set
        if (!selectedResumeId && resumes.length > 0) {
          const defaultResume = resumes.find((r) => r.is_default);
          if (defaultResume) {
            setSelectedResumeId(defaultResume.id);
          }
        }
      })
      .catch(() => {
        // Silently fail - the UI will show "No base resumes yet"
      });
  }, [detail, selectedResumeId]);

  if (!applicationId) {
    return null;
  }
  const activeApplicationId = applicationId;

  async function handleAppliedToggle(applied: boolean) {
    if (!detail) {
      return;
    }

    const previous = detail;
    setDetail({ ...detail, applied });

    try {
      const response = await patchApplication(activeApplicationId, { applied });
      applyDetailState(response);
    } catch (requestError) {
      setDetail(previous);
      setError(requestError instanceof Error ? requestError.message : "Unable to update applied state.");
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
        job_posting_origin_other_text:
          jobForm.job_posting_origin === "other" ? jobForm.job_posting_origin_other_text : null,
      });
      applyDetailState(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save job information.");
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
        job_posting_origin_other_text:
          jobForm.job_posting_origin === "other" ? jobForm.job_posting_origin_other_text : null,
        notes: notesDraft || null,
      });
      applyDetailState(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to submit manual entry.");
    } finally {
      setIsSubmittingManualEntry(false);
    }
  }

  async function handleRetryExtraction() {
    try {
      const response = await retryExtraction(activeApplicationId);
      applyDetailState(response);
      setProgress(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to retry extraction.");
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
      applyDetailState(response);
      setProgress(null);
      setSourceTextDraft("");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to recover from pasted source text.",
      );
    } finally {
      setIsRecoveringFromSource(false);
    }
  }

  async function handleDuplicateDismissal() {
    try {
      const response = await resolveDuplicate(activeApplicationId, "dismissed");
      applyDetailState(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to dismiss duplicate warning.");
    }
  }

  async function handleOpenExistingApplication() {
    if (!detail?.duplicate_warning) {
      return;
    }

    try {
      await resolveDuplicate(activeApplicationId, "redirected");
      navigate(`/app/applications/${detail.duplicate_warning.matched_application.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to open matched application.");
    }
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedResumeId) {
      return;
    }
    setIsSavingSettings(true);
    setError(null);

    try {
      const response = await patchApplication(activeApplicationId, {
        base_resume_id: selectedResumeId,
      });
      applyDetailState(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save settings.");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleTriggerGeneration() {
    if (!selectedResumeId || !detail) {
      return;
    }
    // Prevent double-clicks by checking if already generating
    if (isGenerationWorkflowActive(detail)) {
      return;
    }
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
      applyDetailState(response);
      setGenerationProgress(null);
      // Keep showOptimisticProgress true - polling will clear it
      // Don't reset isGenerating here - let the detail state control the button
    } catch (requestError) {
      setShowOptimisticProgress(false);
      setIsGenerating(false);
      setError(requestError instanceof Error ? requestError.message : "Unable to start generation.");
    }
    // Note: isGenerating is intentionally NOT reset in finally block
    // The button disabled state should be driven by detail.internal_state
  }

  async function handleSaveDraft() {
    if (!editContent.trim()) return;
    setIsSavingDraft(true);
    setError(null);

    try {
      const updated = await saveDraft(activeApplicationId, editContent);
      applyDraftState(updated);
      setEditMode(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save draft.");
    } finally {
      setIsSavingDraft(false);
    }
  }

  function handleEnterEditMode() {
    if (draft) {
      setEditContent(draft.content_md);
      setEditMode(true);
    }
  }

  function handleCancelEdit() {
    setEditMode(false);
    setEditContent("");
  }

  async function handleFullRegeneration() {
    if (!detail) {
      return;
    }
    // Prevent double-clicks by checking if already regenerating
    if (isGenerationWorkflowActive(detail)) {
      return;
    }
    setIsRegenerating(true);
    setShowOptimisticProgress(true);
    setError(null);

    try {
      const response = await triggerFullRegeneration(activeApplicationId, {
        target_length: pageLength,
        aggressiveness,
        additional_instructions: additionalInstructions || undefined,
      });
      applyDetailState(response);
      setGenerationProgress(null);
      // Keep showOptimisticProgress true - polling will clear it
    } catch (requestError) {
      setShowOptimisticProgress(false);
      setIsRegenerating(false);
      setError(requestError instanceof Error ? requestError.message : "Unable to start regeneration.");
    }
    // Note: isRegenerating is intentionally NOT reset in finally block
    // The button disabled state should be driven by detail.internal_state
  }

  async function handleSectionRegeneration() {
    if (!regenSectionName || !regenInstructions.trim()) return;
    if (!detail) {
      return;
    }
    // Prevent double-clicks by checking if already regenerating
    if (isGenerationWorkflowActive(detail)) {
      return;
    }
    setIsRegenerating(true);
    setShowOptimisticProgress(true);
    setError(null);

    try {
      const response = await triggerSectionRegeneration(
        activeApplicationId,
        regenSectionName,
        regenInstructions,
      );
      applyDetailState(response);
      setGenerationProgress(null);
      setShowSectionRegen(false);
      setRegenSectionName("");
      setRegenInstructions("");
      // Keep showOptimisticProgress true - polling will clear it
    } catch (requestError) {
      setShowOptimisticProgress(false);
      setIsRegenerating(false);
      setError(requestError instanceof Error ? requestError.message : "Unable to start section regeneration.");
    }
    // Note: isRegenerating is intentionally NOT reset in finally block
    // The button disabled state should be driven by detail.internal_state
  }

  async function handleCancelGeneration() {
    setIsCancelling(true);
    setError(null);

    try {
      const response = await cancelGeneration(activeApplicationId);
      applyDetailState(response);
      setGenerationProgress(null);
      setShowOptimisticProgress(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to cancel generation.");
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
      // Refresh detail to pick up updated exported_at / visible_status
      const updated = await fetchApplicationDetail(activeApplicationId);
      applyDetailState(updated);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to export PDF.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Button variant="secondary" className="w-fit" onClick={() => navigate("/app")}>
        Back to dashboard
      </Button>

      {error ? (
        <Card className="border-ember/20 bg-ember/5 text-ember">
          <p className="font-semibold">Application request failed</p>
          <p className="mt-2 text-base">{error}</p>
        </Card>
      ) : null}

      {!detail ? (
        <Card className="animate-pulse">
          <div className="h-4 w-32 rounded bg-black/10" />
          <div className="mt-4 h-10 w-3/4 rounded bg-black/10" />
          <div className="mt-4 h-4 w-full rounded bg-black/10" />
        </Card>
      ) : (
        <>
          <Card className="bg-white/85">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={detail.visible_status} />
                  {detail.has_action_required_notification ? (
                    <span className="rounded-full bg-ember/10 px-3 py-1 text-xs font-semibold text-ember">
                      Action Required
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-4 font-display text-4xl text-ink">
                  {detail.job_title ?? "Awaiting extracted title"}
                </h2>
                <p className="mt-2 text-lg text-ink/65">
                  {detail.company ?? "Company still missing from extraction"}
                </p>
                <a
                  className="mt-4 inline-flex text-sm font-medium text-spruce hover:text-ink"
                  href={detail.job_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open source job posting
                </a>
              </div>

              <label className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-ink">
                <input
                  checked={detail.applied}
                  type="checkbox"
                  onChange={(event) => {
                    void handleAppliedToggle(event.target.checked);
                  }}
                />
                Applied
              </label>
            </div>
          </Card>

          {progress && ["extraction_pending", "extracting"].includes(detail.internal_state) ? (
            <Card className="bg-spruce text-white">
              <p className="text-sm uppercase tracking-[0.18em] text-white/90">Extraction progress</p>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white transition-all"
                  style={{ width: `${progress.percent_complete}%` }}
                />
              </div>
              <p className="mt-4 text-lg">{progress.message}</p>
              <p className="mt-2 text-sm text-white/95">Job {progress.job_id}</p>
            </Card>
          ) : null}

          {detail.extraction_failure_details?.kind === "blocked_source" ? (
            <Card className="border-ember/20 bg-ember/5">
              <p className="text-sm uppercase tracking-[0.18em] text-ember">Blocked source</p>
              <h3 className="mt-3 font-display text-3xl text-ink">
                The job site blocked automated retrieval.
              </h3>
              <p className="mt-3 text-ink/70">
                Use pasted job text from your browser if you have it, or complete manual entry below.
              </p>
              <div className="mt-4 grid gap-3 rounded-2xl border border-black/10 bg-white px-4 py-4 text-sm text-ink/70 md:grid-cols-2">
                <div>
                  <p className="font-semibold text-ink">Provider</p>
                  <p>{detail.extraction_failure_details.provider ?? "Unknown source"}</p>
                </div>
                <div>
                  <p className="font-semibold text-ink">Reference ID</p>
                  <p>{detail.extraction_failure_details.reference_id ?? "Unavailable"}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="font-semibold text-ink">Blocked URL</p>
                  <p className="break-all">{detail.extraction_failure_details.blocked_url ?? detail.job_url}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="font-semibold text-ink">Detected</p>
                  <p>{new Date(detail.extraction_failure_details.detected_at).toLocaleString()}</p>
                </div>
              </div>
            </Card>
          ) : null}

          {detail.duplicate_warning ? (
            <Card className="border-ember/20 bg-ember/5">
              <p className="text-sm uppercase tracking-[0.18em] text-ember">Duplicate review</p>
              <h3 className="mt-3 font-display text-3xl text-ink">
                Possible overlap detected with another application.
              </h3>
              <p className="mt-3 text-ink/70">
                Confidence score {detail.duplicate_warning.similarity_score.toFixed(2)} based on{" "}
                {detail.duplicate_warning.matched_fields.join(", ")}.
              </p>
              <div className="mt-4 rounded-2xl border border-black/10 bg-white px-4 py-4 text-sm text-ink/70">
                <p className="font-semibold text-ink">
                  {detail.duplicate_warning.matched_application.job_title ?? "Existing application"}
                </p>
                <p>{detail.duplicate_warning.matched_application.company ?? "Unknown company"}</p>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button onClick={() => void handleDuplicateDismissal()}>Proceed Anyway</Button>
                <Button variant="secondary" onClick={() => void handleOpenExistingApplication()}>
                  Open Existing Application
                </Button>
              </div>
            </Card>
          ) : null}

          {!detail.company && detail.internal_state === "generation_pending" && !detail.failure_reason ? (
            <Card className="border-spruce/20 bg-spruce/5">
              <p className="font-semibold text-spruce">Company missing from extraction</p>
              <p className="mt-2 text-ink/70">
                Add the company name to enable duplicate review on this application.
              </p>
            </Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
            <Card>
              <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Job information</p>
              <form className="mt-5 space-y-4" onSubmit={handleSaveJobInfo}>
                <Input
                  placeholder="Job title"
                  value={jobForm.job_title}
                  onChange={(event) => setJobForm((current) => ({ ...current, job_title: event.target.value }))}
                />
                <Input
                  placeholder="Company"
                  value={jobForm.company}
                  onChange={(event) => setJobForm((current) => ({ ...current, company: event.target.value }))}
                />
                <select
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink"
                  value={jobForm.job_posting_origin}
                  onChange={(event) =>
                    setJobForm((current) => ({
                      ...current,
                      job_posting_origin: event.target.value,
                    }))
                  }
                >
                  <option value="">Origin unknown</option>
                  {jobPostingOriginOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {jobForm.job_posting_origin === "other" ? (
                  <Input
                    placeholder="Other source label"
                    value={jobForm.job_posting_origin_other_text}
                    onChange={(event) =>
                      setJobForm((current) => ({
                        ...current,
                        job_posting_origin_other_text: event.target.value,
                      }))
                    }
                  />
                ) : null}
                <textarea
                  className="min-h-64 w-full rounded-[24px] border border-black/10 bg-white px-4 py-3 text-sm text-ink"
                  placeholder="Job description"
                  value={jobForm.job_description}
                  onChange={(event) =>
                    setJobForm((current) => ({ ...current, job_description: event.target.value }))
                  }
                />
                <div className="flex flex-wrap gap-3">
                  <Button disabled={isSavingJobInfo} type="submit">
                    {isSavingJobInfo ? "Saving…" : "Save Job Information"}
                  </Button>
                  {detail.failure_reason === "extraction_failed" || detail.internal_state === "manual_entry_required" ? (
                    <Button type="button" variant="secondary" onClick={() => void handleRetryExtraction()}>
                      Retry Extraction
                    </Button>
                  ) : null}
                </div>
              </form>
            </Card>

            <div className="flex flex-col gap-6">
              <Card>
                <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Notes</p>
                <textarea
                  className="mt-5 min-h-44 w-full rounded-[24px] border border-black/10 bg-white px-4 py-3 text-sm text-ink"
                  placeholder="Add your own notes for this application."
                  value={notesDraft}
                  onChange={(event) => {
                    setNotesDraft(event.target.value);
                    setNotesState("idle");
                  }}
                />
                <p className="mt-3 text-sm text-ink/50">
                  {notesState === "saving"
                    ? "Saving notes…"
                    : notesState === "saved"
                      ? "Notes saved."
                      : "Notes autosave after you pause typing."}
                </p>
              </Card>

              {detail.internal_state === "manual_entry_required" ? (
                <Card className="border-ember/20 bg-white">
                  <p className="text-sm uppercase tracking-[0.18em] text-ember">Manual entry</p>
                  <h3 className="mt-3 font-display text-3xl text-ink">
                    Extraction needs your help.
                  </h3>
                  <p className="mt-3 text-ink/70">
                    {detail.extraction_failure_details?.kind === "blocked_source"
                      ? "This source blocked automated retrieval. Paste the job posting text first if you have it, or complete the missing job details manually."
                      : "Automatic extraction did not produce the required fields. Paste the job posting text if you have it, or complete the missing job details manually."}
                  </p>
                  <form className="mt-5 space-y-4" onSubmit={handleRecoverFromSource}>
                    <textarea
                      className="min-h-44 w-full rounded-[24px] border border-black/10 bg-white px-4 py-3 text-sm text-ink"
                      placeholder="Paste job posting text from your browser to retry extraction."
                      value={sourceTextDraft}
                      onChange={(event) => setSourceTextDraft(event.target.value)}
                    />
                    <div className="flex flex-wrap gap-3">
                      <Button disabled={isRecoveringFromSource || !sourceTextDraft.trim()} type="submit">
                        {isRecoveringFromSource ? "Retrying…" : "Retry with Pasted Text"}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => void handleRetryExtraction()}>
                        Retry URL Extraction
                      </Button>
                    </div>
                  </form>
                  <form className="mt-5 space-y-4" onSubmit={handleManualEntrySubmit}>
                    <Input
                      placeholder="Job title"
                      value={jobForm.job_title}
                      onChange={(event) =>
                        setJobForm((current) => ({ ...current, job_title: event.target.value }))
                      }
                      required
                    />
                    <Input
                      placeholder="Company"
                      value={jobForm.company}
                      onChange={(event) =>
                        setJobForm((current) => ({ ...current, company: event.target.value }))
                      }
                      required
                    />
                    <textarea
                      className="min-h-48 w-full rounded-[24px] border border-black/10 bg-white px-4 py-3 text-sm text-ink"
                      placeholder="Job description"
                      value={jobForm.job_description}
                      onChange={(event) =>
                        setJobForm((current) => ({ ...current, job_description: event.target.value }))
                      }
                      required
                    />
                    <select
                      className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink"
                      value={jobForm.job_posting_origin}
                      onChange={(event) =>
                        setJobForm((current) => ({
                          ...current,
                          job_posting_origin: event.target.value,
                        }))
                      }
                    >
                      <option value="">Origin unknown</option>
                      {jobPostingOriginOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {jobForm.job_posting_origin === "other" ? (
                      <Input
                        placeholder="Other source label"
                        value={jobForm.job_posting_origin_other_text}
                        onChange={(event) =>
                          setJobForm((current) => ({
                            ...current,
                            job_posting_origin_other_text: event.target.value,
                          }))
                        }
                        required
                      />
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      <Button disabled={isSubmittingManualEntry} type="submit">
                        {isSubmittingManualEntry ? "Saving…" : "Submit Manual Entry"}
                      </Button>
                    </div>
                  </form>
                </Card>
              ) : null}
            </div>
          </div>

          {/* Generation Settings Section */}
          {(() => {
            const extractionStates = ["extraction_pending", "extracting", "manual_entry_required", "duplicate_review_required"];
            return !extractionStates.includes(detail.internal_state);
          })() ? (
            <Card>
              <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Generation Settings</p>
              <form className="mt-5 space-y-6" onSubmit={handleSaveSettings}>
                {/* Base Resume Selection */}
                <div>
                  <label className="block text-sm font-medium text-ink">Base Resume</label>
                  {baseResumes.length === 0 ? (
                    <div className="mt-2 rounded-2xl border border-black/10 bg-black/5 px-4 py-3 text-sm text-ink/70">
                      No base resumes yet.{" "}
                      <Link className="font-medium text-spruce hover:underline" to="/app/resumes">
                        Create one now
                      </Link>
                    </div>
                  ) : (
                    <select
                      className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink"
                      value={selectedResumeId ?? ""}
                      onChange={(event) => setSelectedResumeId(event.target.value || null)}
                    >
                      <option value="">Select a base resume</option>
                      {baseResumes.map((resume) => (
                        <option key={resume.id} value={resume.id}>
                          {resume.name}
                          {resume.is_default ? " (default)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Target Length */}
                <div>
                  <label className="block text-sm font-medium text-ink">Target Length</label>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {PAGE_LENGTH_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                          pageLength === option.value
                            ? "border-spruce bg-spruce text-white"
                            : "border-black/10 bg-white text-ink hover:border-black/20"
                        }`}
                      >
                        <input
                          checked={pageLength === option.value}
                          className="sr-only"
                          name="pageLength"
                          type="radio"
                          value={option.value}
                          onChange={() => setPageLength(option.value)}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Aggressiveness */}
                <div>
                  <label className="block text-sm font-medium text-ink">Tailoring Aggressiveness</label>
                  <div className="mt-2 space-y-2">
                    {AGGRESSIVENESS_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors ${
                          aggressiveness === option.value
                            ? "border-spruce bg-spruce/5"
                            : "border-black/10 bg-white hover:border-black/20"
                        }`}
                      >
                        <input
                          checked={aggressiveness === option.value}
                          className="mt-1"
                          name="aggressiveness"
                          type="radio"
                          value={option.value}
                          onChange={() => setAggressiveness(option.value)}
                        />
                        <div>
                          <p className="text-sm font-medium text-ink">{option.label}</p>
                          <p className="mt-1 text-sm text-ink/65">{option.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Additional Instructions */}
                <div>
                  <label className="block text-sm font-medium text-ink">Additional Instructions (Optional)</label>
                  <textarea
                    className="mt-2 min-h-24 w-full rounded-[24px] border border-black/10 bg-white px-4 py-3 text-sm text-ink"
                    placeholder="Add any specific instructions for the AI..."
                    value={additionalInstructions}
                    onChange={(event) => setAdditionalInstructions(event.target.value)}
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={isSavingSettings || !selectedResumeId || baseResumes.length === 0} type="submit">
                    {isSavingSettings ? "Saving…" : "Save Settings"}
                  </Button>
                  {(() => {
                    const generationActive = isGenerationWorkflowActive(detail);
                    const isGenDisabled =
                      isGenerating ||
                      !selectedResumeId ||
                      baseResumes.length === 0 ||
                      !detail.job_title ||
                      !detail.job_description ||
                      detail.duplicate_resolution_status === "pending" ||
                      generationActive;
                    let disabledReason = "";
                    if (isGenerating) disabledReason = "Generation is already in progress.";
                    else if (!selectedResumeId || baseResumes.length === 0) disabledReason = "Select a base resume to continue.";
                    else if (!detail.job_title) disabledReason = "Job title is required.";
                    else if (!detail.job_description) disabledReason = "Job description is required.";
                    else if (detail.duplicate_resolution_status === "pending") disabledReason = "Resolve the duplicate warning first.";
                    else if (generationActive) disabledReason = "Generation is in progress. Wait for completion or cancel.";
                    return (
                      <div className="flex flex-col gap-1">
                        <Button
                          disabled={isGenDisabled}
                          className="relative"
                          type="button"
                          variant="secondary"
                          onClick={() => void handleTriggerGeneration()}
                        >
                          {isGenerating ? "Starting…" : "Generate Resume"}
                        </Button>
                        {isGenDisabled && disabledReason && (
                          <p className="text-xs text-ember">{disabledReason}</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </form>
            </Card>
          ) : null}

          {/* Generation Progress */}
          {(isGenerationWorkflowActive(detail) || showOptimisticProgress) ? (
            <Card className="bg-spruce/10 border-spruce/20">
              <p className="text-sm uppercase tracking-[0.18em] text-spruce">Generation progress</p>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-spruce/10">
                <div
                  className={`h-full rounded-full bg-spruce transition-all ${
                    showOptimisticProgress && !generationProgress ? "animate-pulse" : ""
                  }`}
                  style={{ 
                    width: showOptimisticProgress && !generationProgress 
                      ? "5%" 
                      : `${generationProgress?.percent_complete ?? 10}%` 
                  }}
                />
              </div>
              <p className="mt-4 text-lg font-medium text-ink">
                {showOptimisticProgress && !generationProgress 
                  ? "Starting resume generation…" 
                  : generationProgress?.message ?? "Resume generation is starting…"}
              </p>
              {generationProgress?.job_id ? (
                <p className="mt-2 text-sm text-ink/60">Job {generationProgress.job_id}</p>
              ) : null}
              {isGenerationWorkflowActive(detail) ? (
                <div className="mt-4 flex gap-3">
                  <Button 
                    variant="secondary" 
                    className="bg-white text-ink hover:bg-white/90 border border-black/10 font-medium"
                    disabled={isCancelling}
                    onClick={() => void handleCancelGeneration()}
                  >
                    {isCancelling ? "Cancelling…" : "Cancel Generation"}
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}

          {/* Generation Timeout Warning */}
          {detail.failure_reason === "generation_timeout" ? (
            <Card className="border-amber/20 bg-amber/5">
              <p className="text-sm uppercase tracking-[0.18em] text-amber">Generation timed out</p>
              <h3 className="mt-3 font-display text-3xl text-ink">Resume generation took too long.</h3>
              <p className="mt-3 text-ink/70">
                {detail.generation_failure_details?.message ?? "The AI provider may be experiencing delays. You can retry with the same settings or adjust them."}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button onClick={() => void handleTriggerGeneration()}>Retry Generation</Button>
              </div>
            </Card>
          ) : null}

          {/* Generation Cancelled Notice */}
          {detail.failure_reason === "generation_cancelled" ? (
            <Card className="border-spruce/20 bg-spruce/5">
              <p className="text-sm uppercase tracking-[0.18em] text-spruce">Generation cancelled</p>
              <h3 className="mt-3 font-display text-3xl text-ink">Generation was cancelled.</h3>
              <p className="mt-3 text-ink/70">
                {detail.generation_failure_details?.message ?? "You can adjust your settings and try again."}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button onClick={() => void handleTriggerGeneration()}>Retry Generation</Button>
              </div>
            </Card>
          ) : null}

          {/* Validation / Generation Failure */}
          {detail.failure_reason === "generation_failed" || detail.failure_reason === "regeneration_failed" ? (
            <Card className="border-ember/20 bg-ember/5">
              <p className="text-sm uppercase tracking-[0.18em] text-ember">Generation failed</p>
              <h3 className="mt-3 font-display text-3xl text-ink">
                {detail.generation_failure_details?.message ?? "Resume generation encountered errors."}
              </h3>
              {detail.generation_failure_details?.validation_errors &&
              detail.generation_failure_details.validation_errors.length > 0 ? (
                <ul className="mt-4 list-disc space-y-2 pl-6 text-sm text-ink/70">
                  {detail.generation_failure_details.validation_errors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  disabled={isGenerating || !selectedResumeId}
                  onClick={() => void handleTriggerGeneration()}
                >
                  {isGenerating ? "Starting…" : "Retry Generation"}
                </Button>
              </div>
            </Card>
          ) : null}

          {/* Resume Draft Preview / Editor */}
          {draft ? (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Generated Resume</p>
                <div className="flex flex-wrap items-center gap-3">
                  {draft.last_exported_at ? (
                    <p className="text-xs text-ink/40">
                      Exported {new Date(draft.last_exported_at).toLocaleString()}
                    </p>
                  ) : null}
                  <p className="text-sm text-ink/50">
                    Generated {new Date(draft.last_generated_at).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Edit / Preview toggle and action buttons */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    !editMode
                      ? "bg-spruce text-white"
                      : "border border-black/10 bg-white text-ink hover:bg-black/5"
                  }`}
                  type="button"
                  onClick={() => { if (editMode) handleCancelEdit(); }}
                >
                  Preview
                </button>
                <button
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    editMode
                      ? "bg-spruce text-white"
                      : "border border-black/10 bg-white text-ink hover:bg-black/5"
                  }`}
                  type="button"
                  onClick={() => { if (!editMode) handleEnterEditMode(); }}
                >
                  Edit
                </button>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {!isGenerationWorkflowActive(detail) ? (
                    <>
                      <Button
                        disabled={isRegenerating || isExporting}
                        variant="secondary"
                        onClick={() => setShowSectionRegen(!showSectionRegen)}
                      >
                        Regen Section
                      </Button>
                      <Button
                        disabled={isRegenerating || isExporting}
                        variant="secondary"
                        onClick={() => void handleFullRegeneration()}
                      >
                        {isRegenerating ? "Starting…" : "Full Regen"}
                      </Button>
                      <Button
                        disabled={isExporting || isRegenerating}
                        onClick={() => void handleExportPdf()}
                      >
                        {isExporting ? "Exporting…" : "Export PDF"}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Section regeneration dialog */}
              {showSectionRegen ? (
                <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4 space-y-3">
                  <p className="text-sm font-medium text-ink">Regenerate a section</p>
                  <select
                    className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink"
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
                  </select>
                  <textarea
                    className="min-h-20 w-full rounded-[24px] border border-black/10 bg-white px-4 py-3 text-sm text-ink"
                    placeholder="Instructions for regenerating this section (required)…"
                    value={regenInstructions}
                    onChange={(e) => setRegenInstructions(e.target.value)}
                  />
                  <div className="flex gap-3">
                    <Button
                      disabled={isRegenerating || !regenSectionName || !regenInstructions.trim()}
                      onClick={() => void handleSectionRegeneration()}
                    >
                      {isRegenerating ? "Regenerating…" : "Regenerate"}
                    </Button>
                    <Button variant="secondary" onClick={() => { setShowSectionRegen(false); setRegenSectionName(""); setRegenInstructions(""); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* Draft content: edit mode vs preview mode */}
              {editMode ? (
                <div className="mt-5">
                  <textarea
                    className="min-h-96 w-full rounded-[24px] border border-black/10 bg-white px-6 py-5 font-mono text-sm text-ink leading-relaxed"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      disabled={isSavingDraft || !editContent.trim()}
                      onClick={() => void handleSaveDraft()}
                    >
                      {isSavingDraft ? "Saving…" : "Save Draft"}
                    </Button>
                    <Button variant="secondary" onClick={handleCancelEdit}>
                      Cancel
                    </Button>
                    <p className="text-sm text-ink/50">Editing Markdown directly. Save to persist changes.</p>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-black/10 bg-white px-6 py-5">
                  <MarkdownPreview content={draft.content_md} />
                </div>
              )}
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
