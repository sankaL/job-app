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
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.name ||
    "—"
  );
}

function UserIdentityCell({ user }: { user: AdminUser }) {
  return (
    <div className="space-y-0.5">
      <p
        className="text-sm font-semibold"
        style={{ color: "var(--color-ink)" }}
      >
        {fullName(user)}
      </p>
      <p className="text-xs" style={{ color: "var(--color-ink-50)" }}>
        {user.email}
      </p>
    </div>
  );
}

function UserStatusCell({ user }: { user: AdminUser }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span
        style={{
          color: user.is_active ? "var(--color-spruce)" : "var(--color-ember)",
        }}
      >
        {user.is_active ? "Active" : "Deactivated"}
      </span>
      <span style={{ color: "var(--color-ink-50)" }}>
        {user.onboarding_completed_at ? "Onboarded" : "Invite pending"}
      </span>
    </div>
  );
}

function UserTierCell({ user }: { user: AdminUser }) {
  const isPro = user.subscription_tier === "pro";
  return (
    <span
      className="inline-flex rounded-md px-2 py-1 text-xs font-semibold capitalize"
      style={{
        background: isPro ? "var(--color-amber-10)" : "var(--color-spruce-10)",
        color: isPro ? "var(--color-amber)" : "var(--color-spruce)",
      }}
    >
      {user.subscription_tier}
    </span>
  );
}

function UserActionsCell({
  user,
  isSelf,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  user: AdminUser;
  isSelf: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-1.5">
      <IconButton
        onClick={onEdit}
        aria-label={`Edit ${user.email}`}
        title="Edit user"
      >
        <Pencil size={15} aria-hidden="true" />
      </IconButton>
      <Button
        size="sm"
        variant={user.is_active ? "danger" : "secondary"}
        onClick={onToggleActive}
        disabled={isSelf}
      >
        {user.is_active ? "Deactivate" : "Reactivate"}
      </Button>
      <IconButton
        variant="danger"
        onClick={onDelete}
        disabled={isSelf}
        aria-label={`Delete ${user.email}`}
        title="Delete user"
      >
        <Trash2 size={15} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function AdminUsersTable({
  users,
  currentUserId,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  users: AdminUser[];
  currentUserId: string | null;
  onEdit: (user: AdminUser) => void;
  onToggleActive: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
}) {
  const columns = [
    {
      key: "name",
      header: "User",
      width: "30%",
      sortable: true,
      sortValue: fullName,
      render: (user: AdminUser) => <UserIdentityCell user={user} />,
    },
    {
      key: "status",
      header: "Status",
      width: "14%",
      sortable: true,
      sortValue: (user: AdminUser) =>
        `${user.is_active}-${user.onboarding_completed_at ? "complete" : "invited"}`,
      render: (user: AdminUser) => <UserStatusCell user={user} />,
    },
    {
      key: "tier",
      header: "Tier",
      width: "12%",
      sortable: true,
      sortValue: (user: AdminUser) => user.subscription_tier,
      render: (user: AdminUser) => <UserTierCell user={user} />,
    },
    {
      key: "invite",
      header: "Invite",
      width: "22%",
      render: (user: AdminUser) => (
        <div
          className="space-y-0.5 text-xs"
          style={{ color: "var(--color-ink-50)" }}
        >
          <p>{user.latest_invite_status || "—"}</p>
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
      sortValue: (user: AdminUser) => user.updated_at,
      render: (user: AdminUser) => (
        <span className="text-xs" style={{ color: "var(--color-ink-50)" }}>
          {formatDate(user.updated_at)}
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="block w-full text-right">Actions</span>,
      width: "12%",
      render: (user: AdminUser) => (
        <UserActionsCell
          user={user}
          isSelf={currentUserId === user.id}
          onEdit={() => onEdit(user)}
          onToggleActive={() => onToggleActive(user)}
          onDelete={() => onDelete(user)}
        />
      ),
    },
  ];
  return (
    <DataTable
      data={users}
      getRowKey={(user) => user.id}
      pageSize={12}
      density="compact"
      verticalAlign="top"
      tableLayout="fixed"
      columns={columns}
      emptyState={
        <div className="rounded-xl border border-dashed px-6 py-10 text-center">
          <UserPlus
            size={20}
            className="mx-auto mb-2"
            style={{ color: "var(--color-ink-40)" }}
          />
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-ink)" }}
          >
            No users found
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-50)" }}>
            Adjust filters or invite a new user.
          </p>
        </div>
      }
    />
  );
}

type AdminUsersContentProps = {
  users: AdminUser[] | undefined;
  currentUserId: string | null;
  isLoading: boolean;
  error: string | null;
  search: string;
  statusFilter: StatusFilter;
  inviteModalOpen: boolean;
  editingUser: AdminUser | null;
  deleteConfirmUser: AdminUser | null;
  isDeleting: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: StatusFilter) => void;
  onRefresh: () => void;
  onOpenInvite: () => void;
  onCloseInvite: () => void;
  onInvite: (payload: {
    email: string;
    first_name: string | null;
    last_name: string | null;
  }) => Promise<void>;
  onEdit: (user: AdminUser) => void;
  onCloseEdit: () => void;
  onSaveEdit: (
    userId: string,
    payload: UpdateAdminUserPayload,
  ) => Promise<void>;
  onToggleActive: (user: AdminUser) => void;
  onChooseDelete: (user: AdminUser | null) => void;
  onConfirmDelete: () => void;
};

function AdminUsersContent(props: AdminUsersContentProps) {
  if (props.isLoading && !props.users)
    return (
      <div className="page-enter space-y-5">
        <PageHeader
          title="User Management"
          subtitle="Invite, update, and control user access."
        />
        <SkeletonTable rows={8} columns={5} />
      </div>
    );
  return (
    <div className="page-enter space-y-5">
      <PageHeader
        title="User Management"
        subtitle="Invite, update, and control user access."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={props.onRefresh}
              loading={props.isLoading}
            >
              <RefreshCcw size={14} />
              Refresh
            </Button>
            <Button onClick={props.onOpenInvite}>
              <Send size={14} />
              Send Invite
            </Button>
          </div>
        }
      />
      {props.error && (
        <Card variant="danger" density="compact">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-ember)" }}
          >
            User list unavailable
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
            {props.error}
          </p>
        </Card>
      )}
      <Card density="compact">
        <div className="mb-4 grid gap-3 md:grid-cols-[2fr_220px]">
          <Input
            placeholder="Search by email or name"
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
          />
          <Select
            value={props.statusFilter}
            onChange={(event) =>
              props.onStatusFilterChange(event.target.value as StatusFilter)
            }
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <AdminUsersTable
          users={props.users ?? []}
          currentUserId={props.currentUserId}
          onEdit={props.onEdit}
          onToggleActive={props.onToggleActive}
          onDelete={props.onChooseDelete}
        />
      </Card>
      <InviteUserModal
        open={props.inviteModalOpen}
        onClose={props.onCloseInvite}
        onSubmit={props.onInvite}
      />
      <EditUserModal
        open={props.editingUser !== null}
        user={props.editingUser}
        onClose={props.onCloseEdit}
        onSubmit={props.onSaveEdit}
      />
      <ConfirmModal
        open={props.deleteConfirmUser !== null}
        title="Delete user"
        message={
          props.deleteConfirmUser
            ? `Delete ${props.deleteConfirmUser.email}? This permanently removes their account and data.`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        loading={props.isDeleting}
        onConfirm={props.onConfirmDelete}
        onCancel={() => {
          if (!props.isDeleting) props.onChooseDelete(null);
        }}
      />
    </div>
  );
}

