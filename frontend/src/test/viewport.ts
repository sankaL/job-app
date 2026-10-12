// Sets the jsdom viewport width read by the matchMedia mock in setup.ts.
// Returns a restore function for the original width.
export function setViewportWidth(width: number) {
  const original = window.innerWidth;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  return () =>
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: original,
    });
}
