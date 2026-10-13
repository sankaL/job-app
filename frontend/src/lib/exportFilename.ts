// Mirrors backend/app/services/export_filename.py so the UI can preview the download
// name. The server's Content-Disposition header stays authoritative.
export const DEFAULT_FILENAME_TEMPLATE = "{first name} {last name} Resume";
export const MAX_FILENAME_TEMPLATE_LENGTH = 120;
export const FILENAME_PLACEHOLDERS = [
  "first name",
  "last name",
  "full name",
  "company",
  "job title",
] as const;

type FilenamePlaceholder = (typeof FILENAME_PLACEHOLDERS)[number];
export type FilenameValues = Record<FilenamePlaceholder, string>;

const PLACEHOLDER_RE = /\{([^{}]*)\}/g;
const DISALLOWED_CHAR_RE = /[^\p{L}\p{M}\p{N} .&()-]|_/gu;
const MAX_STEM_LENGTH = 120;
// Windows refuses these as file names even with an extension.
const WINDOWS_RESERVED_STEMS = new Set([
  "CON", "PRN", "AUX", "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

function normalizePlaceholder(token: string): string {
  return token.trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanStem(value: string): string {
  let stem = value
    .normalize("NFC")
    .replace(DISALLOWED_CHAR_RE, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ .-]+|[ .-]+$/g, "");
  if (stem.length > MAX_STEM_LENGTH) {
    stem = stem.slice(0, MAX_STEM_LENGTH).replace(/[ .-]+$/g, "");
  }
  if (WINDOWS_RESERVED_STEMS.has(stem.toUpperCase())) stem = `${stem} Resume`;
  return stem;
}

function substitute(template: string, values: FilenameValues): string {
  return template.replace(
    PLACEHOLDER_RE,
    (_match, token: string) =>
      values[normalizePlaceholder(token) as FilenamePlaceholder] ?? "",
  );
}

export function buildFilenameValues({
  fullName,
  firstName,
  lastName,
  company,
  jobTitle,
}: {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  jobTitle?: string | null;
}): FilenameValues {
  const parts = (fullName ?? "").split(/\s+/).filter(Boolean);
  const first = parts[0] ?? (firstName ?? "").trim();
  const last = (parts.length > 1 ? parts[parts.length - 1] : "") || (lastName ?? "").trim();
  return {
    "first name": first,
    "last name": last,
    "full name": parts.join(" ") || [first, last].filter(Boolean).join(" "),
    company: (company ?? "").trim(),
    "job title": (jobTitle ?? "").trim(),
  };
}

export function renderFilename(
  template: string | null | undefined,
  values: FilenameValues,
  extension: string,
): string {
  const trimmed = template?.trim();
  let stem = trimmed ? cleanStem(substitute(trimmed, values)) : "";
  if (!stem) stem = cleanStem(substitute(DEFAULT_FILENAME_TEMPLATE, values));
  if (!stem) stem = "Resume";
  return `${stem}.${extension.replace(/^\./, "").toLowerCase()}`;
}

/** Returns an error message for an invalid template, or null when it is valid or blank. */
export function validateFilenameTemplate(template: string): string | null {
  const trimmed = template.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_FILENAME_TEMPLATE_LENGTH) {
    return `File name must be ${MAX_FILENAME_TEMPLATE_LENGTH} characters or fewer.`;
  }
  if ((trimmed.match(/\{/g) ?? []).length !== (trimmed.match(/\}/g) ?? []).length) {
    return "File name has an unmatched { or }.";
  }
  for (const match of trimmed.matchAll(PLACEHOLDER_RE)) {
    if (!FILENAME_PLACEHOLDERS.includes(normalizePlaceholder(match[1]) as FilenamePlaceholder)) {
      return `Unknown placeholder ${match[0]}.`;
    }
  }
  if (!trimmed.match(PLACEHOLDER_RE) && !cleanStem(trimmed)) {
    return "File name must contain letters or numbers.";
  }
  return null;
}
