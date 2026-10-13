import { Text } from "@astryxdesign/core/Text";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  Info,
  Minus,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Section } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SkeletonSection } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { updateSubscriptionTier, type SubscriptionTier } from "@/lib/api";
import {
  invalidateSubscriptionTierQueries,
  useSubscriptionTiersQuery,
} from "@/lib/queries";

const MAX_LIMIT = 10000;
const PRESETS = [10, 25, 60, 100];
const TIER_DESCRIPTIONS: Record<string, string> = {
  basic: "Default plan for new users",
  pro: "Upgraded plan",
};

export function AdminSubscriptionsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const {
    data: tiers,
    error,
    isFetching,
    refetch,
  } = useSubscriptionTiersQuery();
  const [forms, setForms] = useState<Record<string, string>>({});
  const lastLimits = useRef<Record<string, string>>({});
  const [savingTier, setSavingTier] = useState<string | null>(null);

  useEffect(() => {
    if (!tiers) return;
    const previousLimits = lastLimits.current;
    lastLimits.current = Object.fromEntries(
      tiers.map((tier) => [
        tier.key,
        String(tier.monthly_resume_generation_limit),
      ]),
    );
    setForms((current) => {
      const next = { ...current };
      for (const tier of tiers) {
        const limit = String(tier.monthly_resume_generation_limit);
        if (
          next[tier.key] === undefined ||
          next[tier.key] === previousLimits[tier.key]
        )
          next[tier.key] = limit;
      }
      return next;
    });
  }, [tiers]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    tier: SubscriptionTier,
  ) {
    event.preventDefault();
    const rawLimit =
      forms[tier.key] ?? String(tier.monthly_resume_generation_limit);
    const limit = Number(rawLimit);
    if (
      !rawLimit.trim() ||
      !Number.isInteger(limit) ||
      limit < 0 ||
      limit > MAX_LIMIT
    ) {
      toast(
        "Monthly requests must be a whole number between 0 and 10000.",
        "error",
      );
      return;
    }
    setSavingTier(tier.key);
    try {
      const updated = await updateSubscriptionTier(tier.key, {
        monthly_resume_generation_limit: limit,
      });
      setForms((current) => ({
        ...current,
        [tier.key]: String(updated.monthly_resume_generation_limit),
      }));
      await invalidateSubscriptionTierQueries(queryClient);
      toast(`${tier.name} updated.`);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Subscription update failed.",
        "error",
      );
    } finally {
      setSavingTier(null);
    }
  }

  const displayedError = error instanceof Error ? error.message : null;
  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="Subscription Settings"
        subtitle="Monthly request allowances. Both plans use the same models."
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
        <Section variant="danger" density="compact">
          <Text as="p" display="block" type="body">
            {displayedError}
          </Text>
        </Section>
      ) : null}
      {!tiers && !displayedError ? (
        <div className="space-y-4">
          <SkeletonSection density="compact" />
          <SkeletonSection density="compact" />
        </div>
      ) : null}
      <div className="space-y-4">
        {[...(tiers ?? [])]
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((tier) => {
            const current = String(tier.monthly_resume_generation_limit);
            const value = forms[tier.key] ?? current;
            const saving = savingTier === tier.key;
            const dirty = value !== current;
            const numeric = Number(value);
            const valid =
              value.trim() !== "" &&
              Number.isInteger(numeric) &&
              numeric >= 0 &&
              numeric <= MAX_LIMIT;
            const setValue = (next: string) =>
              setForms((existing) => ({ ...existing, [tier.key]: next }));
            const step = (delta: number) =>
              setValue(
                String(
                  Math.min(
                    MAX_LIMIT,
                    Math.max(0, (valid ? numeric : tier.monthly_resume_generation_limit) + delta),
                  ),
                ),
              );
            return (
              <form
                key={tier.key}
                className="py-3"
                onSubmit={(event) => void handleSubmit(event, tier)}
              >
                <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-4">
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                      style={{
                        background:
                          tier.key === "pro"
                            ? "var(--color-background-orange)"
                            : "var(--color-background-muted)",
                        color:
                          tier.key === "pro"
                            ? "var(--color-icon-orange)"
                            : "var(--color-icon-primary)",
                      }}
                    >
                      {tier.key === "pro" ? (
                        <Sparkles size={20} />
                      ) : (
                        <CreditCard size={20} />
                      )}
                    </span>
                    <div>
                      <Text as="p" display="block" type="label">
                        {tier.name}
                      </Text>
                      <Text
                        as="p"
                        display="block"
                        type="supporting"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        {TIER_DESCRIPTIONS[tier.key]
                          ? `${TIER_DESCRIPTIONS[tier.key]} · `
                          : ""}
                        Currently{" "}
                        <span
                          className="font-semibold"
                          style={{ color: "var(--color-text-primary)" }}
                          data-testid={`${tier.key}-current-limit`}
                        >
                          {current}
                        </span>{" "}
                        requests/month
                      </Text>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 md:items-end">
                    <Label htmlFor={`${tier.key}_limit`} className="sr-only">
                      Monthly requests
                    </Label>
                    <div className="flex flex-wrap items-center gap-3">
                      <div
                        className="inline-flex items-center rounded-xl border p-1"
                        style={{
                          borderColor: "var(--color-border)",
                          background: "var(--color-background-muted)",
                        }}
                      >
                        <IconButton
                          type="button"
                          aria-label={`Decrease ${tier.name} monthly requests`}
                          title="Decrease"
                          disabled={
                            savingTier !== null || (valid && numeric <= 0)
                          }
                          onClick={() => step(-1)}
                        >
                          <Minus size={16} aria-hidden="true" />
                        </IconButton>
                        <input
                          id={`${tier.key}_limit`}
                          type="number"
                          min={0}
                          max={MAX_LIMIT}
                          step={1}
                          value={value}
                          disabled={savingTier !== null}
                          required
                          className="h-8 w-16 rounded-lg border-0 bg-transparent text-center text-base font-semibold outline-none focus-visible:ring-2 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          style={{ color: "var(--color-text-primary)" }}
                          onChange={(event) => setValue(event.target.value)}
                        />
                        <IconButton
                          type="button"
                          aria-label={`Increase ${tier.name} monthly requests`}
                          title="Increase"
                          disabled={
                            savingTier !== null ||
                            (valid && numeric >= MAX_LIMIT)
                          }
                          onClick={() => step(1)}
                        >
                          <Plus size={16} aria-hidden="true" />
                        </IconButton>
                      </div>
                      <div
                        role="group"
                        aria-label={`${tier.name} presets`}
                        className="inline-flex items-center gap-1 rounded-xl border p-1"
                        style={{
                          borderColor: "var(--color-border)",
                          background: "var(--color-background-muted)",
                        }}
                      >
                        {PRESETS.map((preset) => {
                          const selected = value === String(preset);
                          return (
                            <button
                              key={preset}
                              type="button"
                              disabled={savingTier !== null}
                              aria-pressed={selected}
                              className="h-8 min-w-10 rounded-lg px-2.5 text-sm transition-all disabled:opacity-50"
                              style={
                                selected
                                  ? {
                                      background:
                                        "var(--color-background-surface)",
                                      color: "var(--color-text-primary)",
                                      boxShadow: "0 1px 3px var(--color-shadow)",
                                      fontWeight: 600,
                                    }
                                  : { color: "var(--color-text-secondary)" }
                              }
                              onClick={() => setValue(String(preset))}
                            >
                              {preset}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {dirty ? (
                  <div
                    className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <Text
                      as="p"
                      display="block"
                      type="supporting"
                      style={{
                        color: valid
                          ? "var(--color-text-secondary)"
                          : "var(--color-error)",
                      }}
                    >
                      {valid
                        ? `Changes ${current} → ${numeric} requests/month`
                        : `Enter a whole number from 0 to ${MAX_LIMIT}.`}
                    </Text>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={savingTier !== null}
                        onClick={() => setValue(current)}
                      >
                        <RotateCcw size={14} />
                        Reset
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        className="app-button-orange"
                        disabled={!valid || savingTier !== null}
                        loading={saving}
                      >
                        <Save size={14} />
                        Save
                      </Button>
                    </div>
                  </div>
                ) : null}
              </form>
            );
          })}
      </div>
      <p
        className="flex items-start gap-1.5 text-xs leading-5"
        style={{ color: "var(--color-text-secondary)" }}
      >
        <Info size={13} className="mt-1 shrink-0" aria-hidden="true" />
        Full generation, full regeneration, section regeneration and keyword
        optimization each use one request. Internal retries and validation do
        not use additional requests. Failed operations return the request.
      </p>
    </div>
  );
}
