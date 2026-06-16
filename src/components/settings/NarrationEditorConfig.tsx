import { useState, useEffect, useCallback } from 'react';
import { projectSettingsApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';

interface NarrationEditorConfigProps {
  projectId: string;
}

export function NarrationEditorConfig({ projectId }: NarrationEditorConfigProps) {
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<'single' | 'two-pass'>('two-pass');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      setLoading(true);
      try {
        const [enabledResult, modeResult] = await Promise.all([
          projectSettingsApi.get(projectId, 'narration_editor_enabled'),
          projectSettingsApi.get(projectId, 'narration_editor_mode'),
        ]);
        if (cancelled) return;
        if (enabledResult.success && enabledResult.data !== null && enabledResult.data !== undefined) {
          setEnabled(Boolean(enabledResult.data));
        }
        if (modeResult.success && modeResult.data === 'single') {
          setMode('single');
        } else {
          setMode('two-pass');
        }
      } catch {
        // Use defaults on error
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadSettings().catch(() => { /* best effort */ });
    return () => { cancelled = true; };
  }, [projectId]);

  const handleToggleEnabled = useCallback(async () => {
    const next = !enabled;
    setEnabled(next);
    await projectSettingsApi.set(projectId, 'narration_editor_enabled', next);
  }, [enabled, projectId]);

  const handleModeChange = useCallback(async (nextMode: 'single' | 'two-pass') => {
    setMode(nextMode);
    await projectSettingsApi.set(projectId, 'narration_editor_mode', nextMode);
  }, [projectId]);

  if (loading) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 12,
        }}
      >
        {zhTW.narrationEditor.title}
      </div>

      {/* Enable toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 0',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>
          {zhTW.narrationEditor.enable}
        </span>
        <button
          onClick={handleToggleEnabled}
          role="switch"
          aria-checked={enabled}
          style={{
            width: 40,
            height: 22,
            borderRadius: 11,
            border: 'none',
            background: enabled ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
            cursor: 'pointer',
            position: 'relative',
            transition: 'background var(--transition-fast)',
            padding: 0,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              left: enabled ? 21 : 3,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'white',
              transition: 'left var(--transition-fast)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
          />
        </button>
      </div>

      {/* Mode selector — only shown when enabled */}
      {enabled && (
        <div style={{ paddingTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ModeButton
              selected={mode === 'single'}
              onClick={() => handleModeChange('single')}
              label={zhTW.narrationEditor.modeSingle}
            />
            <ModeButton
              selected={mode === 'two-pass'}
              onClick={() => handleModeChange('two-pass')}
              label={zhTW.narrationEditor.modeTwoPass}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface ModeButtonProps {
  selected: boolean;
  onClick: () => void;
  label: string;
}

function ModeButton({ selected, onClick, label }: ModeButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: selected ? 'var(--color-accent-subtle)' : 'transparent',
        color: selected ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: selected ? 500 : 400,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
