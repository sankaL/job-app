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
  { value: "1_page", label: "1 Page", description: "Target 450-700 words with an 850-word hard cap." },
  { value: "2_page", label: "2 Pages", description: "Target 900-1400 words with a 1600-word hard cap." },
  { value: "3_page", label: "3 Pages", description: "Target 1500-2100 words with a 2400-word hard cap." },
] as const;

export const AGGRESSIVENESS_OPTIONS = [
  {
    value: "low",
    label: "Low",
    description: "Light cleanup only. Role titles, Skills, and Education stay fixed.",
    warning: undefined,
    details: [
      "Summary: light cleanup only; preserve the original voice closely.",
      "Professional Experience: light rephrasing or bullet reordering only; role titles stay exactly the same.",
      "Skills: no content or grouping changes.",
      "Education: no factual rewrites beyond minimal formatting cleanup.",
    ],
  },
  {
    value: "medium",
    label: "Medium",
    description: "Balanced rewrite, but role titles stay fixed. Education stays fixed.",
    warning: undefined,
    details: [
      "Summary: rewrite for stronger role alignment using source-backed facts only.",
      "Professional Experience: rephrase, reorder, prune, and emphasize grounded bullets, but keep role titles exactly the same.",
      "Skills: reorder, regroup, and prune to the most relevant source-backed skills.",
      "Education: no factual rewrites beyond minimal formatting cleanup.",
    ],
  },
  {
    value: "high",
    label: "High",
    description: "Strongest rewrite. Can materially change phrasing, emphasis, and role titles.",
    details: [
      "Summary: strongest rewrite for role alignment using source-backed facts only.",
      "Professional Experience: aggressively reframe, reprioritize, and condense grounded bullets; role titles may be rewritten when the new title is still a truthful match for the same role.",
      "Skills: aggressively regroup, prioritize, and prune source-backed skills.",
      "Education: no factual rewrites beyond minimal formatting cleanup.",
    ],
    warning:
      "High aggressiveness can make substantial changes to wording, emphasis, and Professional Experience role titles. Use it only when you want a more aggressive rewrite and will review the result carefully.",
  },
] as const;
