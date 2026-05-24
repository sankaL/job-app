import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, RefreshCcw, Send, Trash2, UserPlus } from "lucide-react";
import { useAppContext } from "@/components/layout/AppContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { InviteUserModal } from "@/components/admin/InviteUserModal";
import { EditUserModal } from "@/components/admin/EditUserModal";
import {
  deactivateAdminUser,
  deleteAdminUser,
  inviteAdminUser,
  reactivateAdminUser,
  updateAdminUser,
  type AdminUser,
  type UpdateAdminUserPayload,
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

  const [inviteModalOpen, setInviteModalOpen] = useState(false);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  const [deleteConfirmUser, setDeleteConfirmUser] = useState<AdminUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  useEffect(() => {
    if (editingUserId !== null && users && !editingUser) {
      setEditingUserId(null);
    }
  }, [editingUserId, editingUser, users]);

  function beginEdit(user: AdminUser) {
    setEditingUserId(user.id);
  }

  async function handleInviteSubmit(payload: { email: string; first_name: string | null; last_name: string | null }) {
    try {
      await inviteAdminUser(payload);
      toast("Invite sent.");
      await invalidateAdminUsersQueries(queryClient);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Invite failed.", "error");
      throw err;
    }
  }

  async function handleSaveEdit(userId: string, payload: UpdateAdminUserPayload) {
    try {
      await updateAdminUser(userId, payload);
      toast("User updated.");
      setEditingUserId(null);
      await invalidateAdminUsersQueries(queryClient);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed.", "error");
      throw err;
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
    setIsDeleting(true);
    try {
      await deleteAdminUser(user.id);
      toast("User deleted.");
      await invalidateAdminUsersQueries(queryClient);
      setDeleteConfirmUser(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed.", "error");
    } finally {
      setIsDeleting(false);
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
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => void refetch()} loading={isLoading}>
              <RefreshCcw size={14} />
              Refresh
            </Button>
            <Button onClick={() => setInviteModalOpen(true)}>
              <Send size={14} />
              Send Invite
            </Button>
          </div>
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
              width: "14%",
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
              key: "tier",
              header: "Tier",
              width: "12%",
              sortable: true,
              sortValue: (user) => user.subscription_tier,
              render: (user) => (
                <span
                  className="inline-flex rounded-md px-2 py-1 text-xs font-semibold capitalize"
                  style={{
                    background:
                      user.subscription_tier === "pro"
                        ? "var(--color-amber-10)"
                        : "var(--color-spruce-10)",
                    color:
                      user.subscription_tier === "pro"
                        ? "var(--color-amber)"
                        : "var(--color-spruce)",
                  }}
                >
                  {user.subscription_tier}
                </span>
              ),
            },
            {
              key: "invite",
              header: "Invite",
              width: "22%",
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
              width: "10%",
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
              width: "12%",
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
                      onClick={() => setDeleteConfirmUser(user)}
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

      <InviteUserModal
        open={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        onSubmit={handleInviteSubmit}
      />

      <EditUserModal
        open={editingUser !== null}
        user={editingUser}
        onClose={() => setEditingUserId(null)}
        onSubmit={handleSaveEdit}
      />

      <ConfirmModal
        open={deleteConfirmUser !== null}
        title="Delete user"
        message={
          deleteConfirmUser
            ? `Delete ${deleteConfirmUser.email}? This permanently removes their account and data.`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={isDeleting}
        onConfirm={() => {
          if (deleteConfirmUser) {
            void handleDelete(deleteConfirmUser);
          }
        }}
        onCancel={() => {
          if (!isDeleting) {
            setDeleteConfirmUser(null);
          }
        }}
      />
    </div>
  );
}
