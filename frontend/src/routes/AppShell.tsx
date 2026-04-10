import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AppProvider, useAppContext } from "@/components/layout/AppContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { ToastProvider } from "@/components/ui/toast";

function ShellContent() {
  const { bootstrapError } = useAppContext();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <div className="sidebar-desktop">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <>
          <div className="sidebar-overlay" onClick={() => setMobileSidebarOpen(false)} />
          <div className="sidebar-mobile">
            <Sidebar onNavigate={() => setMobileSidebarOpen(false)} />
          </div>
        </>
      )}

      <div className="main-with-sidebar flex flex-1 flex-col" style={{ marginLeft: "var(--sidebar-width)" }}>
        <TopBar onMenuToggle={() => setMobileSidebarOpen((v) => !v)} />

        <main className="app-shell-main flex-1">
          <div className="app-shell-content">
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
        <ShellContent />
      </ToastProvider>
    </AppProvider>
  );
}
