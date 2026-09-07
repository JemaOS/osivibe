// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useEffect } from 'react';
import { LANGUAGES, Lang } from '../i18n/translations';
import { useI18n } from '../i18n';
import { useLayoutMode } from '../hooks/use-responsive';

export const LanguageSelector: React.FC = () => {
  const { lang, setLang, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const layoutMode = useLayoutMode();

  const buttonSize = layoutMode === 'minimal' ? 'w-8 h-8' : layoutMode === 'compact' ? 'w-9 h-9' : 'w-9 h-9';
  const iconSize = layoutMode === 'minimal' || layoutMode === 'compact' ? 'w-4 h-4' : 'w-5 h-5';

  const handleSelect = (langCode: Lang) => {
    setLang(langCode);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.language-selector')) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isOpen]);

  const currentLangData = LANGUAGES[lang] || LANGUAGES.en;
  const otherLang = lang === 'en' ? 'fr' : 'en';

  return (
    <div
      className={`language-selector relative ${isOpen ? 'open' : ''}`}
      onClick={() => setIsOpen(!isOpen)}
    >
      <button
        className={`${buttonSize} rounded-lg flex items-center justify-center gap-1 px-1 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors touch-target flex-shrink-0`}
        title={t('language')}
      >
        <svg
          className={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 8l6 6M4 14h8M5.5 14l2-6h1l2 6" />
          <path d="M14 5h6M17 5v9M14 9h6" />
        </svg>
        <span className="text-[10px] font-medium">
          {currentLangData.code}/{otherLang}
        </span>
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-32 bg-[#1f1f1f] border border-white/10 rounded-lg shadow-xl z-50 py-1">
          {Object.values(LANGUAGES).map((langEntry) => (
            <div
              key={langEntry.code}
              onClick={(e) => {
                e.stopPropagation();
                handleSelect(langEntry.code);
              }}
              className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                lang === langEntry.code
                  ? 'text-primary-400 bg-white/5 font-medium'
                  : 'text-neutral-300 hover:bg-white/10'
              }`}
            >
              <span>{langEntry.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LanguageSelector;
