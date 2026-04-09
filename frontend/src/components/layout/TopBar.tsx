import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppBreadcrumbs } from "@/components/layout/Breadcrumbs";
import { useAppContext } from "@/components/layout/AppContext";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function TopBar({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const navigate = useNavigate();
  const { bootstrap, needsActionCount } = useAppContext();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const userEmail = bootstrap?.user.email ?? "";
  const userName = bootstrap?.profile?.name ?? "";
  const initials = userName
    ? userName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : userEmail
      ? userEmail[0].toUpperCase()
      : "?";

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between border-b px-6"
      style={{
        height: "var(--topbar-height)",
        background: "var(--color-canvas)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Left: Mobile hamburger + Breadcrumbs */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="sidebar-mobile-toggle flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
            style={{ color: "var(--color-ink-50)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-ink-05)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            aria-label="Toggle sidebar"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          </button>
        )}
        <AppBreadcrumbs />
      </div>

      {/* Right: Notifications + Avatar */}
      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <button
          onClick={() => navigate("/app/applications")}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
          style={{ color: "var(--color-ink-50)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-ink-05)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
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

        {/* Avatar with dropdown */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setAvatarOpen(!avatarOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-all"
            style={{
              background: "var(--color-spruce)",
              color: "#fff",
              boxShadow: avatarOpen ? "0 0 0 2px var(--color-canvas), 0 0 0 4px var(--color-spruce)" : "none",
            }}
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
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--color-ink-05)";
                    e.currentTarget.style.color = "var(--color-ink)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--color-ink-65)";
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
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--color-ink-05)";
                    e.currentTarget.style.color = "var(--color-ink)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--color-ink-65)";
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
