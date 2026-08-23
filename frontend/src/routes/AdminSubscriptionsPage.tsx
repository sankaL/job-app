import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, RefreshCcw, Save, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { updateSubscriptionTier, type SubscriptionTier } from "@/lib/api";
import {
  getModelOption,
  isReasoningEffort,
  openRouterGenerationModels,
  reasoningEffortLabels,
  type ReasoningEffort,
} from "@/lib/openrouter-models";
import {
  invalidateSubscriptionTierQueries,
  useSubscriptionTiersQuery,
} from "@/lib/queries";

const maxMonthlyResumeGenerationLimit = 10000;

type TierFormState = {
  monthly_resume_generation_limit: string;
  generation_model: string;
  generation_reasoning_effort: ReasoningEffort;
  generation_fallback_model: string;
  generation_fallback_reasoning_effort: ReasoningEffort;
};

const tierAccent: Record<
  SubscriptionTier["key"],
  { accent: string; tint: string }
> = {
  basic: { accent: "var(--color-spruce)", tint: "var(--color-spruce-10)" },
  pro: { accent: "var(--color-amber)", tint: "var(--color-amber-10)" },
};

function stateFromTier(tier: SubscriptionTier): TierFormState {
  return {
    monthly_resume_generation_limit: String(
      tier.monthly_resume_generation_limit,
    ),
    generation_model: tier.generation_model,
    generation_reasoning_effort: normalizeReasoning(
      tier.generation_reasoning_effort,
    ),
    generation_fallback_model: tier.generation_fallback_model,
    generation_fallback_reasoning_effort: normalizeReasoning(
      tier.generation_fallback_reasoning_effort,
    ),
  };
}

