import { useState, useRef, useCallback, useEffect } from 'react';
import { zhTW } from '@/i18n/zh-TW';

interface OpeningInputProps {
  onSubmit: (text: string) => void;
  /** True while the opening is being created (IPC in flight). */
  creating?: boolean;
  disabled?: boolean;
}

/**
 * 開場白 — lets the user write/paste the story's opening passage. The text is
 * saved directly as the story's first paragraph (no AI generation); the AI then
 * produces direction options and continues from there.
 */
export function OpeningInput({ onSubmit, creating = false, disabled = false }: OpeningInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);

  // Auto-resize textarea to fit content (min 88px, max 320px)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 88), 320)}px`;
  }, [value]);

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    if (!text || creating || disabled) return;
    onSubmit(text);
  }, [value, creating, disabled, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Enter submits; plain Enter inserts a newline (openings are prose).
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit, isComposing]);

  const canSubmit = value.trim().length > 0 && !creating && !disabled;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: '100%',
        maxWidth: 560,
        padding: '20px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
        {zhTW.chat.openingTitle}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
        {zhTW.chat.openingHint}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        placeholder={zhTW.chat.openingPlaceholder}
        disabled={creating || disabled}
        style={{
          width: '100%',
          minHeight: 88,
          resize: 'none',
          padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
          color: 'var(--color-text-primary)',
          fontSize: 14,
          lineHeight: 1.6,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
          outline: 'none',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
      />

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          alignSelf: 'flex-end',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 18px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-accent)',
          background: canSubmit ? 'var(--color-accent)' : 'var(--color-accent-subtle)',
          color: canSubmit ? 'white' : 'var(--color-accent)',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          fontSize: 14,
          fontWeight: 600,
          opacity: canSubmit ? 1 : 0.6,
          transition: 'all var(--transition-fast)',
        }}
      >
        {creating ? (
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'currentColor',
              animation: 'pulse 1.4s ease-in-out infinite',
            }}
          />
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        )}
        {creating ? zhTW.chat.openingCreating : zhTW.chat.openingStart}
      </button>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}
