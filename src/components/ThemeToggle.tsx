// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, ThemeMode } from '../theme/ThemeProvider';
import { useI18n } from '../i18n';
import { useLayoutMode } from '../hooks/use-responsive';

const THEME_OPTIONS: Array<{ value: ThemeMode; icon: typeof Monitor; labelKey: string }> = [
  { value: 'system', icon: Monitor, labelKey: 'themeSystem' },
  { value: 'light', icon: Sun, labelKey: 'themeLight' },
  { value: 'dark', icon: Moon, labelKey: 'themeDark' },
];

export const ThemeToggle: React.FC = () => {
  const { mode, setMode } = useTheme();
  const { t } = useI18n();
  const layoutMode = useLayoutMode();
  const [isOpen, setIsOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const currentOption = THEME_OPTIONS.find((option) => option.value === mode) ?? THEME_OPTIONS[0];
  const CurrentIcon = currentOption.icon;
  const currentLabel = t(currentOption.labelKey);
  const buttonSize = layoutMode === 'minimal' ? 'w-8 h-8' : 'w-9 h-9';
  const iconSize = layoutMode === 'minimal' || layoutMode === 'compact' ? 'w-4 h-4' : 'w-5 h-5';

  const closeMenu = (restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const openMenu = () => setIsOpen(true);

  useEffect(() => {
    if (!isOpen) return;

    const selectedIndex = THEME_OPTIONS.findIndex((option) => option.value === mode);
    itemRefs.current[selectedIndex >= 0 ? selectedIndex : 0]?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, mode]);

  const selectOption = (nextMode: ThemeMode) => {
    setMode(nextMode);
    closeMenu(true);
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const activeIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
    const lastIndex = THEME_OPTIONS.length - 1;

    const focusItem = (index: number) => {
      const boundedIndex = (index + THEME_OPTIONS.length) % THEME_OPTIONS.length;
      itemRefs.current[boundedIndex]?.focus();
    };

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(activeIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(activeIndex <= 0 ? lastIndex : activeIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(lastIndex);
        break;
      case 'Tab':
        closeMenu();
        break;
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className="theme-toggle relative flex-shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
        className={`${buttonSize} rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors touch-target flex-shrink-0`}
        aria-label={`${t('theme')} : ${currentLabel}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={t('themeToggle')}
      >
        <CurrentIcon className={iconSize} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={t('theme')}
          onKeyDown={handleMenuKeyDown}
          className="absolute top-full right-0 mt-2 w-40 bg-[#1f1f1f] border border-white/10 rounded-lg shadow-xl z-50 py-1"
        >
          {THEME_OPTIONS.map((option, index) => {
            const Icon = option.icon;
            const isSelected = option.value === mode;
            return (
              <button
                key={option.value}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                tabIndex={-1}
                onClick={() => selectOption(option.value)}
                className={`w-full px-3 py-2 text-sm flex items-center gap-2 text-left transition-colors ${
                  isSelected
                    ? 'text-primary-500 bg-white/5 font-medium'
                    : 'text-neutral-300 hover:bg-white/10'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate">{t(option.labelKey)}</span>
                {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ThemeToggle;