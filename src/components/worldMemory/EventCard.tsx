import { useState } from 'react';
import type { StoryEvent, EventHorizon } from '@/types/models';
import { zhTW } from '@/i18n/zh-TW';

const HORIZON_LABEL: Record<EventHorizon, string> = {
  short: zhTW.worldMemory.horizonShort,
  mid: zhTW.worldMemory.horizonMid,
  long: zhTW.worldMemory.horizonLong,
};

interface EventCardProps {
  event: StoryEvent;
  onUpdate: (
    id: string,
    updates: {
      name?: string;
      description?: string;
      storyTimestamp?: string;
      impact?: string;
      participatingCharacters?: string[];
      status?: 'occurred' | 'planned';
      horizon?: EventHorizon;
      orderInHorizon?: number;
    },
  ) => void;
  onDelete: (id: string) => void;
  onMoveUp?: (id: string) => void;
  onMoveDown?: (id: string) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

export function EventCard({ event, onUpdate, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown }: EventCardProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(event.name);
  const [desc, setDesc] = useState(event.description);
  const [time, setTime] = useState(event.storyTimestamp);
  const [impact, setImpact] = useState(event.impact);
  const [status, setStatus] = useState<'occurred' | 'planned'>(event.status);
  const [horizon, setHorizon] = useState<EventHorizon>(event.horizon);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hovered, setHovered] = useState(false);

  const isPlanned = event.status === 'planned';

  const handleSave = () => {
    onUpdate(event.id, { name, description: desc, storyTimestamp: time, impact, status, horizon });
    setEditing(false);
  };

  const toggleStatus = () => {
    const next = event.status === 'planned' ? 'occurred' : 'planned';
    setStatus(next);
    onUpdate(event.id, { status: next });
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
      style={{
        display: 'flex',
        gap: 10,
        marginBottom: 4,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowDeleteConfirm(false); }}
    >
      {/* Timeline line + dot */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flexShrink: 0,
          width: 18,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: isPlanned ? 'transparent' : 'var(--color-accent)',
            border: isPlanned ? '2px dashed var(--color-text-tertiary)' : 'none',
            boxSizing: 'border-box',
            flexShrink: 0,
            marginTop: 14,
            boxShadow: isPlanned ? 'none' : '0 0 0 3px var(--color-accent-subtle)',
          }}
        />
        <div
          style={{
            width: 2,
            flex: 1,
            background: 'var(--color-border)',
            marginTop: 4,
          }}
        />
      </div>

