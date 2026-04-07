import { Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchSessionBootstrap, type SessionBootstrapResponse } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function AppShell() {
  const navigate = useNavigate();
  const [bootstrap, setBootstrap] = useState<SessionBootstrapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessionBootstrap()
      .then((response) => {
        setBootstrap(response);
        setError(null);
      })
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
    <div className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-4 rounded-[32px] bg-ink p-8 text-white shadow-panel md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-white/55">AI Resume Builder</p>
            <h1 className="mt-3 font-display text-4xl">Application intake workspace</h1>
            <p className="mt-4 max-w-3xl text-lg text-white/72">
              Capture job postings, recover failed extraction, and resolve duplicates before
              generation starts.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <div className="text-sm text-white/70">{bootstrap?.user.email ?? "Loading session…"}</div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                className="border-white/20 bg-transparent text-white"
                onClick={() => navigate("/app/resumes")}
              >
                Resumes
              </Button>
              <Button
                variant="secondary"
                className="border-white/20 bg-transparent text-white"
                onClick={() => navigate("/app/profile")}
              >
                Profile
              </Button>
              <Button
                variant="secondary"
                className="border-white/20 bg-transparent text-white"
                onClick={() => navigate("/app/extension")}
              >
                Chrome Extension
              </Button>
              <Button
                variant="secondary"
                className="border-white/20 bg-transparent text-white"
                onClick={handleSignOut}
              >
                Sign out
              </Button>
            </div>
          </div>
        </div>

        {error ? (
          <Card className="border-ember/20 bg-ember/5 text-ember">
            <p className="font-semibold">Session bootstrap failed</p>
            <p className="mt-2 text-base">{error}</p>
          </Card>
        ) : null}

        <Outlet />
      </div>
    </div>
  );
}
