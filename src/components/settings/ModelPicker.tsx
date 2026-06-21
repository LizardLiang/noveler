import { useMemo, useState } from 'react';
import { aiApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';
import type { ModelInfo } from '@/types/ipc';

interface ModelPickerProps {
  baseUrl: string;
  apiKey: string;
  providerId?: string;
  value: string;
  onChange: (model: string) => void;
}

// Format a per-token USD price as a per-1M-tokens figure (OpenRouter prices are per token).
function formatPrice(perToken: number): string {
  const perMillion = perToken * 1_000_000;
  return `$${perMillion < 1 ? perMillion.toFixed(3) : perMillion.toFixed(2)}`;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-secondary)',
  color: 'var(--color-text-primary)',
  fontSize: 14,
  outline: 'none',
};

export function ModelPicker({ baseUrl, apiKey, providerId, value, onChange }: ModelPickerProps) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);

  // Pricing/free filter only make sense when the provider reports prices (OpenRouter).
  const hasPricing = useMemo(() => !!models?.some(m => m.pricePrompt != null), [models]);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await aiApi.getModels({ baseUrl, apiKey, providerId });
      if (result.success) {
        setModels(result.data);
      } else {
        setError(result.error.message || zhTW.settings.fetchModelsFailed);
      }
    } catch {
      setError(zhTW.settings.fetchModelsFailed);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = search.trim().toLowerCase();
    return models.filter(m => {
      if (freeOnly && hasPricing && !m.isFree) return false;
      if (!q) return true;
      return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    });
  }, [models, search, freeOnly, hasPricing]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontSize: 13, color: 'var(--color-text-secondary)', display: 'block' }}>
        {zhTW.settings.defaultModel}
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={fetchModels}
          disabled={loading}
          style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 13,
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? zhTW.settings.fetchingModels : zhTW.settings.fetchModels}
        </button>
      </div>

      {error && (
        <span style={{ fontSize: 12, color: 'var(--color-error)' }}>{error}</span>
      )}

      {models && (
        <div
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-secondary)',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={zhTW.settings.searchModels}
              style={{ ...inputStyle, flex: 1, padding: '6px 10px', fontSize: 13 }}
            />
            {hasPricing && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                <input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} />
                {zhTW.settings.freeOnly}
              </label>
            )}
          </div>

          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filtered.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '6px 8px' }}>
                {zhTW.settings.noModelsFound}
              </span>
            ) : (
              filtered.map(m => {
                const selected = m.id === value;
                return (
                  <button
                    key={m.id}
                    onClick={() => onChange(m.id)}
                    title={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${selected ? 'var(--color-accent)' : 'transparent'}`,
                      background: selected ? 'var(--color-accent-subtle)' : 'transparent',
                      color: 'var(--color-text-primary)',
                      cursor: 'pointer',
                      fontSize: 13,
                      textAlign: 'left',
                      width: '100%',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.name}
                    </span>
                    {m.isFree ? (
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: 'var(--color-success, #22c55e)' }}>
                        {zhTW.settings.free}
                      </span>
                    ) : m.pricePrompt != null && m.priceCompletion != null ? (
                      <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        {formatPrice(m.pricePrompt)} / {formatPrice(m.priceCompletion)} {zhTW.settings.pricePerMTokens}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
