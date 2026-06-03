import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Component that throws a standard error
const ErrorThrower = ({ errorToThrow }: { errorToThrow: Error }) => {
  throw errorToThrow;
};

// Silence console.error in tests to keep output clean
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

describe("ErrorBoundary", () => {
  beforeEach(() => {
    console.error = vi.fn();
    console.warn = vi.fn();
    vi.stubGlobal("location", { reload: vi.fn() });
    
    // Simple sessionStorage mock
    let store: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    });
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    vi.restoreAllMocks();
  });

  it("renders children successfully when no error is thrown", () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Hello World</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("child")).toHaveTextContent("Hello World");
  });

  it("catches standard errors, does not reload, and displays fallback UI", () => {
    const error = new Error("Standard rendering error");
    render(
      <ErrorBoundary>
        <ErrorThrower errorToThrow={error} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.getByText(/Try disabling browser extensions/)).toBeInTheDocument();
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it("reloads page when DOMException removeChild error is thrown", () => {
    const domError = new DOMException("Failed to execute 'removeChild' on 'Node'", "NotFoundError");
    render(
      <ErrorBoundary>
        <ErrorThrower errorToThrow={domError} />
      </ErrorBoundary>,
    );

    expect(window.location.reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.setItem).toHaveBeenCalledWith("last-dom-error-reload", expect.any(String));
  });

  it("reloads page when standard Error containing NotFoundError / removeChild is thrown", () => {
    const error = new Error("NotFoundError: Failed to execute 'removeChild' on 'Node'");
    render(
      <ErrorBoundary>
        <ErrorThrower errorToThrow={error} />
      </ErrorBoundary>,
    );

    expect(window.location.reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.setItem).toHaveBeenCalledWith("last-dom-error-reload", expect.any(String));
  });

  it("suppresses automatic reload and shows fallback UI when reload loop is detected", () => {
    const domError = new DOMException("Failed to execute 'removeChild' on 'Node'", "NotFoundError");
    
    // Set a recent reload timestamp in sessionStorage
    const now = Date.now();
    sessionStorage.setItem("last-dom-error-reload", now.toString());

    render(
      <ErrorBoundary>
        <ErrorThrower errorToThrow={domError} />
      </ErrorBoundary>,
    );

    // Should NOT reload again since last reload was < 10 seconds ago
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });

  it("reloads if last reload was more than 10 seconds ago", () => {
    const domError = new DOMException("Failed to execute 'removeChild' on 'Node'", "NotFoundError");
    
    // Set an old reload timestamp in sessionStorage (e.g. 15 seconds ago)
    const oldTime = Date.now() - 15000;
    sessionStorage.setItem("last-dom-error-reload", oldTime.toString());

    render(
      <ErrorBoundary>
        <ErrorThrower errorToThrow={domError} />
      </ErrorBoundary>,
    );

    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it("handles storage security exceptions gracefully and shows fallback UI", () => {
    const domError = new DOMException("Failed to execute 'removeChild' on 'Node'", "NotFoundError");
    
    // Mock sessionStorage.getItem to throw (e.g. storage disabled / SecurityError)
    vi.spyOn(sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: sessionStorage is disabled");
    });

    render(
      <ErrorBoundary>
        <ErrorThrower errorToThrow={domError} />
      </ErrorBoundary>,
    );

    // Fallback UI should render, and reload should be bypassed/safe
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    expect(console.warn).toHaveBeenCalledWith(
      "ErrorBoundary: Failed to read/write sessionStorage:",
      expect.any(Error)
    );
  });
});
