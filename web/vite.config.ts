import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiPort = process.env.API_PORT ?? '8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      output: {
        // Split heavy, page-specific libraries into their own vendor chunks so
        // they're cached separately and only fetched when a route needs them.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/[\\/](three|@react-three)[\\/]/.test(id)) return 'three'
            if (/[\\/](konva|react-konva)[\\/]/.test(id)) return 'konva'
            if (id.includes('jspdf') || id.includes('html2canvas')) return 'pdf'
          }
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
})
