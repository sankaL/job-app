import "@testing-library/jest-dom/vitest";

// jsdom does not implement the media queries used by Astryx's responsive shell.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: (() => {
      const width = query.match(/width\s*([<>]=?)\s*(\d+)px/);
      if (!width) return false;
      const target = Number(width[2]);
      if (width[1] === "<") return window.innerWidth < target;
      if (width[1] === "<=") return window.innerWidth <= target;
      if (width[1] === ">") return window.innerWidth > target;
      return window.innerWidth >= target;
    })(),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }),
});

// jsdom has dialog elements but lacks their native open/close methods.
// Browser QA covers focus trapping and Escape; these methods expose visibility to RTL.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
}
