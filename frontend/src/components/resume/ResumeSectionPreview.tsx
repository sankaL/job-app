import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ResumeSection, ResumeSectionEntry } from "@/lib/api";
import { renderSectionContent } from "@/lib/resume-document";

function Markdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>{alt || "Image"}</span> }}>{text}</ReactMarkdown>;
}

export function ResumeSectionPreview({ section, disabled, onRegenerate, canRegenerate, regenerationReason }: {
  section: ResumeSection; disabled: boolean;
  onRegenerate?: (entryId: string) => void;
  canRegenerate?: (entryId: string) => boolean;
  regenerationReason?: (entryId: string) => string | null;
}) {
  const structured = section.kind === "professional_experience" || section.kind === "education";
  const rowFields = new Set(section.kind === "professional_experience" ? ["company", "title", "location", "date_range"] : ["institution", "qualification", "location", "date_range"]);
  function entryFacts(entry: ResumeSectionEntry) {
    const fields = entry.fields;
    return <>
      <div className="resume-preview-row font-semibold"><span>{fields.company || fields.institution || "Organization not set"}</span>{fields.location && <span className="font-normal">{fields.location}</span>}</div>
      <div className="resume-preview-row text-sm"><span>{fields.title || fields.qualification || "Role or qualification not set"}</span>{fields.date_range && <span>{fields.date_range}</span>}</div>
      {Object.entries(fields).filter(([key, value]) => !rowFields.has(key) && value.trim()).map(([key, value]) => <div key={key} className="mt-2 text-sm"><span className="font-semibold">{key.replaceAll("_", " ")}: </span><Markdown text={value} /></div>)}
      {entry.bullets.length > 0 && <ul>{entry.bullets.map((bullet) => <li key={bullet.id} data-bullet-id={bullet.id}><Markdown text={bullet.text} /></li>)}</ul>}
    </>;
  }
  return <div className="resume-preview-copy" data-testid={`section-preview-${section.id}`}>
    {section.entries.length ? section.entries.map((entry) => <article key={entry.id} data-entry-id={entry.id} className="resume-preview-entry">
      {structured ? entryFacts(entry) : <Markdown text={renderSectionContent({ ...section, entries: [entry] })} />}
      {onRegenerate && <div className="mt-3"><Button size="sm" variant="secondary" type="button" disabled={disabled || (canRegenerate ? !canRegenerate(entry.id) : false)} title={regenerationReason?.(entry.id) ?? undefined} onClick={() => onRegenerate(entry.id)}><RefreshCw size={13} /> Regenerate role</Button>{regenerationReason?.(entry.id) && <p className="mt-2 text-xs" style={{ color: "var(--color-ink-65)" }}>{regenerationReason(entry.id)}</p>}</div>}
    </article>) : section.content_md.trim() ? <Markdown text={section.content_md} /> : <p className="text-sm" style={{ color: "var(--color-ink-65)" }}>This section is empty. Choose Edit to add content.</p>}
  </div>;
}
