import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import sourceIdentifierPlugin from 'vite-plugin-source-identifier'
import { VitePWA } from 'vite-plugin-pwa'

const isProd = process.env.BUILD_MODE === 'prod'
export default defineConfig({
  plugins: [
    react(), 
    sourceIdentifierPlugin({
      enabled: !isProd,
      attributePrefix: 'data-matrix',
      includeProps: true,
    }),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/icon.svg', 'fonts/Roboto.ttf'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,ttf,woff,woff2}'],
        // Ne pas cacher les gros fichiers media (vidéo/audio)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB max par fichier
        runtimeCaching: [
          {
            // Cache les fichiers FFmpeg WASM au runtime (ils sont gros)
            urlPattern: /\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ffmpeg-wasm-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 an
              },
            },
          },
        ],
      },
      manifest: {
        name: 'Osivibe - Éditeur Vidéo',
        short_name: 'Osivibe',
        description: 'Éditeur vidéo professionnel en ligne par Jema Technology',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f0f0f',
        theme_color: '#757AED',
        categories: ['productivity', 'utilities', 'entertainment'],
        lang: 'fr',
        dir: 'ltr',
        scope: '/',
        id: 'osivibe-editor',
        icons: [
          {
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icons/icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        enabled: false, // Désactivé en dev pour éviter les conflits
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ffmpeg': ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
          'ui-libs': ['@radix-ui/react-accordion', '@radix-ui/react-alert-dialog', '@radix-ui/react-aspect-ratio', '@radix-ui/react-avatar', '@radix-ui/react-checkbox', '@radix-ui/react-collapsible', '@radix-ui/react-context-menu', '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-hover-card', '@radix-ui/react-label', '@radix-ui/react-menubar', '@radix-ui/react-navigation-menu', '@radix-ui/react-popover', '@radix-ui/react-progress', '@radix-ui/react-radio-group', '@radix-ui/react-scroll-area', '@radix-ui/react-select', '@radix-ui/react-separator', '@radix-ui/react-slider', '@radix-ui/react-slot', '@radix-ui/react-switch', '@radix-ui/react-tabs', '@radix-ui/react-toast', '@radix-ui/react-toggle', '@radix-ui/react-toggle-group', '@radix-ui/react-tooltip', 'lucide-react'],
          'charts': ['recharts'],
          'forms': ['react-hook-form', 'zod', '@hookform/resolvers'],
          'utils': ['date-fns', 'uuid', 'clsx', 'tailwind-merge'],
        },
      },
    },
  },
})
