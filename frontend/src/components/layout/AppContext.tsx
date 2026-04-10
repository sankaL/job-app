import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import { fetchSessionBootstrap, listApplications, type ApplicationSummary, type SessionBootstrapResponse } from "@/lib/api";

type AppContextValue = {
  bootstrap: SessionBootstrapResponse | null;
  bootstrapError: string | null;
  applications: ApplicationSummary[] | null;
  refreshApplications: () => Promise<ApplicationSummary[] | null>;
  needsActionCount: number;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be inside AppProvider");
  return ctx;
}

export function AppProvider({ children }: PropsWithChildren) {
  const [bootstrap, setBootstrap] = useState<SessionBootstrapResponse | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [applications, setApplications] = useState<ApplicationSummary[] | null>(null);

  async function refreshApplications() {
    try {
      const response = await listApplications();
      setApplications(response);
      return response;
    } catch {
      // Preserve the last known shell state when the refresh request fails.
      return null;
    }
  }

  useEffect(() => {
    fetchSessionBootstrap()
      .then((response) => {
        setBootstrap(response);
        setBootstrapError(null);
      })
      .catch((err: Error) => {
        setBootstrapError(err.message);
      });
  }, []);

  useEffect(() => {
    void refreshApplications();
  }, []);

  const needsActionCount = applications
    ? applications.filter(
        (a) => a.visible_status === "needs_action" || a.has_action_required_notification || a.has_unresolved_duplicate,
      ).length
    : 0;

  return (
    <AppContext.Provider
      value={{
        bootstrap,
        bootstrapError,
        applications,
        refreshApplications,
        needsActionCount,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
