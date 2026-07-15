import { useEffect, useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModalActions, ModalError, ModalShell } from "@/components/ui/modal-shell";
import { Select } from "@/components/ui/select";
import { type AdminUser, type UpdateAdminUserPayload } from "@/lib/api";
import { useContactFields } from "@/lib/use-contact-fields";

type EditUserModalProps = {
  open: boolean;
  user: AdminUser | null;
  onClose: () => void;
  onSubmit: (userId: string, payload: UpdateAdminUserPayload) => Promise<void>;
};

export function EditUserModal({ open, user, onClose, onSubmit }: EditUserModalProps) {
  const {
    email, setEmail, firstName, setFirstName, lastName, setLastName,
    address, setAddress, phone, setPhone, linkedinUrl, setLinkedinUrl,
    resetContactFields,
  } = useContactFields();
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
    resetContactFields();
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
    }
  }, [open]);

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

  if (!user) return null;

  return (
    <ModalShell
      open={open}
      title="Edit User"
      description={user.email}
      icon={<Pencil size={14} aria-hidden="true" />}
      closeLabel="Close edit user modal"
      onClose={handleClose}
      closeDisabled={isSubmitting}
    >
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
            <ModalError message={error} />
          </div>
          <ModalActions onCancel={handleClose} submitting={isSubmitting} submitLabel="Save Changes" />
        </form>
    </ModalShell>
  );
}
