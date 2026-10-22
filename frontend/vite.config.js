import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The font is bundled, so nothing on the page waits on another site
        // and the app opens offline exactly as it does online.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      manifest: {
        name: 'Student Attendance Tracker',
        short_name: 'Attendance',
        description: 'Offline-first attendance tracker for rural schools',
        theme_color: '#1F4D3A',
        background_color: '#F6F2EA',
        display: 'standalone',
        start_url: '/login',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
})
