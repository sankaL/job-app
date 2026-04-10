import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, FileText, Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type CreateApplicationSubmission = {
  job_url: string;
  source_text?: string;
};

type CreateApplicationModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateApplicationSubmission) => Promise<void>;
};

const DIALOG_WIDTH = "min(520px, calc(100vw - 32px))";

export function CreateApplicationModal({ open, onClose, onSubmit }: CreateApplicationModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const [jobUrl, setJobUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [showSourceText, setShowSourceText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resetState() {
    setJobUrl("");
    setSourceText("");
    setShowSourceText(false);
    setError(null);
    setIsSubmitting(false);
  }

  function handleClose() {
    if (isSubmitting) {
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

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusHandle = window.requestAnimationFrame(() => {
      urlInputRef.current?.focus();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(focusHandle);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, isSubmitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedJobUrl = jobUrl.trim();
    const trimmedSourceText = sourceText.trim();
    if (!trimmedJobUrl) {
      setError("Job URL is required.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({
        job_url: trimmedJobUrl,
        source_text: trimmedSourceText || undefined,
      });
      resetState();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create application.");
      setIsSubmitting(false);
    }
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        aria-hidden="true"
        onClick={handleClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(16, 24, 40, 0.48)",
          backdropFilter: "blur(6px)",
          animation: "fadeIn 220ms var(--ease-out) both",
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="animate-scaleIn"
        style={{
          position: "relative",
          zIndex: 1,
          width: DIALOG_WIDTH,
          borderRadius: "var(--radius-xl)",
          border: "1px solid var(--color-border)",
          background: "var(--color-white)",
          boxShadow: "var(--shadow-panel)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 px-6 pb-4 pt-6"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ background: "var(--color-spruce)", color: "white" }}
              >
                <Link2 size={14} aria-hidden="true" />
              </div>
              <h2
                id={titleId}
                className="text-base font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                New Application
              </h2>
            </div>
            <p
              id={descriptionId}
              className="text-sm leading-relaxed"
              style={{ color: "var(--color-ink-50)" }}
            >
              Paste the job posting URL to create an application and start extraction.
            </p>
          </div>

          <button
            type="button"
            aria-label="Close new application modal"
            onClick={handleClose}
            disabled={isSubmitting}
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              color: "var(--color-ink-40)",
              background: "transparent",
              border: "1px solid var(--color-border)",
            }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <form className="px-6 pb-6 pt-5" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-application-job-url">Job URL</Label>
              <Input
                ref={urlInputRef}
                id="new-application-job-url"
                aria-label="Job URL"
                placeholder="https://company.example/jobs/platform-engineer"
                type="url"
                value={jobUrl}
                onChange={(event) => setJobUrl(event.target.value)}
                required
              />
            </div>

            {/* Source text toggle */}
            <div
              className="rounded-xl border px-4 py-3.5"
              style={{
                borderColor: showSourceText ? "rgba(24, 74, 69, 0.16)" : "var(--color-border)",
                background: showSourceText ? "var(--color-spruce-05)" : "var(--color-ink-05)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm" style={{ color: "var(--color-ink-65)" }}>
                  Already have the job description copied?
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowSourceText((current) => !current);
                    setError(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
                  style={{ color: showSourceText ? "var(--color-spruce)" : "var(--color-ink)" }}
                >
                  {showSourceText ? <X size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
                  {showSourceText ? "Hide" : "Paste it"}
                </button>
              </div>

              {showSourceText && (
                <div className="animate-fadeInUp mt-4">
                  <Label htmlFor="new-application-source-text">Pasted Job Description</Label>
                  <Textarea
                    id="new-application-source-text"
                    aria-label="Pasted Job Description"
                    className="min-h-[160px]"
                    placeholder="Paste the job description, qualifications, and any relevant posting text."
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                  />
                  <p className="mt-2 text-xs leading-5" style={{ color: "var(--color-ink-40)" }}>
                    The URL stays attached as the source link. The pasted text is used only to improve extraction
                    startup for this new application.
                  </p>
                </div>
              )}
            </div>

            {error ? (
              <div
                className="rounded-xl border px-4 py-3 text-sm"
                style={{
                  color: "var(--color-ember)",
                  borderColor: "var(--color-ember-10)",
                  background: "var(--color-ember-05)",
                }}
              >
                {error}
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div
            className="mt-5 flex items-center justify-end gap-2 border-t pt-5"
            style={{ borderColor: "var(--color-border)" }}
          >
            <Button type="button" variant="secondary" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
              {!isSubmitting && <ArrowRight size={14} aria-hidden="true" />}
              {showSourceText ? "Create With Pasted Text" : "Create Application"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
