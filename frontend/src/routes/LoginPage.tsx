import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { env } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    navigate("/app", { replace: true });
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div className="absolute left-[-6rem] top-10 h-64 w-64 rounded-full bg-ember/10 blur-3xl" />
      <div className="absolute bottom-0 right-[-3rem] h-80 w-80 rounded-full bg-spruce/10 blur-3xl" />
      <Card className="relative w-full max-w-5xl overflow-hidden p-0">
        <div className="grid md:grid-cols-[1.15fr_0.85fr]">
          <div className="bg-ink px-8 py-10 text-white md:px-12 md:py-14">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
              Invite-only MVP
            </p>
            <h1 className="font-display text-4xl leading-tight md:text-5xl">
              Tailored resumes without breaking the source of truth.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-white/75">
              Phase 0 establishes the protected shell only: authenticated access, local dev-mode wiring,
              and the shared workflow vocabulary the rest of the product builds on.
            </p>
            <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/50">
                Current environment
              </p>
              <p className="mt-2 text-lg text-white/85">
                {env.VITE_APP_DEV_MODE ? "Local Dockerized dev mode" : "Hosted configuration"}
              </p>
            </div>
          </div>
          <div className="px-8 py-10 md:px-10 md:py-14">
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="invite-only@example.com"
                  required
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Your assigned password"
                  required
                />
              </div>
              {error ? (
                <div className="rounded-2xl border border-ember/20 bg-ember/5 px-4 py-3 text-sm text-ember">
                  {error}
                </div>
              ) : null}
              <Button className="w-full" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Signing in…" : "Enter the workspace"}
              </Button>
            </form>
            <div className="mt-8 rounded-2xl border border-black/5 bg-canvas px-4 py-4 text-sm text-ink/65">
              Public signup is intentionally unavailable in MVP. Access is provisioned directly through
              Supabase Auth.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
