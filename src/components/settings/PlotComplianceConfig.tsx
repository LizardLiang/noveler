import { useState, useEffect, useCallback } from 'react';
import { projectSettingsApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';

interface PlotComplianceConfigProps {
  projectId: string;
}

export function PlotComplianceConfig({ projectId }: PlotComplianceConfigProps) {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      setLoading(true);
      try {
        const result = await projectSettingsApi.get(projectId, 'plot_compliance_enabled');
        if (cancelled) return;
        if (result.success && result.data !== null && result.data !== undefined) {
          setEnabled(Boolean(result.data));
        }
      } catch {
        // Use default on error
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
    await projectSettingsApi.set(projectId, 'plot_compliance_enabled', next);
  }, [enabled, projectId]);

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
        {zhTW.plotCompliance.title}
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
          {zhTW.plotCompliance.enable}
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

      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', paddingTop: 10, lineHeight: '1.5' }}>
        {zhTW.plotCompliance.hint}
      </div>
    </div>
  );
}
