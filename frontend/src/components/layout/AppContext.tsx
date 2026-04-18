import { createContext, useContext, type PropsWithChildren } from "react";
import type { SessionBootstrapResponse } from "@/lib/api";
import { useBootstrapQuery } from "@/lib/queries";

type AppContextValue = {
  bootstrap: SessionBootstrapResponse | null;
  bootstrapError: string | null;
  applicationSummary: SessionBootstrapResponse["application_summary"] | null;
  needsActionCount: number;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be inside AppProvider");
  return ctx;
}

export function AppProvider({ children }: PropsWithChildren) {
  const { data: bootstrap, error } = useBootstrapQuery();
  const bootstrapError = error instanceof Error ? error.message : null;
  const applicationSummary = bootstrap?.application_summary ?? null;
  const needsActionCount = applicationSummary?.needs_action_count ?? 0;

  return (
    <AppContext.Provider
      value={{
        bootstrap: bootstrap ?? null,
        bootstrapError,
        applicationSummary,
        needsActionCount,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
