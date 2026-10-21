// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { I18nProvider } from './i18n'
import { ThemeProvider } from './theme/ThemeProvider.tsx'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
)
