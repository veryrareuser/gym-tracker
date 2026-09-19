import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/gym-tracker/',
  plugins: [
    react(),
    tailwindcss(),
  ],
})
