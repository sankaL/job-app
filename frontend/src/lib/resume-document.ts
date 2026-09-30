import type { ResumeDocument, ResumeSection, ResumeSectionEntry, ResumeSectionKind } from "@/lib/api";
import { parseResume } from "@/components/diff/resume-parser";

export const SECTION_LABELS: Record<ResumeSectionKind, string> = {
  summary: "Summary",
  professional_experience: "Professional experience",
  education: "Education",
  certifications: "Certifications",
  projects: "Projects",
  skills: "Skills",
  custom: "Custom section",
};

export function newResumeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function emptyResumeDocument(): ResumeDocument {
  return { schema_version: 1, revision: 1, sections: [] };
}

export function createResumeSection(kind: ResumeSectionKind): ResumeSection {
  return {
    id: newResumeId("section"), kind, heading: SECTION_LABELS[kind], enabled: true,
    review_state: "needs_review", confidence: null, content_md: "", entries: [],
  };
}

export function createResumeEntry(kind: ResumeSectionKind): ResumeSectionEntry {
  const fields: Record<string, string> = kind === "professional_experience"
    ? { title: "", company: "", location: "", date_range: "" }
    : kind === "education"
      ? { qualification: "", institution: "", location: "", date_range: "" }
      : kind === "projects"
        ? { name: "", details: "", url: "" }
        : { name: "", issuer: "", date: "" };
  return { id: newResumeId("entry"), fields, bullets: [] };
}

export function renderSectionContent(section: ResumeSection): string {
  if (!section.entries.length) return section.content_md.trim();
  const renderEntry = (entry: ResumeSectionEntry): string => {
    const rowFields = new Set(["company", "title", "location", "date_range", "institution", "qualification", "name", "issuer", "date", "url"]);
    const f = Object.fromEntries(Object.entries(entry.fields).map(([key, value]) => [key, rowFields.has(key) ? value.replace(/\s+/g, " ").trim() : value]));
    let lines: string[];
    let handled: Set<string>;
    if (section.kind === "professional_experience") {
      lines = [(f.company ?? "") + (f.location ? ` | ${f.location}` : ""), (f.title ?? "") + (f.date_range ? ` | ${f.date_range}` : "")];
      handled = new Set(["company", "title", "location", "date_range"]);
    } else if (section.kind === "education") {
      lines = [(f.institution ?? "") + (f.location ? ` | ${f.location}` : ""), (f.qualification ?? "") + (f.date_range ? ` | ${f.date_range}` : "")];
      handled = new Set(["institution", "qualification", "location", "date_range"]);
    } else {
      lines = [[f.name ?? f.text ?? "", f.issuer, f.date, f.url].filter(Boolean).join(" | ")];
      if (f.details) lines.push(f.details);
      handled = new Set(["name", "text", "details", "issuer", "date", "url"]);
    }
    for (const [key, value] of Object.entries(f)) {
      if (handled.has(key) || !value.trim()) continue;
      const label = key.replaceAll("_", " ");
      lines.push(`- ${label.charAt(0).toUpperCase()}${label.slice(1).toLowerCase()}: ${value.replaceAll("\n", "\n  ")}`);
    }
    return [...lines, ...entry.bullets.map((bullet) => `- ${bullet.text}`)].join("\n").trim();
  };
  return section.entries.map(renderEntry).filter(Boolean).join("\n\n");
}

export function renderResumeDocument(document: ResumeDocument): string {
  return document.sections.filter((section) => section.enabled).map((section) =>
    `## ${section.heading}\n\n${renderSectionContent(section)}`.trim(),
  ).join("\n\n");
}

/** Used only to make legacy Markdown editable. New imports come with server-created IDs. */
export function documentFromMarkdown(markdown: string): ResumeDocument {
  const parsed = parseResume(markdown);
  return {
    schema_version: 1, revision: 1,
    sections: parsed.sections.map((section) => {
      const id = newResumeId("section");
      const entries: ResumeSectionEntry[] = (section.experienceEntries ?? []).map((entry) => ({
        id: newResumeId("entry"),
        fields: { title: entry.title, company: entry.company, location: entry.location ?? "", date_range: entry.dateRange ?? "" },
        bullets: entry.bullets.map((text) => ({ id: newResumeId("bullet"), text, source_ids: [] })),
      }));
      if (section.kind === "education") {
        entries.push(...(section.educationEntries ?? []).map((entry) => ({
          id: newResumeId("entry"),
          fields: { qualification: entry.degree, institution: entry.institution, location: entry.location ?? "", date_range: entry.dateRange ?? "" },
          bullets: entry.bullets.map((text) => ({ id: newResumeId("bullet"), text, source_ids: [] })),
        })));
      }
      return {
        id, kind: section.kind === "header" ? "custom" : section.kind, heading: section.heading,
        enabled: true, review_state: "needs_review", confidence: null,
        content_md: entries.length ? "" : section.markdownBody ?? section.rawMarkdown,
        entries,
      };
    }),
  };
}

export function hasSectionContent(section: ResumeSection): boolean {
  return Boolean(renderSectionContent(section));
}

export function getResumeRegenerationBlocker(section: ResumeSection, source: ResumeDocument | null | undefined, aggressiveness: unknown, entryId?: string): string | null {
  if (!section.enabled) return "Include this section before regenerating it.";
  const sourceSection = source?.sections.find((item) => item.id === section.id && item.enabled);
  if (!sourceSection || sourceSection.kind !== section.kind) return "Add this section to your base resume, review it, then regenerate the full resume to tailor it.";
  if (sourceSection.kind === "education" || sourceSection.kind === "certifications") return "These source facts stay fixed during tailoring. Edit this section directly.";
  if (sourceSection.kind === "skills" && aggressiveness === "low") return "Low tailoring keeps skills fixed. Edit them directly, or choose a higher tailoring level and regenerate the full resume.";
  if (sourceSection.kind === "professional_experience" && (!sourceSection.entries.length || !section.entries.length)) return "Edit this experience section directly, or organize its roles in your base resume and regenerate the full resume.";
  const sourceEntryIds = new Set(sourceSection.entries.map((entry) => entry.id));
  if (entryId ? !sourceEntryIds.has(entryId) : section.entries.some((entry) => !sourceEntryIds.has(entry.id))) return "Add this entry to your base resume, review it, then regenerate the full resume to tailor it.";
  return null;
}

export function resumeDocumentError(document: ResumeDocument): string | null {
  for (const section of document.sections) {
    if (!section.heading.trim()) return "Give each section a heading before saving.";
    if (/\r|\n/.test(section.heading)) return "Section headings must fit on one line.";
    if (["contact", "contact information", "contact info", "contact details", "contacts", "personal information", "personal details", "personal info"].includes(section.heading.trim().toLowerCase())) return "Manage contact information in your profile.";
    for (const entry of section.entries) if (entry.bullets.some((bullet) => !bullet.text.trim())) return "Write or remove each empty bullet before saving.";
  }
  return null;
}

export function sourceSectionReviewError(section: ResumeSection): string | null {
  if (!hasSectionContent(section)) return "Add the source content before marking this section reviewed.";
  if (section.kind === "professional_experience" && section.entries.some((entry) =>
    !entry.fields.company?.trim() || !entry.fields.title?.trim(),
  )) return "Add an employer and role title for each experience entry before reviewing.";
  if (section.kind === "education" && section.entries.some((entry) =>
    !entry.fields.institution?.trim() || !entry.fields.qualification?.trim(),
  )) return "Add an institution and qualification for each education entry before reviewing.";
  return null;
}
