import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAppContext } from "@/components/layout/AppContext";
import { Badge } from "@/components/ui/badge";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type NavItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  end?: boolean;
};

/* ── SVG Icons (inline, no deps) ── */
const IconDashboard = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="7" height="8" rx="1.5" />
    <rect x="11" y="2" width="7" height="5" rx="1.5" />
    <rect x="2" y="12" width="7" height="6" rx="1.5" />
    <rect x="11" y="9" width="7" height="9" rx="1.5" />
  </svg>
);

const IconApplications = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4h14M3 8h14M3 12h10M3 16h7" />
  </svg>
);

const IconResumes = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 2h7l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
    <path d="M12 2v4h4" />
    <path d="M7 10h6M7 13h4" />
  </svg>
);

const IconExtension = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2h4v3H8zM2 8h3v4H2zM15 8h3v4h-3zM8 15h4v3H8z" />
    <rect x="5" y="5" width="10" height="10" rx="1.5" />
  </svg>
);

const IconSignOut = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3M13 14l4-4-4-4M17 10H7" />
  </svg>
);

const IconAdmin = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2l2 2.5 3-.3.8 2.9 2.6 1.6-1.4 2.7 1.4 2.7-2.6 1.6-.8 2.9-3-.3L10 18l-2-2.5-3 .3-.8-2.9L1.6 11.3 3 8.6 1.6 5.9l2.6-1.6.8-2.9 3 .3L10 2z" />
    <path d="M10 7.5v5M7.5 10h5" />
  </svg>
);

const IconMetrics = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 16h14" />
    <path d="M6 16V9" />
    <path d="M10 16V5" />
    <path d="M14 16v-3" />
  </svg>
);

const IconUsers = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 17v-1a3 3 0 0 0-3-3H6.5a3 3 0 0 0-3 3v1" />
    <circle cx="9" cy="7" r="3" />
    <path d="M18 17v-1a2.5 2.5 0 0 0-2-2.45" />
    <path d="M14.5 4.6a2.5 2.5 0 0 1 0 4.8" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    className="transition-transform"
    style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
  >
    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type SidebarProps = {
  onNavigate?: () => void;
};

export function Sidebar({ onNavigate }: SidebarProps) {
  const { pathname } = useLocation();
  const { needsActionCount, bootstrap } = useAppContext();
  const isAdmin = Boolean(bootstrap?.profile?.is_admin);
  const isOnAdminRoute = pathname === "/app/admin" || pathname.startsWith("/app/admin/");
  const [adminExpanded, setAdminExpanded] = useState<boolean>(isOnAdminRoute);

  useEffect(() => {
    if (isOnAdminRoute) {
      setAdminExpanded(true);
    }
  }, [isOnAdminRoute]);

  const navItems: NavItem[] = [
    { to: "/app", label: "Dashboard", icon: <IconDashboard />, end: true },
    {
      to: "/app/applications",
      label: "Applications",
      icon: <IconApplications />,
      badge: needsActionCount > 0 ? needsActionCount : undefined,
    },
    { to: "/app/resumes", label: "Resumes", icon: <IconResumes /> },
    { to: "/app/extension", label: "Extension", icon: <IconExtension /> },
  ];

  const adminItems: NavItem[] = [
    { to: "/app/admin", label: "Metrics", icon: <IconMetrics />, end: true },
    { to: "/app/admin/users", label: "User Management", icon: <IconUsers /> },
  ];

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  return (
    <aside
      className="fixed left-0 top-0 z-30 flex min-h-screen flex-col border-r"
      style={{
        width: "var(--sidebar-width)",
        height: "100dvh",
        background: "var(--color-sidebar-bg)",
        borderColor: "var(--color-sidebar-border)",
      }}
    >
      <div className="flex h-16 items-center gap-2.5 px-5" style={{ borderBottom: "1px solid var(--color-sidebar-border)" }}>
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden">
          <img src="/applix-logo.svg" alt="Applix logo" className="h-8 w-8 object-contain" />
        </div>
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--color-sidebar-text-active)" }}>
            Applix
          </div>
          <div className="text-[11px]" style={{ color: "var(--color-sidebar-text)" }}>
            AI Job Applications
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive ? "sidebar-nav-active" : "sidebar-nav-item"
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? "var(--color-sidebar-bg-active)" : "transparent",
                color: isActive ? "var(--color-sidebar-text-active)" : "var(--color-sidebar-text)",
              })}
              onClick={onNavigate}
            >
              <span className="flex-shrink-0 transition-colors">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge ? <Badge count={item.badge} variant="warning" /> : null}
            </NavLink>
          ))}

          {isAdmin ? (
            <div className="pt-1">
              <div
                className="group flex items-center rounded-lg transition-all"
                style={{
                  background: isOnAdminRoute ? "var(--color-sidebar-bg-active)" : "transparent",
                  color: isOnAdminRoute ? "var(--color-sidebar-text-active)" : "var(--color-sidebar-text)",
                }}
                onMouseEnter={(event) => {
                  if (!isOnAdminRoute) {
                    event.currentTarget.style.background = "var(--color-sidebar-bg-hover)";
                  }
                }}
                onMouseLeave={(event) => {
                  if (!isOnAdminRoute) {
                    event.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <NavLink
                  to="/app/admin"
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-sm font-medium"
                  onClick={onNavigate}
                >
                  <span className="flex-shrink-0 transition-colors">
                    <IconAdmin />
                  </span>
                  <span className="truncate">Admin</span>
                </NavLink>
                <button
                  type="button"
                  aria-label={adminExpanded ? "Collapse admin menu" : "Expand admin menu"}
                  aria-expanded={adminExpanded}
                  className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setAdminExpanded((value) => !value);
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = "rgba(255,255,255,0.12)";
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = "transparent";
                  }}
                  style={{ color: "inherit" }}
                >
                  <IconChevron open={adminExpanded} />
                </button>
              </div>

              {adminExpanded ? (
                <div className="ml-4 mt-1 space-y-1 border-l pl-2.5" style={{ borderColor: "rgba(255,255,255,0.14)" }}>
                  {adminItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all ${
                          isActive ? "sidebar-nav-active" : "sidebar-nav-item"
                        }`
                      }
                      style={({ isActive }) => ({
                        background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
                        color: isActive ? "var(--color-sidebar-text-active)" : "var(--color-sidebar-text)",
                      })}
                      onClick={onNavigate}
                    >
                      <span className="flex-shrink-0 transition-colors">{item.icon}</span>
                      <span className="flex-1 truncate">{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </nav>

      <div className="px-3 pb-4">
        <button
          onClick={() => void handleSignOut()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all"
          style={{ color: "var(--color-sidebar-text)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--color-sidebar-bg-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <IconSignOut />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