      {/* Card */}
      <div
        style={{
          flex: 1,
          padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          border: `1px solid ${hovered ? 'var(--color-border-strong)' : 'var(--color-border)'}`,
          background: hovered ? 'var(--color-bg-hover)' : 'var(--color-surface)',
          marginBottom: 8,
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 4, letterSpacing: '0.5px' }}>{zhTW.worldMemory.eventName}</div>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 4, letterSpacing: '0.5px' }}>{zhTW.worldMemory.eventDescription}</div>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 4, letterSpacing: '0.5px' }}>{zhTW.worldMemory.eventTime}</div>
                <input type="text" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 4, letterSpacing: '0.5px' }}>{zhTW.worldMemory.eventImpact}</div>
                <input type="text" value={impact} onChange={(e) => setImpact(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 4, letterSpacing: '0.5px' }}>{zhTW.worldMemory.eventStatus}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['occurred', 'planned'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    style={{
                      flex: 1,
                      fontSize: 12,
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      border: `1px solid ${status === s ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: status === s ? 'var(--color-accent-subtle)' : 'transparent',
                      color: status === s ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      fontWeight: status === s ? 600 : 400,
                    }}
                  >
                    {s === 'occurred' ? zhTW.worldMemory.eventStatusOccurred : zhTW.worldMemory.eventStatusPlanned}
                  </button>
                ))}
              </div>
            </div>
            {status === 'planned' && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 4, letterSpacing: '0.5px' }}>{zhTW.worldMemory.eventHorizon}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['short', 'mid', 'long'] as const).map((h) => (
                    <button
                      key={h}
                      onClick={() => setHorizon(h)}
                      style={{
                        flex: 1,
                        fontSize: 12,
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        border: `1px solid ${horizon === h ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        background: horizon === h ? 'var(--color-accent-subtle)' : 'transparent',
                        color: horizon === h ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                        fontWeight: horizon === h ? 600 : 400,
                      }}
                    >
                      {HORIZON_LABEL[h]}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {event.name}
                </span>
                {isPlanned && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '1px 7px',
                      borderRadius: 10,
                      background: 'var(--color-accent-subtle)',
                      border: '1px solid var(--color-accent)',
                      color: 'var(--color-accent)',
                      letterSpacing: '0.5px',
                    }}
                    title={
                      event.horizon === 'short'
                        ? zhTW.worldMemory.horizonShortHint
                        : event.horizon === 'mid'
                          ? zhTW.worldMemory.horizonMidHint
                          : zhTW.worldMemory.horizonLongHint
                    }
                  >
                    {HORIZON_LABEL[event.horizon]}
                  </span>
                )}
                {event.source === 'director' && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '1px 7px',
                      borderRadius: 10,
                      background: 'var(--color-accent-subtle)',
                      border: '1px solid var(--color-accent)',
                      color: 'var(--color-accent)',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {zhTW.worldMemory.eventSourceDirector}
                  </span>
                )}
              </div>
              {event.storyTimestamp && (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                  {event.storyTimestamp}
                </div>
              )}
              {event.description && (
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8, lineHeight: '1.5' }}>
                  {event.description}
                </div>
              )}
              {event.participatingCharacters.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {event.participatingCharacters.map((charName, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        background: 'var(--color-bg-primary)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 10,
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {charName}
                    </span>
                  ))}
                </div>
              )}
              {event.impact && (
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 6, fontStyle: 'italic', lineHeight: '1.4' }}>
                  {event.impact}
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, opacity: hovered ? 1 : 0, transition: 'opacity 0.15s' }}>
              {isPlanned && onMoveUp && (
                <button
                  onClick={() => onMoveUp(event.id)}
                  disabled={!canMoveUp}
                  style={{ background: 'transparent', border: 'none', cursor: canMoveUp ? 'pointer' : 'default', color: 'var(--color-text-tertiary)', padding: 4, opacity: canMoveUp ? 1 : 0.3 }}
                  title={zhTW.worldMemory.moveUp}
                >
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9.5V3M3 5.5L6 2.5l3 3" />
                  </svg>
                </button>
              )}
              {isPlanned && onMoveDown && (
                <button
                  onClick={() => onMoveDown(event.id)}
                  disabled={!canMoveDown}
                  style={{ background: 'transparent', border: 'none', cursor: canMoveDown ? 'pointer' : 'default', color: 'var(--color-text-tertiary)', padding: 4, opacity: canMoveDown ? 1 : 0.3 }}
                  title={zhTW.worldMemory.moveDown}
                >
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2.5V9M3 6.5L6 9.5l3-3" />
                  </svg>
                </button>
              )}
              <button
                onClick={toggleStatus}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: isPlanned ? 'var(--color-accent)' : 'var(--color-text-tertiary)', padding: 4 }}
                title={isPlanned ? `${zhTW.worldMemory.eventStatusPlanned} → ${zhTW.worldMemory.eventStatusOccurred}` : `${zhTW.worldMemory.eventStatusOccurred} → ${zhTW.worldMemory.eventStatusPlanned}`}
              >
                {isPlanned ? (
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                    <circle cx="6" cy="6" r="4" strokeDasharray="2 1.5" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => setEditing(true)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: 4 }}
                title={zhTW.worldMemory.edit}
              >
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M8 2l2 2-6 6H2V8l6-6z" />
                </svg>
              </button>
              {showDeleteConfirm ? (
                <>
                  <button onClick={() => onDelete(event.id)} style={{ fontSize: 10, padding: '2px 6px', background: 'var(--color-error)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>確定</button>
                  <button onClick={() => setShowDeleteConfirm(false)} style={{ fontSize: 10, padding: '2px 6px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', color: 'var(--color-text-secondary)' }}>取消</button>
                </>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: 4 }}
                  title={zhTW.worldMemory.delete}
                >
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="2" y1="2" x2="10" y2="10" />
                    <line x1="10" y1="2" x2="2" y2="10" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
