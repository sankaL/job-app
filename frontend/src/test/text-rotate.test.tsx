import { createRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useReducedMotion } from "motion/react";
import { TextRotate, type TextRotateRef } from "@/components/ui/text-rotate";

vi.mock("motion/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("motion/react")>(),
  useReducedMotion: vi.fn(() => false),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(useReducedMotion).mockReturnValue(false);
});

describe("TextRotate", () => {
  it("advances in order, stops at the final word and releases its interval", () => {
    vi.useFakeTimers();
    const onNext = vi.fn();
    const view = render(<TextRotate texts={["short", "long", "polished", "work"]} loop={false} onNext={onNext} />);
    expect(screen.getByText("short")).toBeInTheDocument();
    for (const word of ["long", "polished", "work"]) {
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.getByText(word)).toBeInTheDocument();
    }
    act(() => vi.advanceTimersByTime(10000));
    expect(onNext.mock.calls).toEqual([[1], [2], [3]]);
    const setInterval = vi.spyOn(window, "setInterval");
    const clearInterval = vi.spyOn(window, "clearInterval");
    view.rerender(<TextRotate texts={["short", "long", "polished", "work"]} loop onNext={onNext} />);
    const intervalId = setInterval.mock.results.at(-1)?.value;
    expect(intervalId).toBeDefined();
    view.unmount();
    expect(clearInterval).toHaveBeenCalledWith(intervalId);
    setInterval.mockRestore();
    clearInterval.mockRestore();
  });

  it("supports wrapping, bounded jumps and reset through its ref", () => {
    const ref = createRef<TextRotateRef>();
    render(<TextRotate ref={ref} texts={["short", "long", "work"]} auto={false} />);
    act(() => ref.current?.previous());
    expect(screen.getByText("work")).toBeInTheDocument();
    act(() => ref.current?.next());
    expect(screen.getByText("short")).toBeInTheDocument();
    act(() => ref.current?.jumpTo(99));
    expect(screen.getByText("work")).toBeInTheDocument();
    act(() => ref.current?.reset());
    expect(screen.getByText("short")).toBeInTheDocument();
  });

  it("shows the final word without automatic rotation for reduced motion", () => {
    vi.useFakeTimers();
    vi.mocked(useReducedMotion).mockReturnValue(true);
    const onNext = vi.fn();
    render(<TextRotate texts={["short", "work"]} onNext={onNext} />);
    expect(screen.getByText("work")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10000));
    expect(onNext).not.toHaveBeenCalled();
  });

  it("handles empty lists and a shortened list without invalid text", () => {
    const ref = createRef<TextRotateRef>();
    const view = render(<TextRotate ref={ref} texts={[]} />);
    expect(view.container).toBeEmptyDOMElement();
    act(() => ref.current?.next());
    view.rerender(<TextRotate ref={ref} texts={["short", "long", "work"]} auto={false} />);
    act(() => ref.current?.jumpTo(2));
    view.rerender(<TextRotate ref={ref} texts={["short"]} auto={false} />);
    expect(screen.getByText("short")).toBeInTheDocument();
  });
});
