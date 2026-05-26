// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function PWAUpdatePrompt() {
  const [showPrompt, setShowPrompt] = useState(false)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      // Vérifie les mises à jour toutes les heures
      if (registration) {
        setInterval(() => {
          registration.update()
        }, 60 * 60 * 1000)
      }
    },
    onRegisterError(error) {
      console.error('Erreur d\'enregistrement du SW:', error)
    },
  })

  useEffect(() => {
    setShowPrompt(needRefresh)
  }, [needRefresh])

  const handleUpdate = () => {
    updateServiceWorker(true)
  }

  const handleDismiss = () => {
    setNeedRefresh(false)
    setShowPrompt(false)
  }

  if (!showPrompt) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-background/95 backdrop-blur-sm px-4 py-3 shadow-lg">
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            Mise à jour disponible
          </p>
          <p className="text-xs text-muted-foreground">
            Une nouvelle version d'Osivibe est prête.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDismiss}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Plus tard
          </button>
          <button
            onClick={handleUpdate}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Mettre à jour
          </button>
        </div>
      </div>
    </div>
  )
}
