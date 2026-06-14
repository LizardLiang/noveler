import { useState, useCallback, useEffect, useRef } from 'react';
import { searchApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';

interface FulltextResult {
  paragraphId: string;
  position: number;
  type: string;
  excerpt: string;
}

interface CharacterResult {
  id: string;
  name: string;
  faction: string;
  status: string;
}

interface EventResult {
  id: string;
  name: string;
  description: string;
  storyTimestamp: string;
}

type SearchTab = 'story' | 'characters' | 'events';

interface GlobalSearchProps {
  projectId: string;
  branchId: string;
  onScrollToParagraph?: (position: number) => void;
  onClose?: () => void;
}

export function GlobalSearch({ projectId, branchId, onScrollToParagraph, onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<SearchTab>('story');
  const [loading, setLoading] = useState(false);
  const [storyResults, setStoryResults] = useState<FulltextResult[]>([]);
  const [characterResults, setCharacterResults] = useState<CharacterResult[]>([]);
  const [eventResults, setEventResults] = useState<EventResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const performSearch = useCallback(
    async (searchQuery: string, searchTab: SearchTab) => {
      if (!searchQuery.trim()) {
        setStoryResults([]);
        setCharacterResults([]);
        setEventResults([]);
        return;
      }

      setLoading(true);
      try {
        if (searchTab === 'story') {
          const result = await searchApi.fulltext(projectId, branchId, searchQuery);
          if (result.success) {
            setStoryResults(result.data as FulltextResult[]);
          }
        } else if (searchTab === 'characters') {
          const result = await searchApi.characters(projectId, searchQuery);
          if (result.success) {
            setCharacterResults(result.data as CharacterResult[]);
          }
        } else {
          const result = await searchApi.events(projectId, searchQuery, { branchId });
          if (result.success) {
            setEventResults(result.data as EventResult[]);
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [projectId, branchId],
  );

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        performSearch(value, tab);
      }, 300);
    },
    [tab, performSearch],
  );

  const handleTabChange = useCallback(
    (newTab: SearchTab) => {
      setTab(newTab);
      if (query.trim()) {
        performSearch(query, newTab);
      }
    },
    [query, performSearch],
  );

  const highlightMatch = (text: string, query: string): string => {
    if (!query.trim()) return text;
    // Simple replacement — not JSX, just text with markers
    return text;
  };

  const tabs: { key: SearchTab; label: string }[] = [
    { key: 'story', label: zhTW.search.story },
    { key: 'characters', label: zhTW.search.characters },
    { key: 'events', label: zhTW.search.events },
  ];

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        width: 560,
        maxHeight: 480,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Search input */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5">
          <circle cx="6" cy="6" r="4" />
          <line x1="9.5" y1="9.5" x2="13" y2="13" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          placeholder={zhTW.search.placeholder}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            color: 'var(--color-text-primary)',
            fontSize: 14,
            outline: 'none',
          }}
          onKeyDown={e => { if (e.key === 'Escape') onClose?.(); }}
        />
        {loading && (
          <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            {zhTW.search.searching}
          </span>
        )}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              padding: 2,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="11" y2="11" />
              <line x1="11" y1="1" x2="1" y2="11" />
            </svg>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--color-accent)' : '2px solid transparent',
              color: tab === t.key ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: tab === t.key ? 500 : 400,
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {tab === 'story' && (
          <>
            {storyResults.length === 0 && query.trim() && !loading && (
              <div style={{ padding: '16px', fontSize: 13, color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                {zhTW.search.noResults}
              </div>
            )}
            {storyResults.map(result => (
              <button
                key={result.paragraphId}
                onClick={() => onScrollToParagraph?.(result.position)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '8px 16px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: result.type === 'ai' ? 'var(--color-accent-subtle)' : 'var(--color-bg-tertiary)',
                      color: result.type === 'ai' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    }}
                  >
                    {result.type === 'ai' ? 'AI' : '使用者'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                    段落 {result.position + 1}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--color-text-secondary)',
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {highlightMatch(result.excerpt, query)}
                </div>
              </button>
            ))}
            {storyResults.length > 0 && query.trim() && (
              <div style={{ padding: '4px 16px 8px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                {storyResults.length} {zhTW.search.matchingParagraphs}
              </div>
            )}
          </>
        )}

        {tab === 'characters' && (
          <>
            {characterResults.length === 0 && query.trim() && !loading && (
              <div style={{ padding: '16px', fontSize: 13, color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                {zhTW.search.noResults}
              </div>
            )}
            {characterResults.map(char => (
              <div
                key={char.id}
                style={{
                  padding: '8px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'var(--color-accent-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    color: 'var(--color-accent)',
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {char.name[0]}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                    {char.name}
                  </div>
                  {char.faction && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      {char.faction}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === 'events' && (
          <>
            {eventResults.length === 0 && query.trim() && !loading && (
              <div style={{ padding: '16px', fontSize: 13, color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                {zhTW.search.noResults}
              </div>
            )}
            {eventResults.map(evt => (
              <div
                key={evt.id}
                style={{ padding: '8px 16px', borderBottom: '1px solid var(--color-border)' }}
              >
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                  {evt.name}
                </div>
                {evt.description && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {evt.description}
                  </div>
                )}
                {evt.storyTimestamp && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {evt.storyTimestamp}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
