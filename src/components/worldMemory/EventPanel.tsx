import { useState, useCallback, useEffect, useRef } from 'react';
import { useWorldMemoryStore } from '@/stores/worldMemoryStore';
import { useProjectStore } from '@/stores/projectStore';
import { useStoryStore } from '@/stores/storyStore';
import { EventCard } from './EventCard';
import { ipcOn } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';
import type { StoryEvent, EventHorizon } from '@/types/models';

// Main → renderer notification fired after the plot-compliance pass advances the
// horizon queue (keep in sync with IPC_CHANNELS.WORLD_MEMORY_EVENTS_CHANGED).
const EVENTS_CHANGED_CHANNEL = 'worldMemory:eventsChanged';

const HORIZON_ORDER: EventHorizon[] = ['short', 'mid', 'long'];
const HORIZON_LABEL: Record<EventHorizon, string> = {
  short: zhTW.worldMemory.horizonShort,
  mid: zhTW.worldMemory.horizonMid,
  long: zhTW.worldMemory.horizonLong,
};
const HORIZON_HINT: Record<EventHorizon, string> = {
  short: zhTW.worldMemory.horizonShortHint,
  mid: zhTW.worldMemory.horizonMidHint,
  long: zhTW.worldMemory.horizonLongHint,
};

function sortByOrder(a: StoryEvent, b: StoryEvent): number {
  return a.orderInHorizon !== b.orderInHorizon
    ? a.orderInHorizon - b.orderInHorizon
    : a.createdAt.localeCompare(b.createdAt);
}

const dropdownItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 14px',
  background: 'none',
  border: 'none',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export function EventPanel() {
  const { currentProject } = useProjectStore();
  const { currentBranchId } = useStoryStore();
  const {
    events,
    characters,
    isLoading,
    loadEvents,
    createEvent,
    updateEventRemote,
    deleteEvent,
    deleteAllEvents,
    importEvents,
    importEventsText,
  } = useWorldMemoryStore();

  const [filterCharName, setFilterCharName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newStatus, setNewStatus] = useState<'occurred' | 'planned'>('occurred');
  const [newHorizon, setNewHorizon] = useState<EventHorizon>('mid');
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const importMenuRef = useRef<HTMLDivElement>(null);

  const projectId = currentProject?.id;
  const branchId = currentBranchId ?? '';

  useEffect(() => {
    if (projectId && branchId) {
      loadEvents(projectId, branchId).catch(() => { /* silent */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, branchId]);

  // Reload after the plot-compliance pass auto-advances the horizon queue.
  useEffect(() => {
    if (!projectId || !branchId) return;
    const dispose = ipcOn<{ projectId: string; branchId: string }>(
      EVENTS_CHANGED_CHANNEL,
      (_e, data) => {
        if (data?.projectId === projectId && data?.branchId === branchId) {
          loadEvents(projectId, branchId).catch(() => { /* silent */ });
        }
      },
    );
    return dispose;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, branchId]);

  useEffect(() => {
    if (!showImportMenu) return;
    const handle = (e: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setShowImportMenu(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showImportMenu]);

  const matchesFilter = useCallback(
    (e: StoryEvent) =>
      !filterCharName ||
      e.participatingCharacters.some((n) =>
        n.toLowerCase().includes(filterCharName.toLowerCase()),
      ),
    [filterCharName],
  );

  const filteredEvents = events.filter(matchesFilter);

  // Planned events grouped by horizon (sorted), and occurred history (newest first).
  const plannedByHorizon = (h: EventHorizon): StoryEvent[] =>
    filteredEvents.filter((e) => e.status === 'planned' && e.horizon === h).sort(sortByOrder);
  const occurredEvents = filteredEvents.filter((e) => e.status !== 'planned');
  const plannedCount = filteredEvents.filter((e) => e.status === 'planned').length;

  const handleAdd = useCallback(async () => {
    if (!projectId || !branchId || !newName) return;
    // Place a new planned event at the end of its horizon bucket.
    const orderInHorizon =
      newStatus === 'planned'
        ? events
            .filter((e) => e.status === 'planned' && e.horizon === newHorizon)
            .reduce((max, e) => Math.max(max, e.orderInHorizon + 1), 0)
        : 0;
    await createEvent(projectId, branchId, {
      name: newName,
      description: newDesc,
      status: newStatus,
      horizon: newHorizon,
      orderInHorizon,
    });
    setShowAddForm(false);
    setNewName('');
    setNewDesc('');
    setNewStatus('occurred');
    setNewHorizon('mid');
  }, [projectId, branchId, newName, newDesc, newStatus, newHorizon, events, createEvent]);

  const handleUpdate = useCallback(
    async (
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
    ) => {
      if (!projectId) return;
      await updateEventRemote(projectId, id, updates);
    },
    [projectId, updateEventRemote],
  );

  // Move a planned event up/down within its horizon bucket by reindexing siblings.
  const handleReorder = useCallback(
    async (id: string, direction: 'up' | 'down') => {
      if (!projectId) return;
      const target = events.find((e) => e.id === id);
      if (!target || target.status !== 'planned') return;
      const siblings = events
        .filter((e) => e.status === 'planned' && e.horizon === target.horizon)
        .sort(sortByOrder);
      const idx = siblings.findIndex((e) => e.id === id);
      const swapWith = direction === 'up' ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= siblings.length) return;
      const arr = [...siblings];
      [arr[idx], arr[swapWith]] = [arr[swapWith], arr[idx]];
      // Reassign sequential order indices (cheap; buckets are small).
      await Promise.all(
        arr.map((e, i) =>
          e.orderInHorizon === i
            ? Promise.resolve()
            : updateEventRemote(projectId, e.id, { orderInHorizon: i }),
        ),
      );
    },
    [projectId, events, updateEventRemote],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!projectId) return;
      await deleteEvent(projectId, id);
    },
    [projectId, deleteEvent],
  );

  const handleClearAll = useCallback(async () => {
    if (!projectId || !branchId || events.length === 0) return;
    if (!window.confirm(zhTW.worldMemory.clearAllEventsConfirm)) return;
    await deleteAllEvents(projectId, branchId);
  }, [projectId, branchId, events.length, deleteAllEvents]);

  const showImportResult = useCallback((result: { created: { id: string }[]; updated: { id: string }[]; skipped: string[] }) => {
    const msg = `${zhTW.worldMemory.importSuccess}: ${zhTW.worldMemory.importCreated} ${result.created.length}、${zhTW.worldMemory.importUpdated} ${result.updated.length}` +
      (result.skipped.length > 0 ? `\n${zhTW.worldMemory.importSkipped} ${result.skipped.length} (${result.skipped.join(', ')})` : '');
    alert(msg);
  }, []);

  const handleImportFile = useCallback(async () => {
    if (!projectId || !branchId) return;
    setShowImportMenu(false);
    try {
      const result = await importEvents(projectId, branchId);
      if (result) showImportResult(result);
    } catch (err) {
      console.error('importEvents error:', err);
    }
  }, [projectId, branchId, importEvents, showImportResult]);

  const handleOpenPasteModal = useCallback(() => {
    setShowImportMenu(false);
    setPasteText('');
    setPasteError('');
    setShowPasteModal(true);
  }, []);

  const handlePasteImport = useCallback(async () => {
    if (!projectId || !branchId || !pasteText.trim()) return;
    try {
      const result = await importEventsText(projectId, branchId, pasteText);
      if (result) {
        setShowPasteModal(false);
        setPasteText('');
        setPasteError('');
        showImportResult(result);
      } else {
        setPasteError(zhTW.worldMemory.importEventJsonError);
      }
    } catch (err) {
      console.error('importEventsText error:', err);
      setPasteError(zhTW.worldMemory.importEventJsonError);
    }
  }, [projectId, branchId, pasteText, importEventsText, showImportResult]);

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: 'var(--color-bg-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-primary)',
    fontSize: 13,
    padding: '8px 10px',
    outline: 'none',
    fontFamily: 'inherit',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* Header — position/zIndex so the dropdown paints above sibling divs below */}
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          gap: 8,
          flexShrink: 0,
          position: 'relative',
          zIndex: 1,
        }}
      >
        <select
          value={filterCharName}
          onChange={(e) => setFilterCharName(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
            fontSize: 13,
            padding: '8px 10px',
          }}
        >
          <option value="">{zhTW.worldMemory.all}</option>
          {characters.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <div ref={importMenuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowImportMenu((v) => !v)}
            title={zhTW.worldMemory.importEvents}
            className="import-btn"
            style={{
              background: 'var(--color-bg-tertiary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              padding: '0 10px',
              height: '100%',
              fontSize: 13,
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v8M5 7l3 3 3-3M3 12h10" />
            </svg>
          </button>
          {showImportMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                zIndex: 100,
                minWidth: 140,
                overflow: 'hidden',
              }}
            >
              <button onClick={handleImportFile} style={dropdownItemStyle}>
                {zhTW.worldMemory.importFromFile}
              </button>
              <button onClick={handleOpenPasteModal} style={dropdownItemStyle}>
                {zhTW.worldMemory.importFromText}
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          style={{
            background: 'var(--color-accent)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            color: 'white',
            cursor: 'pointer',
            padding: '0 14px',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          +
        </button>
        <button
          onClick={handleClearAll}
          disabled={events.length === 0}
          title={zhTW.worldMemory.clearAll}
          className="clear-all-btn"
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-tertiary)',
            cursor: events.length === 0 ? 'default' : 'pointer',
            opacity: events.length === 0 ? 0.4 : 1,
            padding: '0 10px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 4h11M6 4V2.5h4V4M5 4l.5 9h5l.5-9" />
          </svg>
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <input
            type="text"
            placeholder={zhTW.worldMemory.eventName}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={inputStyle}
          />
          <textarea
            placeholder={zhTW.worldMemory.eventDescription}
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {(['occurred', 'planned'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setNewStatus(s)}
                style={{
                  flex: 1,
                  fontSize: 12,
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  border: `1px solid ${newStatus === s ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: newStatus === s ? 'var(--color-accent-subtle)' : 'transparent',
                  color: newStatus === s ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  fontWeight: newStatus === s ? 600 : 400,
                }}
              >
                {s === 'occurred' ? zhTW.worldMemory.eventStatusOccurred : zhTW.worldMemory.eventStatusPlanned}
              </button>
            ))}
          </div>
          {newStatus === 'planned' && (
            <div style={{ display: 'flex', gap: 6 }}>
              {HORIZON_ORDER.map((h) => (
                <button
                  key={h}
                  onClick={() => setNewHorizon(h)}
                  title={HORIZON_HINT[h]}
                  style={{
                    flex: 1,
                    fontSize: 12,
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    border: `1px solid ${newHorizon === h ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: newHorizon === h ? 'var(--color-accent-subtle)' : 'transparent',
                    color: newHorizon === h ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    fontWeight: newHorizon === h ? 600 : 400,
                  }}
                >
                  {HORIZON_LABEL[h]}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setShowAddForm(false)}
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
              onClick={handleAdd}
              disabled={!newName}
              style={{
                fontSize: 12,
                padding: '6px 14px',
                background: 'var(--color-accent)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                color: 'white',
                fontWeight: 600,
                opacity: !newName ? 0.5 : 1,
              }}
            >
              {zhTW.worldMemory.addEvent}
            </button>
          </div>
        </div>
      )}

      {/* Count */}
      <div style={{ padding: '0 16px 8px', fontSize: 11, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
        {filteredEvents.length} {zhTW.worldMemory.events}
      </div>

      {/* Sectioned board: planned (by horizon) + occurred history */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: 24, fontSize: 13 }}>載入中...</div>
        ) : filteredEvents.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: 24, fontSize: 13 }}>
            {zhTW.worldMemory.noEvents}
          </div>
        ) : (
          <>
            {/* Planned roadmap — three horizon sections */}
            <SectionHeader label={zhTW.worldMemory.plannedRoadmap} />
            {plannedCount === 0 ? (
              <div style={{ color: 'var(--color-text-tertiary)', padding: '4px 6px 12px', fontSize: 12 }}>
                {zhTW.worldMemory.noPlannedEvents}
              </div>
            ) : (
              HORIZON_ORDER.map((h) => {
                const bucket = plannedByHorizon(h);
                if (bucket.length === 0) return null;
                return (
                  <div key={h} style={{ marginBottom: 6 }}>
                    <div
                      title={HORIZON_HINT[h]}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--color-accent)',
                        padding: '6px 6px 4px',
                        letterSpacing: '0.5px',
                      }}
                    >
                      {HORIZON_LABEL[h]}　<span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>{HORIZON_HINT[h]}</span>
                    </div>
                    {bucket.map((e, i) => (
                      <EventCard
                        key={e.id}
                        event={e}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                        onMoveUp={(id) => handleReorder(id, 'up')}
                        onMoveDown={(id) => handleReorder(id, 'down')}
                        canMoveUp={i > 0}
                        canMoveDown={i < bucket.length - 1}
                      />
                    ))}
                  </div>
                );
              })
            )}

            {/* Occurred history */}
            {occurredEvents.length > 0 && (
              <>
                <SectionHeader label={zhTW.worldMemory.occurredHistory} />
                {occurredEvents.map((e) => (
                  <EventCard
                    key={e.id}
                    event={e}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Paste JSON modal */}
      {showPasteModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowPasteModal(false)}
        >
          <div
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg, 8px)',
              padding: 16,
              width: '100%',
              maxWidth: 420,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {zhTW.worldMemory.importFromText}
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => { setPasteText(e.target.value); setPasteError(''); }}
              placeholder={zhTW.worldMemory.importEventPasteHint}
              style={{
                width: '100%',
                minHeight: 160,
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-primary)',
                fontSize: 12,
                fontFamily: 'monospace',
                padding: 10,
                resize: 'vertical',
                outline: 'none',
              }}
            />
            {pasteError && (
              <div style={{ fontSize: 12, color: 'var(--color-error, #f44)' }}>{pasteError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setShowPasteModal(false)}
                style={{
                  background: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  padding: '6px 14px',
                  fontSize: 13,
                }}
              >
                {zhTW.worldMemory.importCancel}
              </button>
              <button
                onClick={handlePasteImport}
                disabled={!pasteText.trim()}
                style={{
                  background: 'var(--color-accent)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  color: 'white',
                  cursor: pasteText.trim() ? 'pointer' : 'default',
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  opacity: pasteText.trim() ? 1 : 0.5,
                }}
              >
                {zhTW.worldMemory.importConfirm}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .import-btn { transition: background 0.1s, transform 0.1s; }
        .import-btn:hover { background: var(--color-bg-secondary) !important; color: var(--color-text-primary) !important; }
        .import-btn:active { transform: scale(0.92); opacity: 0.7; }
        .clear-all-btn:not(:disabled):hover { background: rgba(229,83,83,0.1) !important; border-color: var(--color-error) !important; color: var(--color-error) !important; }
        .clear-all-btn:not(:disabled):active { transform: scale(0.92); }
      `}</style>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        color: 'var(--color-text-secondary)',
        padding: '10px 6px 6px',
        borderBottom: '1px solid var(--color-border)',
        marginBottom: 8,
        letterSpacing: '0.5px',
      }}
    >
      {label}
    </div>
  );
}
