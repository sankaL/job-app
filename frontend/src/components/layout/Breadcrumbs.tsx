import { useLocation, Link } from "react-router-dom";
import { useAppContext } from "@/components/layout/AppContext";

type CrumbOverride = {
  label: string;
};

type BreadcrumbsProps = {
  overrides?: Record<string, CrumbOverride>;
};

const DEFAULT_LABELS: Record<string, string> = {
  app: "Home",
  applications: "Applications",
  resumes: "Resumes",
  extension: "Extension",
  profile: "Profile",
  admin: "Admin",
  users: "User Management",
  new: "New",
  dashboard: "Dashboard",
};

export function Breadcrumbs({ overrides }: BreadcrumbsProps) {
  const { pathname } = useLocation();

  const segments = pathname.split("/").filter(Boolean);

  if (segments.length <= 1) {
    return (
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
        <span className="font-medium" style={{ color: "var(--color-ink)" }}>Home</span>
      </nav>
    );
  }

  const crumbs = segments.map((segment, index) => {
    const path = "/" + segments.slice(0, index + 1).join("/");
    const override = overrides?.[segment];
    const label = override?.label ?? DEFAULT_LABELS[segment] ?? decodeURIComponent(segment);
    const isLast = index === segments.length - 1;

    return { path, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm overflow-hidden">
      {crumbs.map((crumb, index) => (
        <span key={crumb.path || `crumb-${index}`} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0" style={{ color: "var(--color-ink-25)" }}>
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {crumb.isLast ? (
            <span className="truncate font-medium" style={{ color: "var(--color-ink)", maxWidth: "180px" }}>
              {crumb.label}
            </span>
          ) : (
            <Link
              to={crumb.path}
              className="truncate transition-colors hidden sm:inline"
              style={{ color: "var(--color-ink-50)", maxWidth: "120px" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-ink)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-ink-50)"; }}
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

/* Wrapper that uses app context for dynamic labels */
export function AppBreadcrumbs() {
  const { applications } = useAppContext();
  const { pathname } = useLocation();

  const overrides: Record<string, CrumbOverride> = {};

  // If we're on an application detail page, override the ID segment with company + title
  const appDetailMatch = pathname.match(/\/app\/applications\/([^/]+)/);
  if (appDetailMatch) {
    const appId = appDetailMatch[1];
    const app = applications?.find((a) => a.id === appId);
    if (app) {
      const label = [app.company, app.job_title].filter(Boolean).join(" — ") || "Application";
      overrides[appId] = { label };
    }
  }

  return <Breadcrumbs overrides={overrides} />;
}
