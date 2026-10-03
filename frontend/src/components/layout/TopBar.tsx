import { MobileNavToggle } from "@astryxdesign/core/MobileNav";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Menu, UserRound, LogOut, Bell } from "lucide-react";
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
          icon={<UserRound size={16} aria-hidden="true" />}
        >
          Profile & Preferences
        </AccountMenuButton>
        <AccountMenuButton
          onClick={onSignOut}
          icon={<LogOut size={16} aria-hidden="true" />}
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
        <Bell size={18} aria-hidden="true" />
        {needsActionCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-error)] px-1 text-xs font-bold leading-none text-[var(--color-on-accent)]">
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

export function TopBar() {
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
    <HStack
      gap={4}
      vAlign="center"
      hAlign="between"
      className="app-topbar"
      height="var(--topbar-height)"
    >
      <HStack gap={3} vAlign="center" className="app-brand">
        <img src="/applix-logo.svg" alt="Applix logo" className="h-7 w-7" />
        <VStack gap={0}>
          <Text type="label">Applix</Text>
          <Text
            type="supporting"
            color="secondary"
            className="app-brand-description"
          >
            AI Job Applications
          </Text>
        </VStack>
      </HStack>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <MobileNavToggle label="Toggle sidebar">
          <Menu size={18} aria-hidden="true" />
        </MobileNavToggle>
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
    </HStack>
  );
}
