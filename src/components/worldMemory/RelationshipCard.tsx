import { useState } from 'react';
import type { Relationship } from '@/types/models';
import { zhTW } from '@/i18n/zh-TW';

interface RelationshipCardProps {
  relationship: Relationship;
  onUpdate: (id: string, updates: { relationshipType?: string; affinityScore?: number; description?: string }) => void;
  onDelete: (id: string) => void;
}

function AffinityBar({ score }: { score: number }) {
  const pct = ((score + 100) / 200) * 100;
  const color = score >= 0 ? 'var(--color-accent)' : 'var(--color-error)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 4,
          background: 'var(--color-border)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            transition: 'width 0.2s',
            borderRadius: 2,
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', minWidth: 32, textAlign: 'right', fontWeight: 600 }}>
        {score > 0 ? `+${score}` : score}
      </span>
    </div>
  );
}

export function RelationshipCard({ relationship, onUpdate, onDelete }: RelationshipCardProps) {
  const [editing, setEditing] = useState(false);
  const [relType, setRelType] = useState(relationship.relationshipType);
  const [affinity, setAffinity] = useState(relationship.affinityScore);
  const [desc, setDesc] = useState(relationship.description);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hovered, setHovered] = useState(false);

  const nameA = relationship.characterAName ?? relationship.characterAId;
  const nameB = relationship.characterBName ?? relationship.characterBId;

  const handleSave = () => {
    onUpdate(relationship.id, {
      relationshipType: relType,
      affinityScore: affinity,
      description: desc,
    });
    setEditing(false);
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: 'var(--color-bg-primary)',
    border: '1px solid var(--color-accent)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    fontSize: 13,
    padding: '8px 10px',
    outline: 'none',
    fontFamily: 'inherit',
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowDeleteConfirm(false); }}
      style={{
        padding: '12px 14px',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${hovered ? 'var(--color-border-strong)' : 'var(--color-border)'}`,
        background: hovered ? 'var(--color-bg-hover)' : 'var(--color-surface)',
        marginBottom: 8,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Character names */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            background: 'var(--color-bg-primary)',
            padding: '3px 8px',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
          }}
        >
          {nameA}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>↔</span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            background: 'var(--color-bg-primary)',
            padding: '3px 8px',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
          }}
        >
          {nameB}
        </span>
        <div style={{ flex: 1 }} />

        {/* Actions */}
        {!editing && (
          <div style={{ display: 'flex', gap: 4, opacity: hovered ? 1 : 0, transition: 'opacity 0.15s' }}>
            <button
              onClick={() => setEditing(true)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-tertiary)',
                padding: 4,
              }}
              title={zhTW.worldMemory.edit}
            >
              <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M8 2l2 2-6 6H2V8l6-6z" />
              </svg>
            </button>
            {showDeleteConfirm ? (
              <>
                <button
                  onClick={() => onDelete(relationship.id)}
                  style={{ fontSize: 11, padding: '2px 6px', background: 'var(--color-error)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                >
                  確定
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  style={{ fontSize: 11, padding: '2px 6px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--color-text-secondary)' }}
                >
                  取消
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-tertiary)',
                  padding: 4,
                }}
                title={zhTW.worldMemory.delete}
              >
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="2" y1="2" x2="10" y2="10" />
                  <line x1="10" y1="2" x2="2" y2="10" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 4, letterSpacing: '0.5px' }}>{zhTW.worldMemory.relType}</div>
            <input type="text" value={relType} onChange={(e) => setRelType(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 4, letterSpacing: '0.5px' }}>
              {zhTW.worldMemory.relAffinity}: {affinity}
            </div>
            <input type="range" min="-100" max="100" value={affinity} onChange={(e) => setAffinity(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--color-accent)' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 4, letterSpacing: '0.5px' }}>{zhTW.worldMemory.relDescription}</div>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setEditing(false)}
              style={{
                fontSize: 12,
                padding: '6px 14px',
                background: 'transparent',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
              }}
            >
              {zhTW.worldMemory.cancel}
            </button>
            <button
              onClick={handleSave}
              style={{
                fontSize: 12,
                padding: '6px 14px',
                background: 'var(--color-accent)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                color: 'white',
                fontWeight: 600,
              }}
            >
              {zhTW.worldMemory.save}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-accent)',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            {relationship.relationshipType}
          </div>
          <AffinityBar score={relationship.affinityScore} />
          {relationship.description && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-text-secondary)',
                marginTop: 8,
                lineHeight: '1.5',
              }}
            >
              {relationship.description}
            </div>
          )}
        </>
      )}
    </div>
  );
}
