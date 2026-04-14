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
      "Professional Experience: light rephrasing or bullet reordering only; role titles stay exactly the same and dates remain fixed.",
      "Skills: no content or grouping changes.",
      "Education: no factual rewrites beyond minimal formatting cleanup.",
    ],
  },
  {
    value: "medium",
    label: "Medium",
    description: "Balanced rewrite with bounded title reframing. Education stays fixed.",
    warning: undefined,
    details: [
      "Summary: stronger rewrite for role alignment using grounded source facts only.",
      "Professional Experience: reframe, reorder, consolidate, prune, and emphasize grounded bullets. Role titles may be lightly reframed only when they stay grounded in the original role family and seniority, while company and dates remain fixed.",
      "Skills: reorder, regroup, and prune to the most relevant source-backed skills, leading with the strongest role-relevant cluster.",
      "Education: no factual rewrites beyond minimal formatting cleanup.",
    ],
  },
  {
    value: "high",
    label: "High",
    description: "Strongest rewrite. Can materially change phrasing, emphasis, and role titles.",
    details: [
      "Summary: strongest rewrite for role alignment, including bounded professional inference from demonstrated patterns in the source.",
      "Professional Experience: aggressively reframe, reprioritize, consolidate, and condense grounded bullets; role titles may be rewritten when the new title still matches the demonstrated work. Company and dates remain fixed.",
      "Skills: aggressively regroup, prioritize, and prune source-backed skills, leading with the most role-relevant cluster.",
      "Education: no factual rewrites beyond minimal formatting cleanup.",
    ],
    warning:
      "High aggressiveness can make substantial changes to wording, emphasis, and Professional Experience role framing, but company and dates stay fixed. Use it only when you want a more aggressive rewrite and will review the result carefully.",
  },
] as const;
