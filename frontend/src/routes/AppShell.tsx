import { Outlet } from "react-router-dom";
import { AppProvider, useAppContext } from "@/components/layout/AppContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";

function ShellContent() {
  const { bootstrapError } = useAppContext();

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex flex-1 flex-col" style={{ marginLeft: "var(--sidebar-width)" }}>
        <TopBar />

        <main className="flex-1 px-6 py-6">
          <div className="mx-auto max-w-[1200px]">
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
      <ShellContent />
    </AppProvider>
  );
}
