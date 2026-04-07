import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101828",
        canvas: "#f5f3ee",
        sand: "#e6dccd",
        spruce: "#184a45",
        ember: "#9f3a16",
      },
      fontFamily: {
        sans: ["'Source Sans 3'", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Bricolage Grotesque'", "'Source Sans 3'", "sans-serif"],
      },
      boxShadow: {
        panel: "0 24px 60px rgba(16, 24, 40, 0.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;
