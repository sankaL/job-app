import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SignupPage } from "@/routes/SignupPage";

const api = vi.hoisted(() => ({
  fetchInvitePreview: vi.fn(),
  acceptInvite: vi.fn(),
}));

const signInWithPassword = vi.fn();

vi.mock("@/lib/api", () => ({
  ...api,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword,
    },
  }),
}));

function renderSignup(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/app" element={<div>App Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("invite signup flow", () => {
  it("blocks weak passwords client-side before invite acceptance", async () => {
    api.fetchInvitePreview.mockResolvedValue({
      invited_email: "invitee@example.com",
      expires_at: "2026-04-17T00:00:00+00:00",
    });

    renderSignup("/signup?token=valid-token");

    await screen.findByText(/invite active/i);
    await userEvent.type(screen.getByLabelText(/first name/i), "Jane");
    await userEvent.type(screen.getByLabelText(/last name/i), "Doe");
    await userEvent.type(screen.getByLabelText(/location/i), "Toronto, ON");
    await userEvent.type(screen.getByLabelText(/^phone$/i), "555-0100");
    await userEvent.type(screen.getByLabelText(/^password$/i), "weakpass");
    await userEvent.type(screen.getByLabelText(/confirm password/i), "weakpass");

    await userEvent.click(screen.getByRole("button", { name: /create account and sign in/i }));

    await screen.findByText(/at least 12 characters/i);
    expect(api.acceptInvite).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("loads invite preview and pre-fills read-only email", async () => {
    api.fetchInvitePreview.mockResolvedValue({
      invited_email: "invitee@example.com",
      expires_at: "2026-04-17T00:00:00+00:00",
    });
    renderSignup("/signup?token=valid-token");

    await screen.findByText(/invite active/i);
    expect(api.fetchInvitePreview).toHaveBeenCalledWith("valid-token");
    expect(screen.getByDisplayValue("invitee@example.com")).toBeDisabled();
  });

  it("accepts invite then signs user in", async () => {
    api.fetchInvitePreview.mockResolvedValue({
      invited_email: "invitee@example.com",
      expires_at: "2026-04-17T00:00:00+00:00",
    });
    api.acceptInvite.mockResolvedValue({
      user_id: "user-1",
      email: "invitee@example.com",
    });
    signInWithPassword.mockResolvedValue({ error: null });

    renderSignup("/signup?token=valid-token");

    await screen.findByText(/invite active/i);
    await userEvent.type(screen.getByLabelText(/first name/i), "Jane");
    await userEvent.type(screen.getByLabelText(/last name/i), "Doe");
    await userEvent.type(screen.getByLabelText(/location/i), "Toronto, ON");
    await userEvent.type(screen.getByLabelText(/^phone$/i), "555-0100");
    await userEvent.type(screen.getByLabelText(/^password$/i), "StrongPass!123");
    await userEvent.type(screen.getByLabelText(/confirm password/i), "StrongPass!123");

    await userEvent.click(screen.getByRole("button", { name: /create account and sign in/i }));

    await waitFor(() => {
      expect(api.acceptInvite).toHaveBeenCalled();
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "invitee@example.com",
        password: "StrongPass!123",
      });
    });
  });
});
