export function formatJudgeInstructions(judgeInstructions: unknown): string {
  if (!judgeInstructions) return "";
  if (typeof judgeInstructions === "string") return judgeInstructions.trim();
  if (typeof judgeInstructions !== "object") return "";
  return Object.entries(judgeInstructions as Record<string, unknown>)
    .flatMap(([sectionId, instructions]) => {
      if (!Array.isArray(instructions)) return [];
      const cleaned = instructions
        .map((item) => String(item ?? "").trim())
        .filter(Boolean);
      if (!cleaned.length) return [];
      const label = sectionId.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
      return [`${label}:`, ...cleaned.map((instruction) => `- ${instruction}`)];
    })
    .join("\n")
    .trim();
}