function isDirty(tier: SubscriptionTier, form: TierFormState | undefined) {
  if (!form) return false;
  return (
    form.monthly_resume_generation_limit !==
      String(tier.monthly_resume_generation_limit) ||
    form.generation_model !== tier.generation_model ||
    form.generation_reasoning_effort !==
      normalizeReasoning(tier.generation_reasoning_effort) ||
    form.generation_fallback_model !== tier.generation_fallback_model ||
    form.generation_fallback_reasoning_effort !==
      normalizeReasoning(tier.generation_fallback_reasoning_effort)
  );
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function normalizeReasoning(value: string): ReasoningEffort {
  return isReasoningEffort(value) ? value : "auto";
}

function reasoningOptionsForModel(modelId: string) {
  return getModelOption(modelId)?.reasoningEfforts ?? ["auto"];
}

type ValidatedTierUpdate = {
  monthly_resume_generation_limit: number;
  generation_model: string;
  generation_reasoning_effort: ReasoningEffort;
  generation_fallback_model: string;
  generation_fallback_reasoning_effort: ReasoningEffort;
};

function validateGenerationLimit(form: TierFormState) {
  const parsedLimit = Number.parseInt(form.monthly_resume_generation_limit, 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 0)
    return { limit: null, error: "Monthly limit must be zero or greater." };
  if (parsedLimit > maxMonthlyResumeGenerationLimit)
    return {
      limit: null,
      error: `Monthly limit cannot exceed ${maxMonthlyResumeGenerationLimit}.`,
    };
  return { limit: parsedLimit, error: null };
}

function validateGenerationModels(form: TierFormState) {
  const primaryModel = form.generation_model.trim();
  const fallbackModel = form.generation_fallback_model.trim();
  if (!primaryModel || !fallbackModel)
    return {
      models: null,
      error: "Both generation model fields are required.",
    };
  if (primaryModel === fallbackModel)
    return {
      models: null,
      error: "Fallback model must be different from the primary model.",
    };
  const primaryOption = getModelOption(primaryModel);
  const fallbackOption = getModelOption(fallbackModel);
  if (!primaryOption || !fallbackOption)
    return {
      models: null,
      error: "Choose one of the supported OpenRouter models.",
    };
  if (
    !primaryOption.reasoningEfforts.includes(form.generation_reasoning_effort)
  )
    return {
      models: null,
      error:
        "Primary reasoning level is not supported by the selected primary model.",
    };
  if (
    !fallbackOption.reasoningEfforts.includes(
      form.generation_fallback_reasoning_effort,
    )
  )
    return {
      models: null,
      error:
        "Fallback reasoning level is not supported by the selected fallback model.",
    };
  return { models: { primaryModel, fallbackModel }, error: null };
}

function validateTierForm(form: TierFormState): {
  value: ValidatedTierUpdate | null;
  error: string | null;
} {
  const limitResult = validateGenerationLimit(form);
  if (limitResult.limit === null)
    return { value: null, error: limitResult.error };
  const modelResult = validateGenerationModels(form);
  if (!modelResult.models) return { value: null, error: modelResult.error };
  return {
    error: null,
    value: {
      monthly_resume_generation_limit: limitResult.limit,
      generation_model: modelResult.models.primaryModel,
      generation_reasoning_effort: form.generation_reasoning_effort,
      generation_fallback_model: modelResult.models.fallbackModel,
      generation_fallback_reasoning_effort:
        form.generation_fallback_reasoning_effort,
    },
  };
}

function ModelReasoningFields({
  tierKey,
  kind,
  model,
  reasoning,
  onModelChange,
  onReasoningChange,
}: {
  tierKey: string;
  kind: "Primary" | "Fallback";
  model: string;
  reasoning: ReasoningEffort;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: ReasoningEffort) => void;
}) {
  const idPrefix = `${tierKey}_${kind.toLowerCase()}`;
  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}_model`}>{kind} model</Label>
        <Select
          id={`${idPrefix}_model`}
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          required
        >
          {openRouterGenerationModels.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}_reasoning`}>{kind} reasoning</Label>
        <Select
          id={`${idPrefix}_reasoning`}
          value={reasoning}
          onChange={(event) =>
            onReasoningChange(normalizeReasoning(event.target.value))
          }
          required
        >
          {reasoningOptionsForModel(model).map((effort) => (
            <option key={effort} value={effort}>
              {reasoningEffortLabels[effort]}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}

export function AdminSubscriptionsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const {
    data: tiers,
    error,
    isFetching,
    refetch,
  } = useSubscriptionTiersQuery();
  const [forms, setForms] = useState<Record<string, TierFormState>>({});
  const [savingTier, setSavingTier] = useState<string | null>(null);

  useEffect(() => {
    if (!tiers) return;
    setForms((current) => {
      const next = { ...current };
      for (const tier of tiers) {
        if (!next[tier.key] || !isDirty(tier, next[tier.key])) {
          next[tier.key] = stateFromTier(tier);
        }
      }
      return next;
    });
  }, [tiers]);

  const orderedTiers = useMemo(
    () =>
      [...(tiers ?? [])].sort((a, b) =>
        a.key === "basic" ? -1 : b.key === "basic" ? 1 : 0,
      ),
    [tiers],
  );
  const defaultGenerationModel = openRouterGenerationModels[0]?.id ?? "";
  const defaultFallbackGenerationModel =
    openRouterGenerationModels[1]?.id ?? defaultGenerationModel;
  const displayedError = error instanceof Error ? error.message : null;

  function updateForm(tierKey: string, updates: Partial<TierFormState>) {
    setForms((current) => ({
      ...current,
      [tierKey]: {
        ...(current[tierKey] ?? {
          monthly_resume_generation_limit: "",
          generation_model: defaultGenerationModel,
          generation_reasoning_effort: "auto",
          generation_fallback_model: defaultFallbackGenerationModel,
          generation_fallback_reasoning_effort: "auto",
        }),
        ...updates,
      },
    }));
  }

  function updateModel(
    tierKey: string,
    field: "generation_model" | "generation_fallback_model",
    modelId: string,
  ) {
    const reasoningField =
      field === "generation_model"
        ? "generation_reasoning_effort"
        : "generation_fallback_reasoning_effort";
    const currentReasoning = forms[tierKey]?.[reasoningField] ?? "auto";
    const allowed = reasoningOptionsForModel(modelId);
    updateForm(tierKey, {
      [field]: modelId,
      [reasoningField]: allowed.includes(currentReasoning)
        ? currentReasoning
        : allowed[0] ?? "auto",
    });
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    tier: SubscriptionTier,
  ) {
    event.preventDefault();
    const form = forms[tier.key];
    if (!form) return;
    const validation = validateTierForm(form);
    if (!validation.value) {
      toast(
        validation.error ?? "Subscription tier settings are invalid.",
        "error",
      );
      return;
    }

    setSavingTier(tier.key);
    try {
      await updateSubscriptionTier(tier.key, validation.value);
      toast(`${tier.name} updated.`);
      await invalidateSubscriptionTierQueries(queryClient);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Subscription tier update failed.",
        "error",
      );
    } finally {
      setSavingTier(null);
    }
  }

  if (!tiers && !displayedError) {
    return (
      <div className="page-enter space-y-5">
        <PageHeader
          title="Subscription Settings"
          subtitle="Generation limits and model access by tier."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <SkeletonCard density="compact" />
          <SkeletonCard density="compact" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Subscription Settings"
        subtitle="Generation limits and model access by tier."
        actions={
          <Button
            variant="secondary"
            onClick={() => void refetch()}
            loading={isFetching}
          >
            <RefreshCcw size={14} />
            Refresh
          </Button>
        }
      />

      {displayedError ? (
        <Card variant="danger" density="compact">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-ember)" }}
          >
            Subscription settings unavailable
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
            {displayedError}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {orderedTiers.map((tier) => {
          const form = forms[tier.key] ?? stateFromTier(tier);
          const dirty = isDirty(tier, form);
          const colors = tierAccent[tier.key];
          const isSaving = savingTier === tier.key;

          return (
            <Card key={tier.key} density="compact" className="overflow-hidden">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg"
                    style={{ background: colors.tint, color: colors.accent }}
                  >
                    {tier.key === "pro" ? (
                      <Sparkles size={19} />
                    ) : (
                      <CreditCard size={19} />
                    )}
                  </span>
                  <div>
                    <p
                      className="font-display text-xl font-semibold"
                      style={{ color: "var(--color-ink)" }}
                    >
                      {tier.name}
                    </p>
                    <p
                      className="text-xs uppercase tracking-[0.16em]"
                      style={{ color: "var(--color-ink-40)" }}
                    >
                      {tier.key}
                    </p>
                  </div>
                </div>
                <span
                  className="rounded-md px-2.5 py-1 text-xs font-semibold"
                  style={{ background: colors.tint, color: colors.accent }}
                >
                  {tier.monthly_resume_generation_limit}/month
                </span>
              </div>

              <form
                className="space-y-4"
                onSubmit={(event) => void handleSubmit(event, tier)}
              >
                <div>
                  <Label htmlFor={`${tier.key}_limit`}>
                    Monthly resume generations
                  </Label>
                  <Input
                    id={`${tier.key}_limit`}
                    type="number"
                    min={0}
                    value={form.monthly_resume_generation_limit}
                    onChange={(event) =>
                      updateForm(tier.key, {
                        monthly_resume_generation_limit: event.target.value,
                      })
                    }
                    required
                  />
                </div>

                <ModelReasoningFields
                  tierKey={tier.key}
                  kind="Primary"
                  model={form.generation_model}
                  reasoning={form.generation_reasoning_effort}
                  onModelChange={(value) =>
                    updateModel(tier.key, "generation_model", value)
                  }
                  onReasoningChange={(value) =>
                    updateForm(tier.key, { generation_reasoning_effort: value })
                  }
                />
                <ModelReasoningFields
                  tierKey={tier.key}
                  kind="Fallback"
                  model={form.generation_fallback_model}
                  reasoning={form.generation_fallback_reasoning_effort}
                  onModelChange={(value) =>
                    updateModel(tier.key, "generation_fallback_model", value)
                  }
                  onReasoningChange={(value) =>
                    updateForm(tier.key, {
                      generation_fallback_reasoning_effort: value,
                    })
                  }
                />

                <div
                  className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <span
                    className="text-xs"
                    style={{ color: "var(--color-ink-40)" }}
                  >
                    Updated {formatDate(tier.updated_at)}
                  </span>
                  <Button
                    type="submit"
                    disabled={!dirty || isSaving}
                    loading={isSaving}
                  >
                    <Save size={14} />
                    Save
                  </Button>
                </div>
              </form>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
