import { PopoverSurface } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AppBreadcrumbs } from "@/components/layout/Breadcrumbs";
import { NotificationPanel } from "@/components/layout/NotificationPanel";
import { useAppContext } from "@/components/layout/AppContext";
import { useToast } from "@/components/ui/toast";
import { clearNotifications, type NotificationSummary } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  invalidateNotificationQueries,
  queryKeys,
  useNotificationsQuery,
} from "@/lib/queries";

function AccountMenuButton({
  children,
  icon,
  onClick,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-4 py-2 text-sm transition-colors"
    >
      {icon}
      {children}
    </Button>
  );
}

function AccountMenu({
  userName,
  userEmail,
  onProfile,
  onSignOut,
}: {
  userName: string;
  userEmail: string;
  onProfile: () => void;
  onSignOut: () => void;
}) {
  return (
    <PopoverSurface className="animate-scaleIn absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-xl border py-1">
      <div
        className="border-b px-4 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="text-sm font-medium text-[var(--color-text-primary)]">
          {userName || "User"}
        </div>
        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
          {userEmail}
        </div>
      </div>
      <div className="py-1">
        <AccountMenuButton
          onClick={onProfile}
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="5" r="3" />
              <path d="M2 14c0-2.5 2.5-4.5 6-4.5s6 2 6 4.5" />
            </svg>
          }
        >
          Profile & Preferences
        </AccountMenuButton>
        <AccountMenuButton
          onClick={onSignOut}
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6M10.5 11.5L14 8l-3.5-3.5M14 8H6" />
            </svg>
          }
        >
          Sign Out
        </AccountMenuButton>
      </div>
    </PopoverSurface>
  );
}

function getInitials(userName: string, userEmail: string) {
  if (userName)
    return userName
      .split(" ")
      .map((namePart) => namePart[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  return userEmail ? userEmail[0].toUpperCase() : "?";
}

function MobileMenuToggle({ onToggle }: { onToggle?: () => void }) {
  if (!onToggle) return null;
  return (
    <Button
      variant="ghost"
      onClick={onToggle}
      className="sidebar-mobile-toggle flex h-9 w-9 items-center justify-center transition-colors"
      aria-label="Toggle sidebar"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <path d="M3 5h14M3 10h14M3 15h14" />
      </svg>
    </Button>
  );
}

function NotificationControl({
  open,
  needsActionCount,
  notifications,
  loading,
  error,
  clearing,
  onToggle,
  onClear,
  onSelect,
}: {
  open: boolean;
  needsActionCount: number;
  notifications: NotificationSummary[];
  loading: boolean;
  error: string | null;
  clearing: boolean;
  onToggle: () => void;
  onClear: () => void;
  onSelect: (notification: NotificationSummary) => void;
}) {
  const title =
    needsActionCount > 0
      ? `${needsActionCount} items need attention`
      : "No pending actions";
  return (
    <div className="relative">
      <Button
        variant="ghost"
        onClick={onToggle}
        className="relative flex h-9 w-9 items-center justify-center transition-colors"
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 2a5 5 0 0 0-5 5c0 3.5-1.5 5.5-2 6h14c-.5-.5-2-2.5-2-6a5 5 0 0 0-5-5z" />
          <path d="M8.5 16a1.5 1.5 0 0 0 3 0" />
        </svg>
        {needsActionCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-error)] px-1 text-[10px] font-bold leading-none text-[var(--color-on-accent)]">
            {needsActionCount}
          </span>
        ) : null}
      </Button>
      {open ? (
        <NotificationPanel
          needsActionCount={needsActionCount}
          notifications={notifications}
          loading={loading}
          error={error}
          clearing={clearing}
          onClear={onClear}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
}

function AccountControl({
  open,
  initials,
  userName,
  userEmail,
  onToggle,
  onProfile,
  onSignOut,
}: {
  open: boolean;
  initials: string;
  userName: string;
  userEmail: string;
  onToggle: () => void;
  onProfile: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="relative">
      <Button
        variant="primary"
        onClick={onToggle}
        style={{ borderRadius: "var(--radius-full)", padding: 0 }}
        className="flex h-9 w-9 items-center justify-center text-xs transition-all"
        aria-label="Account menu"
        aria-expanded={open}
      >
        {initials}
      </Button>
      {open ? (
        <AccountMenu
          userName={userName}
          userEmail={userEmail}
          onProfile={onProfile}
          onSignOut={onSignOut}
        />
      ) : null}
    </div>
  );
}

export function TopBar({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { bootstrap, needsActionCount } = useAppContext();
  const { logout } = useAuth();
  const { toast } = useToast();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsClearing, setNotificationsClearing] = useState(false);
  const menusRef = useRef<HTMLDivElement>(null);
  const {
    data: notifications = [],
    isLoading: notificationsLoading,
    error: notificationsErrorState,
  } = useNotificationsQuery(notificationsOpen);
  const notificationsError =
    notificationsErrorState instanceof Error
      ? notificationsErrorState.message
      : null;
  const userEmail = bootstrap?.user.email ?? "";
  const userName =
    bootstrap?.profile?.name ??
    [bootstrap?.profile?.first_name, bootstrap?.profile?.last_name]
      .filter(Boolean)
      .join(" ");
  const initials = getInitials(userName, userEmail);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!menusRef.current?.contains(event.target as Node)) {
        setAvatarOpen(false);
        setNotificationsOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAvatarOpen(false);
        setNotificationsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function toggleNotifications() {
    setAvatarOpen(false);
    setNotificationsOpen((current) => !current);
  }

  function toggleAvatarMenu() {
    setNotificationsOpen(false);
    setAvatarOpen((current) => !current);
  }

  function handleNotificationSelect(notification: NotificationSummary) {
    if (!notification.application_id) return;
    setNotificationsOpen(false);
    navigate(`/app/applications/${notification.application_id}`);
  }

  async function handleClearNotifications() {
    try {
      setNotificationsClearing(true);
      await clearNotifications();
      queryClient.setQueryData<NotificationSummary[]>(
        queryKeys.notifications,
        (current = []) =>
          current.filter((notification) => notification.action_required),
      );
      await invalidateNotificationQueries(queryClient);
      toast("Cleared notifications that do not need attention.");
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to clear notifications",
        "error",
      );
    } finally {
      setNotificationsClearing(false);
    }
  }

  return (
    <header
      className="app-shell-header sticky top-0 z-20 flex items-center justify-between border-b"
      style={{
        height: "var(--topbar-height)",
        background: "var(--color-background-body)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <MobileMenuToggle onToggle={onMenuToggle} />
        <AppBreadcrumbs />
      </div>

      <div ref={menusRef} className="flex items-center gap-3">
        <NotificationControl
          open={notificationsOpen}
          needsActionCount={needsActionCount}
          notifications={notifications}
          loading={notificationsLoading}
          error={notificationsError}
          clearing={notificationsClearing}
          onToggle={toggleNotifications}
          onClear={() => void handleClearNotifications()}
          onSelect={handleNotificationSelect}
        />
        <AccountControl
          open={avatarOpen}
          initials={initials}
          userName={userName}
          userEmail={userEmail}
          onToggle={toggleAvatarMenu}
          onProfile={() => {
            setAvatarOpen(false);
            navigate("/app/profile");
          }}
          onSignOut={() => void logout()}
        />
      </div>
    </header>
  );
}
