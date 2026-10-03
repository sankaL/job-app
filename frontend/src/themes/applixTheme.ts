import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

// The logo's orange check, with dark lettering for readable primary actions.
export const applixTheme = defineTheme({
  name: "applix",
  extends: neutralTheme,
  tokens: {
    "--color-accent": ["#f47721", "#f47721"],
    "--color-accent-muted": ["#fff0e5", "#46230f"],
    "--color-on-accent": ["#1c1917", "#1c1917"],
  },
});
