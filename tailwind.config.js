/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'poker-red': '#C0392B',
        'poker-red-light': '#E74C3C',
        'poker-gold': '#F39C12',
        'poker-dark': '#0A0A0A',
        'poker-card': '#1A1A1A',
        'poker-border': '#2D2D2D',
      },
      fontFamily: {
        'display': ['Impact', 'Arial Black', 'sans-serif'],
        'mono': ['JetBrains Mono', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
}
