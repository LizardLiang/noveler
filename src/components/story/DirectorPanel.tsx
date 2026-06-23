import { useState, useEffect, useCallback } from 'react';
import { projectSettingsApi, aiApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';

interface DirectorPanelProps {
  projectId: string;
  branchId: string;
  /** Disable the re-plan action when no AI provider is configured. */
  disabled?: boolean;
}

/** Per-branch standing author direction (創作走向) + a button that asks the
 *  director to rewrite the AI roadmap (大綱) toward it. Stored under the
 *  `director_brief:<branchId>` project setting. */
export function DirectorPanel({ projectId, branchId, disabled }: DirectorPanelProps) {
  const settingKey = `director_brief:${branchId}`;
  const [brief, setBrief] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [replanning, setReplanning] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    projectSettingsApi.get(projectId, settingKey).then(result => {
      if (result.success && result.data) {
        setBrief(typeof result.data === 'string' ? result.data : '');
      } else {
        setBrief('');
      }
      setLoading(false);
    });
  }, [projectId, settingKey]);

  const handleSave = useCallback(async () => {
    await projectSettingsApi.set(projectId, settingKey, brief);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [projectId, settingKey, brief]);

  const handleReplan = useCallback(async () => {
    if (replanning || disabled) return;
    setReplanError(null);
    setReplanning(true);
    try {
      // Persist first so the forced reconcile reads the latest brief.
      await projectSettingsApi.set(projectId, settingKey, brief);
      const result = await aiApi.replanDirector(projectId, branchId);
      if (!result.success) {
        setReplanError(result.error?.message ?? zhTW.directorPanel.replanFailed);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setReplanError(zhTW.directorPanel.replanFailed);
    } finally {
      setReplanning(false);
    }
  }, [projectId, branchId, settingKey, brief, replanning, disabled]);

  if (loading) {
    return (
      <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
        載入中...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          display: 'block',
        }}
      >
        {zhTW.directorPanel.briefLabel}
      </label>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {zhTW.directorPanel.briefDescription}
      </p>
      <textarea
        value={brief}
        onChange={e => setBrief(e.target.value)}
        placeholder={zhTW.directorPanel.briefPlaceholder}
        rows={6}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
          color: 'var(--color-text-primary)',
          fontSize: 13,
          lineHeight: 1.6,
          outline: 'none',
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />
      {replanError && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-error, #e5484d)' }}>
          {replanError}
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
        <button
          onClick={handleReplan}
          disabled={replanning || disabled}
          title={disabled ? zhTW.directorPanel.replanNeedsProvider : zhTW.directorPanel.replanHint}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-accent)',
            background: 'transparent',
            color: 'var(--color-accent)',
            cursor: replanning || disabled ? 'not-allowed' : 'pointer',
            fontSize: 13,
            fontWeight: 500,
            opacity: replanning || disabled ? 0.6 : 1,
          }}
        >
          {replanning ? zhTW.directorPanel.replanning : zhTW.directorPanel.replan}
        </button>
        <button
          onClick={handleSave}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: saved ? 'var(--color-success)' : 'var(--color-accent)',
            color: 'white',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            transition: 'background var(--transition-fast)',
          }}
        >
          {saved ? '已儲存' : zhTW.directorPanel.save}
        </button>
      </div>
    </div>
  );
}
