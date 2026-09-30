import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Check, Plus, RefreshCw, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import type { ProfileData, ResumeDocument, ResumeSection, ResumeSectionEntry, ResumeSectionKind } from "@/lib/api";
import { createResumeEntry, createResumeSection, hasSectionContent, newResumeId, renderSectionContent, sourceSectionReviewError, SECTION_LABELS } from "@/lib/resume-document";

export function ResumeContactCard({ profile, suggestions }: { profile: ProfileData | null; suggestions?: Partial<Record<"name" | "email" | "phone" | "address" | "linkedin", string>> }) {
  const contact = [profile?.email, profile?.phone, profile?.address, profile?.linkedin_url].filter(Boolean);
  return (
    <Card className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="flex gap-3">
        <UserRound size={18} className="mt-1 shrink-0" style={{ color: "var(--color-spruce)" }} />
        <div>
          <h3 className="text-sm font-semibold">Contact information</h3>
          <p className="mt-1 text-sm">{profile?.name || [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Add your name in your profile"}</p>
          <p className="mt-1 break-words text-xs" style={{ color: "var(--color-ink-65)" }}>{contact.join(" · ") || "Add your contact details in your profile."}</p>
          <p className="mt-2 text-xs" style={{ color: "var(--color-ink-40)" }}>Copied from your profile. Never sent for tailoring.</p>
          {suggestions && Object.keys(suggestions).length > 0 && <div className="mt-3 border-t pt-2 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-65)" }}><p className="font-semibold">Contact found in your upload</p><dl className="mt-1 space-y-1">{Object.entries(suggestions).map(([key, value]) => <div key={key} className="flex flex-wrap gap-x-2"><dt className="capitalize">{key}</dt><dd className="break-all">{value}</dd></div>)}</dl><p className="mt-2">Review these details in your profile before using them.</p></div>}
        </div>
      </div>
      <Link to="/app/profile" className="text-xs font-semibold underline underline-offset-4" style={{ color: "var(--color-spruce)" }}>Edit profile</Link>
    </Card>
  );
}

const FIELD_LABELS: Record<string, string> = { title: "Role title", company: "Employer", institution: "Institution", degree: "Degree", qualification: "Degree or qualification", details: "Details", url: "Link", location: "Location", date_range: "Dates", name: "Name", issuer: "Issuer", date: "Date", description: "Description" };
const FIELD_ORDER: Partial<Record<ResumeSectionKind, string[]>> = {
  professional_experience: ["title", "company", "location", "date_range"],
  education: ["qualification", "institution", "location", "date_range"],
  projects: ["name", "details", "url"],
  certifications: ["name", "issuer", "date"],
};

