import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchSessionBootstrap, type SessionBootstrapResponse } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { visibleStatuses, workflowContract } from "@/lib/workflow-contract";

export function AppShell() {
  const [bootstrap, setBootstrap] = useState<SessionBootstrapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessionBootstrap()
      .then(setBootstrap)
      .catch((bootstrapError: Error) => {
        setError(bootstrapError.message);
      });
  }, []);

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  return (
    <div className="min-h-screen px-4 py-10 md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-4 rounded-[32px] bg-ink p-8 text-white shadow-panel md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-white/55">Protected shell</p>
            <h1 className="mt-3 font-display text-4xl">Authenticated workspace foundation</h1>
            <p className="mt-4 max-w-3xl text-lg text-white/72">
              This phase proves the invite-only route boundary, backend bootstrap contract, shared
              status vocabulary, and local-stack wiring before feature work starts.
            </p>
          </div>
          <Button variant="secondary" className="border-white/20 bg-transparent text-white" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>

        {error ? (
          <Card className="border-ember/20 bg-ember/5 text-ember">
            <p className="font-semibold">Bootstrap failed</p>
            <p className="mt-2 text-base">{error}</p>
          </Card>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <p className="text-sm uppercase tracking-[0.18em] text-ink/45">Authenticated user</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm text-ink/45">User ID</p>
                <p className="mt-1 break-all text-lg font-semibold text-ink">
                  {bootstrap?.user.id ?? "Loading…"}
                </p>
              </div>
              <div>
                <p className="text-sm text-ink/45">Email</p>
                <p className="mt-1 text-lg font-semibold text-ink">{bootstrap?.user.email ?? "Loading…"}</p>
              </div>
              <div>
                <p className="text-sm text-ink/45">Profile row</p>
                <p className="mt-1 text-lg font-semibold text-ink">
                  {bootstrap?.profile ? "Resolved" : "Awaiting bootstrap"}
                </p>
              </div>
              <div>
                <p className="text-sm text-ink/45">Workflow contract</p>
                <p className="mt-1 text-lg font-semibold text-ink">{bootstrap?.workflow_contract_version ?? "…"}</p>
              </div>
            </div>
          </Card>

          <Card className="bg-spruce text-white">
            <p className="text-sm uppercase tracking-[0.18em] text-white/55">Visible statuses</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {visibleStatuses.map((status) => (
                <span
                  key={status.id}
                  className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold"
                >
                  {status.label}
                </span>
              ))}
            </div>
            <p className="mt-6 text-sm text-white/70">
              Internal states loaded from shared contract: {workflowContract.internal_states.length}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
