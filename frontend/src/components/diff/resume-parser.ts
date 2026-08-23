import type { ResumeRenderModel } from "@/lib/api";

export type SectionKind =
  | "header"
  | "summary"
  | "professional_experience"
  | "education"
  | "skills"
  | "certifications"
  | "projects"
  | "custom";

export interface ParsedExperienceEntry {
  id: string;
  company: string;
  location: string | null;
  title: string;
  dateRange: string | null;
  bullets: string[];
  rawText: string;
}

export interface ParsedEducationEntry {
  id: string;
  institution: string;
  location: string | null;
  degree: string;
  dateRange: string | null;
  bullets: string[];
  rawText: string;
}

export interface ParsedSection {
  id: string;
  heading: string;
  kind: SectionKind;
  rawMarkdown: string;
  experienceEntries?: ParsedExperienceEntry[];
  educationEntries?: ParsedEducationEntry[];
  skillsList?: string[];
  markdownBody?: string;
}

export interface ParsedResumeHeader {
  name: string | null;
  contactLine: string | null;
  extraLines: string[];
  rawText: string;
}

export interface ParsedResumeDoc {
  header: ParsedResumeHeader;
  sections: ParsedSection[];
  rawMarkdown: string;
}

const SECTION_HEADING_RE = /^##\s+(.+?)\s*$/;
const TOP_HEADING_RE = /^#\s+(.+?)\s*$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/;
const PHONE_RE = /(?:\+\d[\d\s().-]{6,}|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;
const LINKEDIN_RE = /linkedin\.com\/|(?:^|[\s|])(?:in|pub|company)\//i;

const DATE_RANGE_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b(?:\s*(?:-|–|—|to)\s*(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}|present|current))?|\b\d{4}\s*[-/]\s*(?:\d{4}|present)\b|\b(?:present|current)\b/i;

const SINGLE_DATE_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b|\b(?:19|20)\d{2}\b/i;

const INSTITUTION_RE =
  /\b(?:university|college|institute|school|academy|polytechnic|conservatory)\b/i;
const DEGREE_RE =
  /\b(?:bachelor|master|doctor|phd|mba|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|degree|certificate|diploma)\b/i;

export function classifyHeading(heading: string): SectionKind {
  const norm = heading.trim().toLowerCase();
  if (norm.includes("experience") || norm.includes("employment") || norm.includes("history") || norm.includes("work")) {
    return "professional_experience";
  }
  if (norm.includes("summary") || norm.includes("profile") || norm.includes("objective") || norm.includes("about")) {
    return "summary";
  }
  if (norm.includes("education") || norm.includes("academic")) {
    return "education";
  }
  if (norm.includes("skill") || norm.includes("technolog") || norm.includes("competenc") || norm.includes("expertise")) {
    return "skills";
  }
  if (norm.includes("certificat") || norm.includes("credential") || norm.includes("license")) {
    return "certifications";
  }
  if (norm.includes("project")) {
    return "projects";
  }
  return "custom";
}

export function stripMarkdown(value: string): string {
  if (!value) return "";
  return value
    .replace(/[`*_~]/g, "")
    .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function splitPipeLine(line: string): string[] {
  return line
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isContactishLine(line: string): boolean {
  return line.includes("|") || EMAIL_RE.test(line) || PHONE_RE.test(line) || LINKEDIN_RE.test(line);
}

function looksLikeDate(value: string, allowSingleDate = false): boolean {
  const norm = stripMarkdown(value);
  if (!norm) return false;
  if (DATE_RANGE_RE.test(norm)) return true;
  return allowSingleDate && SINGLE_DATE_RE.test(norm);
}

function looksLikeInstitution(value: string): boolean {
  return INSTITUTION_RE.test(stripMarkdown(value));
}

function looksLikeDegree(value: string): boolean {
  return DEGREE_RE.test(stripMarkdown(value));
}

function parseBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    blocks.push(current);
  }
  return blocks;
}

function parseExperienceBlock(block: string[], index: number): ParsedExperienceEntry {
  const headerLines: string[] = [];
  const bullets: string[] = [];

  for (const line of block) {
    const bulletMatch = line.trim().match(BULLET_RE);
    if (bulletMatch) {
      bullets.push(bulletMatch[1].trim());
      continue;
    }
    if (bullets.length > 0) {
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line.trim()}`;
      continue;
    }
    headerLines.push(line.trim());
  }

  let company = "";
  let title = "";
  let location: string | null = null;
  let dateRange: string | null = null;

  if (headerLines.length === 1) {
    const parts = splitPipeLine(headerLines[0]);
    if (parts.length >= 3) {
      company = parts[0];
      title = parts[1];
      dateRange = parts[2];
    } else if (parts.length === 2) {
      company = parts[0];
      title = parts[1];
    } else {
      company = parts[0] || `Role ${index + 1}`;
      title = parts[0] || `Role ${index + 1}`;
    }
  } else if (headerLines.length >= 2) {
    const row1Parts = splitPipeLine(headerLines[0]);
    const row2Parts = splitPipeLine(headerLines[1]);

    const row1Left = row1Parts[0] ?? "";
    const row1Right = row1Parts[1] ?? null;
    const row2Left = row2Parts[0] ?? "";
    const row2Right = row2Parts[1] ?? null;

    const row1RightIsDate = row1Right ? looksLikeDate(row1Right) : false;
    const row2RightIsDate = row2Right ? looksLikeDate(row2Right) : false;

    if (row2RightIsDate) {
      // Canonical format: Row 1 = Company | Location, Row 2 = Title | Date
      company = row1Left;
      location = row1Right;
      title = row2Left;
      dateRange = row2Right;
    } else if (row1RightIsDate) {
      // Inverted format: Row 1 = Title | Date, Row 2 = Company | Location
      title = row1Left;
      dateRange = row1Right;
      company = row2Left;
      location = row2Right;
    } else {
      company = row1Left;
      location = row1Right;
      title = row2Left || row1Left;
      dateRange = row2Right;
    }
  }

  return {
    id: `exp-${index}-${slugify(company || title || String(index))}`,
    company: company.trim(),
    location: location?.trim() || null,
    title: title.trim(),
    dateRange: dateRange?.trim() || null,
    bullets,
    rawText: block.join("\n"),
  };
}