function EntryEditor({ entry, index, kind, disabled, onChange, onRemove, onRegenerate, regenerationDisabled = false, regenerationReason }: {
  entry: ResumeSectionEntry; index: number; kind: ResumeSectionKind; disabled: boolean;
  onChange: (entry: ResumeSectionEntry) => void; onRemove: () => void; onRegenerate?: () => void;
  regenerationDisabled?: boolean; regenerationReason?: string | null;
}) {
  const preferredFields = FIELD_ORDER[kind] ?? [];
  const fieldKeys = [
    ...preferredFields.filter((key) => Object.prototype.hasOwnProperty.call(entry.fields, key)),
    ...Object.keys(entry.fields).filter((key) => !preferredFields.includes(key)).sort(),
  ];
  return (
    <div className="rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-ink-05)" }}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-ink-65)" }}>{kind === "professional_experience" ? `Role ${index + 1}` : `Entry ${index + 1}`}</h4>
        <div className="flex gap-1">
          {onRegenerate && <Button size="sm" variant="secondary" type="button" disabled={disabled || regenerationDisabled} title={regenerationReason ?? undefined} onClick={onRegenerate}><RefreshCw size={13} /> Regenerate role</Button>}
          <Button size="sm" variant="secondary" type="button" disabled={disabled} aria-label={`Remove entry ${index + 1}`} onClick={onRemove}><Trash2 size={13} /></Button>
        </div>
      </div>
      {onRegenerate && regenerationReason && <p className="mb-3 text-xs" style={{ color: "var(--color-ink-50)" }}>{regenerationReason}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {fieldKeys.map((key) => (
          <label key={key} className="space-y-1 text-xs">
            <span style={{ color: "var(--color-ink-65)" }}>{FIELD_LABELS[key] ?? key.replaceAll("_", " ")}</span>
            <Input disabled={disabled} value={entry.fields[key]} onChange={(event) => onChange({ ...entry, fields: { ...entry.fields, [key]: event.target.value } })} />
          </label>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {entry.bullets.map((bullet, bulletIndex) => (
          <div key={bullet.id} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-2 text-xs" style={{ color: "var(--color-ink-40)" }}>•</span>
            <div className="min-w-0 flex-1">
              <Textarea disabled={disabled} aria-label={`Entry ${index + 1} bullet ${bulletIndex + 1}`} rows={2} value={bullet.text} onChange={(event) => onChange({ ...entry, bullets: entry.bullets.map((item) => item.id === bullet.id ? { ...item, text: event.target.value } : item) })} />
              {bullet.source_ids.length > 1 && <p className="mt-1 text-[10px]" style={{ color: "var(--color-ink-40)" }}>Based on {bullet.source_ids.length} source bullets</p>}
            </div>
            <Button size="sm" variant="secondary" type="button" disabled={disabled} aria-label={`Remove bullet ${bulletIndex + 1} from entry ${index + 1}`} onClick={() => onChange({ ...entry, bullets: entry.bullets.filter((item) => item.id !== bullet.id) })}><Trash2 size={12} /></Button>
          </div>
        ))}
        <Button size="sm" type="button" variant="secondary" disabled={disabled} onClick={() => onChange({ ...entry, bullets: [...entry.bullets, { id: newResumeId("bullet"), text: "", source_ids: [] }] })}><Plus size={13} /> Add bullet</Button>
      </div>
    </div>
  );
}

export function ResumeSectionWorkbench({ document, onChange, disabled = false, source = false, onRegenerate, canRegenerate, regenerationReason }: {
  document: ResumeDocument; onChange: (document: ResumeDocument) => void; disabled?: boolean; source?: boolean;
  onRegenerate?: (section: ResumeSection, entryId?: string) => void;
  canRegenerate?: (section: ResumeSection, entryId?: string) => boolean;
  regenerationReason?: (section: ResumeSection, entryId?: string) => string | null;
}) {
  const [newKind, setNewKind] = useState<ResumeSectionKind>("professional_experience");
  function updateSection(id: string, update: Partial<ResumeSection>, reviewChanged = true) {
    onChange({ ...document, sections: document.sections.map((section) => section.id === id ? {
      ...section, ...update, ...(source && reviewChanged ? { review_state: "needs_review" as const } : {}),
    } : section) });
  }
  function moveSection(index: number, delta: number) {
    const sections = [...document.sections];
    [sections[index], sections[index + delta]] = [sections[index + delta], sections[index]];
    onChange({ ...document, sections });
  }
  function addEntry(section: ResumeSection) {
    const entry = createResumeEntry(section.kind);
    const preserveText = section.entries.length === 0 && Boolean(section.content_md.trim());
    if (preserveText) {
      entry.bullets = (section.content_md.match(/[\s\S]{1,10000}/gu) ?? []).map((text) => ({ id: newResumeId("bullet"), text, source_ids: [] }));
    }
    updateSection(section.id, { entries: [...section.entries, entry], ...(preserveText ? { content_md: "" } : {}) });
  }
  const active = document.sections.filter((section) => section.enabled && hasSectionContent(section));
  const reviewed = active.filter((section) => section.review_state === "reviewed");
  return (
    <div className="space-y-4" data-testid="resume-section-workbench">
      {source && <div className="rounded-xl border px-4 py-3 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-65)" }}>
        <p className="font-semibold">{reviewed.length} of {active.length} populated sections reviewed</p>
        <p className="mt-1">Review the facts and section type before tailoring. Experience and education are recommended; a summary is optional.</p>
      </div>}
      {document.sections.length === 0 && <Card className="py-8 text-center"><p className="text-sm font-semibold">Build your source resume one section at a time</p><p className="mt-2 text-xs" style={{ color: "var(--color-ink-65)" }}>Start with experience, education, projects, or skills. Add any other section you need.</p></Card>}
      {document.sections.map((section, index) => (
        <Card key={section.id} className={`px-4 py-4 sm:px-5 ${section.enabled ? "" : "opacity-65"}`} data-section-id={section.id}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--color-border)" }}>
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor={`heading-${section.id}`}>Section heading {index + 1}</label>
              <Input id={`heading-${section.id}`} maxLength={120} className="font-semibold" disabled={disabled} value={section.heading} onChange={(event) => updateSection(section.id, { heading: event.target.value })} />
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]" style={{ color: "var(--color-ink-50)" }}>
                <span>{SECTION_LABELS[section.kind]}</span>
                {source && <span style={{ color: section.review_state === "reviewed" ? "var(--color-spruce)" : "var(--color-amber)" }}>{section.review_state === "reviewed" ? "Reviewed" : "Needs review"}</span>}
                {source && section.confidence !== null && <span title="Classification confidence describes the section match, not whether the facts are correct.">Import match {Math.round(section.confidence * 100)}%</span>}
                <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={section.enabled} disabled={disabled} onChange={(event) => updateSection(section.id, { enabled: event.target.checked }, false)} /> Include</label>
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" type="button" disabled={disabled || index === 0} aria-label={`Move ${section.heading} up`} onClick={() => moveSection(index, -1)}><ArrowUp size={14} /></Button>
              <Button size="sm" variant="secondary" type="button" disabled={disabled || index === document.sections.length - 1} aria-label={`Move ${section.heading} down`} onClick={() => moveSection(index, 1)}><ArrowDown size={14} /></Button>
              {section.kind === "custom" && <Button size="sm" variant="secondary" type="button" disabled={disabled} aria-label={`Remove ${section.heading}`} onClick={() => onChange({ ...document, sections: document.sections.filter((item) => item.id !== section.id) })}><Trash2 size={14} /></Button>}
            </div>
          </div>
          {source && <label className="mb-3 block text-xs"><span className="mr-2">Section type</span><Select className="mt-1" disabled={disabled} value={section.kind} onChange={(event) => updateSection(section.id, { kind: event.target.value as ResumeSectionKind, ...(section.entries.length ? { content_md: renderSectionContent(section), entries: [] } : {}) })}>{Object.entries(SECTION_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</Select></label>}
          {(section.entries.length === 0) && <div className="mb-3"><Label htmlFor={`content-${section.id}`}>Section content</Label><MarkdownEditor id={`content-${section.id}`} className="min-h-32" disabled={disabled} value={section.content_md} placeholder="Write the content for this section…" onChange={(event) => updateSection(section.id, { content_md: event.target.value })} /></div>}
          <div className="space-y-3">
            {section.entries.map((entry, entryIndex) => <EntryEditor key={entry.id} entry={entry} index={entryIndex} kind={section.kind} disabled={disabled} onChange={(updated) => updateSection(section.id, { entries: section.entries.map((item) => item.id === entry.id ? updated : item) })} onRemove={() => updateSection(section.id, { entries: section.entries.filter((item) => item.id !== entry.id) })} onRegenerate={onRegenerate && section.kind === "professional_experience" && section.enabled ? () => onRegenerate(section, entry.id) : undefined} regenerationDisabled={canRegenerate ? !canRegenerate(section, entry.id) : false} regenerationReason={regenerationReason?.(section, entry.id)} />)}
          </div>
          {source && hasSectionContent(section) && sourceSectionReviewError(section) && <p className="mt-3 text-xs" style={{ color: "var(--color-amber)" }}>{sourceSectionReviewError(section)}</p>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {["professional_experience", "education", "projects", "certifications"].includes(section.kind) && <Button size="sm" type="button" variant="secondary" disabled={disabled} onClick={() => addEntry(section)}><Plus size={13} /> Add {section.kind === "professional_experience" ? "role" : "entry"}</Button>}
              {source && <Button size="sm" variant="secondary" type="button" disabled={disabled || Boolean(sourceSectionReviewError(section)) || section.review_state === "reviewed"} onClick={() => updateSection(section.id, { review_state: "reviewed" }, false)}><Check size={13} /> Mark reviewed</Button>}
            </div>
            {onRegenerate && <Button size="sm" variant="secondary" type="button" disabled={disabled || !section.enabled || (canRegenerate ? !canRegenerate(section) : false)} title={regenerationReason?.(section) ?? undefined} onClick={() => onRegenerate(section)}><RefreshCw size={13} /> Regenerate section</Button>}
          </div>
          {onRegenerate && regenerationReason?.(section) && <p className="mt-2 text-xs" style={{ color: "var(--color-ink-50)" }}>{regenerationReason(section)}</p>}
        </Card>
      ))}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3" style={{ borderColor: "var(--color-border)" }}>
        <label className="sr-only" htmlFor="add-section-kind">New section type</label>
        <Select id="add-section-kind" className="min-w-40 flex-1" disabled={disabled} value={newKind} onChange={(event) => setNewKind(event.target.value as ResumeSectionKind)}>{Object.entries(SECTION_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</Select>
        <Button size="sm" type="button" variant="secondary" disabled={disabled} onClick={() => onChange({ ...document, sections: [...document.sections, createResumeSection(newKind)] })}><Plus size={14} /> Add section</Button>
      </div>
    </div>
  );
}
