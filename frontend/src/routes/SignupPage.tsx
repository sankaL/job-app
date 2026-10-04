import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthFooterLink, AuthNotice, AuthPageShell } from "@/components/auth/AuthLayout";
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
    <AuthPageShell
      title="Request access"
      description="Applix is invite-only. Tell us where to reach you and an admin will follow up by email."
      notice={
        error ? (
          <AuthNotice>{error}</AuthNotice>
        ) : succeeded ? (
          <AuthNotice tone="success">
            Request sent. Applix is still in beta, and the admin team will reach
            out by email if early access is available.
          </AuthNotice>
        ) : null
      }
      footer={
        <>
          Already invited? Open your invite link, or{" "}
          <AuthFooterLink to="/login">sign in</AuthFooterLink>.
        </>
      }
    >
      <AccessRequestForm
        name={name}
        email={email}
        plan={plan}
        note={note}
        submitting={submitting}
        onNameChange={setName}
        onEmailChange={setEmail}
        onPlanChange={setPlan}
        onNoteChange={setNote}
        onSubmit={handleSubmit}
      />
    </AuthPageShell>
  );
}

type InviteFormProps = ReturnType<typeof useContactFields> & {
  password: string;
  confirmPassword: string;
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
      <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
        Use 12+ characters with uppercase, lowercase, a number, and a symbol.
      </p>
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
  const pageError = previewState.error ?? error;
  return (
    <AuthPageShell
      title="Set up your account"
      width="wide"
      description={
        previewState.loading ? (
          "Loading invite details…"
        ) : previewState.preview ? (
          <>
            Invite active · Expires {previewState.expiryLabel}. Create your
            profile and password to enter the workspace.
          </>
        ) : null
      }
      notice={pageError ? <AuthNotice>{pageError}</AuthNotice> : null}
      footer={
        <>
          Already set up? <AuthFooterLink to="/login">Sign in</AuthFooterLink>
        </>
      }
    >
      {previewState.preview ? (
        <InviteForm
          {...contact}
          password={password}
          confirmPassword={confirmPassword}
          submitting={submitting}
          onPasswordChange={setPassword}
          onConfirmPasswordChange={setConfirmPassword}
          onSubmit={handleSubmit}
        />
      ) : null}
    </AuthPageShell>
  );
}

export function SignupPage() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get("token") || "").trim();
  return token ? <InviteSignupPage token={token} /> : <AccessRequestPage />;
}
