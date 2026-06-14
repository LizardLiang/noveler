import { useState, useEffect } from 'react';
import { templateApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';

export interface TemplateSelectorProps {
  selectedTemplateId: string | null;
  onSelect: (templateId: string | null) => void;
}

interface TemplateItem {
  id: string;
  name: string;
  genre: string;
  description: string;
}

const GENRE_LABELS: Record<string, string> = {
  fantasy: '奇幻',
  scifi: '科幻',
  modern: '現代',
  historical: '歷史',
};

export function TemplateSelector({ selectedTemplateId, onSelect }: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    templateApi.list().then(result => {
      if (result.success) {
        setTemplates(result.data.map(t => ({
          id: t.id,
          name: t.name,
          genre: t.genre,
          description: t.description,
        })));
      }
      setLoading(false);
    });
  }, []);

  return (
    <div>
      <label
        style={{
          fontSize: 14,
          color: 'var(--color-text-secondary)',
          display: 'block',
          marginBottom: 8,
        }}
      >
        {zhTW.template.selectTemplate}
      </label>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
          {zhTW.template.loading}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* No template option */}
          <button
            onClick={() => onSelect(null)}
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${selectedTemplateId === null ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: selectedTemplateId === null ? 'var(--color-accent-subtle)' : 'transparent',
              color: selectedTemplateId === null ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 13,
            }}
          >
            {zhTW.template.noTemplate}
          </button>

          {/* Template options */}
          {templates.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => onSelect(tpl.id)}
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${selectedTemplateId === tpl.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: selectedTemplateId === tpl.id ? 'var(--color-accent-subtle)' : 'var(--color-bg-secondary)',
                color: selectedTemplateId === tpl.id ? 'var(--color-accent)' : 'var(--color-text-primary)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 500, fontSize: 14 }}>{tpl.name}</span>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 999,
                    background: 'var(--color-accent-subtle)',
                    color: 'var(--color-accent)',
                  }}
                >
                  {GENRE_LABELS[tpl.genre] ?? tpl.genre}
                </span>
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: selectedTemplateId === tpl.id ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  lineHeight: 1.4,
                }}
              >
                {tpl.description}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
