import { createContext, useContext, useState, type PropsWithChildren } from "react";

export type ShellLayoutMode = "default" | "immersive";

type ShellLayoutContextValue = {
  mode: ShellLayoutMode;
  setMode: (mode: ShellLayoutMode) => void;
  clearMode: () => void;
};

const ShellLayoutContext = createContext<ShellLayoutContextValue | null>(null);

export function ShellLayoutProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<ShellLayoutMode>("default");

  return (
    <ShellLayoutContext.Provider
      value={{
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
