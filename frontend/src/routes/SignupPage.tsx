import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

function isAccessRequestPlan(
  value: string,
): value is AccessRequestPayload["interested_plan"] {
  return (ACCESS_REQUEST_PLANS as readonly string[]).includes(value);
}

function formatExpiry(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return "Password must be at least 12 characters long.";
  if (!/[A-Z]/.test(password))
    return "Password must include at least one uppercase letter.";
  if (!/[a-z]/.test(password))
    return "Password must include at least one lowercase letter.";
  if (!/\d/.test(password)) return "Password must include at least one number.";
  if (!/[^A-Za-z0-9]/.test(password))
    return "Password must include at least one special character.";
  return null;
}

type AccessRequestFormProps = {
  name: string;
  email: string;
  plan: AccessRequestPayload["interested_plan"];
  note: string;
  error: string | null;
  succeeded: boolean;
  submitting: boolean;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPlanChange: (value: AccessRequestPayload["interested_plan"]) => void;
  onNoteChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function AccessRequestForm(props: AccessRequestFormProps) {
  return (
    <form className="space-y-5" onSubmit={props.onSubmit}>
      <div>
        <Label htmlFor="request_name">Full name</Label>
        <Input
          id="request_name"
          value={props.name}
          onChange={(event) => props.onNameChange(event.target.value)}
          autoComplete="name"
          required
        />
      </div>
      <div>
        <Label htmlFor="request_email">Email</Label>
        <Input
          id="request_email"
          type="email"
          value={props.email}
          onChange={(event) => props.onEmailChange(event.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </div>
      <div>
        <Label htmlFor="request_plan">Plan</Label>
        <Select
          id="request_plan"
          value={props.plan}
          onChange={(event) => {
            if (isAccessRequestPlan(event.target.value))
              props.onPlanChange(event.target.value);
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
          value={props.note}
          onChange={(event) => props.onNoteChange(event.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Share your job-search timeline or what you want Applix to help with."
        />
      </div>
      {props.error && (
        <div className="rounded-lg border border-[var(--color-ember-10)] bg-[var(--color-ember-05)] px-4 py-3 text-sm text-ember">
          {props.error}
        </div>
      )}
      {props.succeeded && (
        <div className="rounded-lg border border-[var(--color-spruce-10)] bg-[var(--color-spruce-05)] px-4 py-3 text-sm text-spruce">
          Request sent. Applix is still in beta, and the admin team will reach
          out by email if early access is available.
        </div>
      )}
      <Button
        type="submit"
        className="w-full"
        loading={props.submitting}
        disabled={props.submitting}
      >
        {props.submitting ? "Sending request…" : "Send access request"}
      </Button>
    </form>
  );
}

function AccessRequestPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [plan, setPlan] =
    useState<AccessRequestPayload["interested_plan"]>("standard");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === "true" || submittingRef.current) return;
    form.dataset.submitting = "true";
    submittingRef.current = true;
    setError(null);
    setSucceeded(false);
    setSubmitting(true);
    try {
      await submitAccessRequest({
        full_name: name,
        email,
        interested_plan: plan,
        note: note || null,
      });
      setSucceeded(true);
      setName("");
      setEmail("");
      setPlan("standard");
      setNote("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Access request failed.",
      );
    } finally {
      delete form.dataset.submitting;
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  return (
    <AuthPageShell ambient={false} illustrationAccents={false}>
      <AuthBrand subtitle="Early access" linkTo="/" uppercaseSubtitle={false} />
      <div className="mt-8">
        <p
          className="text-xs font-semibold"
          style={{ color: "var(--color-spruce)" }}
        >
          Invite-only beta
        </p>
        <h1
          className="mt-3 max-w-lg font-display text-3xl leading-[1.08] sm:text-4xl lg:text-[2.75rem]"
          style={{ color: "var(--color-ink)" }}
        >
          Request access to Applix
        </h1>
        <p
          className="mt-5 max-w-lg text-base leading-7 sm:text-lg"
          style={{ color: "var(--color-ink-65)" }}
        >
          Tell us where to reach you. If there is room in the beta, an admin
          will follow up by email with an invite link.
        </p>
      </div>
      <div className="mt-8 max-w-md">
        <AccessRequestForm
          name={name}
          email={email}
          plan={plan}
          note={note}
          error={error}
          succeeded={succeeded}
          submitting={submitting}
          onNameChange={setName}
          onEmailChange={setEmail}
          onPlanChange={setPlan}
          onNoteChange={setNote}
          onSubmit={handleSubmit}
        />
        <p className="mt-5 text-sm" style={{ color: "var(--color-ink-50)" }}>
          Already invited? Open your invite link, or{" "}
          <Link to="/login" className="font-semibold text-spruce">
            log in
          </Link>
          .
        </p>
      </div>
    </AuthPageShell>
  );
}

type InviteFormProps = ReturnType<typeof useContactFields> & {
  password: string;
  confirmPassword: string;
  error: string | null;
  submitting: boolean;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function InviteForm(props: InviteFormProps) {
  return (
    <form className="space-y-5" onSubmit={props.onSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="first_name">First name</Label>
          <Input
            id="first_name"
            value={props.firstName}
            onChange={(event) => props.setFirstName(event.target.value)}
            autoComplete="given-name"
            required
          />
        </div>
        <div>
          <Label htmlFor="last_name">Last name</Label>
          <Input
            id="last_name"
            value={props.lastName}
            onChange={(event) => props.setLastName(event.target.value)}
            autoComplete="family-name"
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          value={props.email}
          disabled
          className="cursor-not-allowed opacity-70"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="address">Location</Label>
          <Input
            id="address"
            value={props.address}
            onChange={(event) => props.setAddress(event.target.value)}
            autoComplete="address-level2"
            placeholder="City, Province/State"
            required
          />
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            value={props.phone}
            onChange={(event) => props.setPhone(event.target.value)}
            autoComplete="tel"
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="linkedin_url">LinkedIn (optional)</Label>
        <Input
          id="linkedin_url"
          value={props.linkedinUrl}
          onChange={(event) => props.setLinkedinUrl(event.target.value)}
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
            value={props.password}
            onChange={(event) => props.onPasswordChange(event.target.value)}
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
            value={props.confirmPassword}
            onChange={(event) =>
              props.onConfirmPasswordChange(event.target.value)
            }
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
        </div>
      </div>
      <p className="text-xs" style={{ color: "var(--color-ink-50)" }}>
        Use 12+ characters with uppercase, lowercase, a number, and a symbol.
      </p>
      {props.error && (
        <div className="rounded-2xl border border-ember/20 bg-ember/5 px-4 py-3 text-sm text-ember">
          {props.error}
        </div>
      )}
      <Button
        type="submit"
        className="w-full"
        loading={props.submitting}
        disabled={props.submitting}
      >
        {props.submitting
          ? "Setting up account…"
          : "Create account and sign in"}
      </Button>
    </form>
  );
}

function InviteStatus({
  loading,
  error,
  preview,
  expiryLabel,
  children,
}: {
  loading: boolean;
  error: string | null;
  preview: InvitePreview | null;
  expiryLabel: string;
  children: React.ReactNode;
}) {
  if (loading)
    return (
      <div className="mt-6 text-sm" style={{ color: "var(--color-ink-50)" }}>
        Loading invite details…
      </div>
    );
  if (error)
    return (
      <div className="mt-6 rounded-2xl border border-ember/20 bg-ember/5 px-4 py-3 text-sm text-ember">
        {error}
      </div>
    );
  return (
    <>
      {preview && (
        <div
          className="mt-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium"
          style={{
            background: "var(--color-spruce-05)",
            color: "var(--color-spruce)",
            border: "1px solid var(--color-spruce-10)",
          }}
        >
          <span>Invite active</span>
          <span style={{ color: "var(--color-ink-50)" }}>·</span>
          <span style={{ color: "var(--color-ink-65)" }}>
            Expires {expiryLabel}
          </span>
        </div>
      )}
      {children}
    </>
  );
}

function useInvitePreview(
  token: string,
  onPreview: (preview: InvitePreview) => void,
) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchInvitePreview(token)
      .then((payload) => {
        if (!cancelled) {
          onPreviewRef.current(payload);
          setPreview(payload);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setPreview(null);
          setError(
            cause instanceof Error ? cause.message : "Unable to load invite.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  return {
    preview,
    error,
    loading,
    expiryLabel: useMemo(
      () => (preview ? formatExpiry(preview.expires_at) : ""),
      [preview],
    ),
  };
}

function InviteSignupPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const { login } = useAuth();
  const contact = useContactFields();
  const previewState = useInvitePreview(token, (preview) =>
    contact.setEmail(preview.invited_email),
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!previewState.preview) {
      setError("Invite link is unavailable.");
      return;
    }
    const passwordIssue = validatePassword(password);
    if (passwordIssue) {
      setError(passwordIssue);
      return;
    }
    if (password !== confirmPassword) {
      setError("Password confirmation does not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await acceptInvite({
        token,
        email: contact.email,
        password,
        confirm_password: confirmPassword,
        first_name: contact.firstName,
        last_name: contact.lastName,
        phone: contact.phone,
        address: contact.address,
        linkedin_url: contact.linkedinUrl || null,
      });
      await login(contact.email, password);
      navigate("/app", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Signup failed.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <AuthPageShell>
      <AuthBrand subtitle="AI Job Applications" />
      <div className="mt-8">
        <p
          className="text-xs font-semibold uppercase tracking-[0.22em]"
          style={{ color: "var(--color-spruce)" }}
        >
          Invite-only MVP
        </p>
        <h1
          className="mt-3 max-w-lg font-display text-3xl leading-[1.08] sm:text-4xl lg:text-[2.75rem]"
          style={{ color: "var(--color-ink)" }}
        >
          Finish account setup
        </h1>
        <p
          className="mt-5 max-w-lg text-base leading-7 sm:text-lg"
          style={{ color: "var(--color-ink-65)" }}
        >
          Create your profile and password to enter the invite-only workspace.
        </p>
      </div>
      <InviteStatus
        loading={previewState.loading}
        error={previewState.error}
        preview={previewState.preview}
        expiryLabel={previewState.expiryLabel}
      >
        <div className="mt-8 max-w-md">
          <InviteForm
            {...contact}
            password={password}
            confirmPassword={confirmPassword}
            error={error}
            submitting={submitting}
            onPasswordChange={setPassword}
            onConfirmPasswordChange={setConfirmPassword}
            onSubmit={handleSubmit}
          />
        </div>
      </InviteStatus>
    </AuthPageShell>
  );
}

export function SignupPage() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get("token") || "").trim();
  return token ? <InviteSignupPage token={token} /> : <AccessRequestPage />;
}
