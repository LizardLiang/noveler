import { useState, useEffect, useCallback } from 'react';
import { projectSettingsApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';

interface WorldRulesEditorProps {
  projectId: string;
  onSaved?: () => void;
}

export function WorldRulesEditor({ projectId, onSaved }: WorldRulesEditorProps) {
  const [rules, setRules] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    projectSettingsApi.get(projectId, 'world_rules').then(result => {
      if (result.success && result.data) {
        setRules(typeof result.data === 'string' ? result.data : '');
      }
      setLoading(false);
    });
  }, [projectId]);

  const handleSave = useCallback(async () => {
    await projectSettingsApi.set(projectId, 'world_rules', rules);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onSaved?.();
  }, [projectId, rules, onSaved]);

  const handleClear = useCallback(() => {
    setRules('');
  }, []);

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
        {zhTW.worldRules.title}
      </label>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {zhTW.worldRules.description}
      </p>
      <textarea
        value={rules}
        onChange={e => setRules(e.target.value)}
        placeholder={zhTW.worldRules.placeholder}
        rows={14}
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {rules && (
          <button
            onClick={handleClear}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {zhTW.worldRules.reset}
          </button>
        )}
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
          {saved ? '已儲存' : zhTW.worldRules.save}
        </button>
      </div>
    </div>
  );
}
