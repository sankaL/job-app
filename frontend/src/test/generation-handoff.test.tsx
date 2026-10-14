import { act, render } from "@testing-library/react";
import { gsap } from "gsap";
import { useRef } from "react";
import { expect, it } from "vitest";
import { GenerationHandoff, type HandoffMode } from "@/components/applications/GenerationHandoff";

function Column({ mode, card = false }: { mode: HandoffMode; card?: boolean }) {
  const scope = useRef<HTMLDivElement>(null);
  return (
    <div ref={scope}>
      <GenerationHandoff mode={mode} scope={scope}>
        {mode === "generation" ? (
          <div className="application-resume-placeholder" aria-label="Resume generation workspace">
            {card
              ? <div data-flip-id="processing-panel" role="status">Reading and structuring your resume</div>
              : <div data-testid="processing-strip" data-flip-id="processing-panel" role="status">Preparing your tailored resume</div>}
            <div className="resume-generation-paper">Partial sections</div>
          </div>
        ) : (
          <section className="draft-workbench-region">
            <div className="draft-workbench">
              <div className="draft-workbench-content">
                <div className="resume-workbench">
                  <aside className="resume-index">Resume sections</aside>
                  <div className="resume-sheet">Full resume</div>
                </div>
              </div>
              <div data-testid="workbench-footer">All changes saved</div>
            </div>
          </section>
        )}
      </GenerationHandoff>
    </div>
  );
}

/** Jump every running GSAP animation to its end, as the browser would after it plays. */
function finishAnimations() {
  act(() => gsap.globalTimeline.getChildren(false, true, true).forEach((animation) => animation.progress(1)));
}

const ghost = () => document.querySelector("[data-testid='generation-handoff-ghost']");
const liveStyles = () => [".resume-sheet", ".resume-index", "[data-testid='workbench-footer']"]
  .map((selector) => document.querySelector(selector)?.getAttribute("style") ?? "")
  .filter(Boolean);

it("hands the finished generation view off to the workbench and cleans up", () => {
  const { rerender } = render(<Column mode="generation" />);
  rerender(<Column mode="draft" />);
  const clone = ghost();
  expect(clone).not.toBeNull();
  expect(clone).toHaveAttribute("aria-hidden", "true");
  expect(clone?.querySelector("[role],[aria-label]")).toBeNull();
  finishAnimations();
  expect(ghost()).toBeNull();
  expect(liveStyles()).toEqual([]);
});

it("lifts a centred card away when no strip is showing", () => {
  const { rerender } = render(<Column mode="generation" card />);
  rerender(<Column mode="draft" card />);
  const panel = ghost()?.querySelector<HTMLElement>("[data-flip-id='processing-panel']");
  expect(panel).toBeTruthy();
  act(() => gsap.globalTimeline.getChildren(false, true, true).forEach((animation) => animation.progress(0.5)));
  expect(panel?.style.opacity).not.toBe("");
  finishAnimations();
  expect(ghost()).toBeNull();
  expect(liveStyles()).toEqual([]);
});

it("ends the handoff when the draft is left mid-animation", () => {
  const { rerender } = render(<Column mode="generation" />);
  rerender(<Column mode="draft" />);
  expect(ghost()).not.toBeNull();
  rerender(<Column mode="other" />);
  expect(ghost()).toBeNull();
});

it("only plays when generation gives way to the draft", () => {
  const { rerender } = render(<Column mode="other" />);
  rerender(<Column mode="draft" />);
  expect(ghost()).toBeNull();
});

it("removes the clone and styles when unmounted mid-handoff", () => {
  const { rerender, unmount } = render(<Column mode="generation" />);
  rerender(<Column mode="draft" />);
  unmount();
  expect(ghost()).toBeNull();
});

it("switches without motion when reduced motion is preferred", () => {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes("prefers-reduced-motion") })) as typeof window.matchMedia;
  try {
    const { rerender } = render(<Column mode="generation" />);
    rerender(<Column mode="draft" />);
    expect(ghost()).toBeNull();
    expect(liveStyles()).toEqual([]);
  } finally {
    window.matchMedia = original;
  }
});
