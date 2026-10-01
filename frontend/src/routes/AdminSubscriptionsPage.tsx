import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, RefreshCcw, Save, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { updateSubscriptionTier, type SubscriptionTier } from "@/lib/api";
import { invalidateSubscriptionTierQueries, useSubscriptionTiersQuery } from "@/lib/queries";

export function AdminSubscriptionsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: tiers, error, isFetching, refetch } = useSubscriptionTiersQuery();
  const [forms, setForms] = useState<Record<string, string>>({});
  const lastLimits = useRef<Record<string, string>>({});
  const [savingTier, setSavingTier] = useState<string | null>(null);

  useEffect(() => {
    if (!tiers) return;
    const previousLimits = lastLimits.current;
    lastLimits.current = Object.fromEntries(tiers.map((tier) => [tier.key, String(tier.monthly_resume_generation_limit)]));
    setForms((current) => {
      const next = { ...current };
      for (const tier of tiers) {
        const limit = String(tier.monthly_resume_generation_limit);
        if (next[tier.key] === undefined || next[tier.key] === previousLimits[tier.key]) next[tier.key] = limit;
      }
      return next;
    });
  }, [tiers]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>, tier: SubscriptionTier) {
    event.preventDefault();
    const rawLimit = forms[tier.key] ?? String(tier.monthly_resume_generation_limit);
    const limit = Number(rawLimit);
    if (!rawLimit.trim() || !Number.isInteger(limit) || limit < 0 || limit > 10000) {
      toast("Monthly requests must be a whole number between 0 and 10000.", "error");
      return;
    }
    setSavingTier(tier.key);
    try {
      const updated = await updateSubscriptionTier(tier.key, { monthly_resume_generation_limit: limit });
      setForms((current) => ({ ...current, [tier.key]: String(updated.monthly_resume_generation_limit) }));
      await invalidateSubscriptionTierQueries(queryClient);
      toast(`${tier.name} updated.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Subscription update failed.", "error");
    } finally {
      setSavingTier(null);
    }
  }

  const displayedError = error instanceof Error ? error.message : null;
  return (
    <div className="page-enter space-y-5">
      <PageHeader title="Subscription Settings" subtitle="Monthly request allowances. Both plans use the same models."
        actions={<Button variant="secondary" onClick={() => void refetch()} loading={isFetching}><RefreshCcw size={14} />Refresh</Button>} />
      <p className="text-sm" style={{ color: "var(--color-ink-65)" }}>
        Full generation, full regeneration, section regeneration and keyword optimization each use one request.
        Internal retries and validation do not use additional requests. Failed operations return the request.
      </p>
      {displayedError ? <Card variant="danger" density="compact"><p>{displayedError}</p></Card> : null}
      {!tiers && !displayedError ? <div className="grid gap-4 xl:grid-cols-2"><SkeletonCard density="compact" /><SkeletonCard density="compact" /></div> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {[...(tiers ?? [])].sort((a, b) => a.key.localeCompare(b.key)).map((tier) => {
          const value = forms[tier.key] ?? String(tier.monthly_resume_generation_limit);
          const saving = savingTier === tier.key;
          return <Card key={tier.key} density="compact">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">{tier.key === "pro" ? <Sparkles size={19} /> : <CreditCard size={19} />}<p className="font-display text-xl font-semibold">{tier.name}</p></div>
              <span className="text-sm">{tier.monthly_resume_generation_limit} requests/month</span>
            </div>
            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event, tier)}>
              <div><Label htmlFor={`${tier.key}_limit`}>Monthly requests</Label>
                <Input id={`${tier.key}_limit`} type="number" min={0} max={10000} step={1} value={value}
                  disabled={savingTier !== null} required onChange={(event) => setForms((current) => ({ ...current, [tier.key]: event.target.value }))} />
              </div>
              <Button type="submit" disabled={value === String(tier.monthly_resume_generation_limit) || savingTier !== null} loading={saving}><Save size={14} />Save</Button>
            </form>
          </Card>;
        })}
      </div>
    </div>
  );
}
