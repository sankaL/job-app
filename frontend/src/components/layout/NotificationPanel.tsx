import { SkeletonLine } from "@/components/ui/skeleton";
import type { NotificationSummary } from "@/lib/api";

function formatNotificationTimestamp(createdAt: string) {
  const createdDate = new Date(createdAt);
  if (Number.isNaN(createdDate.getTime())) return createdAt;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(createdDate);
}

function getNotificationTone(notification: NotificationSummary) {
  if (notification.action_required) {
    return { accent: "var(--color-ember)", badgeBackground: "var(--color-ember-10)", badgeColor: "var(--color-ember)", badgeLabel: "Needs action" };
  }
  const tones = {
    success: { accent: "var(--color-spruce)", badgeBackground: "var(--color-spruce-05)", badgeColor: "var(--color-spruce)", badgeLabel: "Success" },
    warning: { accent: "var(--color-amber)", badgeBackground: "var(--color-amber-10)", badgeColor: "var(--color-amber)", badgeLabel: "Warning" },
    error: { accent: "var(--color-ember)", badgeBackground: "var(--color-ember-10)", badgeColor: "var(--color-ember)", badgeLabel: "Error" },
    info: { accent: "var(--color-ink-50)", badgeBackground: "var(--color-ink-05)", badgeColor: "var(--color-ink-65)", badgeLabel: "Info" },
  };
  return tones[notification.type as keyof typeof tones] ?? tones.info;
}

function NotificationRow({ notification, onSelect }: { notification: NotificationSummary; onSelect: (notification: NotificationSummary) => void }) {
  const tone = getNotificationTone(notification);
  const isDisabled = notification.application_id === null;
  return (
    <div role="listitem" className="border-b last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
      <button type="button" onClick={() => onSelect(notification)} disabled={isDisabled} className="flex w-full items-start gap-3 bg-transparent px-4 py-3 text-left transition-colors hover:bg-black/5 disabled:cursor-default disabled:hover:bg-transparent">
        <span className="mt-1 h-2.5 w-2.5 flex-none rounded-full" style={{ background: tone.accent }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium leading-5 text-[var(--color-ink)]">{notification.message}</p>
            <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-ink-40)]">{formatNotificationTimestamp(notification.created_at)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ background: tone.badgeBackground, color: tone.badgeColor }}>{tone.badgeLabel}</span>
            <span className="text-xs text-[var(--color-ink-50)]">{isDisabled ? "No linked application" : "Open application"}</span>
          </div>
        </div>
      </button>
    </div>
  );
}

function NotificationContent({ loading, error, notifications, onSelect }: { loading: boolean; error: string | null; notifications: NotificationSummary[]; onSelect: (notification: NotificationSummary) => void }) {
  if (loading) {
    return <div className="space-y-4 px-4 py-4">{Array.from({ length: 3 }, (_, index) => <div key={index} className="space-y-2"><SkeletonLine className="w-full" /><SkeletonLine className="w-4/5" /></div>)}</div>;
  }
  if (error) return <div className="px-4 py-5"><p className="text-sm font-semibold text-[var(--color-ember)]">Notifications unavailable</p><p className="mt-1 text-sm text-[var(--color-ink-65)]">{error}</p></div>;
  if (notifications.length === 0) return <div className="px-4 py-5"><p className="text-sm font-medium text-[var(--color-ink)]">No notifications yet</p><p className="mt-1 text-sm text-[var(--color-ink-50)]">Workflow updates will appear here as your applications move forward.</p></div>;
  return (
    <div role="list" aria-label="Notifications list" data-testid="notifications-scroll-region" className="max-h-96 overflow-y-auto">
      {notifications.map((notification) => <NotificationRow key={notification.id} notification={notification} onSelect={onSelect} />)}
    </div>
  );
}

export function NotificationPanel({ needsActionCount, notifications, loading, error, clearing, onClear, onSelect }: { needsActionCount: number; notifications: NotificationSummary[]; loading: boolean; error: string | null; clearing: boolean; onClear: () => void; onSelect: (notification: NotificationSummary) => void }) {
  const canClear = !loading && !error && notifications.length > 0;
  return (
    <div className="notification-panel-mobile animate-scaleIn absolute right-0 top-full mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border" style={{ background: "var(--color-white)", borderColor: "var(--color-border)", boxShadow: "var(--shadow-lg)", transformOrigin: "top right" }} role="dialog" aria-label="Notifications panel">
      <div className="border-b px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-start justify-between gap-3">
          <div><div className="text-sm font-semibold text-[var(--color-ink)]">Notifications</div><div className="mt-0.5 text-xs text-[var(--color-ink-50)]">{needsActionCount > 0 ? `${needsActionCount} item${needsActionCount === 1 ? "" : "s"} need attention` : "All caught up"}</div></div>
          <div className="flex items-center gap-3">
            {!loading && !error ? <span className="text-xs font-medium text-[var(--color-ink-40)]">{notifications.length}</span> : null}
            {canClear ? <button type="button" onClick={onClear} disabled={clearing} className="text-xs font-semibold text-[var(--color-spruce)] transition-colors hover:text-[var(--color-ink)] disabled:cursor-wait disabled:opacity-50">{clearing ? "Clearing..." : "Clear all"}</button> : null}
          </div>
        </div>
      </div>
      <NotificationContent loading={loading} error={error} notifications={notifications} onSelect={onSelect} />
    </div>
  );
}
