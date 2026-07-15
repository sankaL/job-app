import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, FileText, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModalActions, ModalError, ModalShell } from "@/components/ui/modal-shell";
import { Textarea } from "@/components/ui/textarea";

type CreateApplicationSubmission = {
  job_url?: string;
  source_text?: string;
};

type CreateApplicationModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateApplicationSubmission) => Promise<void>;
};

const SOURCE_MODE_OPTIONS = [
  { value: "link", label: "Job link", icon: Link2 },
  { value: "paste", label: "Paste description", icon: FileText },
] as const;

export function CreateApplicationModal({ open, onClose, onSubmit }: CreateApplicationModalProps) {
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const [sourceMode, setSourceMode] = useState<"link" | "paste">("link");
  const [jobUrl, setJobUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [showSourceText, setShowSourceText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  function resetState() {
    setSourceMode("link");
    setJobUrl("");
    setSourceText("");
    setShowSourceText(false);
    setError(null);
    isSubmittingRef.current = false;
    setIsSubmitting(false);
  }

  function handleClose() {
    if (isSubmittingRef.current) {
      return;
    }
    resetState();
    onClose();
  }

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }

    const focusHandle = window.requestAnimationFrame(() => {
      if (sourceMode === "paste") {
        document.getElementById("new-application-source-text")?.focus();
      } else {
        urlInputRef.current?.focus();
      }
    });

    return () => {
      window.cancelAnimationFrame(focusHandle);
    };
  }, [open, sourceMode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const trimmedJobUrl = jobUrl.trim();
    const trimmedSourceText = sourceText.trim();
    if (sourceMode === "link" && !trimmedJobUrl) {
      setError("Job URL is required.");
      return;
    }
    if (sourceMode === "paste" && !trimmedSourceText) {
      setError("Job description is required.");
      return;
    }

    setError(null);
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      await onSubmit({
        job_url: trimmedJobUrl || undefined,
        source_text: trimmedSourceText || undefined,
      });
      resetState();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create application.");
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <ModalShell
      open={open}
      title="New Application"
      description="Start from a job link or paste the job description directly."
      icon={<Link2 size={14} aria-hidden="true" />}
      closeLabel="Close new application modal"
      onClose={handleClose}
      closeDisabled={isSubmitting}
    >
        <form className="px-6 pb-6 pt-5" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div
              className="grid grid-cols-2 gap-1 rounded-xl border p-1"
              style={{ borderColor: "var(--color-border)", background: "var(--color-ink-05)" }}
            >
              {SOURCE_MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = sourceMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setSourceMode(option.value);
                      setShowSourceText(option.value === "paste");
                      setError(null);
                    }}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-all"
                    style={{
                      background: active ? "var(--color-white)" : "transparent",
                      color: active ? "var(--color-spruce)" : "var(--color-ink-65)",
                      boxShadow: active ? "0 1px 6px rgba(16, 24, 40, 0.08)" : "none",
                    }}
                    aria-pressed={active}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>

            <div>
              <Label htmlFor="new-application-job-url">
                {sourceMode === "paste" ? "Source URL (optional)" : "Job URL"}
              </Label>
              <Input
                ref={urlInputRef}
                id="new-application-job-url"
                aria-label={sourceMode === "paste" ? "Source URL" : "Job URL"}
                placeholder="https://company.example/jobs/platform-engineer"
                type="url"
                value={jobUrl}
                onChange={(event) => setJobUrl(event.target.value)}
                required={sourceMode === "link"}
              />
            </div>

            {sourceMode === "link" && !showSourceText ? (
              <button
                type="button"
                onClick={() => {
                  setShowSourceText(true);
                  setError(null);
                }}
                className="inline-flex items-center gap-2 text-sm font-semibold transition-colors"
                style={{ color: "var(--color-spruce)" }}
              >
                <FileText size={14} aria-hidden="true" />
                Add pasted description
              </button>
            ) : null}

            {(sourceMode === "paste" || showSourceText) && (
              <div className="animate-fadeInUp">
                <Label htmlFor="new-application-source-text">
                  {sourceMode === "paste" ? "Job Description" : "Pasted Job Description"}
                </Label>
                <Textarea
                  id="new-application-source-text"
                  aria-label={sourceMode === "paste" ? "Job Description" : "Pasted Job Description"}
                  className="min-h-[180px]"
                  placeholder="Paste the job description, qualifications, and any relevant posting text."
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  required={sourceMode === "paste"}
                />
                <p className="mt-2 text-xs leading-5" style={{ color: "var(--color-ink-40)" }}>
                  {sourceMode === "paste"
                    ? "Applix will infer the job details from this text and ask for manual entry only if required fields are missing."
                    : "The pasted text is used to improve extraction startup for this new application."}
                </p>
              </div>
            )}

            <ModalError message={error} />
          </div>
          <ModalActions
            onCancel={handleClose}
            submitting={isSubmitting}
            submitLabel={
              <>
                {!isSubmitting && <ArrowRight size={14} aria-hidden="true" />}
                {sourceMode === "paste" ? "Create From Description" : showSourceText ? "Create With Pasted Text" : "Create Application"}
              </>
            }
          />
        </form>
    </ModalShell>
  );
}
