import { zhTW } from '@/i18n/zh-TW';

interface StorySuggestionsProps {
  suggestions: string[];
  loading: boolean;
  onSelect: (suggestion: string) => void;
  onContinue: () => void;
  onRetry: () => void;
}

export function StorySuggestions({
  suggestions,
  loading,
  onSelect,
  onContinue,
  onRetry,
}: StorySuggestionsProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 0',
      }}
    >
      {/* Continue button */}
      <button
        onClick={onContinue}
        disabled={loading}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '10px 20px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-accent)',
          background: 'var(--color-accent-subtle)',
          color: 'var(--color-accent)',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: 14,
          fontWeight: 600,
          transition: 'all var(--transition-fast)',
          opacity: loading ? 0.5 : 1,
        }}
        onMouseEnter={e => {
          if (!loading) {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent)';
            (e.currentTarget as HTMLButtonElement).style.color = 'white';
          }
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-subtle)';
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-accent)';
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
        {zhTW.chat.continueStory}
      </button>

      {/* Suggestions section */}
      {loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 0',
            color: 'var(--color-text-tertiary)',
            fontSize: 13,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-accent)',
              animation: 'pulse 1.4s ease-in-out infinite',
            }}
          />
          {zhTW.chat.suggestionsLoading}
        </div>
      )}

      {!loading && suggestions.length > 0 && (
        <>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              fontWeight: 500,
              padding: '4px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{zhTW.chat.suggestionsTitle}</span>
            <button
              onClick={onRetry}
              title={zhTW.chat.suggestionsRetry}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: '2px 4px',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-accent)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-muted)';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 7A5 5 0 1 1 7 12" />
                <polyline points="2,4 2,7 5,7" />
              </svg>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {suggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => onSelect(suggestion)}
                style={{
                  textAlign: 'left',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: '1.5',
                  transition: 'all var(--transition-fast)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-accent)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-subtle)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-surface)';
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: 'var(--color-accent-subtle)',
                    color: 'var(--color-accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {idx + 1}
                </span>
                <span>{suggestion}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}
