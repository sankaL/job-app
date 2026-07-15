import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthBrand, AuthPageShell } from "@/components/auth/AuthIllustration";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { env } from "@/lib/env";
import { useAuth } from "@/lib/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const { login, user, ensureSession } = useAuth();
  const isLocalDevMode = env.VITE_APP_DEV_MODE;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      navigate("/app", { replace: true });
      return;
    }

    void ensureSession();
  }, [user, ensureSession, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, isLocalDevMode ? "" : password);
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPageShell illustrationMobileHeight="compact">
      <AuthBrand subtitle="AI Job Applications" />

            <div className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: "var(--color-spruce)" }}>
                Invite-only MVP
              </p>
              <h1
                className="mt-3 max-w-lg font-display text-2xl leading-[1.08] sm:text-3xl lg:text-[2.75rem]"
                style={{ color: "var(--color-ink)" }}
              >
                AI-Powered Resume Tailoring
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 sm:text-lg" style={{ color: "var(--color-ink-65)" }}>
                Sign in to manage your job applications, generate tailored resumes, and track your progress.
              </p>
              {isLocalDevMode && (
                <span
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    background: "rgba(24, 74, 69, 0.10)",
                    color: "var(--color-spruce)",
                    border: "1px solid rgba(24, 74, 69, 0.18)",
                  }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: "var(--color-spruce)" }}
                  />
                  Local dev
                </span>
              )}
            </div>

            <div className="mt-8 max-w-md">
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
                    data-gramm="false"
                    data-gramm_editor="false"
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
                    placeholder={isLocalDevMode ? "Not required in dev mode" : "Your assigned password"}
                    required={!isLocalDevMode}
                    disabled={isLocalDevMode}
                    data-gramm="false"
                    data-gramm_editor="false"
                  />
                  {isLocalDevMode && (
                    <p className="mt-1.5 text-xs" style={{ color: "var(--color-spruce)" }}>
                      Auth disabled — enter any email to sign in.
                    </p>
                  )}
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

            </div>
    </AuthPageShell>
  );
}
