import { createContext, useContext, useCallback, useMemo, useState, type PropsWithChildren } from "react";

type ShellLayoutMode = "default" | "immersive";

type ShellLayoutContextValue = {
  actionHost: HTMLElement | null;
  setActionHost: (element: HTMLElement | null) => void;
  mode: ShellLayoutMode;
  setMode: (mode: ShellLayoutMode) => void;
  clearMode: () => void;
};

const ShellLayoutContext = createContext<ShellLayoutContextValue | null>(null);

export function ShellLayoutProvider({ children }: PropsWithChildren) {
  const [actionHost, setActionHost] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<ShellLayoutMode>("default");

  const clearMode = useCallback(() => {
    setMode("default");
  }, []);

  const value = useMemo(
    () => ({
      actionHost,
      setActionHost,
      mode,
      setMode,
      clearMode,
    }),
    [actionHost, mode, clearMode],
  );

  return (
    <ShellLayoutContext.Provider value={value}>
      {children}
    </ShellLayoutContext.Provider>
  );
}

export function useShellLayout() {
  const ctx = useContext(ShellLayoutContext);
  if (!ctx) {
    throw new Error("useShellLayout must be used inside ShellLayoutProvider");
  }
  return ctx;
}

export function usePageActionHost() {
  return useContext(ShellLayoutContext)?.actionHost ?? null;
}
