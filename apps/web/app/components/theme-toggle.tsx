'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { cn } from '@/lib/cn';

type Theme = 'system' | 'light' | 'dark';

const KEY = 'syntheSift:theme';
const CHANGE_EVENT = 'syntheSift:theme-change';

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const saved = window.localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'system') {
    return saved;
  }
  return 'system';
}

function getServerTheme(): Theme {
  return 'system';
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function effective(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function setAppTheme(next: Theme) {
  window.localStorage.setItem(KEY, next);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getStoredTheme, getServerTheme);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = effective(theme);
    };
    apply();
    query?.addEventListener?.('change', apply);
    return () => {
      query?.removeEventListener?.('change', apply);
    };
  }, [theme]);

  return (
    <div
      className="pt-3 mt-3 border-t border-[var(--ss-border)]"
      role="group"
      aria-label="Appearance"
    >
      <span className="block px-1 mb-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-[var(--ss-subtle)]">
        APPEARANCE
      </span>
      <div className="grid grid-cols-3 gap-0.5 p-0.5 rounded-md border border-[var(--ss-border)] bg-[var(--ss-canvas)]">
        {(['system', 'light', 'dark'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={cn(
              'py-1.5 text-[11px] font-medium rounded-[4px] transition-colors',
              theme === item
                ? 'bg-[var(--ss-surface)] text-[var(--ss-text)] shadow-xs font-semibold'
                : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)]',
            )}
            aria-pressed={theme === item}
            onClick={() => setAppTheme(item)}
          >
            {item === 'system' ? 'Auto' : item === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
    </div>
  );
}
