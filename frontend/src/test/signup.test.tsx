import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignupPage } from "@/routes/SignupPage";

const api = vi.hoisted(() => ({
  fetchInvitePreview: vi.fn(),
  acceptInvite: vi.fn(),
  submitAccessRequest: vi.fn(),
}));

const loginMock = vi.fn();

vi.mock("@/lib/api", () => ({
  ...api,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    login: loginMock,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

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
  it("shows a public access request form when no invite token is present", async () => {
    api.submitAccessRequest.mockResolvedValue({
      status: "submitted",
      message: "Access request submitted.",
    });

    renderSignup("/signup");

    expect(screen.getByRole("heading", { name: /request access to applix/i })).toBeInTheDocument();
    expect(api.fetchInvitePreview).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/full name/i), "Jane Doe");
    await userEvent.type(screen.getByLabelText(/^email$/i), "jane@example.com");
    await userEvent.selectOptions(screen.getByLabelText(/plan/i), "pro");
    await userEvent.type(screen.getByLabelText(/note/i), "I am applying to product roles.");
    await userEvent.click(screen.getByRole("button", { name: /send access request/i }));

    await waitFor(() => {
      expect(api.submitAccessRequest).toHaveBeenCalledWith({
        full_name: "Jane Doe",
        email: "jane@example.com",
        interested_plan: "pro",
        note: "I am applying to product roles.",
      });
    });
    expect(screen.getByText(/request sent/i)).toBeInTheDocument();
  });

  it("shows loading feedback and prevents repeat submits while an access request is pending", async () => {
    let resolveRequest:
      | ((value: { status: string; message: string }) => void)
      | undefined;
    api.submitAccessRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    renderSignup("/signup");

    await userEvent.type(screen.getByLabelText(/full name/i), "Jane Doe");
    await userEvent.type(screen.getByLabelText(/^email$/i), "jane@example.com");
    const form = screen.getByRole("button", { name: /send access request/i }).closest("form");
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(screen.getByRole("button", { name: /sending request/i })).toBeDisabled();
    expect(api.submitAccessRequest).toHaveBeenCalledTimes(1);

    expect(resolveRequest).toBeDefined();
    resolveRequest!({
      status: "submitted",
      message: "Access request submitted.",
    });

    await screen.findByText(/request sent/i);
  });

  it("surfaces public access request server errors", async () => {
    api.submitAccessRequest.mockRejectedValue(new Error("Access request processing is currently unavailable."));

    renderSignup("/signup");

    await userEvent.type(screen.getByLabelText(/full name/i), "Jane Doe");
    await userEvent.type(screen.getByLabelText(/^email$/i), "jane@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send access request/i }));

    expect(
      await screen.findByText(/access request processing is currently unavailable/i),
    ).toBeInTheDocument();
  });

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
    expect(loginMock).not.toHaveBeenCalled();
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
    loginMock.mockResolvedValue(undefined);

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
      expect(loginMock).toHaveBeenCalledWith("invitee@example.com", "StrongPass!123");
    });
  });
});
