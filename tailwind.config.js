/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#050D08",
        surface: "#07130D",
        accent: "#7CFF2B",
        accent2: "#39FF14",
        ok: "#39FF14",
        warn: "#FFD166",
        err: "#FF4D4D",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
