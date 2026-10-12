import { useMediaQuery } from "@astryxdesign/core/hooks";

// Phone layouts apply below the Astryx `md` breakpoint, matching the shell's
// MobileNav switch and the `max-width: 767px` rules in index.css.
export const MOBILE_QUERY = "(max-width: 767px)";
// Application detail splits into resume and details columns from `xl` up.
export const WIDE_WORKSPACE_QUERY = "(min-width: 1280px)";

export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY);
}

export function useIsWideWorkspace() {
  return useMediaQuery(WIDE_WORKSPACE_QUERY);
}
