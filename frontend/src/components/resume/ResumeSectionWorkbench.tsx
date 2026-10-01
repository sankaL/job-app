import { useId, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import "./resume-workbench.css";
import { ResumeSectionPreview } from "./ResumeSectionPreview";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Check, Plus, RefreshCw, Trash2, UserRound, ChevronDown, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ProfileData, ResumeDocument, ResumeSection, ResumeSectionEntry, ResumeSectionKind } from "@/lib/api";
import { createResumeEntry, createResumeSection, hasSectionContent, newResumeId, renderSectionContent, sourceSectionReviewError, SECTION_LABELS } from "@/lib/resume-document";

export function ResumeContactCard({ profile, suggestions }: { profile: ProfileData | null; suggestions?: Partial<Record<"name" | "email" | "phone" | "address" | "linkedin", string>> }) {
  const contact = [profile?.email, profile?.phone, profile?.address, profile?.linkedin_url].filter(Boolean);
  return (
    <div className="resume-contact flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 gap-3">
        <UserRound size={18} className="mt-1 shrink-0" style={{ color: "var(--color-spruce)" }} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Contact information</h3>
          <p className="mt-1 text-sm">{profile?.name || [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Add your name in your profile"}</p>
          <p className="mt-1 break-words text-xs" style={{ color: "var(--color-ink-65)" }}>{contact.join(" · ") || "Add your contact details in your profile."}</p>
          <p className="mt-2 text-xs" style={{ color: "var(--color-ink-40)" }}>Copied from your profile. Never sent for tailoring.</p>
          {suggestions && Object.keys(suggestions).length > 0 && <div className="mt-3 border-t pt-2 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-65)" }}><p className="font-semibold">Contact found in your upload</p><dl className="mt-1 space-y-1">{Object.entries(suggestions).map(([key, value]) => <div key={key} className="flex flex-wrap gap-x-2"><dt className="capitalize">{key}</dt><dd className="break-all">{value}</dd></div>)}</dl><p className="mt-2">Review these details in your profile before using them.</p></div>}
        </div>
      </div>
      <Link to="/app/profile" className="text-xs font-semibold underline underline-offset-4" style={{ color: "var(--color-spruce)" }}>Edit profile</Link>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = { title: "Role title", company: "Employer", institution: "Institution", degree: "Degree", qualification: "Degree or qualification", details: "Details", url: "Link", location: "Location", date_range: "Dates", name: "Name", issuer: "Issuer", date: "Date", description: "Description" };
const FIELD_ORDER: Partial<Record<ResumeSectionKind, string[]>> = {
  professional_experience: ["title", "company", "location", "date_range"],
  education: ["qualification", "institution", "location", "date_range"],
  projects: ["name", "details", "url"],
  certifications: ["name", "issuer", "date"],
};

function GrowingTextarea({ value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    function resize() {
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight + 2, 480)}px`;
    }
    resize();
    // Reflow long prose when the workbench changes width, not only when it is edited.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [value]);
  return <textarea {...props} value={value} ref={ref} className="resume-prose" />;
}

function EntryEditor({ entry, index, kind, disabled, onChange, onRemove, onRegenerate, regenerationDisabled = false, regenerationReason }: {
  entry: ResumeSectionEntry; index: number; kind: ResumeSectionKind; disabled: boolean;
  onChange: (entry: ResumeSectionEntry) => void; onRemove: () => void; onRegenerate?: () => void;
  regenerationDisabled?: boolean; regenerationReason?: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const preferredFields = FIELD_ORDER[kind] ?? [];
  const fieldKeys = [
    ...preferredFields,
    ...Object.keys(entry.fields).filter((key) => !preferredFields.includes(key)).sort(),
  ];
  return (
    <div className="resume-entry" data-entry-id={entry.id}>
      <div className="resume-entry-header">
        <button type="button" className="resume-entry-toggle" aria-expanded={expanded} aria-controls={contentId} aria-label={`${expanded ? "Collapse" : "Expand"} ${kind === "professional_experience" ? "role" : "entry"} ${index + 1}`} onClick={() => setExpanded(!expanded)}>
          <span className="resume-entry-number">{String(index + 1).padStart(2, "0")}</span>
          <span className="min-w-0"><span className="block break-words font-semibold">{entry.fields.company || entry.fields.institution || entry.fields.name || (kind === "professional_experience" ? `Role ${index + 1}` : `Entry ${index + 1}`)}</span><span className="block break-words text-xs font-normal" style={{ color: "var(--color-ink-65)" }}>{[entry.fields.title || entry.fields.qualification, entry.fields.date_range].filter(Boolean).join(" · ") || "Add the facts below"}</span></span>
          <ChevronDown size={16} className={`shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} />
        </button>
        <div className="resume-entry-actions">
          {onRegenerate && <Button size="sm" variant="secondary" type="button" disabled={disabled || regenerationDisabled} title={regenerationReason ?? undefined} onClick={onRegenerate}><RefreshCw size={13} /> Regenerate role</Button>}
          <Button size="sm" variant="secondary" type="button" disabled={disabled} aria-label={`Remove entry ${index + 1}`} onClick={onRemove}><Trash2 size={13} /></Button>
        </div>
      </div>
      <div id={contentId} hidden={!expanded}>
      {onRegenerate && regenerationReason && <p className="mb-3 text-xs" style={{ color: "var(--color-ink-50)" }}>{regenerationReason}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {fieldKeys.map((key) => (
          <label key={key} className="min-w-0 space-y-1 text-xs">
            <span style={{ color: "var(--color-ink-65)" }}>{FIELD_LABELS[key] ?? key.replaceAll("_", " ")}</span>
            <Input disabled={disabled} value={entry.fields[key] ?? ""} onChange={(event) => onChange({ ...entry, fields: { ...entry.fields, [key]: event.target.value } })} />
          </label>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {entry.bullets.map((bullet, bulletIndex) => (
          <div key={bullet.id} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-2 text-xs" style={{ color: "var(--color-ink-40)" }}>•</span>
            <div className="min-w-0 flex-1">
              <GrowingTextarea disabled={disabled} aria-label={`Entry ${index + 1} bullet ${bulletIndex + 1}`} rows={2} value={bullet.text} onChange={(event) => onChange({ ...entry, bullets: entry.bullets.map((item) => item.id === bullet.id ? { ...item, text: event.target.value } : item) })} />
              {bullet.source_ids.length > 1 && <p className="mt-1 text-[10px]" style={{ color: "var(--color-ink-40)" }}>Based on {bullet.source_ids.length} source bullets</p>}
            </div>
            <Button size="sm" variant="secondary" type="button" disabled={disabled} aria-label={`Remove bullet ${bulletIndex + 1} from entry ${index + 1}`} onClick={() => onChange({ ...entry, bullets: entry.bullets.filter((item) => item.id !== bullet.id) })}><Trash2 size={12} /></Button>
          </div>
        ))}
        <Button size="sm" type="button" variant="secondary" disabled={disabled} onClick={() => onChange({ ...entry, bullets: [...entry.bullets, { id: newResumeId("bullet"), text: "", source_ids: [] }] })}><Plus size={13} /> Add bullet</Button>
      </div>
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
  const workbenchId = useId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    setEditingId(section.id);
    const entry = createResumeEntry(section.kind);
    const preserveText = section.entries.length === 0 && Boolean(section.content_md.trim());
    if (preserveText) {
      entry.bullets = (section.content_md.match(/[\s\S]{1,10000}/gu) ?? []).map((text) => ({ id: newResumeId("bullet"), text, source_ids: [] }));
    }
    updateSection(section.id, { entries: [...section.entries, entry], ...(preserveText ? { content_md: "" } : {}) });
  }
  const active = document.sections.filter((section) => section.enabled && hasSectionContent(section));
  const reviewed = active.filter((section) => section.review_state === "reviewed");
  const nextReview = active.find((section) => section.review_state !== "reviewed");
  const selectedSection = document.sections.find((section) => section.id === selectedId) ?? document.sections[0];
  const anchor = (id: string) => `${workbenchId}-section-${id}`;
  return (
    <div className="resume-workbench" data-testid="resume-section-workbench">
      <aside className="resume-index">
        <div className="resume-index-inner">
          <h2 className="text-sm font-semibold">{source ? "Review your resume" : "Resume sections"}</h2>
          {source && <div className="mt-3">
            <p className="text-xs" aria-live="polite">{reviewed.length} of {active.length} populated sections reviewed</p>
            <progress className="resume-review-progress" aria-label="Source section review progress" max={Math.max(active.length, 1)} value={reviewed.length} />
            <p className="mt-2 text-xs" style={{ color: "var(--color-ink-65)" }}>Check every included section against your source. Saving does not mark it reviewed.</p>
            {nextReview && <button className="resume-next-review" type="button" onClick={() => { setSelectedId(nextReview.id); setEditingId(null); }}>Continue review <ArrowDown size={13} /></button>}
          </div>}
          {source && document.sections.length > 0 && <label className="resume-mobile-section-select my-3 text-xs">
            <span>Current section</span>
            <Select className="mt-1" aria-label="Current resume section" value={selectedSection?.id ?? ""} onChange={(event) => { setSelectedId(event.target.value); setEditingId(null); }}>
              {document.sections.map((section) => <option key={section.id} value={section.id}>{section.heading || "Untitled section"}{!section.enabled ? " · excluded" : section.review_state === "reviewed" ? " · reviewed" : " · needs review"}</option>)}
            </Select>
          </label>}
          <nav aria-label="Resume section index" className="resume-section-links">
            {document.sections.map((section, index) => <button key={section.id} type="button" aria-current={selectedSection?.id === section.id ? "true" : undefined} aria-controls={anchor(section.id)} onClick={() => { setSelectedId(section.id); setEditingId(null); if (!source) window.document.getElementById(anchor(section.id))?.scrollIntoView({ block: "start" }); }}>
              <span className="resume-index-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="min-w-0 break-words">{section.heading || "Untitled section"}</span>
              <span className={`resume-index-dot ${!section.enabled ? "excluded" : source && section.review_state !== "reviewed" ? "pending" : ""}`} aria-label={!section.enabled ? "Excluded" : source ? section.review_state === "reviewed" ? "Section reviewed" : "Section needs review" : "Included"} />
            </button>)}
          </nav>
          <p className="text-xs" style={{ color: "var(--color-ink-65)" }}>{source ? "Included sections and their order apply to new generations. Existing drafts keep their saved layout." : "Included sections and their order apply to this draft, its regeneration and exports. Excluded sections stay here so you can include them again."}</p>
        </div>
      </aside>
      <div className="resume-sheet">
        {document.sections.length === 0 && <div className="resume-empty"><h3 className="font-display text-lg font-semibold">Build your source resume one section at a time</h3><p className="mt-2 text-sm" style={{ color: "var(--color-ink-65)" }}>Start with experience, education, projects, or skills. Add any other section you need.</p></div>}
        {document.sections.map((section, index) => (
          <section key={section.id} id={anchor(section.id)} className={`resume-section ${section.enabled ? "" : "resume-section-excluded"}`} hidden={source && selectedSection?.id !== section.id} data-section-id={section.id} aria-label={section.heading || "Untitled section"} tabIndex={-1} onDoubleClick={(event) => {
            if (!disabled && editingId !== section.id && !(event.target as HTMLElement).closest("button, a, input, select, textarea, summary")) setEditingId(section.id);
          }}>
            <div className="resume-section-header">
              <div className="min-w-0 flex-1">
                {editingId === section.id ? <><Label className="sr-only" htmlFor={`heading-${section.id}`}>Section heading {index + 1}</Label><Input autoFocus id={`heading-${section.id}`} maxLength={120} className="resume-section-heading" disabled={disabled} value={section.heading} onChange={(event) => updateSection(section.id, { heading: event.target.value })} /></> : <h3 className="resume-section-heading break-words">{section.heading || "Untitled section"}</h3>}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs" style={{ color: "var(--color-ink-65)" }}>
                  <span>{SECTION_LABELS[section.kind]}{section.entries.length > 0 ? ` · ${section.entries.length} ${section.kind === "professional_experience" ? section.entries.length === 1 ? "role" : "roles" : section.entries.length === 1 ? "entry" : "entries"}` : ""}</span>
                  {source && <span className="resume-review-state" data-reviewed={section.review_state === "reviewed"}>{section.review_state === "reviewed" ? "Reviewed" : "Needs review"}</span>}
                  {!section.enabled && <span>Excluded from resume</span>}
                </div>
              </div>
              <div className="resume-section-controls">
                <Button size="sm" variant="secondary" type="button" disabled={disabled && editingId !== section.id} aria-label={`${editingId === section.id ? "Preview" : "Edit"} ${section.heading}`} aria-expanded={editingId === section.id} onClick={() => setEditingId(editingId === section.id ? null : section.id)}>{editingId === section.id ? <Check size={14} /> : <Pencil size={14} />}{editingId === section.id ? "Preview" : "Edit"}</Button>
                <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" aria-label={`Include ${section.heading}`} checked={section.enabled} disabled={disabled} onChange={(event) => updateSection(section.id, { enabled: event.target.checked }, false)} /> Include</label>
                <Button size="sm" variant="secondary" type="button" disabled={disabled || index === 0} aria-label={`Move ${section.heading} up`} onClick={() => moveSection(index, -1)}><ArrowUp size={14} /></Button>
                <Button size="sm" variant="secondary" type="button" disabled={disabled || index === document.sections.length - 1} aria-label={`Move ${section.heading} down`} onClick={() => moveSection(index, 1)}><ArrowDown size={14} /></Button>
                {section.kind === "custom" && <Button size="sm" variant="secondary" type="button" disabled={disabled} aria-label={`Remove ${section.heading}`} onClick={() => onChange({ ...document, sections: document.sections.filter((item) => item.id !== section.id) })}><Trash2 size={14} /></Button>}
              </div>
            </div>
            {editingId === section.id && source && <details className="resume-section-settings">
              <summary>Section settings</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs"><span>Section type</span><Select className="mt-1" disabled={disabled} value={section.kind} onChange={(event) => updateSection(section.id, { kind: event.target.value as ResumeSectionKind, ...(section.entries.length ? { content_md: renderSectionContent(section), entries: [] } : {}) })}>{Object.entries(SECTION_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</Select></label>
                <p className="self-center text-xs" style={{ color: "var(--color-ink-65)" }}>{section.confidence !== null ? `Import match ${Math.round(section.confidence * 100)}%. This describes the section type, not the accuracy of its facts.` : "Choose the type that matches this content."} Changing type preserves entry content as text for review.</p>
              </div>
            </details>}
            {source && section.kind === "professional_experience" && !section.entries.length && section.content_md.trim() && <p className="resume-import-warning my-3 text-xs">These jobs are still source text. Check each job boundary before marking reviewed. Add roles to organize them; the original text will stay in the first role for you to split.</p>}
            {editingId === section.id ? <>
            {section.entries.length === 0 && <div className="my-4"><Label htmlFor={`content-${section.id}`}>Section content <span className="font-normal">· Markdown supported</span></Label><GrowingTextarea id={`content-${section.id}`} disabled={disabled} rows={6} value={section.content_md} placeholder="Write the content for this section…" onChange={(event) => updateSection(section.id, { content_md: event.target.value })} /></div>}
            <div>
              {section.entries.map((entry, entryIndex) => <EntryEditor key={entry.id} entry={entry} index={entryIndex} kind={section.kind} disabled={disabled} onChange={(updated) => updateSection(section.id, { entries: section.entries.map((item) => item.id === entry.id ? updated : item) })} onRemove={() => updateSection(section.id, { entries: section.entries.filter((item) => item.id !== entry.id) })} onRegenerate={onRegenerate && section.kind === "professional_experience" && section.enabled ? () => onRegenerate(section, entry.id) : undefined} regenerationDisabled={canRegenerate ? !canRegenerate(section, entry.id) : false} regenerationReason={regenerationReason?.(section, entry.id)} />)}
            </div>
            </> : <ResumeSectionPreview section={section} disabled={disabled}
              onRegenerate={onRegenerate && section.kind === "professional_experience" && section.enabled ? (entryId) => onRegenerate(section, entryId) : undefined}
              canRegenerate={canRegenerate ? (entryId) => canRegenerate(section, entryId) : undefined}
              regenerationReason={regenerationReason ? (entryId) => regenerationReason(section, entryId) : undefined} />}
            {source && hasSectionContent(section) && sourceSectionReviewError(section) && <p className="mt-3 text-xs" style={{ color: "var(--color-amber)" }}>{sourceSectionReviewError(section)}</p>}
            <div className="resume-section-footer">
              <div className="flex flex-wrap gap-2">
                {["professional_experience", "education", "projects", "certifications"].includes(section.kind) && <Button size="sm" type="button" variant="secondary" disabled={disabled} onClick={() => addEntry(section)}><Plus size={13} /> Add {section.kind === "professional_experience" ? "role" : "entry"}</Button>}
                {source && <Button size="sm" variant="secondary" type="button" disabled={disabled || Boolean(sourceSectionReviewError(section)) || section.review_state === "reviewed"} onClick={() => updateSection(section.id, { review_state: "reviewed" }, false)}><Check size={13} /> Mark reviewed</Button>}
              </div>
              {onRegenerate && <Button size="sm" variant="secondary" type="button" disabled={disabled || !section.enabled || (canRegenerate ? !canRegenerate(section) : false)} title={regenerationReason?.(section) ?? undefined} onClick={() => onRegenerate(section)}><RefreshCw size={13} /> Regenerate section</Button>}
            </div>
            {onRegenerate && regenerationReason?.(section) && <p className="mt-2 text-xs" style={{ color: "var(--color-ink-65)" }}>{regenerationReason(section)}</p>}
          </section>
        ))}
        <div className="resume-add-section">
          <label className="sr-only" htmlFor={`${workbenchId}-add-section-kind`}>New section type</label>
          <Select id={`${workbenchId}-add-section-kind`} disabled={disabled} value={newKind} onChange={(event) => setNewKind(event.target.value as ResumeSectionKind)}>{Object.entries(SECTION_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</Select>
          <Button size="sm" type="button" variant="secondary" disabled={disabled} onClick={() => { const section = createResumeSection(newKind); onChange({ ...document, sections: [...document.sections, section] }); setSelectedId(section.id); setEditingId(section.id); }}><Plus size={14} /> Add section</Button>
        </div>
      </div>
    </div>
  );
}
