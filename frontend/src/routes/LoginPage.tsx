import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthBrand, AuthPageShell } from "@/components/auth/AuthIllustration";
import { Button } from "@/components/auth/login-button";
import { Input } from "@/components/auth/login-input";
import { Label } from "@/components/auth/login-label";
import { Select } from "@/components/ui/select";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { z } from "zod";
import { env } from "@/lib/env";
import { useAuth } from "@/lib/auth";

const localUsersResponse = z.object({ emails: z.array(z.string().email()) });

export function LoginPage() {
  const navigate = useNavigate();
  const { login, user, ensureSession } = useAuth();
  const isLocalDevMode = env.VITE_APP_DEV_MODE;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [localUsers, setLocalUsers] = useState<string[] | null>(null);
  const [localUsersError, setLocalUsersError] = useState<string | null>(null);
  const [localUsersAttempt, setLocalUsersAttempt] = useState(0);

  useEffect(() => {
    if (user) {
      navigate("/app", { replace: true });
      return;
    }

    let active = true;
    void ensureSession().finally(() => {
      if (active) setSessionChecked(true);
    });
    return () => {
      active = false;
    };
  }, [user, ensureSession, navigate]);

  useEffect(() => {
    if (!isLocalDevMode || !sessionChecked || user) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    setLocalUsers(null);
    setLocalUsersError(null);
    setEmail("");
    void (async () => {
      try {
        const response = await fetch(`${env.VITE_API_URL}/api/auth/local-users`, {
          signal: controller.signal,
          credentials: "omit",
        });
        if (!response.ok) throw new Error("Local users unavailable.");
        const data = localUsersResponse.parse(await response.json());
        if (active) setLocalUsers(data.emails);
      } catch {
        if (active) setLocalUsersError("Couldn't load local users. Try again.");
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isLocalDevMode, sessionChecked, user, localUsersAttempt]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || (isLocalDevMode && !localUsers?.includes(email))) return;
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
                {isLocalDevMode ? (
                  <div>
                    <Label htmlFor="local-user">Local user</Label>
                    <Theme theme={neutralTheme} mode="light">
                      <Select
                        id="local-user"
                        name="email"
                        aria-label="Local user"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        disabled={isSubmitting || !localUsers?.length}
                        required
                      >
                        <option value="" disabled>
                          {localUsersError ? "Users unavailable" : localUsers === null ? "Loading local users…" : localUsers.length ? "Select a user" : "No local users available"}
                        </option>
                        {localUsers?.map((localEmail) => (
                          <option key={localEmail} value={localEmail}>{localEmail}</option>
                        ))}
                      </Select>
                    </Theme>
                    <p className="mt-1.5 text-xs" style={{ color: "var(--color-spruce)" }}>
                      Choose an existing local account. No password required.
                    </p>
                    {localUsersError || localUsers?.length === 0 ? (
                      <div className="mt-3">
                        <p role="alert" className="text-sm text-ember">
                          {localUsersError ?? "No local accounts are available. Seed a local user first."}
                        </p>
                        <Button type="button" onClick={() => setLocalUsersAttempt((attempt) => attempt + 1)}>
                          Retry
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <>
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
                    placeholder="Your assigned password"
                    required
                    data-gramm="false"
                    data-gramm_editor="false"
                  />
                </div>
                  </>
                )}
                {error ? (
                  <div className="rounded-2xl border border-ember/20 bg-ember/5 px-4 py-3 text-sm text-ember">
                    {error}
                  </div>
                ) : null}
                <Button className="w-full" disabled={isSubmitting || (isLocalDevMode && !localUsers?.includes(email))} type="submit">
                  {isSubmitting ? "Signing in…" : "Enter the workspace"}
                </Button>
              </form>

            </div>
    </AuthPageShell>
  );
}
