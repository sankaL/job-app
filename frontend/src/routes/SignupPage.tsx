import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthBrand, AuthPageShell } from "@/components/auth/AuthIllustration";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  acceptInvite,
  fetchInvitePreview,
  submitAccessRequest,
  type AccessRequestPayload,
  type InvitePreview,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useContactFields } from "@/lib/use-contact-fields";

const PASSWORD_MIN_LENGTH = 12;
const ACCESS_REQUEST_PLANS = ["standard", "pro", "not_sure"] as const;

function isAccessRequestPlan(value: string): value is AccessRequestPayload["interested_plan"] {
  return (ACCESS_REQUEST_PLANS as readonly string[]).includes(value);
}

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
  const { login } = useAuth();
  const [searchParams] = useSearchParams();
  const token = (searchParams.get("token") || "").trim();

  const [requestName, setRequestName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestPlan, setRequestPlan] = useState<AccessRequestPayload["interested_plan"]>("standard");
  const [requestNote, setRequestNote] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSucceeded, setRequestSucceeded] = useState(false);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const isSubmittingRequestRef = useRef(false);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);

  const {
    email, setEmail, firstName, setFirstName, lastName, setLastName,
    address, setAddress, phone, setPhone, linkedinUrl, setLinkedinUrl,
  } = useContactFields();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreview(null);
      setPreviewError(null);
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

      await login(email, password);
      navigate("/app", { replace: true });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Signup failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAccessRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === "true") return;
    if (isSubmittingRequestRef.current) return;
    form.dataset.submitting = "true";
    isSubmittingRequestRef.current = true;
    setRequestError(null);
    setRequestSucceeded(false);
    setIsSubmittingRequest(true);

    try {
      await submitAccessRequest({
        full_name: requestName,
        email: requestEmail,
        interested_plan: requestPlan,
        note: requestNote || null,
      });
      setRequestSucceeded(true);
      setRequestName("");
      setRequestEmail("");
      setRequestPlan("standard");
      setRequestNote("");
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Access request failed.");
    } finally {
      delete form.dataset.submitting;
      isSubmittingRequestRef.current = false;
      setIsSubmittingRequest(false);
    }
  }

  if (!token) {
    return (
      <AuthPageShell ambient={false} illustrationAccents={false}>
        <AuthBrand subtitle="Early access" linkTo="/" uppercaseSubtitle={false} />

              <div className="mt-8">
                <p className="text-xs font-semibold" style={{ color: "var(--color-spruce)" }}>
                  Invite-only beta
                </p>
                <h1
                  className="mt-3 max-w-lg font-display text-3xl leading-[1.08] sm:text-4xl lg:text-[2.75rem]"
                  style={{ color: "var(--color-ink)" }}
                >
                  Request access to Applix
                </h1>
                <p className="mt-5 max-w-lg text-base leading-7 sm:text-lg" style={{ color: "var(--color-ink-65)" }}>
                  Tell us where to reach you. If there is room in the beta, an admin will follow up by email with an invite link.
                </p>
              </div>

              <div className="mt-8 max-w-md">
                <form className="space-y-5" onSubmit={handleAccessRequestSubmit}>
                  <div>
                    <Label htmlFor="request_name">Full name</Label>
                    <Input
                      id="request_name"
                      value={requestName}
                      onChange={(event) => setRequestName(event.target.value)}
                      autoComplete="name"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="request_email">Email</Label>
                    <Input
                      id="request_email"
                      type="email"
                      value={requestEmail}
                      onChange={(event) => setRequestEmail(event.target.value)}
                      autoComplete="email"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="request_plan">Plan</Label>
                    <Select
                      id="request_plan"
                      value={requestPlan}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (isAccessRequestPlan(value)) {
                          setRequestPlan(value);
                        }
                      }}
                    >
                      <option value="standard">Standard: 50 generations/month</option>
                      <option value="pro">Pro: 200 generations/month</option>
                      <option value="not_sure">Not sure yet</option>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="request_note">Note (optional)</Label>
                    <Textarea
                      id="request_note"
                      value={requestNote}
                      onChange={(event) => setRequestNote(event.target.value)}
                      rows={4}
                      maxLength={1000}
                      placeholder="Share your job-search timeline or what you want Applix to help with."
                    />
                  </div>

                  {requestError ? (
                    <div className="rounded-lg border border-[var(--color-ember-10)] bg-[var(--color-ember-05)] px-4 py-3 text-sm text-ember">
                      {requestError}
                    </div>
                  ) : null}
                  {requestSucceeded ? (
                    <div className="rounded-lg border border-[var(--color-spruce-10)] bg-[var(--color-spruce-05)] px-4 py-3 text-sm text-spruce">
                      Request sent. Applix is still in beta, and the admin team will reach out by email if early access is available.
                    </div>
                  ) : null}

                  <Button type="submit" className="w-full" loading={isSubmittingRequest} disabled={isSubmittingRequest}>
                    {isSubmittingRequest ? "Sending request…" : "Send access request"}
                  </Button>
                </form>
                <p className="mt-5 text-sm" style={{ color: "var(--color-ink-50)" }}>
                  Already invited? Open your invite link, or <Link to="/login" className="font-semibold text-spruce">log in</Link>.
                </p>
              </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <AuthBrand subtitle="AI Job Applications" />

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
    </AuthPageShell>
  );
}
