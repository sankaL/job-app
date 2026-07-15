import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, FileText, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ModalActions,
  ModalError,
  ModalShell,
} from "@/components/ui/modal-shell";
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
type SourceMode = (typeof SOURCE_MODE_OPTIONS)[number]["value"];

function validateSubmission(
  sourceMode: SourceMode,
  jobUrl: string,
  sourceText: string,
) {
  if (sourceMode === "link" && !jobUrl) return "Job URL is required.";
  if (sourceMode === "paste" && !sourceText)
    return "Job description is required.";
  return null;
}

function SourceModeSelector({
  value,
  onChange,
}: {
  value: SourceMode;
  onChange: (mode: SourceMode) => void;
}) {
  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-xl border p-1"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-ink-05)",
      }}
    >
      {SOURCE_MODE_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
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
  );
}

function ApplicationSourceFields({
  sourceMode,
  jobUrl,
  sourceText,
  showSourceText,
  urlInputRef,
  onJobUrlChange,
  onSourceTextChange,
  onRevealSourceText,
}: {
  sourceMode: SourceMode;
  jobUrl: string;
  sourceText: string;
  showSourceText: boolean;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  onJobUrlChange: (value: string) => void;
  onSourceTextChange: (value: string) => void;
  onRevealSourceText: () => void;
}) {
  const pasteMode = sourceMode === "paste";
  const textVisible = pasteMode || showSourceText;
  const textLabel = pasteMode ? "Job Description" : "Pasted Job Description";
  return (
    <>
      <div>
        <Label htmlFor="new-application-job-url">
          {pasteMode ? "Source URL (optional)" : "Job URL"}
        </Label>
        <Input
          ref={urlInputRef}
          id="new-application-job-url"
          aria-label={pasteMode ? "Source URL" : "Job URL"}
          placeholder="https://company.example/jobs/platform-engineer"
          type="url"
          value={jobUrl}
          onChange={(event) => onJobUrlChange(event.target.value)}
          required={!pasteMode}
        />
      </div>
      {!pasteMode && !showSourceText ? (
        <button
          type="button"
          onClick={onRevealSourceText}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-spruce)] transition-colors"
        >
          <FileText size={14} aria-hidden="true" />
          Add pasted description
        </button>
      ) : null}
      {textVisible ? (
        <div className="animate-fadeInUp">
          <Label htmlFor="new-application-source-text">{textLabel}</Label>
          <Textarea
            id="new-application-source-text"
            aria-label={textLabel}
            className="min-h-[180px]"
            placeholder="Paste the job description, qualifications, and any relevant posting text."
            value={sourceText}
            onChange={(event) => onSourceTextChange(event.target.value)}
            required={pasteMode}
          />
          <p className="mt-2 text-xs leading-5 text-[var(--color-ink-40)]">
            {pasteMode
              ? "Applix will infer the job details from this text and ask for manual entry only if required fields are missing."
              : "The pasted text is used to improve extraction startup for this new application."}
          </p>
        </div>
      ) : null}
    </>
  );
}

export function CreateApplicationModal({
  open,
  onClose,
  onSubmit,
}: CreateApplicationModalProps) {
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("link");
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
    const validationError = validateSubmission(
      sourceMode,
      trimmedJobUrl,
      trimmedSourceText,
    );
    if (validationError) {
      setError(validationError);
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
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to create application.",
      );
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
          <SourceModeSelector
            value={sourceMode}
            onChange={(mode) => {
              setSourceMode(mode);
              setShowSourceText(mode === "paste");
              setError(null);
            }}
          />
          <ApplicationSourceFields
            sourceMode={sourceMode}
            jobUrl={jobUrl}
            sourceText={sourceText}
            showSourceText={showSourceText}
            urlInputRef={urlInputRef}
            onJobUrlChange={setJobUrl}
            onSourceTextChange={setSourceText}
            onRevealSourceText={() => {
              setShowSourceText(true);
              setError(null);
            }}
          />

          <ModalError message={error} />
        </div>
        <ModalActions
          onCancel={handleClose}
          submitting={isSubmitting}
          submitLabel={
            <>
              {!isSubmitting && <ArrowRight size={14} aria-hidden="true" />}
              {sourceMode === "paste"
                ? "Create From Description"
                : showSourceText
                  ? "Create With Pasted Text"
                  : "Create Application"}
            </>
          }
        />
      </form>
    </ModalShell>
  );
}
