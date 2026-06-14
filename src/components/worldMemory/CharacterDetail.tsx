import { useState, useCallback, useRef, type ReactNode } from 'react';
import type { Character } from '@/types/models';
import { zhTW } from '@/i18n/zh-TW';

interface CharacterDetailProps {
  character: Character;
  onUpdate: (id: string, updates: Partial<Character>) => void;
  onClose: () => void;
}

interface InlineFieldProps {
  label: string;
  value: string;
  onSave: (value: string) => void;
  multiline?: boolean;
}

function InlineField({ label, value, onSave, multiline = false }: InlineFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const handleBlur = useCallback(() => {
    setEditing(false);
    if (draft !== value) {
      onSave(draft);
    }
  }, [draft, value, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!multiline && e.key === 'Enter') {
        (inputRef.current as HTMLInputElement | null)?.blur();
      }
      if (e.key === 'Escape') {
        setDraft(value);
        setEditing(false);
      }
    },
    [multiline, value],
  );

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: 'var(--color-bg-primary)',
    border: '1px solid var(--color-accent)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    fontSize: 13,
    lineHeight: '1.5',
    padding: '8px 10px',
    outline: 'none',
    fontFamily: 'inherit',
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-text-tertiary)',
          marginBottom: 4,
          letterSpacing: '0.5px',
        }}
      >
        {label}
      </div>
      {editing ? (
        multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            style={inputStyle}
          />
        )
      ) : (
        <div
          onClick={startEdit}
          title={zhTW.worldMemory.clickToEdit}
          style={{
            fontSize: 13,
            lineHeight: '1.5',
            color: value ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            cursor: 'text',
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid transparent',
            minHeight: multiline ? 60 : 36,
            whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
            overflow: 'hidden',
            textOverflow: multiline ? undefined : 'ellipsis',
            transition: 'border-color 0.15s, background 0.15s',
            fontStyle: value ? 'normal' : 'italic',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.border = '1px dashed var(--color-border-strong)';
            e.currentTarget.style.background = 'var(--color-bg-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.border = '1px solid transparent';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {value || '點擊編輯...'}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--color-text-muted)',
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        marginBottom: 12,
        marginTop: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span>{children}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
    </div>
  );
}

const STATUS_OPTIONS: { value: Character['status']; label: string; color: string }[] = [
  { value: 'active', label: zhTW.worldMemory.charStatusActive, color: 'var(--color-success)' },
  { value: 'retired', label: zhTW.worldMemory.charStatusRetired, color: 'var(--color-text-tertiary)' },
  { value: 'deceased', label: zhTW.worldMemory.charStatusDeceased, color: 'var(--color-error)' },
];

export function CharacterDetail({ character, onUpdate, onClose }: CharacterDetailProps) {
  const save = useCallback(
    (field: keyof Character, value: unknown) => {
      onUpdate(character.id, { [field]: value });
    },
    [character.id, onUpdate],
  );

  const currentStatus = STATUS_OPTIONS.find(s => s.value === character.status);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Detail header with back button */}
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            padding: '6px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.15s',
          }}
          title="返回列表"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9,2 4,7 9,12" />
          </svg>
        </button>

        {/* Character avatar + name */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'var(--color-accent-subtle)',
            border: '2px solid var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--color-accent)',
          }}
        >
          {character.name.charAt(0)}
        </div>

        <div style={{ flex: 1, overflow: 'hidden' }}>
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.2,
            }}
          >
            {character.name}
          </h3>
          {character.faction && (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 1 }}>
              {character.faction}
            </div>
          )}
        </div>

        {/* Status badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            borderRadius: 12,
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: currentStatus?.color ?? 'var(--color-text-tertiary)',
            }}
          />
          <select
            value={character.status}
            onChange={(e) => save('status', e.target.value as Character['status'])}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
              outline: 'none',
              padding: 0,
            }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 20px 24px',
        }}
      >
        {/* Basic info section */}
        <SectionHeader>基本資訊</SectionHeader>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <InlineField
            label={zhTW.worldMemory.charName}
            value={character.name}
            onSave={(v) => save('name', v)}
          />
          <InlineField
            label={zhTW.worldMemory.charFaction}
            value={character.faction}
            onSave={(v) => save('faction', v)}
          />
        </div>

        {/* Aliases */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--color-text-tertiary)',
              marginBottom: 4,
              letterSpacing: '0.5px',
            }}
          >
            {zhTW.worldMemory.charAliases}
          </div>
          <div
            style={{
              fontSize: 13,
              color: character.aliases.length > 0 ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
              padding: '8px 10px',
              fontStyle: character.aliases.length > 0 ? 'normal' : 'italic',
            }}
          >
            {character.aliases.length > 0 ? character.aliases.join('、') : '—'}
          </div>
        </div>

        {/* Description section */}
        <SectionHeader>角色描述</SectionHeader>

        <InlineField
          label={zhTW.worldMemory.charAppearance}
          value={character.appearance}
          onSave={(v) => save('appearance', v)}
          multiline
        />
        <InlineField
          label={zhTW.worldMemory.charPersonality}
          value={character.personality}
          onSave={(v) => save('personality', v)}
          multiline
        />
        <InlineField
          label={zhTW.worldMemory.charVoiceStyle}
          value={character.voiceStyle}
          onSave={(v) => save('voiceStyle', v)}
          multiline
        />

        {/* Background section */}
        <SectionHeader>背景設定</SectionHeader>

        <InlineField
          label={zhTW.worldMemory.charBackground}
          value={character.background}
          onSave={(v) => save('background', v)}
          multiline
        />
        <InlineField
          label={zhTW.worldMemory.charAbilities}
          value={character.abilities}
          onSave={(v) => save('abilities', v)}
          multiline
        />
      </div>
    </div>
  );
}
