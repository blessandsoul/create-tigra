'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

type ThemeName = 'warm-orange' | 'electric-indigo' | 'ocean-teal' | 'rose-pink';

interface PaletteOption {
  name: ThemeName;
  label: string;
  previewColor: string;
}

const PALETTES: PaletteOption[] = [
  { name: 'warm-orange', label: 'Warm Orange', previewColor: 'oklch(0.66 0.135 39.9)' },
  { name: 'electric-indigo', label: 'Electric Indigo', previewColor: 'oklch(0.62 0.22 270)' },
  { name: 'ocean-teal', label: 'Ocean Teal', previewColor: 'oklch(0.65 0.15 195)' },
  { name: 'rose-pink', label: 'Rose Pink', previewColor: 'oklch(0.68 0.2 350)' },
];

const STORAGE_KEY = 'theme-palette';
const TRANSITION_DURATION = 400;
const TRANSITION_CLASS = 'theme-transitioning';

interface ThemeSwitcherProps {
  smooth?: boolean;
}

export function ThemeSwitcher({ smooth = true }: ThemeSwitcherProps): React.ReactElement {
  const [active, setActive] = useState<ThemeName>('warm-orange');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (stored && PALETTES.some((p) => p.name === stored)) {
      setActive(stored);
      if (stored !== 'warm-orange') {
        document.documentElement.setAttribute('data-theme', stored);
      }
    }
  }, []);

  const handleSelect = useCallback((palette: PaletteOption): void => {
    setActive(palette.name);
    const root = document.documentElement;

    if (smooth) {
      root.classList.add(TRANSITION_CLASS);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        root.classList.remove(TRANSITION_CLASS);
      }, TRANSITION_DURATION);
    }

    if (palette.name === 'warm-orange') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', palette.name);
    }

    localStorage.setItem(STORAGE_KEY, palette.name);
  }, [smooth]);

  useEffect(() => {
    return (): void => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      document.documentElement.classList.remove(TRANSITION_CLASS);
    };
  }, []);

  return (
    <>
      {smooth && (
        <style>{`
          .theme-transitioning,
          .theme-transitioning *,
          .theme-transitioning *::before,
          .theme-transitioning *::after {
            transition: background-color 0.4s ease, color 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease !important;
          }
        `}</style>
      )}
      <div className="flex flex-col items-center gap-3">
        <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Theme Palette
        </p>
        <div className="flex gap-2">
          {PALETTES.map((palette) => (
            <button
              key={palette.name}
              type="button"
              onClick={() => handleSelect(palette)}
              aria-label={`Switch to ${palette.label} theme`}
              className={cn(
                'flex min-h-11 min-w-11 items-center justify-center rounded-xl border-2 p-2.5 transition-all duration-200 active:scale-[0.95]',
                active === palette.name
                  ? 'border-foreground/40 bg-muted shadow-md'
                  : 'border-transparent bg-muted/50 md:hover:bg-muted md:hover:border-border',
              )}
            >
              <div
                className="h-5 w-5 rounded-full shadow-sm ring-1 ring-foreground/10"
                style={{ backgroundColor: palette.previewColor }}
              />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
