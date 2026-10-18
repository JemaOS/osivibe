import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import sourceIdentifierPlugin from 'vite-plugin-source-identifier'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  // Le plugin d'identification des sources injecte des attributs data-matrix
  // (dont des chemins absolus locaux) : uniquement en développement, jamais
  // dans le bundle de production (fuite d'information + poids inutile).
  const isDev = mode !== 'production'

  return {
    plugins: [
      react(),
      sourceIdentifierPlugin({
        enabled: isDev,
        attributePrefix: 'data-matrix',
        includeProps: true,
      }),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icons/icon.svg', 'icons/icon-192x192.png', 'icons/icon-512x512.png'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,ttf,woff,woff2}'],
          // Ne pas précacher ce qui n'est pas nécessaire au premier écran :
          // - Roboto.ttf (515 Ko) ne sert qu'aux exports ffmpeg avec texte
          // - les sous-ensembles latinext ne servent qu'à des caractères exotiques
          // - les chunks paresseux (média/export/ffmpeg) sont chargés à la demande
          globIgnores: [
            '**/fonts/Roboto.ttf',
            '**/fonts/*-latinext.woff2',
            '**/assets/media-*.js',
            '**/assets/mediaBunny-*.js',
            '**/assets/ExportModal-*.js',
            '**/assets/ffmpeg-*.js',
          ],
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
              src: '/icons/icon-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icons/icon-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/icons/icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icons/icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
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
    esbuild: {
      // Purge le bruit de debug du bundle de production
      drop: ['debugger'],
      pure: ['console.debug', 'console.info', 'console.log'],
    },
    build: {
      // Évite le calcul gzip de chaque asset à chaque build (CI plus rapide)
      reportCompressedSize: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'ffmpeg': ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
            'media': ['mediabunny'],
            'ui-libs': ['lucide-react'],
            'utils': ['uuid', 'clsx', 'tailwind-merge'],
          },
        },
      },
    },
  }
})
