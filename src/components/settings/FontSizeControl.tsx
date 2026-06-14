import { useUIStore } from '@/stores/uiStore';
import { settingsApi } from '@/lib/ipc';

const FONT_SIZES = [12, 14, 16, 18, 20] as const;
type FontSize = (typeof FONT_SIZES)[number];

const FONT_SIZE_LABELS: Record<FontSize, string> = {
  12: '極小',
  14: '小',
  16: '標準',
  18: '大',
  20: '極大',
};

export function FontSizeControl() {
  const { fontSize, setFontSize } = useUIStore();

  const handleChange = (size: FontSize) => {
    setFontSize(size);
    // Persist to config
    settingsApi.set('fontSize', size).catch(() => {
      // Ignore errors silently
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        文字大小
      </label>
      <div style={{ display: 'flex', gap: 4 }}>
        {FONT_SIZES.map(size => (
          <button
            key={size}
            onClick={() => handleChange(size)}
            title={FONT_SIZE_LABELS[size]}
            style={{
              flex: 1,
              padding: '6px 4px',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${fontSize === size ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: fontSize === size ? 'var(--color-accent-subtle)' : 'transparent',
              color: fontSize === size ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: `${size * 0.6}px`,
              fontWeight: fontSize === size ? 600 : 400,
              transition: 'all var(--transition-fast)',
            }}
          >
            A
          </button>
        ))}
      </div>
      <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
        目前：{FONT_SIZE_LABELS[fontSize as FontSize] ?? '標準'} ({fontSize}px)
      </span>
    </div>
  );
}
