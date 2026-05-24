export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export type OpenRouterGenerationModelOption = {
  id: string;
  label: string;
  reasoningEfforts: ReasoningEffort[];
};

export const reasoningEffortLabels: Record<ReasoningEffort, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};

export const openRouterGenerationModels: OpenRouterGenerationModelOption[] = [
  {
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    reasoningEfforts: ["none", "low", "medium", "high"],
  },
  {
    id: "openai/gpt-5.4-mini",
    label: "GPT 5.4 Mini",
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh"],
  },
  {
    id: "google/gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    reasoningEfforts: ["none", "low", "medium", "high"],
  },
];

export function getModelOption(modelId: string) {
  return openRouterGenerationModels.find((model) => model.id === modelId) ?? null;
}

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return ["none", "low", "medium", "high", "xhigh"].includes(value);
}
