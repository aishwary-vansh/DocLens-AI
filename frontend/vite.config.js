import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'


// A client that disconnects mid-request (closed tab, cancelled stream) resets
// the proxied socket; unhandled, that ECONNRESET crashed the dev server.
function logProxyErrors(proxy) {
  proxy.on('error', (err) => console.warn(`[proxy] ${err.code || err.message}`))
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Dev-server proxy: mirrors the nginx proxy so relative URLs work the same
  // in local dev (npm run dev) as they do inside the Docker container.
  // The AI service is internal (only the backend calls it), so it is not proxied.
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure: logProxyErrors,
      },
      // Socket.IO live document status, like the nginx /socket.io/ location.
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
        configure: logProxyErrors,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
})

