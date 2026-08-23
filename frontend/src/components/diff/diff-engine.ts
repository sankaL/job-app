import { diffWordsWithSpace, type Change } from "diff";
import {
  type ParsedResumeDoc,
  type ParsedSection,
  type ParsedExperienceEntry,
  type ParsedEducationEntry,
  stripMarkdown,
} from "./resume-parser";
export type { DiffHighlightMode } from "./InlineDiffText";

export interface WordDiffChunk {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export type DiffChangeStatus = "added" | "removed" | "modified" | "unchanged";

export interface BulletDiffItem {
  id: string;
  status: DiffChangeStatus;
  baseText: string | null;
  tailoredText: string | null;
  chunks: WordDiffChunk[];
  similarityScore: number;
}

export interface ExperienceEntryDiff {
  id: string;
  company: string;
  location: {
    base: string | null;
    tailored: string | null;
  };
  dateRange: {
    base: string | null;
    tailored: string | null;
  };
  title: {
    base: string | null;
    tailored: string | null;
    isRetitled: boolean;
    chunks: WordDiffChunk[];
  };
  bullets: BulletDiffItem[];
  status: DiffChangeStatus;
  stats: {
    totalTailoredBullets: number;
    modifiedBullets: number;
    addedBullets: number;
    omittedBullets: number;
  };
}

export interface EducationEntryDiff {
  id: string;
  institution: string;
  degree: {
    base: string | null;
    tailored: string | null;
    chunks: WordDiffChunk[];
  };
  location: string | null;
  dateRange: string | null;
  bullets: BulletDiffItem[];
  status: DiffChangeStatus;
}

export interface SectionDiff {
  id: string;
  heading: string;
  kind: ParsedSection["kind"];
  status: DiffChangeStatus;
  baseSection: ParsedSection | null;
  tailoredSection: ParsedSection | null;
  experienceDiffs?: ExperienceEntryDiff[];
  educationDiffs?: EducationEntryDiff[];
  summaryDiff?: {
    baseText: string;
    tailoredText: string;
    chunks: WordDiffChunk[];
  };
  skillsDiff?: {
    baseSkills: string[];
    tailoredSkills: string[];
    addedSkills: string[];
    retainedSkills: string[];
    removedSkills: string[];
  };
  genericDiff?: {
    baseText: string;
    tailoredText: string;
    chunks: WordDiffChunk[];
  };
  stats: {
    changesCount: number;
    addedCount: number;
    removedCount: number;
  };
}

export interface ResumeComparisonSummary {
  baseDoc: ParsedResumeDoc;
  tailoredDoc: ParsedResumeDoc;
  sections: SectionDiff[];
  stats: {
    totalSections: number;
    modifiedSections: number;
    totalRoles: number;
    retitledRoles: number;
    totalTailoredBullets: number;
    modifiedBullets: number;
    addedBullets: number;
    omittedBullets: number;
    addedSkillsCount: number;
    wordsAdded: number;
    wordsRemoved: number;
  };
}

export function computeWordDiff(baseText: string, tailoredText: string): WordDiffChunk[] {
  if (!baseText && !tailoredText) return [];
  if (!baseText) return [{ value: tailoredText, added: true }];
  if (!tailoredText) return [{ value: baseText, removed: true }];
  if (baseText === tailoredText) return [{ value: baseText }];

  const rawChanges: Change[] = diffWordsWithSpace(baseText, tailoredText);
  return rawChanges.map((c) => ({
    value: c.value,
    added: c.added,
    removed: c.removed,
  }));
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function calculateStringSimilarity(str1: string, str2: string): number {
  const s1 = stripMarkdown(str1).toLowerCase().replace(/[^\w\s]/g, "");
  const s2 = stripMarkdown(str2).toLowerCase().replace(/[^\w\s]/g, "");
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const words1 = new Set(s1.split(/\s+/).filter(Boolean));
  const words2 = new Set(s2.split(/\s+/).filter(Boolean));

  if (words1.size === 0 || words2.size === 0) return 0.0;

  let intersection = 0;
  for (const w of words1) {
    if (words2.has(w)) intersection++;
  }

  const union = new Set([...words1, ...words2]).size;
  return intersection / union;
}

export function alignExperienceBullets(
  baseBullets: string[],
  tailoredBullets: string[],
): BulletDiffItem[] {
  const items: BulletDiffItem[] = [];
  const usedBaseIndices = new Set<number>();

  // Match each tailored bullet with best base bullet
  tailoredBullets.forEach((tailoredText, tIdx) => {
    let bestScore = 0;
    let bestBaseIdx = -1;

    baseBullets.forEach((baseText, bIdx) => {
      if (usedBaseIndices.has(bIdx)) return;
      const score = calculateStringSimilarity(baseText, tailoredText);
      if (score > bestScore) {
        bestScore = score;
        bestBaseIdx = bIdx;
      }
    });

    // If similarity threshold is met (e.g. >= 0.25), consider it a match
    if (bestScore >= 0.25 && bestBaseIdx !== -1) {
      usedBaseIndices.add(bestBaseIdx);
      const baseText = baseBullets[bestBaseIdx];
      const isUnchanged = stripMarkdown(baseText) === stripMarkdown(tailoredText);
      items.push({
        id: `bullet-tailored-${tIdx}-base-${bestBaseIdx}`,
        status: isUnchanged ? "unchanged" : "modified",
        baseText,
        tailoredText,
        chunks: computeWordDiff(baseText, tailoredText),
        similarityScore: bestScore,
      });
    } else {
      // Brand new tailored bullet
      items.push({
        id: `bullet-tailored-${tIdx}-new`,
        status: "added",
        baseText: null,
        tailoredText,
        chunks: [{ value: tailoredText, added: true }],
        similarityScore: 0,
      });
    }
  });

  // Omitted base bullets
  baseBullets.forEach((baseText, bIdx) => {
    if (!usedBaseIndices.has(bIdx)) {
      items.push({
        id: `bullet-base-omitted-${bIdx}`,
        status: "removed",
        baseText,
        tailoredText: null,
        chunks: [{ value: baseText, removed: true }],
        similarityScore: 0,
      });
    }
  });

  return items;
}

export function compareExperienceEntries(
  baseEntries: ParsedExperienceEntry[],
  tailoredEntries: ParsedExperienceEntry[],
): ExperienceEntryDiff[] {
  const diffs: ExperienceEntryDiff[] = [];
  const usedBaseIds = new Set<string>();

  tailoredEntries.forEach((tailored, tIdx) => {
    // Find matching base entry by company name or order
    const normTailoredCompany = stripMarkdown(tailored.company).toLowerCase();
    let bestBase: ParsedExperienceEntry | null = null;
    let bestBaseScore = 0;

    for (const base of baseEntries) {
      if (usedBaseIds.has(base.id)) continue;
      const normBaseCompany = stripMarkdown(base.company).toLowerCase();
      let score = 0;
      if (normBaseCompany === normTailoredCompany) {
        score = 1.0;
      } else if (normBaseCompany.includes(normTailoredCompany) || normTailoredCompany.includes(normBaseCompany)) {
        score = 0.8;
      } else {
        score = calculateStringSimilarity(base.company, tailored.company);
      }

      if (score > bestBaseScore) {
        bestBaseScore = score;
        bestBase = base;
      }
    }

    // If fallback by index if company similarity isn't found
    if (!bestBase && baseEntries[tIdx] && !usedBaseIds.has(baseEntries[tIdx].id)) {
      bestBase = baseEntries[tIdx];
    }

    if (bestBase) {
      usedBaseIds.add(bestBase.id);
    }

    const baseTitle = bestBase?.title ?? null;
    const tailoredTitle = tailored.title;
    const isRetitled = Boolean(
      baseTitle &&
        tailoredTitle &&
        stripMarkdown(baseTitle).toLowerCase() !== stripMarkdown(tailoredTitle).toLowerCase(),
    );

    const titleChunks = computeWordDiff(baseTitle ?? "", tailoredTitle);
    const bullets = alignExperienceBullets(bestBase?.bullets ?? [], tailored.bullets);

    const modifiedBullets = bullets.filter((b) => b.status === "modified").length;
    const addedBullets = bullets.filter((b) => b.status === "added").length;
    const omittedBullets = bullets.filter((b) => b.status === "removed").length;

    let entryStatus: DiffChangeStatus = "unchanged";
    if (!bestBase) entryStatus = "added";
    else if (isRetitled || modifiedBullets > 0 || addedBullets > 0 || omittedBullets > 0) {
      entryStatus = "modified";
    }

    diffs.push({
      id: `exp-diff-${tailored.id}`,
      company: tailored.company || bestBase?.company || `Role ${tIdx + 1}`,
      location: {
        base: bestBase?.location ?? null,
        tailored: tailored.location ?? null,
      },
      dateRange: {
        base: bestBase?.dateRange ?? null,
        tailored: tailored.dateRange ?? null,
      },
      title: {
        base: baseTitle,
        tailored: tailoredTitle,
        isRetitled,
        chunks: titleChunks,
      },
      bullets,
      status: entryStatus,
      stats: {
        totalTailoredBullets: tailored.bullets.length,
        modifiedBullets,
        addedBullets,
        omittedBullets,
      },
    });
  });

  // Handle any remaining base entries not present in tailored
  baseEntries.forEach((base) => {
    if (!usedBaseIds.has(base.id)) {
      diffs.push({
        id: `exp-diff-omitted-${base.id}`,
        company: base.company,
        location: { base: base.location, tailored: null },
        dateRange: { base: base.dateRange, tailored: null },
        title: {
          base: base.title,
          tailored: null,
          isRetitled: false,
          chunks: [{ value: base.title, removed: true }],
        },
        bullets: base.bullets.map((b, bIdx) => ({
          id: `omitted-b-${bIdx}`,
          status: "removed",
          baseText: b,
          tailoredText: null,
          chunks: [{ value: b, removed: true }],
          similarityScore: 0,
        })),
        status: "removed",
        stats: {
          totalTailoredBullets: 0,
          modifiedBullets: 0,
          addedBullets: 0,
          omittedBullets: base.bullets.length,
        },
      });
    }
  });

  return diffs;
}

export function compareEducationEntries(
  baseEntries: ParsedEducationEntry[],
  tailoredEntries: ParsedEducationEntry[],
): EducationEntryDiff[] {
  const diffs: EducationEntryDiff[] = [];
  const usedBaseIds = new Set<string>();

  tailoredEntries.forEach((tailored, idx) => {
    let bestBase = baseEntries.find((b) => !usedBaseIds.has(b.id) && stripMarkdown(b.institution).toLowerCase() === stripMarkdown(tailored.institution).toLowerCase()) ?? null;
    if (!bestBase && baseEntries[idx] && !usedBaseIds.has(baseEntries[idx].id)) {
      bestBase = baseEntries[idx];
    }
    if (bestBase) {
      usedBaseIds.add(bestBase.id);
    }

    const degreeChunks = computeWordDiff(bestBase?.degree ?? "", tailored.degree);
    const bullets = alignExperienceBullets(bestBase?.bullets ?? [], tailored.bullets);
    const hasDegreeChanges = degreeChunks.some((c) => c.added || c.removed);
    const hasBulletChanges = bullets.some((bullet) => bullet.status !== "unchanged");
    const locationChanged =
      stripMarkdown(bestBase?.location ?? "").toLowerCase() !==
      stripMarkdown(tailored.location ?? "").toLowerCase();
    const dateRangeChanged =
      stripMarkdown(bestBase?.dateRange ?? "").toLowerCase() !==
      stripMarkdown(tailored.dateRange ?? "").toLowerCase();

    let status: DiffChangeStatus = "unchanged";
    if (!bestBase) {
      status = "added";
    } else if (hasDegreeChanges || hasBulletChanges || locationChanged || dateRangeChanged) {
      status = "modified";
    }

    diffs.push({
      id: `edu-diff-${tailored.id}`,
      institution: tailored.institution || bestBase?.institution || `Education ${idx + 1}`,
      degree: {
        base: bestBase?.degree ?? null,
        tailored: tailored.degree,
        chunks: degreeChunks,
      },
      location: tailored.location || bestBase?.location || null,
      dateRange: tailored.dateRange || bestBase?.dateRange || null,
      bullets,
      status,
    });
  });

  baseEntries.forEach((base) => {
    if (!usedBaseIds.has(base.id)) {
      diffs.push({
        id: `edu-diff-omitted-${base.id}`,
        institution: base.institution,
        degree: {
          base: base.degree,
          tailored: null,
          chunks: [{ value: base.degree, removed: true }],
        },
        location: base.location,
        dateRange: base.dateRange,
        bullets: base.bullets.map((bullet, idx) => ({
          id: `edu-omitted-b-${idx}`,
          status: "removed",
          baseText: bullet,
          tailoredText: null,
          chunks: [{ value: bullet, removed: true }],
          similarityScore: 0,
        })),
        status: "removed",
      });
    }
  });

  return diffs;
}

export function compareResumeDocs(
  baseDoc: ParsedResumeDoc,
  tailoredDoc: ParsedResumeDoc,
): ResumeComparisonSummary {
  const sectionDiffs: SectionDiff[] = [];
  const usedBaseSectionIds = new Set<string>();

  let wordsAdded = 0;
  let wordsRemoved = 0;
  let retitledRoles = 0;
  let totalRoles = 0;
  let totalTailoredBullets = 0;
  let modifiedBullets = 0;
  let addedBullets = 0;
  let omittedBullets = 0;
  let addedSkillsCount = 0;

  // Process tailored sections
  tailoredDoc.sections.forEach((tailoredSec, idx) => {
    // Find matching base section by kind
    let matchingBase = baseDoc.sections.find(
      (b) => !usedBaseSectionIds.has(b.id) && b.kind === tailoredSec.kind,
    ) ?? null;

    // Fallback to title match
    if (!matchingBase) {
      matchingBase = baseDoc.sections.find(
        (b) => !usedBaseSectionIds.has(b.id) && stripMarkdown(b.heading).toLowerCase() === stripMarkdown(tailoredSec.heading).toLowerCase(),
      ) ?? null;
    }

    if (matchingBase) {
      usedBaseSectionIds.add(matchingBase.id);
    }

    let sectionStatus: DiffChangeStatus = !matchingBase ? "added" : "unchanged";
    let expDiffs: ExperienceEntryDiff[] | undefined;
    let eduDiffs: EducationEntryDiff[] | undefined;
    let summaryDiff: SectionDiff["summaryDiff"];
    let skillsDiff: SectionDiff["skillsDiff"];
    let genericDiff: SectionDiff["genericDiff"];
    let changesCount = 0;
    let secAdded = 0;
    let secRemoved = 0;

    if (tailoredSec.kind === "professional_experience") {
      expDiffs = compareExperienceEntries(
        matchingBase?.experienceEntries ?? [],
        tailoredSec.experienceEntries ?? [],
      );

      expDiffs.forEach((e) => {
        totalRoles++;
        if (e.title.isRetitled) retitledRoles++;
        totalTailoredBullets += e.stats.totalTailoredBullets;
        modifiedBullets += e.stats.modifiedBullets;
        addedBullets += e.stats.addedBullets;
        omittedBullets += e.stats.omittedBullets;

        if (e.status !== "unchanged") {
          changesCount += e.stats.modifiedBullets + e.stats.addedBullets + (e.title.isRetitled ? 1 : 0);
        }
      });

      if (expDiffs.some((e) => e.status !== "unchanged")) {
        sectionStatus = "modified";
      }
    } else if (tailoredSec.kind === "education") {
      eduDiffs = compareEducationEntries(
        matchingBase?.educationEntries ?? [],
        tailoredSec.educationEntries ?? [],
      );
      if (eduDiffs.some((e) => e.status !== "unchanged")) {
        sectionStatus = "modified";
        changesCount += 1;
      }
    } else if (tailoredSec.kind === "summary") {
      const baseBody = matchingBase?.rawMarkdown || matchingBase?.markdownBody || "";
      const tailoredBody = tailoredSec.rawMarkdown || tailoredSec.markdownBody || "";
      const chunks = computeWordDiff(baseBody, tailoredBody);

      chunks.forEach((c) => {
        if (c.added) {
          const w = countWords(c.value);
          wordsAdded += w;
          secAdded += w;
        }
        if (c.removed) {
          const w = countWords(c.value);
          wordsRemoved += w;
          secRemoved += w;
        }
      });

      const isDiff = chunks.some((c) => c.added || c.removed);
      if (isDiff) {
        sectionStatus = "modified";
        changesCount = secAdded + secRemoved;
      }
      summaryDiff = {
        baseText: baseBody,
        tailoredText: tailoredBody,
        chunks,
      };
    } else if (tailoredSec.kind === "skills") {
      const baseSkills = matchingBase?.skillsList ?? [];
      const tailoredSkills = tailoredSec.skillsList ?? [];
      const baseSet = new Set(baseSkills.map((s) => s.toLowerCase().trim()));
      const tailoredSet = new Set(tailoredSkills.map((s) => s.toLowerCase().trim()));

      const added = tailoredSkills.filter((s) => !baseSet.has(s.toLowerCase().trim()));
      const retained = tailoredSkills.filter((s) => baseSet.has(s.toLowerCase().trim()));
      const removed = baseSkills.filter((s) => !tailoredSet.has(s.toLowerCase().trim()));

      addedSkillsCount += added.length;
      changesCount += added.length + removed.length;

      if (added.length > 0 || removed.length > 0) {
        sectionStatus = "modified";
      }

      skillsDiff = {
        baseSkills,
        tailoredSkills,
        addedSkills: added,
        retainedSkills: retained,
        removedSkills: removed,
      };
    } else {
      // Generic section
      const baseBody = matchingBase?.rawMarkdown || matchingBase?.markdownBody || "";
      const tailoredBody = tailoredSec.rawMarkdown || tailoredSec.markdownBody || "";
      const chunks = computeWordDiff(baseBody, tailoredBody);

      chunks.forEach((c) => {
        if (c.added) {
          const w = countWords(c.value);
          wordsAdded += w;
          secAdded += w;
        }
        if (c.removed) {
          const w = countWords(c.value);
          wordsRemoved += w;
          secRemoved += w;
        }
      });

      if (chunks.some((c) => c.added || c.removed)) {
        sectionStatus = "modified";
        changesCount = secAdded + secRemoved;
      }

      genericDiff = {
        baseText: baseBody,
        tailoredText: tailoredBody,
        chunks,
      };
    }

    sectionDiffs.push({
      id: `sec-diff-${tailoredSec.id || idx}`,
      heading: tailoredSec.heading,
      kind: tailoredSec.kind,
      status: sectionStatus,
      baseSection: matchingBase,
      tailoredSection: tailoredSec,
      experienceDiffs: expDiffs,
      educationDiffs: eduDiffs,
      summaryDiff,
      skillsDiff,
      genericDiff,
      stats: {
        changesCount,
        addedCount: secAdded,
        removedCount: secRemoved,
      },
    });
  });

  // Unmatched base sections
  baseDoc.sections.forEach((baseSec) => {
    if (!usedBaseSectionIds.has(baseSec.id)) {
      let expDiffs: ExperienceEntryDiff[] | undefined;
      let eduDiffs: EducationEntryDiff[] | undefined;
      let summaryDiff: SectionDiff["summaryDiff"];
      let skillsDiff: SectionDiff["skillsDiff"];

      if (baseSec.kind === "skills") {
        skillsDiff = {
          baseSkills: baseSec.skillsList ?? [],
          tailoredSkills: [],
          addedSkills: [],
          retainedSkills: [],
          removedSkills: baseSec.skillsList ?? [],
        };
      } else if (baseSec.kind === "professional_experience") {
        expDiffs = compareExperienceEntries(baseSec.experienceEntries ?? [], []);
      } else if (baseSec.kind === "education") {
        eduDiffs = compareEducationEntries(baseSec.educationEntries ?? [], []);
      } else if (baseSec.kind === "summary") {
        summaryDiff = {
          baseText: baseSec.rawMarkdown,
          tailoredText: "",
          chunks: [{ value: baseSec.rawMarkdown, removed: true }],
        };
      }

      sectionDiffs.push({
        id: `sec-diff-omitted-${baseSec.id}`,
        heading: baseSec.heading,
        kind: baseSec.kind,
        status: "removed",
        baseSection: baseSec,
        tailoredSection: null,
        experienceDiffs: expDiffs,
        educationDiffs: eduDiffs,
        summaryDiff,
        skillsDiff,
        genericDiff: {
          baseText: baseSec.rawMarkdown,
          tailoredText: "",
          chunks: [{ value: baseSec.rawMarkdown, removed: true }],
        },
        stats: {
          changesCount: 1,
          addedCount: 0,
          removedCount: countWords(baseSec.rawMarkdown),
        },
      });
    }
  });

  const modifiedSections = sectionDiffs.filter((s) => s.status !== "unchanged").length;

  return {
    baseDoc,
    tailoredDoc,
    sections: sectionDiffs,
    stats: {
      totalSections: sectionDiffs.length,
      modifiedSections,
      totalRoles,
      retitledRoles,
      totalTailoredBullets,
      modifiedBullets,
      addedBullets,
      omittedBullets,
      addedSkillsCount,
      wordsAdded,
      wordsRemoved,
    },
  };
}
