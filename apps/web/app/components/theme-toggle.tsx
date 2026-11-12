'use client';

import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'syntheSift:theme';

function effective(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    const saved = window.localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = effective(theme); };
    apply();
    query?.addEventListener?.('change', apply);
    return () => query?.removeEventListener?.('change', apply);
  }, [theme]);
  function choose(next: Theme) {
    window.localStorage.setItem(KEY, next);
    setTheme(next);
  }
  return (
    <div className="ss-theme-picker" role="group" aria-label="Appearance">
      <span className="ss-product-nav-label">APPEARANCE</span>
      <div className="ss-theme-choices">
        {(['system', 'light', 'dark'] as const).map((item) => (
          <button key={item} type="button" className={theme === item ? 'is-current' : ''}
            aria-pressed={theme === item} onClick={() => choose(item)}>
            {item === 'system' ? 'Auto' : item === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
    </div>
  );
}
