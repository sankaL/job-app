import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, RefreshCcw, Send, Trash2, UserPlus } from "lucide-react";
import { useAppContext } from "@/components/layout/AppContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  deactivateAdminUser,
  deleteAdminUser,
  inviteAdminUser,
  reactivateAdminUser,
  updateAdminUser,
  type AdminUser,
} from "@/lib/api";
import { invalidateAdminUsersQueries, useAdminUsersQuery } from "@/lib/queries";

const STATUS_OPTIONS = [
  { value: "all", label: "All users" },
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "deactivated", label: "Deactivated" },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function fullName(user: AdminUser) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.name || "—";
}

export function AdminUsersPage() {
  const { bootstrap } = useAppContext();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const deferredSearch = useDeferredValue(search);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [isInviting, setIsInviting] = useState(false);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editLinkedin, setEditLinkedin] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const {
    data: users,
    error: queryError,
    isFetching: isLoading,
    refetch,
  } = useAdminUsersQuery(deferredSearch, statusFilter);
  const displayedError = error ?? (queryError instanceof Error ? queryError.message : null);

  const currentUserId = bootstrap?.user.id ?? null;
  const editingUser = useMemo(
    () => users?.find((user) => user.id === editingUserId) ?? null,
    [users, editingUserId],
  );

  function beginEdit(user: AdminUser) {
    setEditingUserId(user.id);
    setEditEmail(user.email);
    setEditFirstName(user.first_name ?? "");
    setEditLastName(user.last_name ?? "");
    setEditAddress(user.address ?? "");
    setEditPhone(user.phone ?? "");
    setEditLinkedin(user.linkedin_url ?? "");
  }

  async function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsInviting(true);
    try {
      await inviteAdminUser({
        email: inviteEmail,
        first_name: inviteFirstName || null,
        last_name: inviteLastName || null,
      });
      toast("Invite sent.");
      setInviteEmail("");
      setInviteFirstName("");
      setInviteLastName("");
      await invalidateAdminUsersQueries(queryClient);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Invite failed.", "error");
    } finally {
      setIsInviting(false);
    }
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUserId) return;
    setIsSavingEdit(true);
    try {
      await updateAdminUser(editingUserId, {
        email: editEmail,
        first_name: editFirstName || null,
        last_name: editLastName || null,
        address: editAddress || null,
        phone: editPhone || null,
        linkedin_url: editLinkedin || null,
      });
      toast("User updated.");
      setEditingUserId(null);
      await invalidateAdminUsersQueries(queryClient);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed.", "error");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleToggleActive(user: AdminUser) {
    try {
      if (user.is_active) {
        await deactivateAdminUser(user.id);
        toast("User deactivated.");
      } else {
        await reactivateAdminUser(user.id);
        toast("User reactivated.");
      }
      await invalidateAdminUsersQueries(queryClient);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Status update failed.", "error");
    }
  }

  async function handleDelete(user: AdminUser) {
    const confirmed = window.confirm(`Delete ${user.email}? This permanently removes their account and data.`);
    if (!confirmed) return;
    try {
      await deleteAdminUser(user.id);
      toast("User deleted.");
      await invalidateAdminUsersQueries(queryClient);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed.", "error");
    }
  }

  if (isLoading && users == null) {
    return (
      <div className="page-enter space-y-5">
        <PageHeader title="User Management" subtitle="Invite, update, and control user access." />
        <SkeletonTable rows={8} columns={5} />
      </div>
    );
  }

  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="User Management"
        subtitle="Invite, update, and control user access."
        actions={
          <Button variant="secondary" onClick={() => void refetch()} loading={isLoading}>
            <RefreshCcw size={14} />
            Refresh
          </Button>
        }
      />

      {displayedError ? (
        <Card variant="danger" density="compact">
          <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>
            User list unavailable
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
            {displayedError}
          </p>
        </Card>
      ) : null}

      <Card density="compact" className="overflow-hidden">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-40)" }}>
              Invite user
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--color-ink-50)" }}>
              Creates a Supabase account immediately and sends a signup link through Resend.
            </p>
          </div>
        </div>
        <form className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]" onSubmit={handleInviteSubmit}>
          <Input
            type="email"
            placeholder="user@example.com"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            required
          />
          <Input
            placeholder="First name (optional)"
            value={inviteFirstName}
            onChange={(event) => setInviteFirstName(event.target.value)}
          />
          <Input
            placeholder="Last name (optional)"
            value={inviteLastName}
            onChange={(event) => setInviteLastName(event.target.value)}
          />
          <Button type="submit" loading={isInviting} disabled={isInviting}>
            <Send size={14} />
            Send invite
          </Button>
        </form>
      </Card>

      <Card density="compact">
        <div className="mb-4 grid gap-3 md:grid-cols-[2fr_220px]">
          <Input
            placeholder="Search by email or name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <DataTable
          data={users ?? []}
          getRowKey={(user) => user.id}
          pageSize={12}
          density="compact"
          verticalAlign="top"
          tableLayout="fixed"
          columns={[
            {
              key: "name",
              header: "User",
              width: "30%",
              sortable: true,
              sortValue: (user) => fullName(user),
              render: (user) => (
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                    {fullName(user)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-50)" }}>
                    {user.email}
                  </p>
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              width: "16%",
              sortable: true,
              sortValue: (user) => `${user.is_active}-${user.onboarding_completed_at ? "complete" : "invited"}`,
              render: (user) => (
                <div className="flex flex-col gap-1 text-xs">
                  <span style={{ color: user.is_active ? "var(--color-spruce)" : "var(--color-ember)" }}>
                    {user.is_active ? "Active" : "Deactivated"}
                  </span>
                  <span style={{ color: "var(--color-ink-50)" }}>
                    {user.onboarding_completed_at ? "Onboarded" : "Invite pending"}
                  </span>
                </div>
              ),
            },
            {
              key: "invite",
              header: "Invite",
              width: "24%",
              render: (user) => (
                <div className="space-y-0.5 text-xs" style={{ color: "var(--color-ink-50)" }}>
                  <p>{user.latest_invite_status ? user.latest_invite_status : "—"}</p>
                  <p>Sent: {formatDate(user.latest_invite_sent_at)}</p>
                  <p>Expires: {formatDate(user.latest_invite_expires_at)}</p>
                </div>
              ),
            },
            {
              key: "updated_at",
              header: "Updated",
              width: "12%",
              sortable: true,
              sortValue: (user) => user.updated_at,
              render: (user) => (
                <span className="text-xs" style={{ color: "var(--color-ink-50)" }}>
                  {formatDate(user.updated_at)}
                </span>
              ),
            },
            {
              key: "actions",
              header: <span className="block w-full text-right">Actions</span>,
              width: "18%",
              render: (user) => {
                const isSelf = currentUserId === user.id;
                return (
                  <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-1.5">
                    <IconButton
                      onClick={() => beginEdit(user)}
                      aria-label={`Edit ${user.email}`}
                      title="Edit user"
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </IconButton>
                    <Button
                      size="sm"
                      variant={user.is_active ? "danger" : "secondary"}
                      onClick={() => void handleToggleActive(user)}
                      disabled={isSelf}
                    >
                      {user.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                    <IconButton
                      variant="danger"
                      onClick={() => void handleDelete(user)}
                      disabled={isSelf}
                      aria-label={`Delete ${user.email}`}
                      title="Delete user"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </IconButton>
                  </div>
                );
              },
            },
          ]}
          emptyState={
            <div className="rounded-xl border border-dashed px-6 py-10 text-center">
              <UserPlus size={20} className="mx-auto mb-2" style={{ color: "var(--color-ink-40)" }} />
              <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                No users found
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-50)" }}>
                Adjust filters or invite a new user.
              </p>
            </div>
          }
        />
      </Card>

      {editingUser ? (
        <Card density="compact">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-40)" }}>
                Edit user
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
                {editingUser.email}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setEditingUserId(null)}>
              Cancel
            </Button>
          </div>

          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSaveEdit}>
            <div>
              <Label htmlFor="edit_email">Email</Label>
              <Input
                id="edit_email"
                type="email"
                value={editEmail}
                onChange={(event) => setEditEmail(event.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="edit_phone">Phone</Label>
              <Input
                id="edit_phone"
                value={editPhone}
                onChange={(event) => setEditPhone(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit_first_name">First name</Label>
              <Input
                id="edit_first_name"
                value={editFirstName}
                onChange={(event) => setEditFirstName(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit_last_name">Last name</Label>
              <Input
                id="edit_last_name"
                value={editLastName}
                onChange={(event) => setEditLastName(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit_address">Location</Label>
              <Input
                id="edit_address"
                value={editAddress}
                onChange={(event) => setEditAddress(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit_linkedin">LinkedIn</Label>
              <Input
                id="edit_linkedin"
                value={editLinkedin}
                onChange={(event) => setEditLinkedin(event.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" loading={isSavingEdit} disabled={isSavingEdit}>
                Save user updates
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
