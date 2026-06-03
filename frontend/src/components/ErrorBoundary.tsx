import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Top-level error boundary that catches React commit-phase errors caused by
 * browser extensions (Grammarly, Google Translate, password managers) injecting
 * or removing DOM nodes that React owns. These surface as
 * `removeChild` / `insertBefore` NotFoundError crashes.
 *
 * On catch, we reload the page to restore a clean DOM state rather than leaving
 * the user on a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    // Only auto-recover from the known browser-extension DOM mutation error.
    // All other errors surface the fallback UI so they aren't silently swallowed.
    const isDomMutationError =
      error &&
      (error instanceof DOMException ||
        error.name === "NotFoundError" ||
        error.message?.includes("removeChild") ||
        error.message?.includes("insertBefore"));

    if (isDomMutationError) {
      try {
        const now = Date.now();
        const lastReload = sessionStorage.getItem("last-dom-error-reload");
        if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
          sessionStorage.setItem("last-dom-error-reload", now.toString());
          // Reload so the browser extension starts fresh without a corrupted React tree.
          window.location.reload();
          return;
        }
        console.warn("ErrorBoundary: Suppressed automatic reload loop for DOM mutation error.");
      } catch (storageError) {
        // Handle SecurityError when sessionStorage is disabled (e.g. private mode)
        console.warn("ErrorBoundary: Failed to read/write sessionStorage:", storageError);
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center bg-canvas text-ink font-sans">
          <p className="text-lg font-semibold">Something went wrong.</p>
          <p className="text-sm font-medium" style={{ color: "var(--color-ink-65)" }}>
            Try disabling browser extensions (Grammarly, password managers) and reload.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-5 py-2.5 rounded-lg border-none text-sm font-semibold cursor-pointer bg-spruce text-white hover:opacity-90 active:scale-95 transition-all"
          >
            Reload page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

