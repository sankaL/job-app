import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--color-ink)",
        canvas: "var(--color-canvas)",
        sand: "var(--color-sand)",
        spruce: "var(--color-spruce)",
        ember: "var(--color-ember)",
        amber: "var(--color-amber)",
        control: "var(--color-border-emphasized)",
        error: "var(--color-error)",
        surface: "var(--color-surface)",
      },
      fontFamily: {
        sans: ["'Source Sans 3'", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Bricolage Grotesque'", "'Source Sans 3'", "sans-serif"],
      },
      boxShadow: {
        xs: "var(--shadow-low)",
        sm: "var(--shadow-low)",
        md: "var(--shadow-med)",
        lg: "var(--shadow-high)",
        panel: "var(--shadow-high)",
      },
      borderRadius: {
        xs: "var(--radius-inner)",
        sm: "var(--radius-inner)",
        md: "var(--radius-element)",
        lg: "var(--radius-container)",
        xl: "var(--radius-container)",
        "2xl": "var(--radius-page)",
      },
    },
  },
  plugins: [],
} satisfies Config;
