import { Component, type ReactNode, type RefObject } from "react";
import { gsap } from "gsap";

export type HandoffMode = "generation" | "draft" | "other";

type Snapshot = {
  ghost: HTMLElement;
  view: DOMRect;
  paper: DOMRect;
  scrollTop: number;
};

/** Every inline property the handoff sets on live elements; cleared when it ends or is interrupted. */
const HANDOFF_PROPS = "transform,translate,width,opacity,visibility";

function prefersReducedMotion() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

type HandoffProps = {
  mode: HandoffMode;
  scope: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** The processing view to clone. */
  viewSelector?: string;
  /** The workbench region that replaces it; holds the `.resume-sheet` and `.resume-index`. */
  regionSelector?: string;
  /** Region elements around the sheet that slide in last. */
  chromeSelector?: string;
};

/**
 * Plays the move from a finished processing view (generation or resume import) into the section
 * workbench. The processing view is cloned just before React removes it. The clone's strip or
 * card lifts away while the paper crossfades into the real resume sheet as the sheet moves into
 * place. The section index and the workbench chrome then slide in. Reduced motion switches instantly.
 */
export class GenerationHandoff extends Component<HandoffProps> {
  private stop: (() => void) | null = null;

  getSnapshotBeforeUpdate(previous: Readonly<{ mode: HandoffMode }>): Snapshot | null {
    if (previous.mode !== "generation" || this.props.mode !== "draft" || prefersReducedMotion()) return null;
    const view = this.props.scope.current?.querySelector<HTMLElement>(this.props.viewSelector ?? ".application-resume-placeholder");
    const paper = view?.querySelector<HTMLElement>(".resume-generation-paper");
    if (!view || !paper) return null;
    const ghost = view.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("aria-label");
    ghost.querySelectorAll("[id],[role],[aria-live]").forEach((element) => {
      element.removeAttribute("id");
      element.removeAttribute("role");
      element.removeAttribute("aria-live");
    });
    return { ghost, view: view.getBoundingClientRect(), paper: paper.getBoundingClientRect(), scrollTop: view.scrollTop };
  }

  componentDidUpdate(previous: Readonly<{ mode: HandoffMode }>, _state: unknown, snapshot: Snapshot | null) {
    if (snapshot) this.play(snapshot);
    // Leaving the draft mid-handoff (for example Re-upload) ends it, so the clone never covers the next view.
    else if (previous.mode !== this.props.mode) this.stop?.();
  }

  componentWillUnmount() {
    this.stop?.();
  }

  private play({ ghost, view, paper, scrollTop }: Snapshot) {
    this.stop?.();
    const region = this.props.scope.current?.querySelector<HTMLElement>(this.props.regionSelector ?? ".draft-workbench-region");
    const sheet = region?.querySelector<HTMLElement>(".resume-sheet");
    const host = this.props.scope.current?.closest<HTMLElement>("[data-astryx-theme]") ?? document.body;
    if (!region || !sheet) return;

    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("inert", "");
    ghost.dataset.testid = "generation-handoff-ghost";
    Object.assign(ghost.style, {
      position: "fixed", left: `${view.left}px`, top: `${view.top}px`, width: `${view.width}px`, height: `${view.height}px`,
      margin: "0", zIndex: "20", overflow: "hidden", pointerEvents: "none",
    });
    host.appendChild(ghost);
    ghost.scrollTop = scrollTop;
    // A transformed ancestor would offset a fixed element, so correct against where the clone actually landed.
    const landed = ghost.getBoundingClientRect();
    ghost.style.left = `${view.left * 2 - landed.left}px`;
    ghost.style.top = `${view.top * 2 - landed.top}px`;

    const target = sheet.getBoundingClientRect();
    const dx = target.left - paper.left;
    const dy = target.top - paper.top;
    const index = region.querySelector<HTMLElement>(".resume-index");
    const chrome = [...region.querySelectorAll<HTMLElement>(this.props.chromeSelector ?? ".draft-workbench > :not(.draft-workbench-content)")];
    const strip = ghost.querySelector<HTMLElement>("[data-testid='processing-strip']");
    const card = strip ? null : ghost.querySelector<HTMLElement>("[data-flip-id='processing-panel']");
    const ghostPaper = ghost.querySelector<HTMLElement>(".resume-generation-paper");
    const live = [sheet, index, ...chrome].filter((element): element is HTMLElement => Boolean(element));

    const timeline = gsap.timeline({ onComplete: () => this.stop?.() });
    if (strip) timeline.to(strip, { yPercent: -100, opacity: 0, duration: 0.4, ease: "power2.in" }, 0);
    // A centred card (no sections arrived first) rises and fades so the paper behind it takes focus.
    if (card) timeline.to(card, { y: -16, scale: 0.96, opacity: 0, duration: 0.35, ease: "power2.in" }, 0);
    // The old paper and the sheet travel together, so the swap reads as one surface. The clone's
    // frame stays put (it clips the paper) so it never slides over the details panel.
    if (ghostPaper) timeline.to(ghostPaper, { x: dx, y: dy, duration: 0.7, ease: "power3.inOut" }, 0.1);
    timeline.to(ghost, { opacity: 0, duration: 0.45, ease: "power1.inOut" }, 0.25)
      .fromTo(sheet, { x: -dx, y: -dy, width: paper.width, opacity: 0 }, {
        x: 0, y: 0, width: target.width, duration: 0.7, ease: "power3.inOut",
      }, 0.1)
      .to(sheet, { opacity: 1, duration: 0.4, ease: "power1.out" }, 0.25);
    if (index) timeline.from(index, { x: -24, opacity: 0, duration: 0.45, ease: "power2.out" }, 0.5);
    if (chrome.length) timeline.from(chrome, { y: 8, opacity: 0, duration: 0.35, stagger: 0.05, ease: "power2.out" }, 0.6);

    // An interrupted handoff jumps to its end and is cleared, so no clone or inline styles are left behind.
    this.stop = () => {
      this.stop = null;
      timeline.progress(1).kill();
      ghost.remove();
      gsap.set(live, { clearProps: HANDOFF_PROPS });
    };
  }

  render() {
    return this.props.children;
  }
}
