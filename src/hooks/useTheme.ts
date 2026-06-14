import { useEffect, useCallback } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { settingsApi } from '@/lib/ipc';

export type ThemeMode = 'dark' | 'light' | 'system';

export function applyThemeToDom(theme: ThemeMode): void {
  const html = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', 'light');
    }
  } else if (theme === 'light') {
    html.setAttribute('data-theme', 'light');
  } else {
    // dark — remove attribute so CSS :root (dark default) applies
    html.removeAttribute('data-theme');
  }
}

export function useTheme() {
  const theme = useUIStore(state => state.theme) as ThemeMode;
  const setThemeStore = useUIStore(state => state.setTheme);

  // Apply theme on mount and when theme changes
  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyThemeToDom('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback(
    async (newTheme: ThemeMode) => {
      applyThemeToDom(newTheme);
      setThemeStore(newTheme);
      await settingsApi.set('theme', newTheme);
    },
    [setThemeStore],
  );

  return { theme, setTheme };
}
