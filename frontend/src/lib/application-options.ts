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
  { value: "1_page", label: "1 Page", description: "Target 450-700 words; may be shorter when source material is limited." },
  { value: "2_page", label: "2 Pages", description: "Target 900-1400 words; may be shorter when source material is limited." },
  { value: "3_page", label: "3 Pages", description: "Target 1500-2100 words; may be shorter when source material is limited." },
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
    description: "Rewrites your resume to fit the job. Experience, skills, and summary can include things that aren't true.",
    details: [
      "Professional Experience: each role keeps its company and dates. The title can change to fit the job at the same seniority, and any bullet can be replaced with new work that fits the role, matching the job's keywords.",
      "Projects and other optional sections: rewritten to match the new experience.",
      "Skills: rebuilt around the job's keywords and the new experience; may include skills you haven't listed.",
      "Summary: written last, to describe the rewritten resume.",
      "Education and certifications: unchanged.",
    ],
    warning:
      "High rewrites your resume to fit this job. Titles, bullets, skills, and summary may describe work you haven't done. Only company, dates, seniority, education, and certifications stay true to your resume. You accept that risk: review every line, and remove anything you can't speak to in an interview.",
  },
] as const;
