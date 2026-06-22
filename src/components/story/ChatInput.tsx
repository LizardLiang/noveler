import { useRef, useState, useCallback, useEffect } from 'react';
import { zhTW } from '@/i18n/zh-TW';

interface ChatInputProps {
  onSend: (message: string) => void;
  onCancel: () => void;
  isGenerating: boolean;
  disabled?: boolean;
  /** Per-generation target word count override; undefined = use the project default. */
  wordCount?: number;
  onWordCountChange?: (value: number | undefined) => void;
}

export function ChatInput({ onSend, onCancel, isGenerating, disabled, wordCount, onWordCountChange }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ignore Enter while an IME is composing (e.g. selecting Chinese characters),
      // otherwise confirming a candidate would wrongly send the message.
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!isGenerating && !disabled && value.trim()) {
          const msg = value.trim();
          setValue('');
          onSend(msg);
        }
      }
    },
    [isGenerating, disabled, value, onSend],
  );

  const handleSend = useCallback(() => {
    if (!isGenerating && !disabled && value.trim()) {
      const msg = value.trim();
      setValue('');
      onSend(msg);
    }
  }, [isGenerating, disabled, value, onSend]);

  const isDisabled = disabled || (!isGenerating && !value.trim());

  return (
    <div
      style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
      }}
    >
      {onWordCountChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label
            htmlFor="gen-word-count"
            title={zhTW.chat.wordCountTooltip}
            style={{ fontSize: 12, color: 'var(--color-text-tertiary)', cursor: 'help' }}
          >
            {zhTW.chat.wordCountLabel}
          </label>
          <input
            id="gen-word-count"
            type="number"
            min={1}
            step={50}
            value={wordCount ?? ''}
            placeholder={zhTW.chat.wordCountPlaceholder}
            disabled={isGenerating || disabled}
            onChange={e => {
              const raw = e.target.value.trim();
              const n = Number(raw);
              onWordCountChange(raw === '' || !Number.isFinite(n) || n <= 0 ? undefined : n);
            }}
            style={{
              width: 90,
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
              fontSize: 12,
              outline: 'none',
              opacity: disabled ? 0.5 : 1,
            }}
          />
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? '請先在設定中配置 AI 供應商...' : zhTW.chat.inputPlaceholder}
          disabled={isGenerating || disabled}
          rows={1}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text-primary)',
            fontSize: 'var(--font-size-story)',
            lineHeight: '1.6',
            resize: 'none',
            outline: 'none',
            overflow: 'hidden',
            minHeight: 44,
            maxHeight: 200,
            fontFamily: 'inherit',
            transition: 'border-color var(--transition-fast)',
            opacity: disabled ? 0.5 : 1,
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = 'var(--color-accent)';
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = 'var(--color-border)';
          }}
        />

        {isGenerating ? (
          <button
            onClick={onCancel}
            title={zhTW.chat.cancel}
            style={{
              padding: '10px 16px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-error)',
              background: 'transparent',
              color: 'var(--color-error)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 44,
              whiteSpace: 'nowrap',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2" y="2" width="8" height="8" rx="1" />
            </svg>
            {zhTW.chat.cancel}
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={isDisabled}
            title={zhTW.chat.send}
            style={{
              padding: '10px 16px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: isDisabled ? 'var(--color-bg-tertiary)' : 'var(--color-accent)',
              color: isDisabled ? 'var(--color-text-muted)' : 'white',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 500,
              flexShrink: 0,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'background var(--transition-fast)',
              whiteSpace: 'nowrap',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l4 2.5v3.5l2.5-2L12 2z" />
            </svg>
            {zhTW.chat.send}
          </button>
        )}
      </div>

      {isGenerating && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-tertiary)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
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
          {zhTW.chat.generating}
        </div>
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
