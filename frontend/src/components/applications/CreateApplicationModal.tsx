import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, BriefcaseBusiness, FileText, Link2, Sparkles, X } from "lucide-react";
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

const DIALOG_WIDTH = "min(560px, calc(100vw - 32px))";

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
          background:
            "radial-gradient(circle at top, rgba(24, 74, 69, 0.16), transparent 42%), rgba(16, 24, 40, 0.56)",
          backdropFilter: "blur(10px)",
          animation: "fadeIn 220ms var(--ease-out) both",
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="animate-scaleIn overflow-hidden"
        style={{
          position: "relative",
          zIndex: 1,
          width: DIALOG_WIDTH,
          borderRadius: "28px",
          border: "1px solid rgba(16, 24, 40, 0.08)",
          background:
            "linear-gradient(180deg, rgba(250, 248, 242, 0.98) 0%, rgba(255, 255, 255, 0.98) 34%, rgba(255, 255, 255, 1) 100%)",
          boxShadow: "0 30px 80px rgba(16, 24, 40, 0.18)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: "-24px",
            top: "-24px",
            height: "160px",
            width: "160px",
            borderRadius: "999px",
            background: "radial-gradient(circle, rgba(24, 74, 69, 0.2) 0%, rgba(24, 74, 69, 0) 72%)",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-36px",
            bottom: "-48px",
            height: "180px",
            width: "180px",
            borderRadius: "999px",
            background: "radial-gradient(circle, rgba(180, 83, 9, 0.12) 0%, rgba(180, 83, 9, 0) 72%)",
          }}
        />

        <div className="relative border-b px-6 pb-5 pt-6" style={{ borderColor: "rgba(16, 24, 40, 0.08)" }}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-4">
              <div
                className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{
                  color: "var(--color-spruce)",
                  background: "rgba(24, 74, 69, 0.08)",
                }}
              >
                <Sparkles size={13} aria-hidden="true" />
                New Application
              </div>
              <div className="space-y-2">
                <h2
                  id={titleId}
                  className="font-display text-[1.75rem] leading-[1.05] sm:text-[2rem]"
                  style={{ color: "var(--color-ink)" }}
                >
                  Start with the job link.
                </h2>
                <p
                  id={descriptionId}
                  className="max-w-[34rem] text-sm leading-6"
                  style={{ color: "var(--color-ink-65)" }}
                >
                  Paste the posting URL to create the application. If you already copied the job description, you can
                  reveal a pasted-text field and include it now to kick off extraction with richer source content.
                </p>
              </div>
            </div>

            <button
              type="button"
              aria-label="Close new application modal"
              onClick={handleClose}
              disabled={isSubmitting}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                color: "var(--color-ink-50)",
                background: "rgba(255, 255, 255, 0.72)",
                border: "1px solid rgba(16, 24, 40, 0.08)",
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <form className="relative px-6 pb-6 pt-5" onSubmit={handleSubmit}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div
              className="rounded-2xl border px-4 py-3"
              style={{
                borderColor: "rgba(24, 74, 69, 0.12)",
                background: "rgba(24, 74, 69, 0.05)",
              }}
            >
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-spruce)" }}>
                <Link2 size={14} aria-hidden="true" />
                URL First
              </div>
              <p className="mt-2 text-sm leading-5" style={{ color: "var(--color-ink-65)" }}>
                Keep the source link attached from the start.
              </p>
            </div>
            <div
              className="rounded-2xl border px-4 py-3"
              style={{
                borderColor: "rgba(16, 24, 40, 0.08)",
                background: "rgba(255, 255, 255, 0.72)",
              }}
            >
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-ink)" }}>
                <FileText size={14} aria-hidden="true" />
                Optional Paste
              </div>
              <p className="mt-2 text-sm leading-5" style={{ color: "var(--color-ink-65)" }}>
                Reveal the textarea only if you already copied the posting text.
              </p>
            </div>
            <div
              className="rounded-2xl border px-4 py-3"
              style={{
                borderColor: "rgba(180, 83, 9, 0.12)",
                background: "rgba(180, 83, 9, 0.05)",
              }}
            >
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-ember)" }}>
                <BriefcaseBusiness size={14} aria-hidden="true" />
                Direct Intake
              </div>
              <p className="mt-2 text-sm leading-5" style={{ color: "var(--color-ink-65)" }}>
                Submit once and continue on the detail page while extraction runs.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
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

            <div
              className="rounded-2xl border px-4 py-4"
              style={{
                borderColor: showSourceText ? "rgba(24, 74, 69, 0.18)" : "rgba(16, 24, 40, 0.08)",
                background: showSourceText ? "rgba(24, 74, 69, 0.04)" : "rgba(16, 24, 40, 0.02)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                    Have the job description copied already?
                  </p>
                  <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
                    Add it now to help extraction start from the exact posting text.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSourceText((current) => !current);
                    setError(null);
                  }}
                  className="inline-flex items-center gap-2 text-sm font-semibold transition-colors"
                  style={{ color: showSourceText ? "var(--color-spruce)" : "var(--color-ink)" }}
                >
                  {showSourceText ? <X size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
                  {showSourceText ? "Hide pasted text" : "Paste job description instead"}
                </button>
              </div>

              {showSourceText && (
                <div className="animate-fadeInUp mt-4">
                  <Label htmlFor="new-application-source-text">Pasted Job Description</Label>
                  <Textarea
                    id="new-application-source-text"
                    aria-label="Pasted Job Description"
                    className="min-h-[180px]"
                    placeholder="Paste the job description, qualifications, and any other relevant posting text."
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                  />
                  <p className="mt-2 text-xs leading-5" style={{ color: "var(--color-ink-50)" }}>
                    The URL stays attached as the source link. The pasted text is used only to improve extraction
                    startup for this new application.
                  </p>
                </div>
              )}
            </div>

            {error ? (
              <div
                className="rounded-2xl border px-4 py-3 text-sm"
                style={{
                  color: "var(--color-ember)",
                  borderColor: "rgba(179, 56, 44, 0.14)",
                  background: "rgba(179, 56, 44, 0.05)",
                }}
              >
                {error}
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "rgba(16, 24, 40, 0.08)" }}>
            <p className="text-xs leading-5" style={{ color: "var(--color-ink-50)" }}>
              Extraction begins after submit. You will land on the application detail page immediately.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={handleClose} disabled={isSubmitting}>
                <X size={14} aria-hidden="true" />
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
                {!isSubmitting && <ArrowRight size={14} aria-hidden="true" />}
                {showSourceText ? "Create With Pasted Text" : "Create Application"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
