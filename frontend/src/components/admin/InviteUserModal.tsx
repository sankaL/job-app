import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Send, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InviteUserModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { email: string; first_name: string | null; last_name: string | null }) => Promise<void>;
};

const DIALOG_WIDTH = "min(480px, calc(100vw - 32px))";

export function InviteUserModal({ open, onClose, onSubmit }: InviteUserModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resetState() {
    setEmail("");
    setFirstName("");
    setLastName("");
    setError(null);
    setIsSubmitting(false);
  }

  function handleClose() {
    if (isSubmitting) return;
    resetState();
    onClose();
  }

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusHandle = window.requestAnimationFrame(() => {
      emailInputRef.current?.focus();
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(focusHandle);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, isSubmitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Email is required.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({
        email: trimmedEmail,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
      });
      resetState();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to send invite.");
      setIsSubmitting(false);
    }
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        aria-hidden="true"
        onClick={handleClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(16, 24, 40, 0.48)",
          backdropFilter: "blur(6px)",
          animation: "fadeIn 220ms var(--ease-out) both",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="animate-scaleIn"
        style={{
          position: "relative",
          zIndex: 1,
          width: DIALOG_WIDTH,
          borderRadius: "var(--radius-xl)",
          border: "1px solid var(--color-border)",
          background: "var(--color-white)",
          boxShadow: "var(--shadow-panel)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 px-6 pb-4 pt-6"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ background: "var(--color-spruce)", color: "white" }}
              >
                <UserPlus size={14} aria-hidden="true" />
              </div>
              <h2
                id={titleId}
                className="text-base font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                Send Invite
              </h2>
            </div>
            <p
              id={descriptionId}
              className="text-sm leading-relaxed"
              style={{ color: "var(--color-ink-50)" }}
            >
              Creates a Supabase account immediately and sends a signup link through Resend.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close send invite modal"
            onClick={handleClose}
            disabled={isSubmitting}
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              color: "var(--color-ink-40)",
              background: "transparent",
              border: "1px solid var(--color-border)",
            }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <form className="px-6 pb-6 pt-5" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="invite-email">Email</Label>
              <Input
                ref={emailInputRef}
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="invite-first-name">First name (optional)</Label>
                <Input
                  id="invite-first-name"
                  placeholder="First name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="invite-last-name">Last name (optional)</Label>
                <Input
                  id="invite-last-name"
                  placeholder="Last name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                />
              </div>
            </div>
            {error ? (
              <div
                className="rounded-xl border px-4 py-3 text-sm"
                style={{
                  color: "var(--color-ember)",
                  borderColor: "var(--color-ember-10)",
                  background: "var(--color-ember-05)",
                }}
              >
                {error}
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div
            className="mt-5 flex items-center justify-end gap-2 border-t pt-5"
            style={{ borderColor: "var(--color-border)" }}
          >
            <Button type="button" variant="secondary" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
              {!isSubmitting && <Send size={14} aria-hidden="true" />}
              Send Invite
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
