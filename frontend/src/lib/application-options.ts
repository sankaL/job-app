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
    description: "Balanced rewrite with bounded title reframing plus JD keyword/skill injection. Education stays fixed.",
    warning: undefined,
    details: [
      "Summary: stronger rewrite for role alignment using grounded source facts plus job-description language.",
      "Professional Experience: reframe, reorder, consolidate, prune, and emphasize grounded bullets. Role titles may be lightly reframed only when they stay grounded in the original role family and seniority, while company and dates remain fixed.",
      "Skills: reorder, regroup, prune, and add role-relevant job-description keyword skills for fit, leading with the strongest role-relevant cluster.",
      "Education: no factual rewrites beyond minimal formatting cleanup.",
    ],
  },
  {
    value: "high",
    label: "High",
    description: "Strongest rewrite. Can materially change phrasing, emphasis, role titles, and keyword coverage.",
    details: [
      "Summary: strongest rewrite for role alignment, including bounded professional inference and job-description keyword emphasis.",
      "Professional Experience: aggressively reframe, reprioritize, consolidate, and condense grounded bullets; role titles may be rewritten when the new title still matches the demonstrated work. Company and dates remain fixed.",
      "Skills: aggressively regroup, prioritize, prune, and expand with job-description keyword skills for fit.",
      "Education: no factual rewrites beyond minimal formatting cleanup.",
    ],
    warning:
      "High aggressiveness can make substantial changes to wording, emphasis, Professional Experience role framing, and keyword/skills coverage, while company and dates stay fixed. Review all generated additions carefully.",
  },
] as const;
