import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { AppProvider, useAppContext } from "@/components/layout/AppContext";
import { ShellLayoutProvider, useShellLayout } from "@/components/layout/ShellLayoutContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { ToastProvider } from "@/components/ui/toast";

function ShellContent() {
  const { bootstrapError } = useAppContext();
  const { mode } = useShellLayout();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const immersive = mode === "immersive";

  useEffect(() => {
    if (immersive) {
      setMobileSidebarOpen(false);
    }
  }, [immersive]);

  return (
    <div className="app-shell-root flex min-h-screen overflow-x-hidden" data-shell-mode={mode}>
      {/* Desktop sidebar */}
      <div className="sidebar-desktop app-shell-sidebar-desktop">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {!immersive && mobileSidebarOpen && (
        <>
          <div className="sidebar-overlay" onClick={() => setMobileSidebarOpen(false)} />
          <div className="sidebar-mobile">
            <Sidebar onNavigate={() => setMobileSidebarOpen(false)} />
          </div>
        </>
      )}

      <div
        className="main-with-sidebar app-shell-frame min-w-0 flex flex-1 flex-col"
        style={{ marginLeft: immersive ? 0 : "var(--sidebar-width)" }}
      >
        <TopBar onMenuToggle={immersive ? undefined : () => setMobileSidebarOpen((v) => !v)} />

        <main className="app-shell-main flex-1" style={{ overflowX: "hidden" }}>
          <div className="app-shell-content" style={{ maxWidth: "100%", overflowX: "hidden" }}>
            {bootstrapError ? (
              <Card variant="danger" className="mb-6">
                <p className="text-sm font-semibold" style={{ color: "var(--color-ember)" }}>
                  Session bootstrap failed
                </p>
                <p className="mt-1 text-sm" style={{ color: "var(--color-ink-65)" }}>
                  {bootstrapError}
                </p>
              </Card>
            ) : null}

            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export function AppShell() {
  return (
    <AppProvider>
      <ToastProvider>
        <ShellLayoutProvider>
          <ShellContent />
        </ShellLayoutProvider>
      </ToastProvider>
    </AppProvider>
  );
}
