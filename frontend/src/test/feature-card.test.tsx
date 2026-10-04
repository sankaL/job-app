import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FeatureCard } from "@/components/ui/feature-card";

afterEach(cleanup);

it("opens the invite-only access request from the circular arrow using the keyboard", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><Routes>
    <Route path="/" element={<FeatureCard title="AI tailoring" description="Grounded in your resume."
      category="Tailor" tags={["Grounded AI"]} imageUrl="/feature.webp" icon={<span />} href="/signup" />} />
    <Route path="/signup" element={<h1>Request access</h1>} />
  </Routes></MemoryRouter>);
  await user.tab();
  expect(screen.getByRole("link", { name: "Request access for AI tailoring" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("heading", { name: "Request access" })).toBeInTheDocument();
});
