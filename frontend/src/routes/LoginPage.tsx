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
    <div className="animate-fadeInUp relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      {/* Animated gradient blobs */}
      <div
        className="absolute left-[-6rem] top-10 h-64 w-64 rounded-full blur-3xl"
        style={{
          background: "linear-gradient(135deg, rgba(159, 58, 22, 0.12), rgba(180, 83, 9, 0.08))",
          animation: "floatBlob1 8s ease-in-out infinite",
        }}
      />
      <div
        className="absolute bottom-0 right-[-3rem] h-80 w-80 rounded-full blur-3xl"
        style={{
          background: "linear-gradient(225deg, rgba(24, 74, 69, 0.12), rgba(31, 95, 89, 0.06))",
          animation: "floatBlob2 10s ease-in-out infinite",
        }}
      />

      <Card className="relative w-full max-w-5xl overflow-hidden p-0">
        <div className="grid md:grid-cols-[1.15fr_0.85fr]">
          {/* Dark panel */}
          <div
            className="relative overflow-hidden px-8 py-10 text-white md:px-12 md:py-14"
            style={{
              background: "linear-gradient(160deg, #0e2f2c 0%, #101828 60%, #1a1a2e 100%)",
            }}
          >
            {/* Subtle animated gradient overlay */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(ellipse at 30% 20%, rgba(24, 74, 69, 0.3) 0%, transparent 60%)",
                animation: "floatBlob1 12s ease-in-out infinite",
                pointerEvents: "none",
              }}
            />
            <div style={{ position: "relative" }}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
                Invite-only MVP
              </p>
              <h1 className="font-display text-4xl leading-tight md:text-5xl">
                AI-Powered Resume Tailoring
              </h1>
              <p className="mt-6 max-w-xl text-lg text-white/75">
                Sign in to manage your job applications, generate tailored resumes, and track your progress.
              </p>
              {env.VITE_APP_DEV_MODE && (
                <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5">
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/50">
                    Current environment
                  </p>
                  <p className="mt-2 text-lg text-white/85">
                    Local Dockerized dev mode
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Form panel */}
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

      {/* Floating blob animation keyframes */}
      <style>{`
        @keyframes floatBlob1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(10px, -15px) scale(1.05); }
          66% { transform: translate(-8px, 10px) scale(0.97); }
        }
        @keyframes floatBlob2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-12px, 12px) scale(1.03); }
          66% { transform: translate(8px, -8px) scale(0.98); }
        }
      `}</style>
    </div>
  );
}
