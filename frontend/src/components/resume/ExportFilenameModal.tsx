import { useEffect, useState, type FormEvent } from "react";
import { FileText } from "lucide-react";
import { ModalActions, ModalShell } from "@/components/ui/modal-shell";
import { ExportFilenameField } from "@/components/resume/ExportFilenameField";
import type { ProfileData } from "@/lib/api";
import { validateFilenameTemplate } from "@/lib/exportFilename";

type ExportFilenameModalProps = {
  open: boolean;
  value: string;
  profile: ProfileData | null;
  /** Shown in the description so users know Apply still needs the page-level save. */
  applyHint: string;
  onApply: (value: string) => void;
  onClose: () => void;
};

/**
 * Edits the base resume's download file name. Apply only updates the editor state;
 * the page's save action persists it together with any section edits.
 */
export function ExportFilenameModal({
  open,
  value,
  profile,
  applyHint,
  onApply,
  onClose,
}: ExportFilenameModalProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validateFilenameTemplate(draft)) return;
    onApply(draft.trim());
    onClose();
  }

  return (
    <ModalShell
      open={open}
      title="File Name"
      description={`Name the resumes exported from applications built on this resume. ${applyHint}`}
      icon={<FileText size={14} aria-hidden="true" />}
      closeLabel="Close file name dialog"
      onClose={onClose}
    >
      <form className="px-4 pb-5 pt-5 sm:px-6 sm:pb-6" onSubmit={handleSubmit}>
        <ExportFilenameField value={draft} onChange={setDraft} profile={profile} />
        <ModalActions onCancel={onClose} submitting={false} submitLabel="Apply" />
      </form>
    </ModalShell>
  );
}
