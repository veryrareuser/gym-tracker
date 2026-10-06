import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/gym-tracker/',
  plugins: [
    {
      name: 'production-csp',
      transformIndexHtml(html, context) {
        // Vite's development refresh uses inline scripts and WebSockets. Never
        // weaken the production policy to accommodate a local development server.
        return context.server ? html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '') : html
      },
    },
    react(),
    tailwindcss(),
  ],
})
