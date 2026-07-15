import { useEffect, useRef, useState, type FormEvent } from "react";
import { Send, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModalActions, ModalError, ModalShell } from "@/components/ui/modal-shell";

type InviteUserModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { email: string; first_name: string | null; last_name: string | null }) => Promise<void>;
};

export function InviteUserModal({ open, onClose, onSubmit }: InviteUserModalProps) {
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
    const focusHandle = window.requestAnimationFrame(() => {
      emailInputRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusHandle);
    };
  }, [open]);

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

  return (
    <ModalShell
      open={open}
      title="Send Invite"
      description="Creates a Supabase account immediately and sends a signup link through Resend."
      icon={<UserPlus size={14} aria-hidden="true" />}
      closeLabel="Close send invite modal"
      onClose={handleClose}
      closeDisabled={isSubmitting}
      width="min(480px, calc(100vw - 32px))"
    >
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
            <ModalError message={error} />
          </div>
          <ModalActions
            onCancel={handleClose}
            submitting={isSubmitting}
            submitLabel={<>{!isSubmitting && <Send size={14} aria-hidden="true" />}Send Invite</>}
          />
        </form>
    </ModalShell>
  );
}
