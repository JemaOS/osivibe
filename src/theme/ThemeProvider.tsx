// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'osivibe-theme';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readStoredThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

export function applyTheme(resolvedTheme: ResolvedTheme): void {
  const root = document.documentElement;
  const isDark = resolvedTheme === 'dark';
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = resolvedTheme;
  root.dataset.theme = resolvedTheme;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(mode));

  useEffect(() => {
    const media = window.matchMedia(DARK_MEDIA_QUERY);

    const sync = () => {
      const nextTheme: ResolvedTheme =
        mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
      setResolvedTheme(nextTheme);
      applyTheme(nextTheme);
    };

    sync();

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // localStorage can be unavailable (private mode, embedded webview).
    }

    if (mode !== 'system') return;

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync);
      return () => media.removeEventListener('change', sync);
    }

    media.addListener(sync);
    return () => media.removeListener(sync);
  }, [mode]);

  // Keep tabs in sync when another tab changes the preference.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      if (!isThemeMode(event.newValue)) return;
      setModeState(event.newValue);
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedTheme,
      setMode: (nextMode: ThemeMode) => {
        if (isThemeMode(nextMode)) setModeState(nextMode);
      },
    }),
    [mode, resolvedTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
