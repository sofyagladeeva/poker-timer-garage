import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves this project from /poker-timer-garage/.
  // Keep the root base for local development and custom-root deployments.
  base: process.env.GITHUB_ACTIONS ? '/poker-timer-garage/' : '/',
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
})
