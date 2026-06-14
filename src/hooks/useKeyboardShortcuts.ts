import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { autosaveApi } from '@/lib/ipc';

export interface KeyboardShortcutOptions {
  onNewProject?: () => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
  onToggleWorldMemory?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onForceSave?: () => void;
  onEscape?: () => void;
}

function isInputFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    (active as HTMLElement).contentEditable === 'true'
  );
}

export function useKeyboardShortcuts(options: KeyboardShortcutOptions = {}) {
  const navigate = useNavigate();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      // Escape — close modals (always active)
      if (e.key === 'Escape') {
        options.onEscape?.();
        return;
      }

      // Most shortcuts require Ctrl/Cmd
      if (!ctrl) return;

      switch (e.key.toLowerCase()) {
        // Ctrl+N — new project (go to project list)
        case 'n':
          if (!shift) {
            e.preventDefault();
            if (options.onNewProject) {
              options.onNewProject();
            } else {
              navigate('/');
            }
          }
          break;

        // Ctrl+O — open project (go to project list)
        case 'o':
          if (!shift) {
            e.preventDefault();
            navigate('/');
          }
          break;

        // Ctrl+F — open search
        case 'f':
          if (!shift) {
            e.preventDefault();
            options.onOpenSearch?.();
          }
          break;

        // Ctrl+, — open settings
        case ',':
          e.preventDefault();
          if (options.onOpenSettings) {
            options.onOpenSettings();
          } else {
            navigate('/settings');
          }
          break;

        // Ctrl+S — force save (trigger autosave)
        case 's':
          if (!shift) {
            e.preventDefault();
            options.onForceSave?.();
            autosaveApi.trigger({}).catch(() => { /* best effort */ });
          }
          break;

        // Ctrl+B — toggle sidebar / Ctrl+Shift+B — toggle world memory
        case 'b':
          e.preventDefault();
          if (!shift) {
            options.onToggleSidebar?.();
          } else {
            options.onToggleWorldMemory?.();
          }
          break;

        // Ctrl+Z — undo (skip when input is focused to let browser handle it)
        case 'z':
          if (!shift && !isInputFocused()) {
            e.preventDefault();
            options.onUndo?.();
          } else if (shift && !isInputFocused()) {
            // Ctrl+Shift+Z — redo
            e.preventDefault();
            options.onRedo?.();
          }
          break;

        // Ctrl+Y — redo
        case 'y':
          if (!isInputFocused()) {
            e.preventDefault();
            options.onRedo?.();
          }
          break;
      }
    },
    [navigate, options],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}
