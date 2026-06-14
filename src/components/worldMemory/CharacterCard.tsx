import { useState } from 'react';
import type { Character } from '@/types/models';
import { zhTW } from '@/i18n/zh-TW';

interface CharacterCardProps {
  character: Character;
  isSelected: boolean;
  onClick: () => void;
  onDelete: (id: string) => void;
}

const STATUS_COLORS: Record<Character['status'], string> = {
  active: 'var(--color-success)',
  retired: 'var(--color-text-tertiary)',
  deceased: 'var(--color-error)',
};

const STATUS_LABELS: Record<Character['status'], string> = {
  active: zhTW.worldMemory.charStatusActive,
  retired: zhTW.worldMemory.charStatusRetired,
  deceased: zhTW.worldMemory.charStatusDeceased,
};

export function CharacterCard({ character, isSelected, onClick, onDelete }: CharacterCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hovered, setHovered] = useState(false);

  const snippet = character.personality || character.background || character.appearance;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowDeleteConfirm(false); }}
      style={{
        padding: '12px 14px',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${isSelected ? 'var(--color-accent)' : hovered ? 'var(--color-border-strong)' : 'var(--color-border)'}`,
        background: isSelected ? 'var(--color-accent-subtle)' : hovered ? 'var(--color-bg-hover)' : 'var(--color-surface)',
        cursor: 'pointer',
        marginBottom: 8,
        position: 'relative',
        transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
        boxShadow: hovered ? 'var(--shadow-sm)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Avatar */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: isSelected ? 'var(--color-accent)' : 'var(--color-bg-primary)',
            border: `1.5px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 15,
            fontWeight: 700,
            color: isSelected ? 'white' : 'var(--color-text-secondary)',
            transition: 'all 0.15s',
          }}
        >
          {character.name.charAt(0)}
        </div>

        <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {character.name}
            </div>
            {/* Status dot */}
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: STATUS_COLORS[character.status],
                flexShrink: 0,
              }}
              title={STATUS_LABELS[character.status]}
            />
          </div>
          {character.faction && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-text-tertiary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 1,
              }}
            >
              {character.faction}
            </div>
          )}
          {snippet && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 4,
              }}
            >
              {snippet}
            </div>
          )}
        </div>

        {/* Delete button */}
        {showDeleteConfirm ? (
          <div
            style={{ display: 'flex', gap: 4, flexShrink: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onDelete(character.id)}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                background: 'var(--color-error)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              確定
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                background: 'var(--color-surface)',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              color: 'var(--color-text-tertiary)',
              opacity: hovered ? 0.7 : 0,
              transition: 'opacity 0.15s',
              flexShrink: 0,
            }}
            title={zhTW.worldMemory.delete}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="2" x2="10" y2="10" />
              <line x1="10" y1="2" x2="2" y2="10" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
