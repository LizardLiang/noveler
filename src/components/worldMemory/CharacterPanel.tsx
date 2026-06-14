import { useState, useCallback, useEffect } from 'react';
import type { Character } from '@/types/models';
import { useWorldMemoryStore } from '@/stores/worldMemoryStore';
import { useProjectStore } from '@/stores/projectStore';
import { useStoryStore } from '@/stores/storyStore';
import { CharacterCard } from './CharacterCard';
import { CharacterDetail } from './CharacterDetail';
import { zhTW } from '@/i18n/zh-TW';
import { useUndoRedo } from '@/hooks/useUndoRedo';

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

export function CharacterPanel() {
  const { currentProject } = useProjectStore();
  const { currentBranchId } = useStoryStore();
  const {
    characters,
    isLoading,
    loadCharacters,
    createCharacter,
    updateCharacterRemote,
    deleteCharacter,
    deleteAllCharacters,
    importCharacters,
    importCharactersText,
  } = useWorldMemoryStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const { execute: executeCmd, undo: undoCmd, redo: redoCmd, state: _undoState } = useUndoRedo();

  const projectId = currentProject?.id;

  useEffect(() => {
    if (projectId) {
      loadCharacters(projectId).catch(() => { /* silent */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const active = document.activeElement;
      const inInput = active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        (active as HTMLElement).contentEditable === 'true'
      );
      if (inInput) return;

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoCmd().catch(() => { /* best effort */ });
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        redoCmd().catch(() => { /* best effort */ });
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [undoCmd, redoCmd]);

  const selectedCharacter = characters.find((c) => c.id === selectedId) ?? null;

  const filteredCharacters = characters.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.faction.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleAdd = useCallback(async () => {
    if (!projectId) return;
    const char = await createCharacter(projectId, { name: '新角色' });
    if (char) setSelectedId(char.id);
  }, [projectId, createCharacter]);

  const showImportResult = useCallback((result: { created: { id: string }[]; updated: { id: string }[]; skipped: string[] }) => {
    const msg = `${zhTW.worldMemory.importSuccess}: ${zhTW.worldMemory.importCreated} ${result.created.length}、${zhTW.worldMemory.importUpdated} ${result.updated.length}` +
      (result.skipped.length > 0 ? `\n${zhTW.worldMemory.importSkipped} ${result.skipped.length} (${result.skipped.join(', ')})` : '');
    alert(msg);
  }, []);

  const handleImportFile = useCallback(async () => {
    if (!projectId) return;
    setShowImportMenu(false);
    const result = await importCharacters(projectId);
    if (result) showImportResult(result);
  }, [projectId, importCharacters, showImportResult]);

  const handleOpenPasteModal = useCallback(() => {
    setShowImportMenu(false);
    setPasteText('');
    setPasteError('');
    setShowPasteModal(true);
  }, []);

  const handlePasteImport = useCallback(async () => {
    if (!projectId || !pasteText.trim()) return;
    const result = await importCharactersText(projectId, pasteText);
    if (result) {
      setShowPasteModal(false);
      setPasteText('');
      setPasteError('');
      showImportResult(result);
    } else {
      setPasteError(zhTW.worldMemory.importJsonError);
    }
  }, [projectId, pasteText, importCharactersText, showImportResult]);

  const handleUpdate = useCallback(
    async (id: string, updates: Partial<Character>) => {
      if (!projectId) return;
      const prev = characters.find(c => c.id === id);
      if (!prev) {
        await updateCharacterRemote(projectId, id, updates);
        return;
      }
      const reverseUpdates: Partial<Character> = {};
      for (const key of Object.keys(updates) as (keyof Character)[]) {
        (reverseUpdates as Record<string, unknown>)[key] = prev[key];
      }
      await executeCmd({
        description: `更新角色 ${prev.name}`,
        execute: () => updateCharacterRemote(projectId, id, updates),
        undo: () => updateCharacterRemote(projectId, id, reverseUpdates),
      });
    },
    [projectId, characters, updateCharacterRemote, executeCmd],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!projectId) return;
      await deleteCharacter(projectId, id);
      if (selectedId === id) setSelectedId(null);
    },
    [projectId, deleteCharacter, selectedId],
  );

  const handleClearAll = useCallback(async () => {
    if (!projectId || characters.length === 0) return;
    if (!window.confirm(zhTW.worldMemory.clearAllCharactersConfirm)) return;
    await deleteAllCharacters(projectId);
    setSelectedId(null);
  }, [projectId, characters.length, deleteAllCharacters]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* List view */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          opacity: selectedCharacter ? 0 : 1,
          pointerEvents: selectedCharacter ? 'none' : 'auto',
          transition: 'opacity 0.2s ease',
        }}
      >
        {/* Search + Add header */}
        <div
          style={{
            padding: '12px 16px',
            display: 'flex',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '0 10px',
              transition: 'border-color 0.15s',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="6" cy="6" r="4.5" />
              <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" />
            </svg>
            <input
              type="text"
              placeholder={zhTW.worldMemory.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-primary)',
                fontSize: 13,
                padding: '8px 0',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowImportMenu((v) => !v)}
              title={zhTW.worldMemory.importCharacters}
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
                transition: 'opacity 0.15s',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v8M5 7l3 3 3-3M3 12h10" />
              </svg>
            </button>
            {showImportMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowImportMenu(false)} />
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
              </>
            )}
          </div>
          <button
            onClick={handleAdd}
            title={zhTW.worldMemory.addCharacter}
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
              transition: 'opacity 0.15s',
            }}
          >
            +
          </button>
          <button
            onClick={handleClearAll}
            disabled={characters.length === 0}
            title={zhTW.worldMemory.clearAll}
            className="clear-all-btn"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-tertiary)',
              cursor: characters.length === 0 ? 'default' : 'pointer',
              opacity: characters.length === 0 ? 0.4 : 1,
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

        {/* Character count */}
        <div style={{ padding: '0 16px 8px', fontSize: 11, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
          {filteredCharacters.length} {zhTW.worldMemory.characters}
        </div>

        {/* Character list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 12px 12px',
          }}
        >
          {isLoading ? (
            <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: 24, fontSize: 13 }}>
              載入中...
            </div>
          ) : filteredCharacters.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: 24, fontSize: 13 }}>
              {searchQuery ? '無符合結果' : zhTW.worldMemory.noCharacters}
            </div>
          ) : (
            filteredCharacters.map((c) => (
              <CharacterCard
                key={c.id}
                character={c}
                isSelected={selectedId === c.id}
                onClick={() => setSelectedId(c.id)}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </div>

      {/* Detail view — slides in over the list, full width */}
      {selectedCharacter && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--world-panel-bg)',
            zIndex: 5,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            animation: 'wmSlideIn 0.2s ease-out',
          }}
        >
          <CharacterDetail
            character={selectedCharacter}
            onUpdate={handleUpdate}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}

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
              placeholder={zhTW.worldMemory.importPasteHint}
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
        @keyframes wmSlideIn {
          from { opacity: 0; transform: translateX(16px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
