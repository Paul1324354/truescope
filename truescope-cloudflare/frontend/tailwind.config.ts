import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#050D1A", 900: "#0A1A33", 800: "#0F2547", 700: "#16325E", 600: "#1F4380" },
        ink: { 950: "#0B0D10", 900: "#111418", 800: "#181C22", 700: "#222831", 600: "#2E3540" },
        sky: { 400: "#5AB0FF", 500: "#3A97F5", 300: "#8CC8FF" },
        ok: "#2FA36B", warn: "#D9A21B", bad: "#D2483F",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      boxShadow: { card: "0 1px 2px rgba(10,26,51,.06), 0 4px 16px rgba(10,26,51,.06)" },
    },
  },
  plugins: [],
} satisfies Config;
