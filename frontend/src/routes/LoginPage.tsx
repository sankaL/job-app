import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthFooterLink, AuthNotice, AuthPageShell } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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

  const localUsersUnavailable = isLocalDevMode && (localUsersError !== null || localUsers?.length === 0);
  const notice = error ? (
    <AuthNotice>{error}</AuthNotice>
  ) : localUsersUnavailable ? (
    <AuthNotice
      action={
        <Button variant="secondary" size="sm" onClick={() => setLocalUsersAttempt((attempt) => attempt + 1)}>
          Retry
        </Button>
      }
    >
      {localUsersError ?? "No local accounts are available. Seed a local user first."}
    </AuthNotice>
  ) : null;

  return (
    <AuthPageShell
      title="Sign in"
      notice={notice}
      footer={
        <>
          Need an invite? <AuthFooterLink to="/signup">Request access</AuthFooterLink>
        </>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        {isLocalDevMode ? (
          <div>
            <Label htmlFor="local-user">Account</Label>
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
                {localUsersError
                  ? "Users unavailable"
                  : localUsers === null
                    ? "Loading local users…"
                    : localUsers.length
                      ? "Select an account"
                      : "No local users available"}
              </option>
              {localUsers?.map((localEmail) => (
                <option key={localEmail} value={localEmail}>
                  {localEmail}
                </option>
              ))}
            </Select>
            <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
              Local dev: choose an existing account. No password required.
            </p>
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
                placeholder="you@example.com"
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
                required
                data-gramm="false"
                data-gramm_editor="false"
              />
            </div>
          </>
        )}
        <Button
          type="submit"
          className="w-full"
          loading={isSubmitting}
          disabled={isSubmitting || (isLocalDevMode && !localUsers?.includes(email))}
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthPageShell>
  );
}
