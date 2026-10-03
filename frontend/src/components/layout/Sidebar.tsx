import {
  forwardRef,
  useEffect,
  useState,
  type AnchorHTMLAttributes,
} from "react";
import {
  BarChart3,
  CreditCard,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Puzzle,
  Settings2,
  Users,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { SideNav, SideNavItem } from "@astryxdesign/core/SideNav";
import { useAppContext } from "@/components/layout/AppContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

const RouterLink = forwardRef<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement>
>(function RouterLink({ href, ...props }, ref) {
  return <Link ref={ref} to={href ?? "/app"} {...props} />;
});

export function Sidebar({
  onNavigate,
  inDrawer = false,
}: {
  onNavigate?: () => void;
  inDrawer?: boolean;
}) {
  const { pathname } = useLocation();
  const { needsActionCount, bootstrap } = useAppContext();
  const { logout } = useAuth();
  const onAdminRoute =
    pathname === "/app/admin" || pathname.startsWith("/app/admin/");
  const [adminCollapsed, setAdminCollapsed] = useState(!onAdminRoute);
  useEffect(() => {
    if (onAdminRoute) setAdminCollapsed(false);
  }, [onAdminRoute]);

  const destinations = [
    {
      href: "/app",
      label: "Dashboard",
      icon: <LayoutDashboard size={18} />,
      selected: pathname === "/app",
    },
    {
      href: "/app/applications",
      label: "Applications",
      icon: <ListChecks size={18} />,
      selected: pathname.startsWith("/app/applications"),
      endContent:
        needsActionCount > 0 ? (
          <Badge count={needsActionCount} variant="warning" />
        ) : undefined,
    },
    {
      href: "/app/resumes",
      label: "Resumes",
      icon: <FileText size={18} />,
      selected: pathname.startsWith("/app/resumes"),
    },
    {
      href: "/app/extension",
      label: "Extension",
      icon: <Puzzle size={18} />,
      selected: pathname === "/app/extension",
    },
  ];
  return (
    <SideNav
      aria-label="Primary navigation"
      className="app-sidebar"
      style={{ width: inDrawer ? "100%" : "var(--sidebar-width)" }}
      footer={
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            void logout();
            onNavigate?.();
          }}
        >
          <LogOut size={18} aria-hidden="true" />
          Sign Out
        </Button>
      }
    >
      {destinations.map(({ selected, ...item }) => (
        <SideNavItem
          key={item.href}
          {...item}
          as={RouterLink}
          isSelected={selected}
          onClick={onNavigate}
        />
      ))}
      {bootstrap?.profile?.is_admin ? (
        <SideNavItem
          as={RouterLink}
          href="/app/admin"
          label="Admin"
          icon={<Settings2 size={18} />}
          isSelected={onAdminRoute}
          onClick={onNavigate}
          collapsible={{
            isCollapsed: adminCollapsed,
            onCollapsedChange: setAdminCollapsed,
          }}
        >
          {[
            {
              href: "/app/admin",
              label: "Metrics",
              icon: <BarChart3 size={18} />,
            },
            {
              href: "/app/admin/users",
              label: "User Management",
              icon: <Users size={18} />,
            },
            {
              href: "/app/admin/subscriptions",
              label: "Subscriptions",
              icon: <CreditCard size={18} />,
            },
          ].map((item) => (
            <SideNavItem
              key={item.href}
              {...item}
              as={RouterLink}
              size="sm"
              isSelected={pathname === item.href}
              onClick={onNavigate}
            />
          ))}
        </SideNavItem>
      ) : null}
    </SideNav>
  );
}
