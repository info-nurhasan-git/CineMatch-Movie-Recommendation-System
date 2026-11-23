import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    // Flask handles CORS too; the proxy keeps browser requests same-origin.
    proxy: {
      '/api': 'http://127.0.0.1:5001',
    },
  },
})
