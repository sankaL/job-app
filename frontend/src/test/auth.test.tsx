import { StrictMode, type ReactElement } from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadAuthFixtures(appEnv = "development", appDevMode = false) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      VITE_APP_ENV: appEnv,
      VITE_APP_DEV_MODE: appDevMode,
      VITE_API_URL: "http://localhost:8000",
    },
  }));

  const [{ default: App }, { LoginPage }, { LandingPage }, { AuthProvider }, { ProtectedRoute }] =
    await Promise.all([
      import("@/App"),
      import("@/routes/LoginPage"),
      import("@/routes/LandingPage"),
      import("@/lib/auth"),
      import("@/routes/ProtectedRoute"),
    ]);

  function renderWithAuth(element: ReactElement) {
    return render(<AuthProvider><MemoryRouter>{element}</MemoryRouter></AuthProvider>);
  }

  return {
    App,
    LoginPage,
    LandingPage,
    AuthProvider,
    ProtectedRoute,
    renderWithAuth,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("frontend phase 0 auth shell", () => {
  it("renders the invite-only login surface", async () => {
    const { LoginPage, renderWithAuth } = await loadAuthFixtures("development", true);

    await act(async () => {
      renderWithAuth(<LoginPage />);
    });

    expect(screen.getByText("Applix")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ai-powered resume tailoring/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enter the workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/local dev/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /applix logo/i })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /businessman seated with a laptop, representing the applix workspace/i }),
    ).toBeInTheDocument();
  });

  it("opens at the landing page and attempts a session refresh", async () => {
    const { App, AuthProvider } = await loadAuthFixtures("development", true);
    const fetchMock = vi.mocked(fetch);

    await act(async () => {
      render(
        <AuthProvider>
          <MemoryRouter initialEntries={["/"]}>
            <App />
          </MemoryRouter>
        </AuthProvider>,
      );
    });

    expect(screen.getByRole("heading", { name: /tailor your resume for your dream role in seconds/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^login$/i })[0]).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: /^sign up$/i })[0]).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("heading", { name: /designed for serious job seekers/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /simple beta pricing/i })).toBeInTheDocument();
    expect(screen.getByText(/grounded AI agent tailoring/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request pro access/i })).toHaveAttribute("href", "/signup");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/auth/refresh",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("redirects to /app when landing page is loaded with an active session", async () => {
    const { LandingPage, AuthProvider } = await loadAuthFixtures("development", true);
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "token-123",
            token_type: "bearer",
            expires_in: 900,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "user-123",
            email: "session-active@example.com",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    await act(async () => {
      render(
        <AuthProvider>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/app" element={<div>Target workspace</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>,
      );
    });

    expect(await screen.findByText("Target workspace")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/auth/refresh",
      expect.any(Object),
    );
  });

  it("redirects to /app when login page is loaded with an active session", async () => {
    const { LoginPage, AuthProvider } = await loadAuthFixtures("development", true);
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "token-123",
            token_type: "bearer",
            expires_in: 900,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "user-123",
            email: "session-active@example.com",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    await act(async () => {
      render(
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/app" element={<div>Target workspace</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>,
      );
    });

    expect(await screen.findByText("Target workspace")).toBeInTheDocument();
  });

  it("restores an existing session only when a protected route is visited", async () => {
    const { AuthProvider, ProtectedRoute } = await loadAuthFixtures("development", true);
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "token-123",
            token_type: "bearer",
            expires_in: 900,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "user-1",
            email: "invite-only@example.com",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/app"]}>
          <Routes>
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <div>Protected workspace</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(screen.getByText(/checking your invite-only session/i)).toBeInTheDocument();
    expect(await screen.findByText("Protected workspace")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/auth/refresh",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8000/api/auth/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer token-123" },
      }),
    );
  });

  it("restores an existing session after a protected-route refresh in React StrictMode", async () => {
    const { AuthProvider, ProtectedRoute } = await loadAuthFixtures("development", true);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input) => {
      const url = input.toString();
      if (url.endsWith("/api/auth/refresh")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "token-123",
              token_type: "bearer",
              expires_in: 900,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.endsWith("/api/auth/me")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "user-1",
              email: "invite-only@example.com",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(
      <StrictMode>
        <AuthProvider>
          <MemoryRouter initialEntries={["/app"]}>
            <Routes>
              <Route path="/login" element={<div>Login screen</div>} />
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <div>Protected workspace</div>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </StrictMode>,
    );

    expect(screen.getByText(/checking your invite-only session/i)).toBeInTheDocument();
    expect(await screen.findByText("Protected workspace")).toBeInTheDocument();
    expect(screen.queryByText("Login screen")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/auth/refresh",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("requires a password when local dev mode is off", async () => {
    const { LoginPage, renderWithAuth } = await loadAuthFixtures("development", false);

    await act(async () => {
      renderWithAuth(<LoginPage />);
    });

    const passwordInput = screen.getByLabelText("Password");
    expect(passwordInput).toBeEnabled();
    expect(passwordInput).toBeRequired();
    expect(screen.queryByText(/auth disabled/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/local dev/i)).not.toBeInTheDocument();
  });

  it("refreshes when the cached access token has expired", async () => {
    await loadAuthFixtures("development", true);
    const { setAccessToken, getAccessToken } = await import("@/lib/auth");

    setAccessToken("expired-token", 0);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "fresh-token",
          token_type: "bearer",
          expires_in: 900,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(getAccessToken()).resolves.toBe("fresh-token");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/auth/refresh",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns to login when the protected-route refresh request hangs", async () => {
    const { AuthProvider, ProtectedRoute } = await loadAuthFixtures("development", true);
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/app"]}>
          <Routes>
            <Route path="/login" element={<div>Login screen</div>} />
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <div>Protected workspace</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(screen.getByText(/checking your invite-only session/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_100);
    });

    expect(screen.getByText("Login screen")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("loads the shared workflow contract from the repo-level artifact", async () => {
    await loadAuthFixtures("development", true);
    const { default: workflowContract } = await import("@/lib/workflow-contract.json");

    expect(workflowContract.visible_statuses.map((status) => status.id)).toEqual([
      "draft",
      "needs_action",
      "in_progress",
      "complete",
    ]);
  });

  it("only attempts to refresh session once and caches failure to prevent API spam", async () => {
    await loadAuthFixtures("development", true);
    const { getAccessToken } = await import("@/lib/auth");
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValueOnce(
      new Response("", { status: 401 }),
    );

    await expect(getAccessToken()).rejects.toThrow("Missing authenticated session.");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(getAccessToken()).rejects.toThrow("Missing authenticated session.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps transient refresh throttling and outages retryable", async () => {
    await loadAuthFixtures("development", true);
    const { getAccessToken } = await import("@/lib/auth");
    const fetchMock = vi.mocked(fetch);

    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }));

    await expect(getAccessToken()).rejects.toThrow("Missing authenticated session.");
    await expect(getAccessToken()).rejects.toThrow("Missing authenticated session.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