function parseEducationBlock(block: string[], index: number): ParsedEducationEntry {
  const headerLines: string[] = [];
  const bullets: string[] = [];

  for (const line of block) {
    const bulletMatch = line.trim().match(BULLET_RE);
    if (bulletMatch) {
      bullets.push(bulletMatch[1].trim());
      continue;
    }
    if (bullets.length > 0) {
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line.trim()}`;
      continue;
    }
    headerLines.push(line.trim());
  }

  let institution = "";
  let degree = "";
  let location: string | null = null;
  let dateRange: string | null = null;

  if (headerLines.length === 1) {
    const parts = splitPipeLine(headerLines[0]);
    if (parts.length >= 3) {
      institution = parts[0];
      degree = parts[1];
      dateRange = parts[2];
    } else if (parts.length === 2) {
      institution = parts[0];
      degree = parts[1];
    } else {
      institution = parts[0] || `Education ${index + 1}`;
      degree = parts[0] || `Degree`;
    }
  } else if (headerLines.length >= 2) {
    const row1Parts = splitPipeLine(headerLines[0]);
    const row2Parts = splitPipeLine(headerLines[1]);

    const row1Left = row1Parts[0] ?? "";
    const row1Right = row1Parts[1] ?? null;
    const row2Left = row2Parts[0] ?? "";
    const row2Right = row2Parts[1] ?? null;

    if (looksLikeInstitution(row1Left) || looksLikeDegree(row2Left)) {
      institution = row1Left;
      location = row1Right;
      degree = row2Left;
      dateRange = row2Right;
    } else {
      institution = row2Left || row1Left;
      location = row2Right;
      degree = row1Left;
      dateRange = row1Right;
    }
  }

  return {
    id: `edu-${index}-${slugify(institution || degree || String(index))}`,
    institution: institution.trim(),
    location: location?.trim() || null,
    degree: degree.trim(),
    dateRange: dateRange?.trim() || null,
    bullets,
    rawText: block.join("\n"),
  };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/--+/g, "-")
    .trim();
}

export function parseSkillsList(lines: string[]): string[] {
  const skills: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bulletMatch = trimmed.match(BULLET_RE);
    const content = bulletMatch ? bulletMatch[1] : trimmed;

    const parts = content.split(/[,|•·;]/).map((s) => stripMarkdown(s).trim()).filter(Boolean);
    if (parts.length > 1) {
      skills.push(...parts);
    } else if (parts.length === 1) {
      skills.push(parts[0]);
    }
  }
  return Array.from(new Set(skills));
}

export function parseMarkdownResume(markdown: string): ParsedResumeDoc {
  const stripped = markdown.trim();
  if (!stripped) {
    return {
      header: { name: null, contactLine: null, extraLines: [], rawText: "" },
      sections: [],
      rawMarkdown: markdown,
    };
  }

  const lines = stripped.split(/\r?\n/);
  const firstSectionIdx = lines.findIndex((l) => SECTION_HEADING_RE.test(l.trim()));
  const preambleLines = firstSectionIdx === -1 ? lines : lines.slice(0, firstSectionIdx);
  const bodyLines = firstSectionIdx === -1 ? [] : lines.slice(firstSectionIdx);

  // Parse header
  let name: string | null = null;
  let contactLine: string | null = null;
  const extraLines: string[] = [];
  const nonBlankPreamble = preambleLines.filter((l) => l.trim().length > 0);

  if (nonBlankPreamble.length > 0) {
    const first = nonBlankPreamble[0].trim();
    const topHeadingMatch = first.match(TOP_HEADING_RE);
    if (topHeadingMatch) {
      name = topHeadingMatch[1].trim();
    } else {
      name = stripMarkdown(first);
    }

    for (const line of nonBlankPreamble.slice(1)) {
      const trimmed = line.trim();
      if (!contactLine && isContactishLine(trimmed)) {
        contactLine = trimmed;
      } else {
        extraLines.push(trimmed);
      }
    }
  }

  // Parse sections
  const sectionTuples: Array<{ heading: string; lines: string[] }> = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of bodyLines) {
    const match = line.trim().match(SECTION_HEADING_RE);
    if (match) {
      if (currentHeading !== null) {
        sectionTuples.push({ heading: currentHeading, lines: currentLines });
      }
      currentHeading = match[1].trim();
      currentLines = [];
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
  }
  if (currentHeading !== null) {
    sectionTuples.push({ heading: currentHeading, lines: currentLines });
  }

  const sections: ParsedSection[] = sectionTuples.map((st, idx) => {
    const kind = classifyHeading(st.heading);
    const rawMarkdown = st.lines.join("\n").trim();
    const blocks = parseBlocks(st.lines);

    if (kind === "professional_experience") {
      const entries = blocks.map((b, i) => parseExperienceBlock(b, i));
      return {
        id: `section-${idx}-${kind}`,
        heading: st.heading,
        kind,
        rawMarkdown,
        experienceEntries: entries,
      };
    }

    if (kind === "education") {
      const entries = blocks.map((b, i) => parseEducationBlock(b, i));
      return {
        id: `section-${idx}-${kind}`,
        heading: st.heading,
        kind,
        rawMarkdown,
        educationEntries: entries,
      };
    }

    if (kind === "skills") {
      const skillsList = parseSkillsList(st.lines);
      return {
        id: `section-${idx}-${kind}`,
        heading: st.heading,
        kind,
        rawMarkdown,
        skillsList,
        markdownBody: rawMarkdown,
      };
    }

    return {
      id: `section-${idx}-${kind}`,
      heading: st.heading,
      kind,
      rawMarkdown,
      markdownBody: rawMarkdown,
    };
  });

  return {
    header: {
      name,
      contactLine,
      extraLines,
      rawText: preambleLines.join("\n"),
    },
    sections,
    rawMarkdown: markdown,
  };
}

export function parseFromRenderModel(model: ResumeRenderModel): ParsedResumeDoc {
  const sections: ParsedSection[] = model.sections.map((sec, idx) => {
    const kind = classifyHeading(sec.heading);
    if (sec.kind === "professional_experience" || kind === "professional_experience") {
      const expEntries: ParsedExperienceEntry[] = sec.entries.map((entry, eIdx) => ({
        id: `exp-${idx}-${eIdx}-${slugify(entry.row1_left || entry.row2_left || String(eIdx))}`,
        company: entry.row1_left,
        location: entry.row1_right,
        title: entry.row2_left,
        dateRange: entry.row2_right,
        bullets: entry.bullets,
        rawText: `${entry.row1_left} | ${entry.row1_right ?? ""}\n${entry.row2_left} | ${entry.row2_right ?? ""}\n${entry.bullets.map((b) => `- ${b}`).join("\n")}`,
      }));
      return {
        id: `section-${idx}-experience`,
        heading: sec.heading,
        kind: "professional_experience",
        rawMarkdown: sec.markdown_body ?? "",
        experienceEntries: expEntries,
      };
    }

    if (sec.kind === "education" || kind === "education") {
      const eduEntries: ParsedEducationEntry[] = sec.entries.map((entry, eIdx) => ({
        id: `edu-${idx}-${eIdx}-${slugify(entry.row1_left || entry.row2_left || String(eIdx))}`,
        institution: entry.row1_left,
        location: entry.row1_right,
        degree: entry.row2_left,
        dateRange: entry.row2_right,
        bullets: entry.bullets,
        rawText: `${entry.row1_left} | ${entry.row1_right ?? ""}\n${entry.row2_left} | ${entry.row2_right ?? ""}\n${entry.bullets.map((b) => `- ${b}`).join("\n")}`,
      }));
      return {
        id: `section-${idx}-education`,
        heading: sec.heading,
        kind: "education",
        rawMarkdown: sec.markdown_body ?? "",
        educationEntries: eduEntries,
      };
    }

    const rawBody = sec.markdown_body ?? "";
    const isSkills = kind === "skills";
    return {
      id: `section-${idx}-${kind}`,
      heading: sec.heading,
      kind,
      rawMarkdown: rawBody,
      markdownBody: rawBody,
      skillsList: isSkills ? parseSkillsList(rawBody.split("\n")) : undefined,
    };
  });

  return {
    header: {
      name: model.header?.name ?? null,
      contactLine: model.header?.contact_line ?? null,
      extraLines: model.header?.extra_lines ?? [],
      rawText: model.header?.name ? `# ${model.header.name}\n${model.header.contact_line ?? ""}` : "",
    },
    sections,
    rawMarkdown: model.normalized_markdown || "",
  };
}

export function parseResume(markdown: string, renderModel?: ResumeRenderModel | null): ParsedResumeDoc {
  if (renderModel && renderModel.sections?.length > 0) {
    try {
      return parseFromRenderModel(renderModel);
    } catch {
      // Fallback to markdown parser
    }
  }
  return parseMarkdownResume(markdown);
}
