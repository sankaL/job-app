export const jobPostingOriginOptions = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "indeed", label: "Indeed" },
  { value: "google_jobs", label: "Google Jobs" },
  { value: "glassdoor", label: "Glassdoor" },
  { value: "ziprecruiter", label: "ZipRecruiter" },
  { value: "monster", label: "Monster" },
  { value: "dice", label: "Dice" },
  { value: "company_website", label: "Company Website" },
  { value: "other", label: "Other" },
] as const;

export const visibleStatusLabels = {
  draft: "Draft",
  needs_action: "Needs Action",
  in_progress: "In Progress",
  complete: "Complete",
} as const;

export const PAGE_LENGTH_OPTIONS = [
  { value: "1_page", label: "1 Page" },
  { value: "2_page", label: "2 Pages" },
  { value: "3_page", label: "3 Pages" },
] as const;

export const AGGRESSIVENESS_OPTIONS = [
  { value: "low", label: "Low", description: "Minimal change; preserve voice and structure with light keyword alignment" },
  { value: "medium", label: "Medium", description: "Moderate tailoring; reword and reorder to align with the job posting" },
  { value: "high", label: "High", description: "Stronger tailoring; significant rewrite while staying grounded in source content" },
] as const;
