// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { translations, Lang } from './translations';

export type { Lang };

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// Langue courante (module-level, pour le code hors React).
let activeLang: Lang = 'fr';

const LANG_STORAGE_KEY = 'jemaos_lang';

// Langue initiale : choix persisté de l'utilisateur, sinon langue du
// navigateur/système (en ou fr), sinon anglais. Les PWA suivent donc la
// langue du système/navigateur par défaut.
function detectInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    /* stockage indisponible */
  }
  try {
    const candidates = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    for (const candidate of candidates) {
      const short = (candidate || '').toLowerCase().split('-')[0];
      if (short === 'en' || short === 'fr') return short;
    }
  } catch {
    /* navigator indisponible */
  }
  return 'en';
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  let result = template;
  for (const key of Object.keys(params)) {
    result = result.split(`{${key}}`).join(String(params[key]));
  }
  return result;
}

export function t(key: string, params?: Record<string, string | number>): string {
  return interpolate(translations[activeLang][key] ?? translations.en[key] ?? key, params);
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  useEffect(() => {
    activeLang = lang;
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, newLang);
    } catch {
      /* stockage indisponible */
    }
  };

  const value: I18nContextValue = {
    lang,
    setLang,
    t: (key, params) => {
      const dict = translations[lang] ?? translations.en;
      return interpolate(dict[key] ?? translations.en[key] ?? key, params);
    },
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
