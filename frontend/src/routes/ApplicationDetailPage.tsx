import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import {
  fetchApplicationDetail,
  fetchApplicationProgress,
  listBaseResumes,
  patchApplication,
  recoverApplicationFromSource,
  resolveDuplicate,
  retryExtraction,
  submitManualEntry,
  type ApplicationDetail,
  type BaseResumeSummary,
  type ExtractionProgress,
} from "@/lib/api";
import { AGGRESSIVENESS_OPTIONS, jobPostingOriginOptions, PAGE_LENGTH_OPTIONS } from "@/lib/application-options";

type JobFormState = {
  job_title: string;
  company: string;
  job_description: string;
  job_posting_origin: string;
  job_posting_origin_other_text: string;
};

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

  function applyDetailState(response: ApplicationDetail) {
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

  useEffect(() => {
    if (!applicationId || !detail) {
      return;
    }
    if (!["extraction_pending", "extracting"].includes(detail.internal_state)) {
      return;
    }

    const interval = window.setInterval(() => {
      fetchApplicationProgress(applicationId)
        .then((nextProgress) => {
          setProgress(nextProgress);
          if (!["extraction_pending", "extracting"].includes(nextProgress.state)) {
            void fetchApplicationDetail(applicationId).then((response) => {
              applyDetailState(response);
            });
          }
        })
        .catch(() => {});
    }, 2000);

    return () => window.clearInterval(interval);
  }, [applicationId, detail]);

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
              <p className="text-sm uppercase tracking-[0.18em] text-white/55">Extraction progress</p>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white transition-all"
                  style={{ width: `${progress.percent_complete}%` }}
                />
              </div>
              <p className="mt-4 text-lg">{progress.message}</p>
              <p className="mt-2 text-sm text-white/70">Job {progress.job_id}</p>
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

          {!detail.company && detail.internal_state === "generation_pending" ? (
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
                <div className="flex flex-wrap gap-3">
                  <Button disabled={isSavingSettings || !selectedResumeId || baseResumes.length === 0} type="submit">
                    {isSavingSettings ? "Saving…" : "Save Settings"}
                  </Button>
                  <Button
                    disabled
                    className="relative"
                    title="Generation will be available in the next update"
                    type="button"
                    variant="secondary"
                  >
                    Generate Resume
                    <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-xs">Coming Soon</span>
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
