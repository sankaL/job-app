import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ResumeContactSection, ResumeSectionWorkbench } from "./ResumeSectionWorkbench";
import type { ProfileData, ResumeDocument, ResumeDraft, ResumeSection } from "@/lib/api";
import { documentFromMarkdown, resumeDocumentError } from "@/lib/resume-document";

export function DraftSectionWorkbench({ draft, profile, locked = false, saving = false, onSave, onRegenerate, onDirtyChange, canRegenerate, regenerationReason }: {
  draft: ResumeDraft; profile: ProfileData | null; locked?: boolean; saving?: boolean;
  onSave: (document: ResumeDocument, expectedRevision: number) => Promise<boolean>;
  onRegenerate: (section: ResumeSection, entryId?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  canRegenerate?: (section: ResumeSection, entryId?: string) => boolean;
  regenerationReason?: (section: ResumeSection, entryId?: string) => string | null;
}) {
  const [document, setDocument] = useState(() => draft.document ?? documentFromMarkdown(draft.content_md));
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const saveInFlightRef = useRef(false);
  const revisionRef = useRef(draft.document?.revision ?? 1);
  const signatureRef = useRef(`${draft.id}:${draft.updated_at}:${draft.document?.revision ?? 1}`);
  const currentSignature = `${draft.id}:${draft.updated_at}:${draft.document?.revision ?? 1}`;
  useEffect(() => {
    if (signatureRef.current === currentSignature) return;
    if (dirty) { setChangedElsewhere(true); return; }
    signatureRef.current = currentSignature;
    revisionRef.current = draft.document?.revision ?? 1;
    setDocument(draft.document ?? documentFromMarkdown(draft.content_md));
    setChangedElsewhere(false);
  }, [currentSignature, draft, dirty]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  function discardChanges() {
    signatureRef.current = currentSignature;
    revisionRef.current = draft.document?.revision ?? 1;
    setDocument(draft.document ?? documentFromMarkdown(draft.content_md));
    setDirty(false); setChangedElsewhere(false);
  }

  async function saveChanges() {
    if (saveInFlightRef.current) return;
    const documentError = resumeDocumentError(document);
    if (documentError) { setError(documentError); return; }
    setError(null);
    saveInFlightRef.current = true;
    try { if (await onSave(document, revisionRef.current)) setDirty(false); }
    finally { saveInFlightRef.current = false; }
  }

  return (
    <div className="draft-workbench flex min-h-0 flex-1 flex-col" data-testid="draft-section-workbench">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--color-border)" }}>
        <div><h3 className="text-sm font-semibold">Generated resume</h3><p className="mt-1 text-xs" style={{ color: "var(--color-ink-50)" }}>Preview your resume. Double-click a section or choose Edit to change it.</p></div>
        <div className="space-y-1 text-right text-[11px]" style={{ color: "var(--color-ink-40)" }}><p>Generated {new Date(draft.last_generated_at).toLocaleString()}</p>{draft.last_exported_at && <p>Exported {new Date(draft.last_exported_at).toLocaleString()}</p>}<p>Revision {draft.document?.revision ?? 1}</p></div>
      </div>
      {error && <p role="alert" className="mt-3 text-xs" style={{ color: "var(--color-ember)" }}>{error}</p>}
      {changedElsewhere && <Card variant="warning" className="mt-3"><p className="text-xs">A newer draft is available. Your unsaved edits are preserved here. Reload the latest draft before saving.</p><Button type="button" size="sm" variant="secondary" className="mt-2" disabled={locked || saving} onClick={discardChanges}>Reload latest draft</Button></Card>}
      <div className="draft-workbench-content flex min-h-0 flex-1 flex-col gap-4 py-4">
        {!draft.document && <p className="text-xs" style={{ color: "var(--color-ink-50)" }}>This legacy draft will gain section IDs when you save it. To refresh source links, choose Use latest base resume during full regeneration.</p>}
        <ResumeSectionWorkbench contactPanel={<ResumeContactSection profile={profile} />} document={document} disabled={locked || saving} onChange={(next) => { setDocument(next); setDirty(true); }} onRegenerate={!dirty && draft.document ? onRegenerate : undefined} canRegenerate={canRegenerate} regenerationReason={regenerationReason} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
        <p className="text-xs" style={{ color: "var(--color-ink-50)" }}>{dirty ? "Unsaved changes. Save before regenerating or exporting." : "All changes saved"}</p>
        {dirty && <div className="flex gap-2"><Button type="button" size="sm" variant="secondary" disabled={locked || saving} onClick={discardChanges}>Discard edits</Button><Button type="button" size="sm" disabled={locked || saving || changedElsewhere} loading={saving} onClick={() => void saveChanges()}>{saving ? "Saving…" : "Save Draft"}</Button></div>}
      </div>
    </div>
  );
}
