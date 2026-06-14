import { useState, useCallback, useEffect, useRef } from 'react';
import { useWorldMemoryStore } from '@/stores/worldMemoryStore';
import { useProjectStore } from '@/stores/projectStore';
import { useStoryStore } from '@/stores/storyStore';
import { RelationshipCard } from './RelationshipCard';
import { zhTW } from '@/i18n/zh-TW';

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

export function RelationshipPanel() {
  const { currentProject } = useProjectStore();
  const { currentBranchId } = useStoryStore();
  const {
    relationships,
    characters,
    isLoading,
    loadRelationships,
    createRelationship,
    updateRelationshipRemote,
    deleteRelationship,
    deleteAllRelationships,
    importRelationships,
    importRelationshipsText,
  } = useWorldMemoryStore();

  const [filterCharId, setFilterCharId] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCharAId, setNewCharAId] = useState('');
  const [newCharBId, setNewCharBId] = useState('');
  const [newType, setNewType] = useState('盟友');
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const importMenuRef = useRef<HTMLDivElement>(null);

  const projectId = currentProject?.id;
  const branchId = currentBranchId ?? '';

  useEffect(() => {
    if (projectId && branchId) {
      loadRelationships(projectId, branchId).catch(() => { /* silent */ });
    }
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

  const filteredRelationships = filterCharId
    ? relationships.filter(
        (r) => r.characterAId === filterCharId || r.characterBId === filterCharId,
      )
    : relationships;

  const handleAdd = useCallback(async () => {
    if (!projectId || !branchId || !newCharAId || !newCharBId) return;
    await createRelationship(projectId, branchId, {
      characterAId: newCharAId,
      characterBId: newCharBId,
      relationshipType: newType || '盟友',
    });
    setShowAddForm(false);
    setNewCharAId('');
    setNewCharBId('');
    setNewType('盟友');
  }, [projectId, branchId, newCharAId, newCharBId, newType, createRelationship]);

  const handleUpdate = useCallback(
    async (id: string, updates: { relationshipType?: string; affinityScore?: number; description?: string }) => {
      if (!projectId) return;
      await updateRelationshipRemote(projectId, id, updates);
    },
    [projectId, updateRelationshipRemote],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!projectId) return;
      await deleteRelationship(projectId, id);
    },
    [projectId, deleteRelationship],
  );

  const handleClearAll = useCallback(async () => {
    if (!projectId || !branchId || relationships.length === 0) return;
    if (!window.confirm(zhTW.worldMemory.clearAllRelationshipsConfirm)) return;
    await deleteAllRelationships(projectId, branchId);
  }, [projectId, branchId, relationships.length, deleteAllRelationships]);

  const showImportResult = useCallback((result: { created: { id: string }[]; updated: { id: string }[]; skipped: string[] }) => {
    const msg = `${zhTW.worldMemory.importSuccess}: ${zhTW.worldMemory.importCreated} ${result.created.length}、${zhTW.worldMemory.importUpdated} ${result.updated.length}` +
      (result.skipped.length > 0 ? `\n${zhTW.worldMemory.importSkipped} ${result.skipped.length} (${result.skipped.join(', ')})` : '');
    alert(msg);
  }, []);

  const handleImportFile = useCallback(async () => {
    if (!projectId || !branchId) return;
    setShowImportMenu(false);
    try {
      const result = await importRelationships(projectId, branchId);
      if (result) showImportResult(result);
    } catch (err) {
      console.error('importRelationships error:', err);
    }
  }, [projectId, branchId, importRelationships, showImportResult]);

  const handleOpenPasteModal = useCallback(() => {
    setShowImportMenu(false);
    setPasteText('');
    setPasteError('');
    setShowPasteModal(true);
  }, []);

  const handlePasteImport = useCallback(async () => {
    if (!projectId || !branchId || !pasteText.trim()) return;
    try {
      const result = await importRelationshipsText(projectId, branchId, pasteText);
      if (result) {
        setShowPasteModal(false);
        setPasteText('');
        setPasteError('');
        showImportResult(result);
      } else {
        setPasteError(zhTW.worldMemory.importRelJsonError);
      }
    } catch (err) {
      console.error('importRelationshipsText error:', err);
      setPasteError(zhTW.worldMemory.importRelJsonError);
    }
  }, [projectId, branchId, pasteText, importRelationshipsText, showImportResult]);

  const selectStyle = {
    flex: 1,
    minWidth: 0,
    background: 'var(--color-bg-primary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-primary)',
    fontSize: 13,
    padding: '8px 10px',
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
          value={filterCharId}
          onChange={(e) => setFilterCharId(e.target.value)}
          style={selectStyle}
        >
          <option value="">{zhTW.worldMemory.all}</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div ref={importMenuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowImportMenu((v) => !v)}
            title={zhTW.worldMemory.importRelationships}
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
          disabled={relationships.length === 0}
          title={zhTW.worldMemory.clearAll}
          className="clear-all-btn"
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-tertiary)',
            cursor: relationships.length === 0 ? 'default' : 'pointer',
            opacity: relationships.length === 0 ? 0.4 : 1,
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

      <style>{`
        .clear-all-btn:not(:disabled):hover { background: rgba(229,83,83,0.1) !important; border-color: var(--color-error) !important; color: var(--color-error) !important; }
        .clear-all-btn:not(:disabled):active { transform: scale(0.92); }
      `}</style>

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
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={newCharAId}
              onChange={(e) => setNewCharAId(e.target.value)}
              style={selectStyle}
            >
              <option value="">{zhTW.worldMemory.relCharA}</option>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span style={{ display: 'flex', alignItems: 'center', color: 'var(--color-text-tertiary)', fontSize: 14, flexShrink: 0 }}>↔</span>
            <select
              value={newCharBId}
              onChange={(e) => setNewCharBId(e.target.value)}
              style={selectStyle}
            >
              <option value="">{zhTW.worldMemory.relCharB}</option>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <input
            type="text"
            placeholder={zhTW.worldMemory.relType}
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
              fontSize: 13,
              padding: '8px 10px',
              outline: 'none',
            }}
          />
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
              disabled={!newCharAId || !newCharBId}
              style={{
                fontSize: 12,
                padding: '6px 14px',
                background: 'var(--color-accent)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                color: 'white',
                fontWeight: 600,
                opacity: (!newCharAId || !newCharBId) ? 0.5 : 1,
              }}
            >
              {zhTW.worldMemory.addRelationship}
            </button>
          </div>
        </div>
      )}

      {/* Count */}
      <div style={{ padding: '0 16px 8px', fontSize: 11, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
        {filteredRelationships.length} {zhTW.worldMemory.relationships}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: 24, fontSize: 13 }}>載入中...</div>
        ) : filteredRelationships.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: 24, fontSize: 13 }}>
            {zhTW.worldMemory.noRelationships}
          </div>
        ) : (
          filteredRelationships.map((r) => (
            <RelationshipCard
              key={r.id}
              relationship={r}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))
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
              placeholder={zhTW.worldMemory.importRelPasteHint}
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
      `}</style>
    </div>
  );
}
