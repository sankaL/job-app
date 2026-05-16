import type React from "react";
import { render, screen } from "@testing-library/react";
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

  const [{ default: App }, { LoginPage }, { AuthProvider }, { ProtectedRoute }, { workflowContract }] =
    await Promise.all([
      import("@/App"),
      import("@/routes/LoginPage"),
      import("@/lib/auth"),
      import("@/routes/ProtectedRoute"),
      import("@/lib/workflow-contract"),
    ]);

  function renderWithAuth(element: React.ReactElement) {
    return render(<AuthProvider><MemoryRouter>{element}</MemoryRouter></AuthProvider>);
  }

  return {
    App,
    LoginPage,
    AuthProvider,
    ProtectedRoute,
    renderWithAuth,
    workflowContract,
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

    renderWithAuth(<LoginPage />);

    expect(screen.getByText("Applix")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ai-powered resume tailoring/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enter the workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/local dev/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /applix logo/i })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /businessman seated with a laptop, representing the applix workspace/i }),
    ).toBeInTheDocument();
  });

  it("opens at the login page without attempting a session refresh", async () => {
    const { App, AuthProvider } = await loadAuthFixtures("development", true);

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(screen.getByRole("heading", { name: /ai-powered resume tailoring/i })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
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
        headers: { "Content-Type": "application/json" },
        method: "POST",
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

  it("requires a password when local dev mode is off", async () => {
    const { LoginPage, renderWithAuth } = await loadAuthFixtures("development", false);

    renderWithAuth(<LoginPage />);

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
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
  });

  it("loads the shared workflow contract from the repo-level artifact", async () => {
    const { workflowContract } = await loadAuthFixtures("development", true);

    expect(workflowContract.visible_statuses.map((status) => status.id)).toEqual([
      "draft",
      "needs_action",
      "in_progress",
      "complete",
    ]);
  });
});
