import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppContext } from "@/components/layout/AppContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { GenerationProgress } from "@/components/ui/generation-progress";
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
    } catch (err) {
      setDetail(previous);
      setError(err instanceof Error ? err.message : "Unable to update applied state.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save settings.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save draft.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to export PDF.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="page-enter space-y-5">
      {/* Error banner */}
      {error && (
        <Card variant="danger">
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
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors" style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}>
                  <input type="checkbox" checked={detail.applied} onChange={(e) => void handleAppliedToggle(e.target.checked)} style={{ accentColor: "var(--color-spruce)" }} />
                  Applied
                </label>
                <a className="text-sm font-medium transition-colors" style={{ color: "var(--color-spruce)" }} href={detail.job_url} rel="noreferrer" target="_blank">
                  View Posting ↗
                </a>
              </div>
            }
          />

          {/* ── Extraction Progress ── */}
          {progress && ["extraction_pending", "extracting"].includes(detail.internal_state) && (
            <Card variant="success">
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-spruce)" }}>Extraction Progress</h3>
              <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--color-spruce-10)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${progress.percent_complete}%`, background: "var(--color-spruce)" }} />
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--color-ink)" }}>{progress.message}</p>
            </Card>
          )}

          {/* ── Blocked Source ── */}
          {detail.extraction_failure_details?.kind === "blocked_source" && (
            <Card variant="danger">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>Blocked Source</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>The job site blocked automated retrieval. Use pasted text or manual entry below.</p>
              <div className="mt-3 grid gap-2 rounded-lg border p-3 text-xs sm:grid-cols-2" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-50)" }}>
                <div><span className="font-semibold" style={{ color: "var(--color-ink)" }}>Provider:</span> {detail.extraction_failure_details.provider ?? "Unknown"}</div>
                <div><span className="font-semibold" style={{ color: "var(--color-ink)" }}>Ref ID:</span> {detail.extraction_failure_details.reference_id ?? "N/A"}</div>
                <div className="sm:col-span-2 break-all"><span className="font-semibold" style={{ color: "var(--color-ink)" }}>URL:</span> {detail.extraction_failure_details.blocked_url ?? detail.job_url}</div>
              </div>
            </Card>
          )}

          {/* ── Duplicate Warning ── */}
          {detail.duplicate_warning && (
            <Card variant="warning">
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

          {/* ── Company Missing Warning ── */}
          {!detail.company && detail.internal_state === "generation_pending" && !detail.failure_reason && (
            <Card variant="success">
              <p className="text-sm font-medium" style={{ color: "var(--color-spruce)" }}>Company is missing from extraction. Add it to enable duplicate review.</p>
            </Card>
          )}

          {/* ── Two-column: Job Info + Notes ── */}
          <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
            {/* Job Information */}
            <Card>
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Job Information</h3>
              <form className="mt-4 space-y-3" onSubmit={handleSaveJobInfo}>
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
                  <Textarea id="jd" className="min-h-48" placeholder="Job description" value={jobForm.job_description} onChange={(e) => setJobForm((c) => ({ ...c, job_description: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <Button loading={isSavingJobInfo} disabled={isSavingJobInfo} type="submit">
                    {isSavingJobInfo ? "Saving…" : "Save"}
                  </Button>
                  {(detail.failure_reason === "extraction_failed" || detail.internal_state === "manual_entry_required") && (
                    <Button type="button" variant="secondary" onClick={() => void handleRetryExtraction()}>Retry Extraction</Button>
                  )}
                </div>
              </form>
            </Card>

            {/* Notes + Manual Entry */}
            <div className="space-y-5">
              <Card>
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Notes</h3>
                <Textarea className="mt-3 min-h-32" placeholder="Add your own notes…" value={notesDraft} onChange={(e) => { setNotesDraft(e.target.value); setNotesState("idle"); }} />
                <p className="mt-2 text-xs" style={{ color: "var(--color-ink-40)" }}>
                  {notesState === "saving" ? "Saving…" : notesState === "saved" ? "Saved." : "Autosaves when you pause typing."}
                </p>
              </Card>

              {detail.internal_state === "manual_entry_required" && (
                <Card variant="danger">
                  <h3 className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>Manual Entry Required</h3>
                  <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
                    {detail.extraction_failure_details?.kind === "blocked_source"
                      ? "Source blocked. Paste text or enter details manually."
                      : "Extraction incomplete. Paste text or fill in details."}
                  </p>
                  <form className="mt-3 space-y-3" onSubmit={handleRecoverFromSource}>
                    <Textarea className="min-h-32" placeholder="Paste job posting text to retry extraction…" value={sourceTextDraft} onChange={(e) => setSourceTextDraft(e.target.value)} />
                    <div className="flex gap-2">
                      <Button loading={isRecoveringFromSource} disabled={isRecoveringFromSource || !sourceTextDraft.trim()} type="submit">Retry with Text</Button>
                      <Button type="button" variant="secondary" onClick={() => void handleRetryExtraction()}>Retry URL</Button>
                    </div>
                  </form>
                  <form className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: "var(--color-border)" }} onSubmit={handleManualEntrySubmit}>
                    <Label>Or submit manually</Label>
                    <Input placeholder="Job title" value={jobForm.job_title} onChange={(e) => setJobForm((c) => ({ ...c, job_title: e.target.value }))} required />
                    <Input placeholder="Company" value={jobForm.company} onChange={(e) => setJobForm((c) => ({ ...c, company: e.target.value }))} required />
                    <Textarea className="min-h-32" placeholder="Job description" value={jobForm.job_description} onChange={(e) => setJobForm((c) => ({ ...c, job_description: e.target.value }))} required />
                    <Button loading={isSubmittingManualEntry} disabled={isSubmittingManualEntry} type="submit">
                      {isSubmittingManualEntry ? "Saving…" : "Submit Manual Entry"}
                    </Button>
                  </form>
                </Card>
              )}
            </div>
          </div>

          {/* ── Generation Settings ── */}
          {(() => {
            const extractionStates = ["extraction_pending", "extracting", "manual_entry_required", "duplicate_review_required"];
            return !extractionStates.includes(detail.internal_state);
          })() && (
            <Card>
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Generation Settings</h3>
              <form className="mt-4 space-y-5" onSubmit={handleSaveSettings}>
                <div className="grid gap-5 lg:grid-cols-2">
                  {/* Base Resume */}
                  <div>
                    <Label>Base Resume</Label>
                    {baseResumes.length === 0 ? (
                      <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-50)" }}>
                        No base resumes yet. <Link className="font-medium" style={{ color: "var(--color-spruce)" }} to="/app/resumes">Create one</Link>
                      </div>
                    ) : (
                      <Select value={selectedResumeId ?? ""} onChange={(e) => setSelectedResumeId(e.target.value || null)}>
                        <option value="">Select a base resume</option>
                        {baseResumes.map((r) => <option key={r.id} value={r.id}>{r.name}{r.is_default ? " (default)" : ""}</option>)}
                      </Select>
                    )}
                  </div>
                  {/* Target Length */}
                  <div>
                    <Label>Target Length</Label>
                    <div className="flex flex-wrap gap-2">
                      {PAGE_LENGTH_OPTIONS.map((o) => (
                        <label key={o.value} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors" style={{ borderColor: pageLength === o.value ? "var(--color-spruce)" : "var(--color-border)", background: pageLength === o.value ? "var(--color-spruce-05)" : "var(--color-white)", color: pageLength === o.value ? "var(--color-spruce)" : "var(--color-ink)" }}>
                          <input checked={pageLength === o.value} className="sr-only" name="pageLength" type="radio" value={o.value} onChange={() => setPageLength(o.value)} />
                          {o.label}
                        </label>
                      ))}
                    </div>
                    <p className="mt-1.5 text-xs" style={{ color: "var(--color-ink-40)" }}>{PAGE_LENGTH_OPTIONS.find((o) => o.value === pageLength)?.description}</p>
                  </div>
                </div>

                {/* Aggressiveness */}
                <div>
                  <Label>Tailoring Aggressiveness</Label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {AGGRESSIVENESS_OPTIONS.map((o) => (
                      <label key={o.value} className="cursor-pointer rounded-lg border p-3 transition-colors" style={{ borderColor: aggressiveness === o.value ? "var(--color-spruce)" : "var(--color-border)", background: aggressiveness === o.value ? "var(--color-spruce-05)" : "var(--color-white)" }}>
                        <input checked={aggressiveness === o.value} className="sr-only" name="aggressiveness" type="radio" value={o.value} onChange={() => setAggressiveness(o.value)} />
                        <div className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{o.label}</div>
                        <div className="mt-1 text-xs" style={{ color: "var(--color-ink-50)" }}>{o.description}</div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Additional Instructions */}
                <div>
                  <Label>Additional Instructions (Optional)</Label>
                  <Textarea className="min-h-20" placeholder="e.g., emphasize API architecture, keep summary concise…" value={additionalInstructions} onChange={(e) => setAdditionalInstructions(e.target.value)} />
                  <p className="mt-1 text-xs" style={{ color: "var(--color-ink-40)" }}>Refines tone, emphasis, and keyword focus. Cannot add new facts.</p>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={isSavingSettings || !selectedResumeId || baseResumes.length === 0} type="submit">
                    {isSavingSettings ? "Saving…" : "Save Settings"}
                  </Button>
                  {(() => {
                    const generationActive = isGenerationWorkflowActive(detail);
                    const isGenDisabled = isGenerating || !selectedResumeId || baseResumes.length === 0 || !detail.job_title || !detail.job_description || detail.duplicate_resolution_status === "pending" || generationActive;
                    return (
                      <Button disabled={isGenDisabled} type="button" variant="secondary" onClick={() => void handleTriggerGeneration()}>
                        {isGenerating ? "Starting…" : "Generate Resume"}
                      </Button>
                    );
                  })()}
                </div>
              </form>
            </Card>
          )}

          {/* ── Generation Progress (rich component) ── */}
          {(isGenerationWorkflowActive(detail) || showOptimisticProgress) && (
            <GenerationProgress
              progress={generationProgress}
              isOptimistic={showOptimisticProgress}
              isActive={isGenerationWorkflowActive(detail)}
              isCancelling={isCancelling}
              onCancel={() => void handleCancelGeneration()}
            />
          )}

          {/* ── Generation Timeout ── */}
          {detail.failure_reason === "generation_timeout" && (
            <Card variant="warning">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-amber)" }}>Generation Timed Out</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{detail.generation_failure_details?.message ?? "The AI provider may be experiencing delays."}</p>
              <Button className="mt-3" size="sm" onClick={() => void handleTriggerGeneration()}>Retry</Button>
            </Card>
          )}

          {/* ── Generation Cancelled ── */}
          {detail.failure_reason === "generation_cancelled" && (
            <Card variant="success">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-spruce)" }}>Generation Cancelled</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>{detail.generation_failure_details?.message ?? "You can adjust settings and try again."}</p>
              <Button className="mt-3" size="sm" onClick={() => void handleTriggerGeneration()}>Retry</Button>
            </Card>
          )}

          {/* ── Generation Failed ── */}
          {(detail.failure_reason === "generation_failed" || detail.failure_reason === "regeneration_failed") && (
            <Card variant="danger">
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

          {/* ── Resume Draft ── */}
          {draft && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-ink-40)" }}>Generated Resume</h3>
                <div className="flex items-center gap-3 text-xs" style={{ color: "var(--color-ink-40)" }}>
                  {draft.last_exported_at && <span>Exported {new Date(draft.last_exported_at).toLocaleString()}</span>}
                  <span>Generated {new Date(draft.last_generated_at).toLocaleString()}</span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors" style={{ background: !editMode ? "var(--color-ink)" : "transparent", color: !editMode ? "#fff" : "var(--color-ink-50)", border: editMode ? "1px solid var(--color-border)" : "none" }} type="button" onClick={() => { if (editMode) handleCancelEdit(); }}>Preview</button>
                <button className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors" style={{ background: editMode ? "var(--color-ink)" : "transparent", color: editMode ? "#fff" : "var(--color-ink-50)", border: !editMode ? "1px solid var(--color-border)" : "none" }} type="button" onClick={() => { if (!editMode) handleEnterEditMode(); }}>Edit</button>

                <div className="ml-auto flex items-center gap-2">
                  {!isGenerationWorkflowActive(detail) && (
                    <>
                      <Button size="sm" variant="secondary" disabled={isRegenerating || isExporting} onClick={() => setShowSectionRegen(!showSectionRegen)}>Regen Section</Button>
                      <Button size="sm" variant="secondary" disabled={isRegenerating || isExporting} onClick={() => void handleFullRegeneration()}>
                        {isRegenerating ? "Starting…" : "Full Regen"}
                      </Button>
                      <Button size="sm" disabled={isExporting || isRegenerating} onClick={() => void handleExportPdf()}>
                        {isExporting ? "Exporting…" : "Export PDF"}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {showSectionRegen && (
                <div className="mt-3 space-y-3 rounded-lg border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-ink-05)" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Regenerate a section</p>
                  <Select value={regenSectionName} onChange={(e) => setRegenSectionName(e.target.value)}>
                    <option value="">Select section…</option>
                    <option value="summary">Summary</option>
                    <option value="professional_experience">Professional Experience</option>
                    <option value="education">Education</option>
                    <option value="skills">Skills</option>
                    <option value="certifications">Certifications</option>
                    <option value="projects">Projects</option>
                  </Select>
                  <Textarea className="min-h-16" placeholder="Instructions for regenerating (required)…" value={regenInstructions} onChange={(e) => setRegenInstructions(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={isRegenerating || !regenSectionName || !regenInstructions.trim()} onClick={() => void handleSectionRegeneration()}>
                      {isRegenerating ? "Regenerating…" : "Regenerate"}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => { setShowSectionRegen(false); setRegenSectionName(""); setRegenInstructions(""); }}>Cancel</Button>
                  </div>
                </div>
              )}

              {editMode ? (
                <div className="mt-4">
                  <textarea className="min-h-96 w-full rounded-lg border bg-white px-5 py-4 font-mono text-sm leading-relaxed outline-none transition focus:ring-2" style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }} value={editContent} onChange={(e) => setEditContent(e.target.value)} />
                  <div className="mt-3 flex items-center gap-3">
                    <Button size="sm" loading={isSavingDraft} disabled={isSavingDraft || !editContent.trim()} onClick={() => void handleSaveDraft()}>
                      {isSavingDraft ? "Saving…" : "Save Draft"}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={handleCancelEdit}>Cancel</Button>
                    <span className="text-xs" style={{ color: "var(--color-ink-40)" }}>Editing Markdown directly</span>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border bg-white px-5 py-4" style={{ borderColor: "var(--color-border)" }}>
                  <MarkdownPreview content={draft.content_md} />
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
