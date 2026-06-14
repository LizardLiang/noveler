import { useState, useEffect } from 'react';
import { windowApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Check initial maximized state
    windowApi.isMaximized().then(setIsMaximized);

    // Listen for maximize/unmaximize events from main process
    const handler = (_event: unknown, maximized: boolean) => {
      setIsMaximized(maximized);
    };

    window.ipcRenderer.on('window:maximized-changed', handler as Parameters<typeof window.ipcRenderer.on>[1]);
    return () => {
      window.ipcRenderer.off('window:maximized-changed', handler as Parameters<typeof window.ipcRenderer.off>[1]);
    };
  }, []);

  const handleMinimize = () => {
    windowApi.minimize();
  };

  const handleMaximize = () => {
    windowApi.maximize().then(() => {
      windowApi.isMaximized().then(setIsMaximized);
    });
  };

  const handleClose = () => {
    windowApi.close();
  };

  return (
    <div
      className="flex items-center justify-between select-none"
      style={{
        height: 'var(--titlebar-height)',
        background: 'var(--titlebar-bg)',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
    >
      {/* Left: app icon + title (draggable) */}
      <div
        className="drag-region flex items-center gap-2 px-4 flex-1 h-full"
        style={{ color: 'var(--titlebar-text)' }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="shrink-0"
        >
          <rect width="16" height="16" rx="3" fill="var(--color-accent)" />
          <path
            d="M4 5h8M4 8h6M4 11h7"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <span className="text-sm font-medium" style={{ color: 'var(--titlebar-text)' }}>
          {zhTW.app.name}
        </span>
      </div>

      {/* Right: window controls (non-draggable) */}
      <div className="no-drag flex items-center h-full">
        {/* Minimize */}
        <button
          onClick={handleMinimize}
          title={zhTW.titlebar.minimize}
          className="flex items-center justify-center transition-colors"
          style={{
            width: 46,
            height: '100%',
            color: 'var(--titlebar-text)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-hover)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={handleMaximize}
          title={isMaximized ? zhTW.titlebar.restore : zhTW.titlebar.maximize}
          className="flex items-center justify-center transition-colors"
          style={{
            width: 46,
            height: '100%',
            color: 'var(--titlebar-text)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-hover)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          {isMaximized ? (
            /* Restore icon */
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="0" width="8" height="8" />
              <polyline points="0,2 0,10 8,10" />
            </svg>
          ) : (
            /* Maximize icon */
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0" y="0" width="10" height="10" />
            </svg>
          )}
        </button>

        {/* Close */}
        <button
          onClick={handleClose}
          title={zhTW.titlebar.close}
          className="flex items-center justify-center transition-colors"
          style={{
            width: 46,
            height: '100%',
            color: 'var(--titlebar-text)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = '#e81123';
            (e.currentTarget as HTMLButtonElement).style.color = 'white';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--titlebar-text)';
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="0" y1="0" x2="10" y2="10" />
            <line x1="10" y1="0" x2="0" y2="10" />
          </svg>
        </button>
      </div>
    </div>
  );
}
