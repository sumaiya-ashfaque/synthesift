'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
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

const ITEMS: ReadonlyArray<{ id: Theme; label: string; Icon: typeof Sun }> = [
  { id: 'system', label: 'Auto', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
];

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
      className="inline-flex items-center gap-0.5 rounded-full border border-[var(--ss-border)] bg-[var(--ss-canvas)] p-0.5"
      role="group"
      aria-label="Appearance"
    >
      {ITEMS.map(({ id, label, Icon }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => setAppTheme(id)}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-full transition-all',
              active
                ? 'bg-[var(--ss-surface)] text-[var(--ss-primary)] shadow-xs'
                : 'text-[var(--ss-subtle)] hover:text-[var(--ss-text)]',
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
