
'use client';

import { useEffect, useSyncExternalStore } from 'react';

type Theme = 'system' | 'light' | 'dark';

const KEY = 'syntheSift:theme';
const CHANGE_EVENT = 'syntheSift:theme-change';

function getStoredTheme(): Theme {
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

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribe,
    getStoredTheme,
    getServerTheme
  );

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

  function choose(next: Theme) {
    window.localStorage.setItem(KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <div className="ss-theme-picker" role="group" aria-label="Appearance">
      <span className="ss-product-nav-label">APPEARANCE</span>

      <div className="ss-theme-choices">
        {(['system', 'light', 'dark'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={theme === item ? 'is-current' : ''}
            aria-pressed={theme === item}
            onClick={() => choose(item)}
          >
            {item === 'system' ? 'Auto' : item === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
    </div>
  );
}