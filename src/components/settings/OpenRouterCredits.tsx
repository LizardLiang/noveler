import { useState } from 'react';
import { aiApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';
import type { CreditsInfo } from '@/types/ipc';

interface OpenRouterCreditsProps {
  baseUrl: string;
  apiKey: string;
  providerId?: string;
}

export function OpenRouterCredits({ baseUrl, apiKey, providerId }: OpenRouterCreditsProps) {
  const [credits, setCredits] = useState<CreditsInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCredits = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await aiApi.getCredits({ baseUrl, apiKey, providerId });
      if (result.success) {
        setCredits(result.data);
      } else {
        setError(result.error.message || zhTW.settings.fetchCreditsFailed);
      }
    } catch {
      setError(zhTW.settings.fetchCreditsFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button
        onClick={fetchCredits}
        disabled={loading}
        style={{
          padding: '6px 12px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
          background: 'transparent',
          color: 'var(--color-text-secondary)',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 13,
        }}
      >
        {loading ? zhTW.settings.fetchingModels : zhTW.settings.credits}
      </button>
      {credits && (
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {zhTW.settings.creditsRemaining}: <strong style={{ color: 'var(--color-text-primary)' }}>${credits.remaining.toFixed(2)}</strong>
          {' · '}
          {zhTW.settings.creditsUsed}: ${credits.totalUsage.toFixed(2)}
        </span>
      )}
      {error && <span style={{ fontSize: 12, color: 'var(--color-error)' }}>{error}</span>}
    </div>
  );
}
