import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/exports': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/voices': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
