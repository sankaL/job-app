import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "@/routes/LoginPage";
import { supabaseOptions } from "@/lib/supabase";
import { workflowContract } from "@/lib/workflow-contract";

vi.mock("@/lib/env", () => ({
  env: {
    VITE_APP_ENV: "test",
    VITE_APP_DEV_MODE: true,
    VITE_SUPABASE_URL: "http://localhost:54321",
    VITE_SUPABASE_ANON_KEY: "anon-key",
    VITE_API_URL: "http://localhost:8000",
  },
}));

describe("frontend phase 0 auth shell", () => {
  it("renders the invite-only login surface", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Applix")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ai-powered resume tailoring/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enter the workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/local dev/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /applix logo/i })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /businessman seated with a laptop, representing the applix workspace/i }),
    ).toBeInTheDocument();
  });

  it("uses sessionStorage instead of localStorage for Supabase session persistence", () => {
    expect(supabaseOptions.auth.storage).toBe(window.sessionStorage);
    expect(supabaseOptions.auth.storage).not.toBe(window.localStorage);
  });

  it("loads the shared workflow contract from the repo-level artifact", () => {
    expect(workflowContract.visible_statuses.map((status) => status.id)).toEqual([
      "draft",
      "needs_action",
      "in_progress",
      "complete",
    ]);
  });
});
