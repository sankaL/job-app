import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InteractiveTravelCard } from "@/components/ui/3d-card";

afterEach(cleanup);

it("keeps the access action keyboard-operable and the feature link in the invite flow", async () => {
  const onActionClick = vi.fn();
  const user = userEvent.setup();
  render(<InteractiveTravelCard title="AI tailoring" subtitle="Grounded in your resume."
    imageUrl="/feature.jpg" actionText="Request access" href="/signup" onActionClick={onActionClick} />);
  expect(screen.getByRole("link", { name: "Learn more about AI tailoring" })).toHaveAttribute("href", "/signup");
  const button = screen.getByRole("button", { name: "Request access" });
  button.focus();
  await user.keyboard("{Enter}");
  expect(onActionClick).toHaveBeenCalledOnce();
});
