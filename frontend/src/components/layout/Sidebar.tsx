import { NavLink, useNavigate } from "react-router-dom";
import { useAppContext } from "@/components/layout/AppContext";
import { Badge } from "@/components/ui/badge";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type NavItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
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

export function Sidebar() {
  const navigate = useNavigate();
  const { needsActionCount } = useAppContext();

  const navItems: NavItem[] = [
    { to: "/app", label: "Dashboard", icon: <IconDashboard /> },
    {
      to: "/app/applications",
      label: "Applications",
      icon: <IconApplications />,
      badge: needsActionCount > 0 ? needsActionCount : undefined,
    },
    { to: "/app/resumes", label: "Resumes", icon: <IconResumes /> },
    { to: "/app/extension", label: "Extension", icon: <IconExtension /> },
  ];

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  return (
    <aside
      className="fixed left-0 top-0 z-30 flex h-screen flex-col border-r"
      style={{
        width: "var(--sidebar-width)",
        background: "var(--color-sidebar-bg)",
        borderColor: "var(--color-sidebar-border)",
      }}
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 px-5" style={{ borderBottom: "1px solid var(--color-sidebar-border)" }}>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold"
          style={{ background: "var(--color-spruce-light)", color: "#fff" }}
        >
          RB
        </div>
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--color-sidebar-text-active)" }}>
            Resume Builder
          </div>
          <div className="text-[11px]" style={{ color: "var(--color-sidebar-text)" }}>
            AI Workspace
          </div>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/app"}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? "sidebar-nav-active"
                    : "sidebar-nav-item"
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? "var(--color-sidebar-bg-active)" : "transparent",
                color: isActive ? "var(--color-sidebar-text-active)" : "var(--color-sidebar-text)",
              })}
            >
              <span className="flex-shrink-0 transition-colors">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge ? <Badge count={item.badge} variant="warning" /> : null}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Footer */}
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
