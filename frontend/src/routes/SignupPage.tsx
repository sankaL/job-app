import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import businessmanIllustration from "@/assets/business-man-illustration.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInvite, fetchInvitePreview, type InvitePreview } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const PASSWORD_MIN_LENGTH = 12;

function formatExpiry(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return "Password must be at least 12 characters long.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter.";
  }
  if (!/\d/.test(password)) {
    return "Password must include at least one number.";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must include at least one special character.";
  }
  return null;
}

export function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = (searchParams.get("token") || "").trim();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreviewError("Invite token is missing.");
      setIsLoadingPreview(false);
      return;
    }

    let cancelled = false;
    setIsLoadingPreview(true);
    fetchInvitePreview(token)
      .then((payload) => {
        if (cancelled) return;
        setPreview(payload);
        setEmail(payload.invited_email);
        setPreviewError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(error instanceof Error ? error.message : "Unable to load invite.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPreview(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const inviteExpiryLabel = useMemo(
    () => (preview ? formatExpiry(preview.expires_at) : ""),
    [preview],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || !token) {
      setSubmitError("Invite link is unavailable.");
      return;
    }

    const passwordIssue = validatePassword(password);
    if (passwordIssue) {
      setSubmitError(passwordIssue);
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError("Password confirmation does not match.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await acceptInvite({
        token,
        email,
        password,
        confirm_password: confirmPassword,
        first_name: firstName,
        last_name: lastName,
        phone,
        address,
        linkedin_url: linkedinUrl || null,
      });

      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        throw new Error(error.message);
      }
      navigate("/app", { replace: true });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Signup failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="animate-fadeInUp relative min-h-screen overflow-hidden"
      style={{
        background: `
          radial-gradient(circle at top left, rgba(159, 58, 22, 0.12), transparent 28%),
          radial-gradient(circle at 85% 20%, rgba(24, 74, 69, 0.16), transparent 30%),
          linear-gradient(135deg, rgba(245, 243, 238, 0.98) 0%, rgba(230, 220, 205, 0.94) 100%)
        `,
      }}
    >
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
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(16, 24, 40, 0.12), transparent)" }}
      />

      <main className="relative grid min-h-screen lg:grid-cols-[minmax(0,1.08fr)_minmax(480px,0.92fr)]">
        <section className="flex min-h-screen items-center px-6 py-8 sm:px-10 sm:py-10 lg:px-16 lg:py-6 xl:px-20">
          <div className="mx-auto w-full max-w-xl">
            <div className="inline-flex items-center gap-3 rounded-full border border-black/5 bg-white/60 px-3 py-2 shadow-sm backdrop-blur-sm">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden">
                <img src="/applix-logo.svg" alt="Applix logo" className="h-10 w-10 object-contain" />
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                  Applix
                </p>
                <p className="text-xs uppercase tracking-[0.18em]" style={{ color: "var(--color-ink-50)" }}>
                  AI Job Applications
                </p>
              </div>
            </div>

            <div className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: "var(--color-spruce)" }}>
                Invite-only MVP
              </p>
              <h1
                className="mt-3 max-w-lg font-display text-3xl leading-[1.08] sm:text-4xl lg:text-[2.75rem]"
                style={{ color: "var(--color-ink)" }}
              >
                Finish account setup
              </h1>
              <p className="mt-5 max-w-lg text-base leading-7 sm:text-lg" style={{ color: "var(--color-ink-65)" }}>
                Create your profile and password to enter the invite-only workspace.
              </p>
            </div>

            {isLoadingPreview ? (
              <div className="mt-6 text-sm" style={{ color: "var(--color-ink-50)" }}>
                Loading invite details…
              </div>
            ) : previewError ? (
              <div className="mt-6 rounded-2xl border border-ember/20 bg-ember/5 px-4 py-3 text-sm text-ember">
                {previewError}
              </div>
            ) : (
              <>
                {preview && (
                  <div className="mt-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium" 
                       style={{ background: "var(--color-spruce-05)", color: "var(--color-spruce)", border: "1px solid var(--color-spruce-10)" }}>
                    <span>Invite active</span>
                    <span style={{ color: "var(--color-ink-50)" }}>·</span>
                    <span style={{ color: "var(--color-ink-65)" }}>Expires {inviteExpiryLabel}</span>
                  </div>
                )}

                <div className="mt-8 max-w-md">
                  <form className="space-y-5" onSubmit={handleSubmit}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="first_name">First name</Label>
                        <Input
                          id="first_name"
                          value={firstName}
                          onChange={(event) => setFirstName(event.target.value)}
                          autoComplete="given-name"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="last_name">Last name</Label>
                        <Input
                          id="last_name"
                          value={lastName}
                          onChange={(event) => setLastName(event.target.value)}
                          autoComplete="family-name"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" value={email} disabled className="cursor-not-allowed opacity-70" />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="address">Location</Label>
                        <Input
                          id="address"
                          value={address}
                          onChange={(event) => setAddress(event.target.value)}
                          autoComplete="address-level2"
                          placeholder="City, Province/State"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                          id="phone"
                          value={phone}
                          onChange={(event) => setPhone(event.target.value)}
                          autoComplete="tel"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="linkedin_url">LinkedIn (optional)</Label>
                      <Input
                        id="linkedin_url"
                        value={linkedinUrl}
                        onChange={(event) => setLinkedinUrl(event.target.value)}
                        autoComplete="url"
                        placeholder="https://linkedin.com/in/your-handle"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="password">Password</Label>
                        <Input
                          id="password"
                          type="password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          autoComplete="new-password"
                          minLength={PASSWORD_MIN_LENGTH}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="confirm_password">Confirm password</Label>
                        <Input
                          id="confirm_password"
                          type="password"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          autoComplete="new-password"
                          minLength={PASSWORD_MIN_LENGTH}
                          required
                        />
                      </div>
                    </div>
                    <p className="text-xs" style={{ color: "var(--color-ink-50)" }}>
                      Use 12+ characters with uppercase, lowercase, a number, and a symbol.
                    </p>

                    {submitError ? (
                      <div className="rounded-2xl border border-ember/20 bg-ember/5 px-4 py-3 text-sm text-ember">
                        {submitError}
                      </div>
                    ) : null}

                    <Button type="submit" className="w-full" loading={isSubmitting} disabled={isSubmitting}>
                      {isSubmitting ? "Setting up account…" : "Create account and sign in"}
                    </Button>
                  </form>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="flex items-end justify-center px-6 pb-6 pt-0 sm:px-10 lg:min-h-screen lg:justify-end lg:px-0 lg:py-0">
          <div className="relative flex h-[360px] w-full max-w-[860px] items-end justify-center overflow-visible sm:h-[430px] lg:h-screen lg:max-w-[980px]">
            <div
              className="absolute inset-x-2 bottom-0 top-8 rounded-[40px] sm:inset-x-6 lg:bottom-0 lg:left-[18%] lg:right-0 lg:top-0 lg:rounded-[28px_0_0_28px]"
              style={{
                background: "linear-gradient(180deg, rgba(128, 177, 210, 0.48) 0%, rgba(190, 216, 233, 0.62) 100%)",
                border: "1px solid rgba(255, 255, 255, 0.6)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), 0 30px 60px rgba(16, 24, 40, 0.08)",
              }}
            />
            <div
              className="absolute right-10 top-12 hidden h-32 w-32 rounded-full blur-3xl lg:block"
              style={{ background: "rgba(24, 74, 69, 0.14)" }}
            />
            <div
              className="absolute bottom-16 left-10 hidden h-24 w-24 rounded-full blur-3xl lg:block"
              style={{ background: "rgba(159, 58, 22, 0.14)" }}
            />
            <div className="relative z-10 max-h-[95%] w-full lg:absolute lg:bottom-0 lg:left-[-10%] lg:h-[100%] lg:w-[100%]">
              <img
                src={businessmanIllustration}
                alt="Businessman seated with a laptop, representing the Applix workspace"
                className="h-full w-full object-contain drop-shadow-[0_28px_38px_rgba(16,24,40,0.18)]"
              />
            </div>
            <div
              className="absolute bottom-6 left-[52%] h-10 w-[58%] -translate-x-1/2 rounded-full blur-2xl lg:bottom-2 lg:left-[48%] lg:w-[54%]"
              style={{ background: "rgba(16, 24, 40, 0.18)" }}
            />
          </div>
        </section>
      </main>

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
