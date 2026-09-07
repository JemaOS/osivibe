// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { translations, Lang } from './translations';

export type { Lang };

function getSystemLang(): Lang {
  const nav = navigator as Navigator & { userLanguage?: string };
  const browserLang = navigator.language || nav.userLanguage || 'fr';
  const short = browserLang.split('-')[0].toLowerCase();
  return short === 'fr' ? 'fr' : 'en';
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

let activeLang: Lang = getSystemLang();

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
  const [lang, setLangState] = useState<Lang>(getSystemLang);

  useEffect(() => {
    const handleLanguageChange = () => {
      setLangState(getSystemLang());
    };
    window.addEventListener('languagechange', handleLanguageChange);
    return () => window.removeEventListener('languagechange', handleLanguageChange);
  }, []);

  useEffect(() => {
    activeLang = lang;
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
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
