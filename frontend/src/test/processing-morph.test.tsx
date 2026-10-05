import { act, render, screen } from "@testing-library/react";
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { afterEach, expect, it, vi } from "vitest";
import { ResumeProcessing } from "@/components/ui/resume-processing";

afterEach(() => vi.restoreAllMocks());

function view(layout: "card" | "strip") {
  return <ResumeProcessing title="Preparing your tailored resume" message="Writing sections" layout={layout} sessionKey="generation:job-1" />;
}

/** Jump every running GSAP animation to its end, as the browser would after it plays. */
function finishAnimations() {
  act(() => gsap.globalTimeline.getChildren(false, true, true).forEach((animation) => animation.progress(1)));
}

function inlineStyles() {
  return [...document.querySelectorAll("[data-flip-id],[data-processing-fade]")]
    .map((element) => `${element.getAttribute("data-flip-id") ?? element.tagName}: ${element.getAttribute("style") ?? ""}`)
    .filter((entry) => !entry.endsWith(": "))
    .map((entry) => entry)
    .filter(Boolean);
}

it("morphs the card into the strip and leaves no inline animation styles behind", () => {
  const morph = vi.spyOn(Flip, "from");
  const { rerender } = render(view("card"));
  expect(morph).not.toHaveBeenCalled();
  rerender(view("strip"));
  expect(morph).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("processing-strip")).toBeInTheDocument();
  finishAnimations();
  expect(inlineStyles()).toEqual([]);
});

it("finishes an interrupted morph cleanly when the layout flips back and forth", () => {
  const { rerender } = render(view("card"));
  rerender(view("strip"));
  rerender(view("card"));
  rerender(view("strip"));
  finishAnimations();
  expect(screen.getByTestId("processing-strip")).toBeInTheDocument();
  expect(inlineStyles()).toEqual([]);
});

it("switches without motion when reduced motion is preferred", () => {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes("prefers-reduced-motion") })) as typeof window.matchMedia;
  try {
    const morph = vi.spyOn(Flip, "from");
    const { rerender } = render(view("card"));
    rerender(view("strip"));
    expect(morph).not.toHaveBeenCalled();
    expect(screen.getByTestId("processing-strip")).toBeInTheDocument();
    expect(inlineStyles()).toEqual([]);
  } finally {
    window.matchMedia = original;
  }
});
