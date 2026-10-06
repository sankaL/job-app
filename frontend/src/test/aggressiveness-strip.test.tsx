import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AggressivenessStrip } from "@/components/applications/AggressivenessStrip";
import { AGGRESSIVENESS_OPTIONS } from "@/lib/application-options";

function StripHarness({ initial = "medium" }: { initial?: string }) {
  const [aggressiveness, setAggressiveness] = useState(initial);
  return <AggressivenessStrip aggressiveness={aggressiveness} onAggressivenessChange={setAggressiveness} />;
}

const HIGH_WARNING = AGGRESSIVENESS_OPTIONS[2].warning;

describe("aggressiveness strip", () => {
  it("tints by level and never shows the High disclaimer inline", async () => {
    render(<StripHarness />);
    const strip = screen.getByRole("region", { name: "Aggressiveness" });
    expect(strip).toHaveAttribute("data-level", "medium");
    expect(screen.queryByText(HIGH_WARNING)).not.toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Aggressiveness" });
    slider.focus();
    await userEvent.keyboard("{Home}");
    expect(slider).toHaveAttribute("aria-valuetext", "Low");
    expect(strip).toHaveAttribute("data-level", "low");
  });

  it("asks the user to accept the risk before switching to High", async () => {
    render(<StripHarness />);
    const slider = screen.getByRole("slider", { name: "Aggressiveness" });
    slider.focus();
    await userEvent.keyboard("{End}");
    const dialog = screen.getByRole("dialog", { name: "Use High aggressiveness?" });
    expect(within(dialog).getByText(HIGH_WARNING)).toBeInTheDocument();
    expect(dialog.querySelector("svg")).not.toBeNull(); // The paper mascot.
    // Nothing changes until the user accepts.
    expect(slider).toHaveAttribute("aria-valuetext", "Medium");

    await userEvent.click(within(dialog).getByRole("button", { name: "Keep Medium" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(slider).toHaveAttribute("aria-valuetext", "Medium");

    slider.focus();
    await userEvent.keyboard("{End}");
    await userEvent.click(screen.getByRole("button", { name: "I accept the risk" }));
    expect(slider).toHaveAttribute("aria-valuetext", "High");
    expect(screen.getByRole("region", { name: "Aggressiveness" })).toHaveAttribute("data-level", "high");
    expect(screen.getByRole("button", { name: "High aggressiveness details" })).toHaveTextContent("High");
    expect(screen.queryByText(HIGH_WARNING)).not.toBeInTheDocument();
  });

  it("does not ask again for a saved High setting or when leaving High", async () => {
    render(<StripHarness initial="high" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Aggressiveness" });
    slider.focus();
    await userEvent.keyboard("{Home}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Aggressiveness" })).toHaveAttribute("aria-valuetext", "Low");
  });

  it("shows the current level's details in the badge tooltip and has no level buttons or Save", async () => {
    render(<StripHarness initial="low" />);
    expect(screen.queryByRole("button", { name: /^(Low|Medium|High) aggressiveness$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    const lowDetail = AGGRESSIVENESS_OPTIONS[0].details[0];
    expect(screen.getByText(lowDetail)).not.toBeVisible();
    await userEvent.hover(screen.getByRole("button", { name: "Low aggressiveness details" }));
    await waitFor(() => expect(screen.getByText(lowDetail)).toBeVisible());
  });
});
