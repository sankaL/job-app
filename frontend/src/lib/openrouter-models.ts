export type ReasoningEffort = "auto" | "none" | "low" | "medium" | "high" | "xhigh";

export type OpenRouterGenerationModelOption = {
  id: string;
  label: string;
  reasoningEfforts: ReasoningEffort[];
};

export const reasoningEffortLabels: Record<ReasoningEffort, string> = {
  auto: "Auto",
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};

export const openRouterGenerationModels: OpenRouterGenerationModelOption[] = [
  {
    id: "openai/gpt-5.6-luna",
    label: "GPT 5.6 Luna",
    reasoningEfforts: ["auto", "none", "low", "medium", "high", "xhigh"],
  },
  {
    id: "google/gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    reasoningEfforts: ["auto", "none", "low", "medium", "high"],
  },
  {
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    reasoningEfforts: ["auto", "none", "low", "medium", "high"],
  },
  {
    id: "openai/gpt-5.4-mini",
    label: "GPT 5.4 Mini",
    reasoningEfforts: ["auto", "none", "low", "medium", "high", "xhigh"],
  },
  {
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    reasoningEfforts: ["auto", "none", "high", "xhigh"],
  },
  {
    id: "google/gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    reasoningEfforts: ["auto", "none", "low", "medium", "high"],
  },
];

const reasoningEffortValues = new Set<ReasoningEffort>(["auto", "none", "low", "medium", "high", "xhigh"]);

export function getModelOption(modelId: string) {
  return openRouterGenerationModels.find((model) => model.id === modelId) ?? null;
}

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return reasoningEffortValues.has(value as ReasoningEffort);
}
