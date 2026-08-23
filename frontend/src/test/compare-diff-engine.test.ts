import { describe, it, expect } from "vitest";
import { parseMarkdownResume, parseResume } from "@/components/diff/resume-parser";
import {
  computeWordDiff,
  alignExperienceBullets,
  compareExperienceEntries,
  compareResumeDocs,
} from "@/components/diff/diff-engine";
import type { ResumeRenderModel } from "@/lib/api";

describe("Resume Parser & Diff Engine", () => {
  const sampleBaseMarkdown = `# Sanka Lokuliyana
sanka@example.com | 555-0199 | Toronto, ON

## Summary
Quality Engineering Manager with 10+ years at Deloitte Canada.

## Professional Experience
Deloitte Canada | Toronto, ON
Manager, Quality Engineering | Jan 2022 - Present
- Responsible for QE strategy, team leadership, and quality outcomes across client engagements.
- Rebuilt the regression suite on Playwright, pushing coverage above 80% and cutting execution time by 50%.
- Developed structured mentorship programs for the QE team.

Deloitte Canada | Toronto, ON
Senior Consultant, Quality Engineering | Jan 2019 - Dec 2021
- Led end-to-end QA on the delivery of AI-driven analytics platforms.

## Education
University of Toronto | Toronto, ON
Bachelor of Science in Computer Science | 2014 - 2018

## Skills
- Cypress
- Playwright
- Selenium
- JIRA
`;

  const sampleTailoredMarkdown = `# Sanka Lokuliyana
sanka@example.com | 555-0199 | Toronto, ON

## Summary
Software QA/QC Test Manager with 10+ years of revenue-impacting QA engineering across the SDLC.

## Professional Experience
Deloitte Canada | Toronto, ON
Software QA/QC Test Manager | Jan 2022 - Present
- Define the end-to-end testing strategy and lead a global team of 15+ QA engineers across the SDLC.
- Rebuilt the regression suite on Playwright, boosting regression coverage past 82% and cutting test execution time by 50%.
- Oversee the defect lifecycle using Jira, establishing QA metrics like defect density and escape rate.

Deloitte Canada | Toronto, ON
Senior QA Lead | Jan 2019 - Dec 2021
- Coordinated three concurrent offshore QA teams, managing story estimation and final sign-off.

## Education
University of Toronto | Toronto, ON
Bachelor of Science in Computer Science | 2014 - 2018

## Skills
- Cypress
- Playwright
- Selenium
- JIRA
- Defect Density
- Escape Rate
- CI/CD Pipelines
`;

  it("parses base markdown into structured sections and experience entries", () => {
    const doc = parseMarkdownResume(sampleBaseMarkdown);
    expect(doc.header.name).toBe("Sanka Lokuliyana");
    expect(doc.header.contactLine).toContain("sanka@example.com");
    expect(doc.sections.length).toBe(4);

    const expSection = doc.sections.find((s) => s.kind === "professional_experience");
    expect(expSection).toBeDefined();
    expect(expSection?.experienceEntries?.length).toBe(2);

    const firstJob = expSection!.experienceEntries![0];
    expect(firstJob.company).toBe("Deloitte Canada");
    expect(firstJob.title).toBe("Manager, Quality Engineering");
    expect(firstJob.dateRange).toBe("Jan 2022 - Present");
    expect(firstJob.bullets.length).toBe(3);
  });

  it("computes word-level diffs correctly", () => {
    const base = "Manager, Quality Engineering";
    const tailored = "Software QA/QC Test Manager";
    const chunks = computeWordDiff(base, tailored);

    expect(chunks.some((c) => c.added)).toBe(true);
    expect(chunks.some((c) => c.removed)).toBe(true);
  });

  it("aligns experience bullets and detects modified vs added bullets", () => {
    const baseBullets = [
      "Rebuilt the regression suite on Playwright, pushing coverage above 80% and cutting execution time by 50%.",
      "Mentored junior engineers.",
    ];
    const tailoredBullets = [
      "Rebuilt the regression suite on Playwright, boosting regression coverage past 82% and cutting test execution time by 50%.",
      "Introduced automated defect triage.",
    ];

    const aligned = alignExperienceBullets(baseBullets, tailoredBullets);
    expect(aligned.length).toBe(3); // 1 modified + 1 added + 1 removed

    const modified = aligned.find((b) => b.status === "modified");
    expect(modified).toBeDefined();
    expect(modified?.baseText).toContain("pushing coverage above 80%");
    expect(modified?.tailoredText).toContain("boosting regression coverage past 82%");

    const added = aligned.find((b) => b.status === "added");
    expect(added).toBeDefined();
    expect(added?.tailoredText).toContain("automated defect triage");

    const removed = aligned.find((b) => b.status === "removed");
    expect(removed).toBeDefined();
    expect(removed?.baseText).toContain("Mentored junior engineers");
  });

  it("detects retitled experience roles in compareExperienceEntries", () => {
    const baseDoc = parseMarkdownResume(sampleBaseMarkdown);
    const tailoredDoc = parseMarkdownResume(sampleTailoredMarkdown);

    const baseExp = baseDoc.sections.find((s) => s.kind === "professional_experience")!;
    const tailoredExp = tailoredDoc.sections.find((s) => s.kind === "professional_experience")!;

    const diffs = compareExperienceEntries(baseExp.experienceEntries!, tailoredExp.experienceEntries!);
    expect(diffs.length).toBe(2);

    const firstRole = diffs[0];
    expect(firstRole.company.tailored).toBe("Deloitte Canada");
    expect(firstRole.title.isRetitled).toBe(true);
    expect(firstRole.title.base).toBe("Manager, Quality Engineering");
    expect(firstRole.title.tailored).toBe("Software QA/QC Test Manager");
  });

  it("marks changed employer, date, and location fields as modified", () => {
    const [diff] = compareExperienceEntries(
      [
        {
          id: "base-role",
          company: "Acme Inc.",
          title: "Engineer",
          location: "Toronto, ON",
          dateRange: "2020 - Present",
          bullets: ["Built platform features."],
          rawText: "Acme Inc. | Toronto, ON\nEngineer | 2020 - Present\n- Built platform features.",
        },
      ],
      [
        {
          id: "tailored-role",
          company: "Acme Holdings",
          title: "Engineer",
          location: "Remote",
          dateRange: "2021 - Present",
          bullets: ["Built platform features."],
          rawText: "Acme Holdings | Remote\nEngineer | 2021 - Present\n- Built platform features.",
        },
      ],
    );

    expect(diff.status).toBe("modified");
    expect(diff.company.chunks.some((chunk) => chunk.added || chunk.removed)).toBe(true);
    expect(diff.location.chunks.some((chunk) => chunk.added || chunk.removed)).toBe(true);
    expect(diff.dateRange.chunks.some((chunk) => chunk.added || chunk.removed)).toBe(true);
  });

  it("computes full document comparison summary with stats", () => {
    const baseDoc = parseMarkdownResume(sampleBaseMarkdown);
    const tailoredDoc = parseMarkdownResume(sampleTailoredMarkdown);

    const summary = compareResumeDocs(baseDoc, tailoredDoc);

    expect(summary.sections.length).toBe(4);
    expect(summary.stats.totalRoles).toBe(2);
    expect(summary.stats.retitledRoles).toBe(2);
    expect(summary.stats.addedSkillsCount).toBe(3); // Defect Density, Escape Rate, CI/CD Pipelines

    const skillsSection = summary.sections.find((s) => s.kind === "skills")!;
    expect(skillsSection.skillsDiff?.addedSkills).toEqual(
      expect.arrayContaining(["Defect Density", "Escape Rate", "CI/CD Pipelines"]),
    );
  });

  it("preserves removed education entries within a matched education section", () => {
    const baseDoc = parseMarkdownResume(`# Candidate

## Education
University of Toronto | Toronto, ON
Bachelor of Science | 2014 - 2018

Seneca College | Toronto, ON
Diploma in QA | 2012 - 2014
`);
    const tailoredDoc = parseMarkdownResume(`# Candidate

## Education
University of Toronto | Toronto, ON
Bachelor of Science | 2014 - 2018
`);

    const summary = compareResumeDocs(baseDoc, tailoredDoc);
    const educationSection = summary.sections.find((section) => section.kind === "education");

    expect(educationSection?.status).toBe("modified");
    expect(educationSection?.educationDiffs).toHaveLength(2);
    expect(educationSection?.educationDiffs?.some((entry) => entry.status === "removed")).toBe(true);
  });

  it("tracks removed skills instead of marking them retained", () => {
    const baseDoc = parseMarkdownResume(`# Candidate

## Skills
- Cypress
- Playwright
- Selenium
`);
    const tailoredDoc = parseMarkdownResume(`# Candidate

## Skills
- Cypress
`);

    const summary = compareResumeDocs(baseDoc, tailoredDoc);
    const skillsSection = summary.sections.find((section) => section.kind === "skills");

    expect(skillsSection?.status).toBe("modified");
    expect(skillsSection?.skillsDiff?.retainedSkills).toEqual(["Cypress"]);
    expect(skillsSection?.skillsDiff?.removedSkills).toEqual(["Playwright", "Selenium"]);
  });

  it("parses from ResumeRenderModel when present", () => {
    const renderModel: ResumeRenderModel = {
      render_contract_version: "2026-04-19.v1",
      header: {
        name: "Sanka Lokuliyana",
        contact_line: "sanka@example.com | 555-0199",
        extra_lines: [],
      },
      sections: [
        {
          heading: "Professional Experience",
          kind: "professional_experience",
          entries: [
            {
              row1_left: "Deloitte Canada",
              row1_right: "Toronto, ON",
              row2_left: "Software QA Manager",
              row2_right: "Jan 2022 - Present",
              bullets: ["Defined testing strategy."],
            },
          ],
        },
      ],
      normalized_markdown: "",
    };

    const doc = parseResume("", renderModel);
    expect(doc.header.name).toBe("Sanka Lokuliyana");
    expect(doc.sections.length).toBe(1);
    expect(doc.sections[0].experienceEntries?.[0].title).toBe("Software QA Manager");
  });
});
