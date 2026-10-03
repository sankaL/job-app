import { MobileNav } from "@astryxdesign/core/MobileNav";
import { Text } from "@astryxdesign/core/Text";
import { AppShell as AstryxAppShell } from "@astryxdesign/core/AppShell";
import { Theme } from "@astryxdesign/core/theme";
import { applixTheme } from "@/themes/applix";
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { AppProvider, useAppContext } from "@/components/layout/AppContext";
import {
  ShellLayoutProvider,
  useShellLayout,
} from "@/components/layout/ShellLayoutContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { Section } from "@/components/ui/card";
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
    <AstryxAppShell
      className="app-shell-root"
      data-shell-mode={mode}
      variant="section"
      height="auto"
      contentPadding={0}
      sideNav={
        immersive ? undefined : (
          <Sidebar onNavigate={() => setMobileSidebarOpen(false)} />
        )
      }
      topNav={<TopBar />}
      mobileNav={
        immersive
          ? false
          : {
              hasToggle: false,
              isOpen: mobileSidebarOpen,
              onOpenChange: setMobileSidebarOpen,
              breakpoint: "md",
              content: (
                <MobileNav header="Applix" side="start">
                  <Sidebar
                    inDrawer
                    onNavigate={() => setMobileSidebarOpen(false)}
                  />
                </MobileNav>
              ),
            }
      }
    >
      <div className="app-shell-content">
        {bootstrapError ? (
          <Section variant="danger" className="mb-6">
            <Text
              as="p"
              display="block"
              type="label"
              className="text-[var(--color-error)]"
            >
              Session bootstrap failed
            </Text>
            <Text
              as="p"
              display="block"
              type="body"
              className="mt-1 text-[var(--color-text-secondary)]"
            >
              {bootstrapError}
            </Text>
          </Section>
        ) : null}
        <Outlet />
      </div>
    </AstryxAppShell>
  );
}

export function AppShell() {
  return (
    <Theme theme={applixTheme} mode="light">
      <AppProvider>
        <ToastProvider>
          <ShellLayoutProvider>
            <ShellContent />
          </ShellLayoutProvider>
        </ToastProvider>
      </AppProvider>
    </Theme>
  );
}
