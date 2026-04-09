import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppBreadcrumbs } from "@/components/layout/Breadcrumbs";
import { SkeletonLine } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useAppContext } from "@/components/layout/AppContext";
import { clearNotifications, listNotifications, type NotificationSummary } from "@/lib/api";
import { NOTIFICATIONS_CLEARED_EVENT } from "@/lib/events";
import { getSupabaseBrowserClient } from "@/lib/supabase";

function formatNotificationTimestamp(createdAt: string) {
  const createdDate = new Date(createdAt);
  if (Number.isNaN(createdDate.getTime())) {
    return createdAt;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(createdDate);
}

function getNotificationTone(notification: NotificationSummary) {
  if (notification.action_required) {
    return {
      accent: "var(--color-ember)",
      badgeBackground: "var(--color-ember-10)",
      badgeColor: "var(--color-ember)",
      badgeLabel: "Needs action",
    };
  }

  switch (notification.type) {
    case "success":
      return {
        accent: "var(--color-spruce)",
        badgeBackground: "var(--color-spruce-05)",
        badgeColor: "var(--color-spruce)",
        badgeLabel: "Success",
      };
    case "warning":
      return {
        accent: "var(--color-amber)",
        badgeBackground: "var(--color-amber-10)",
        badgeColor: "var(--color-amber)",
        badgeLabel: "Warning",
      };
    case "error":
      return {
        accent: "var(--color-ember)",
        badgeBackground: "var(--color-ember-10)",
        badgeColor: "var(--color-ember)",
        badgeLabel: "Error",
      };
    default:
      return {
        accent: "var(--color-ink-50)",
        badgeBackground: "var(--color-ink-05)",
        badgeColor: "var(--color-ink-65)",
        badgeLabel: "Info",
      };
  }
}

export function TopBar({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const navigate = useNavigate();
  const { bootstrap, needsActionCount, refreshApplications } = useAppContext();
  const { toast } = useToast();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsClearing, setNotificationsClearing] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const menusRef = useRef<HTMLDivElement>(null);

  const userEmail = bootstrap?.user.email ?? "";
  const userName = bootstrap?.profile?.name ?? "";
  const initials = userName
    ? userName
        .split(" ")
        .map((namePart) => namePart[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : userEmail
      ? userEmail[0].toUpperCase()
      : "?";

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menusRef.current && !menusRef.current.contains(event.target as Node)) {
        setAvatarOpen(false);
        setNotificationsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!notificationsOpen) {
      return;
    }

    let cancelled = false;
    setNotificationsLoading(true);
    setNotificationsError(null);

    void listNotifications()
      .then((response) => {
        if (!cancelled) {
          setNotifications(response);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setNotifications([]);
          setNotificationsError(err instanceof Error ? err.message : "Failed to load notifications.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setNotificationsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [notificationsOpen]);

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  function toggleNotifications() {
    setAvatarOpen(false);
    setNotificationsOpen((current) => !current);
  }

  function toggleAvatarMenu() {
    setNotificationsOpen(false);
    setAvatarOpen((current) => !current);
  }

  function handleNotificationSelect(notification: NotificationSummary) {
    if (!notification.application_id) {
      return;
    }

    setNotificationsOpen(false);
    navigate(`/app/applications/${notification.application_id}`);
  }

  async function handleClearNotifications() {
    try {
      setNotificationsClearing(true);
      await clearNotifications();
      setNotifications([]);
      setNotificationsError(null);
      await refreshApplications();
      window.dispatchEvent(new Event(NOTIFICATIONS_CLEARED_EVENT));
      toast("Notifications cleared.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to clear notifications", "error");
    } finally {
      setNotificationsClearing(false);
    }
  }

  return (
    <header
      className="app-shell-header sticky top-0 z-20 flex items-center justify-between border-b"
      style={{
        height: "var(--topbar-height)",
        background: "var(--color-canvas)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="sidebar-mobile-toggle flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
            style={{ color: "var(--color-ink-50)" }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = "var(--color-ink-05)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
            }}
            aria-label="Toggle sidebar"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          </button>
        )}
        <AppBreadcrumbs />
      </div>

      <div ref={menusRef} className="flex items-center gap-3">
        <div className="relative">
          <button
            onClick={toggleNotifications}
            className="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
            style={{
              color: "var(--color-ink-50)",
              background: notificationsOpen ? "var(--color-ink-05)" : "transparent",
            }}
            onMouseEnter={(event) => {
              if (!notificationsOpen) {
                event.currentTarget.style.background = "var(--color-ink-05)";
              }
            }}
            onMouseLeave={(event) => {
              if (!notificationsOpen) {
                event.currentTarget.style.background = "transparent";
              }
            }}
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            aria-haspopup="dialog"
            title={needsActionCount > 0 ? `${needsActionCount} items need attention` : "No pending actions"}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 2a5 5 0 0 0-5 5c0 3.5-1.5 5.5-2 6h14c-.5-.5-2-2.5-2-6a5 5 0 0 0-5-5z" />
              <path d="M8.5 16a1.5 1.5 0 0 0 3 0" />
            </svg>
            {needsActionCount > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
                style={{ background: "var(--color-ember)" }}
              >
                {needsActionCount}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div
              className="animate-scaleIn absolute right-0 top-full mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border"
              style={{
                background: "var(--color-white)",
                borderColor: "var(--color-border)",
                boxShadow: "var(--shadow-lg)",
                transformOrigin: "top right",
              }}
              role="dialog"
              aria-label="Notifications panel"
            >
              <div className="border-b px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                      Notifications
                    </div>
                    <div className="mt-0.5 text-xs" style={{ color: "var(--color-ink-50)" }}>
                      {needsActionCount > 0 ? `${needsActionCount} item${needsActionCount === 1 ? "" : "s"} need attention` : "All caught up"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {!notificationsLoading && !notificationsError && (
                      <span className="text-xs font-medium" style={{ color: "var(--color-ink-40)" }}>
                        {notifications.length}
                      </span>
                    )}
                    {!notificationsLoading && !notificationsError && notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleClearNotifications()}
                        disabled={notificationsClearing}
                        className="text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-50"
                        style={{ color: "var(--color-spruce)" }}
                        onMouseEnter={(event) => {
                          if (!notificationsClearing) {
                            event.currentTarget.style.color = "var(--color-ink)";
                          }
                        }}
                        onMouseLeave={(event) => {
                          event.currentTarget.style.color = "var(--color-spruce)";
                        }}
                      >
                        {notificationsClearing ? "Clearing..." : "Clear all"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {notificationsLoading ? (
                <div className="space-y-4 px-4 py-4">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="space-y-2">
                      <SkeletonLine className="w-full" />
                      <SkeletonLine className="w-4/5" />
                    </div>
                  ))}
                </div>
              ) : notificationsError ? (
                <div className="px-4 py-5">
                  <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>
                    Notifications unavailable
                  </p>
                  <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
                    {notificationsError}
                  </p>
                </div>
              ) : notifications.length === 0 ? (
                <div className="px-4 py-5">
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    No notifications yet
                  </p>
                  <p className="mt-1 text-sm" style={{ color: "var(--color-ink-50)" }}>
                    Workflow updates will appear here as your applications move forward.
                  </p>
                </div>
              ) : (
                <div
                  role="list"
                  aria-label="Notifications list"
                  data-testid="notifications-scroll-region"
                  className="max-h-96 overflow-y-auto"
                >
                  {notifications.map((notification) => {
                    const tone = getNotificationTone(notification);
                    const isDisabled = notification.application_id === null;

                    return (
                      <div
                        key={notification.id}
                        role="listitem"
                        className="border-b last:border-b-0"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        <button
                          type="button"
                          onClick={() => handleNotificationSelect(notification)}
                          disabled={isDisabled}
                          className="flex w-full items-start gap-3 bg-transparent px-4 py-3 text-left transition-colors hover:bg-black/5 disabled:cursor-default disabled:hover:bg-transparent"
                        >
                          <span
                            className="mt-1 h-2.5 w-2.5 flex-none rounded-full"
                            style={{ background: tone.accent }}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-medium leading-5" style={{ color: "var(--color-ink)" }}>
                                {notification.message}
                              </p>
                              <span
                                className="shrink-0 text-[11px] font-medium uppercase tracking-[0.14em]"
                                style={{ color: "var(--color-ink-40)" }}
                              >
                                {formatNotificationTimestamp(notification.created_at)}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span
                                className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                                style={{
                                  background: tone.badgeBackground,
                                  color: tone.badgeColor,
                                }}
                              >
                                {tone.badgeLabel}
                              </span>
                              <span className="text-xs" style={{ color: "var(--color-ink-50)" }}>
                                {isDisabled ? "No linked application" : "Open application"}
                              </span>
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={toggleAvatarMenu}
            className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-all"
            style={{
              background: "var(--color-spruce)",
              color: "#fff",
              boxShadow: avatarOpen ? "0 0 0 2px var(--color-canvas), 0 0 0 4px var(--color-spruce)" : "none",
            }}
            aria-label="Account menu"
          >
            {initials}
          </button>

          {avatarOpen && (
            <div
              className="animate-scaleIn absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-xl border py-1"
              style={{
                background: "var(--color-white)",
                borderColor: "var(--color-border)",
                boxShadow: "var(--shadow-lg)",
                transformOrigin: "top right",
              }}
            >
              <div className="border-b px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
                <div className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                  {userName || "User"}
                </div>
                <div className="mt-0.5 text-xs" style={{ color: "var(--color-ink-50)" }}>
                  {userEmail}
                </div>
              </div>
              <div className="py-1">
                <button
                  onClick={() => {
                    setAvatarOpen(false);
                    navigate("/app/profile");
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm transition-colors"
                  style={{ color: "var(--color-ink-65)" }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = "var(--color-ink-05)";
                    event.currentTarget.style.color = "var(--color-ink)";
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = "transparent";
                    event.currentTarget.style.color = "var(--color-ink-65)";
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="5" r="3" />
                    <path d="M2 14c0-2.5 2.5-4.5 6-4.5s6 2 6 4.5" />
                  </svg>
                  Profile & Preferences
                </button>
                <button
                  onClick={() => void handleSignOut()}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm transition-colors"
                  style={{ color: "var(--color-ink-65)" }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = "var(--color-ink-05)";
                    event.currentTarget.style.color = "var(--color-ink)";
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = "transparent";
                    event.currentTarget.style.color = "var(--color-ink-65)";
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6M10.5 11.5L14 8l-3.5-3.5M14 8H6" />
                  </svg>
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
