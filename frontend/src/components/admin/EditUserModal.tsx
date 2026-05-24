import { useEffect, useId, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { type AdminUser, type UpdateAdminUserPayload } from "@/lib/api";

type EditUserModalProps = {
  open: boolean;
  user: AdminUser | null;
  onClose: () => void;
  onSubmit: (userId: string, payload: UpdateAdminUserPayload) => Promise<void>;
};

const DIALOG_WIDTH = "min(520px, calc(100vw - 32px))";

export function EditUserModal({ open, user, onClose, onSubmit }: EditUserModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [subscriptionTier, setSubscriptionTier] = useState<"basic" | "pro">("basic");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const userId = user?.id ?? null;

  useEffect(() => {
    if (user) {
      setEmail(user.email);
      setFirstName(user.first_name ?? "");
      setLastName(user.last_name ?? "");
      setAddress(user.address ?? "");
      setPhone(user.phone ?? "");
      setLinkedinUrl(user.linkedin_url ?? "");
      setSubscriptionTier(user.subscription_tier ?? "basic");
      setError(null);
    }
  }, [user]);

  function resetState() {
    setEmail("");
    setFirstName("");
    setLastName("");
    setAddress("");
    setPhone("");
    setLinkedinUrl("");
    setSubscriptionTier("basic");
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
    return () => {
      document.body.style.overflow = previousOverflow;
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
    if (!userId) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(userId, {
        email,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        address: address.trim() || null,
        phone: phone.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
        subscription_tier: subscriptionTier,
      });
      resetState();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to update user.");
      setIsSubmitting(false);
    }
  }

  if (!open || !user || typeof document === "undefined") {
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
                <Pencil size={14} aria-hidden="true" />
              </div>
              <h2
                id={titleId}
                className="text-base font-semibold"
                style={{ color: "var(--color-ink)" }}
              >
                Edit User
              </h2>
            </div>
            <p
              id={descriptionId}
              className="text-sm leading-relaxed"
              style={{ color: "var(--color-ink-50)" }}
            >
              {user.email}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close edit user modal"
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
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-first-name">First name</Label>
                <Input
                  id="edit-first-name"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-last-name">Last name</Label>
                <Input
                  id="edit-last-name"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-address">Location</Label>
                <Input
                  id="edit-address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-linkedin">LinkedIn</Label>
                <Input
                  id="edit-linkedin"
                  value={linkedinUrl}
                  onChange={(event) => setLinkedinUrl(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-subscription-tier">Subscription tier</Label>
                <Select
                  id="edit-subscription-tier"
                  value={subscriptionTier}
                  onChange={(event) => {
                    const tier = event.target.value;
                    if (tier === "basic" || tier === "pro") {
                      setSubscriptionTier(tier);
                    }
                  }}
                >
                  <option value="basic">Basic</option>
                  <option value="pro">Pro</option>
                </Select>
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
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
