import { createContext, useContext, useState, type PropsWithChildren } from "react";

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

  return (
    <ShellLayoutContext.Provider
      value={{
        actionHost,
        setActionHost,
        mode,
        setMode,
        clearMode: () => setMode("default"),
      }}
    >
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
