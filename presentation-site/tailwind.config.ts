import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#101010",   // Charbon profond (palette AImaging)
        accent: "#4F8EF7",   // Bleu marque AImaging
        background: "#0C0C0C",// Noir profond
        foreground: "#F5F5F5",// Blanc cassé
        surface: "#1A1A1A",   // Gris charbon
        muted: "#888888",     // Gris moyen
        border: "#262626",    // Bordure discrète
      },
      fontFamily: {
        sans: ["var(--font-sora)", "ui-sans-serif", "system-ui"],
        display: ["var(--font-sora)", "ui-sans-serif", "system-ui"],
        drama: ["var(--font-instrument-serif)", "serif"],
        mono: ["var(--font-fira-code)", "monospace"],
      },
      borderRadius: {
        "3xl": "2rem",
        "4xl": "3rem",
      },
      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
export default config;