type ToastFn = ReturnType<typeof useToast>["toast"];

async function runAdminUserMutation(
  operation: () => Promise<unknown>,
  onSuccess: () => Promise<void>,
  toast: ToastFn,
  successMessage: string,
  failureMessage: string,
  rethrow = false,
) {
  try {
    await operation();
    toast(successMessage);
    await onSuccess();
  } catch (error) {
    toast(error instanceof Error ? error.message : failureMessage, "error");
    if (rethrow) throw error;
  }
}

async function toggleAdminUser(user: AdminUser) {
  return user.is_active
    ? deactivateAdminUser(user.id)
    : reactivateAdminUser(user.id);
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

  const [deleteConfirmUser, setDeleteConfirmUser] = useState<AdminUser | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    data: users,
    error: queryError,
    isFetching: isLoading,
    refetch,
  } = useAdminUsersQuery(deferredSearch, statusFilter);
  const displayedError =
    error ?? (queryError instanceof Error ? queryError.message : null);

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

  async function handleInviteSubmit(payload: {
    email: string;
    first_name: string | null;
    last_name: string | null;
  }) {
    await runAdminUserMutation(
      () => inviteAdminUser(payload),
      () => invalidateAdminUsersQueries(queryClient),
      toast,
      "Invite sent.",
      "Invite failed.",
      true,
    );
  }

  async function handleSaveEdit(
    userId: string,
    payload: UpdateAdminUserPayload,
  ) {
    await runAdminUserMutation(
      () => updateAdminUser(userId, payload),
      async () => {
        setEditingUserId(null);
        await invalidateAdminUsersQueries(queryClient);
      },
      toast,
      "User updated.",
      "Update failed.",
      true,
    );
  }

  async function handleToggleActive(user: AdminUser) {
    await runAdminUserMutation(
      () => toggleAdminUser(user),
      () => invalidateAdminUsersQueries(queryClient),
      toast,
      user.is_active ? "User deactivated." : "User reactivated.",
      "Status update failed.",
    );
  }

  async function handleDelete(user: AdminUser) {
    setIsDeleting(true);
    await runAdminUserMutation(
      () => deleteAdminUser(user.id),
      async () => {
        await invalidateAdminUsersQueries(queryClient);
        setDeleteConfirmUser(null);
      },
      toast,
      "User deleted.",
      "Delete failed.",
    );
    setIsDeleting(false);
  }

  return (
    <AdminUsersContent
      users={users}
      currentUserId={currentUserId}
      isLoading={isLoading}
      error={displayedError}
      search={search}
      statusFilter={statusFilter}
      inviteModalOpen={inviteModalOpen}
      editingUser={editingUser}
      deleteConfirmUser={deleteConfirmUser}
      isDeleting={isDeleting}
      onSearchChange={setSearch}
      onStatusFilterChange={setStatusFilter}
      onRefresh={() => void refetch()}
      onOpenInvite={() => setInviteModalOpen(true)}
      onCloseInvite={() => setInviteModalOpen(false)}
      onInvite={handleInviteSubmit}
      onEdit={beginEdit}
      onCloseEdit={() => setEditingUserId(null)}
      onSaveEdit={handleSaveEdit}
      onToggleActive={(user) => void handleToggleActive(user)}
      onChooseDelete={setDeleteConfirmUser}
      onConfirmDelete={() => {
        if (deleteConfirmUser) void handleDelete(deleteConfirmUser);
      }}
    />
  );
}
