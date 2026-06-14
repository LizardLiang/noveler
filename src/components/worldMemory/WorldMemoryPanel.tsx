import { useUIStore } from '@/stores/uiStore';
import { zhTW } from '@/i18n/zh-TW';
import { CharacterPanel } from './CharacterPanel';
import { RelationshipPanel } from './RelationshipPanel';
import { EventPanel } from './EventPanel';

type Tab = 'characters' | 'relationships' | 'events';

const TABS: { key: Tab; label: string }[] = [
  { key: 'characters', label: zhTW.worldMemory.characters },
  { key: 'relationships', label: zhTW.worldMemory.relationships },
  { key: 'events', label: zhTW.worldMemory.events },
];

export function WorldMemoryPanel() {
  const { worldMemoryTab, setWorldMemoryTab } = useUIStore();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Panel header */}
      <div
        style={{
          padding: '14px 16px 0',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--color-text-tertiary)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 3v4l2.5 1.5" />
          </svg>
          {zhTW.worldMemory.panel}
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            background: 'var(--color-bg-primary)',
            borderRadius: 'var(--radius-md)',
            padding: 3,
          }}
        >
          {TABS.map((tab) => {
            const active = worldMemoryTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setWorldMemoryTab(tab.key)}
                style={{
                  flex: 1,
                  padding: '7px 4px',
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                  background: active ? 'var(--color-surface)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: active ? 'var(--shadow-sm)' : 'none',
                  letterSpacing: '0.3px',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--color-border)', margin: '12px 16px 0', flexShrink: 0 }} />

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {worldMemoryTab === 'characters' && <CharacterPanel />}
        {worldMemoryTab === 'relationships' && <RelationshipPanel />}
        {worldMemoryTab === 'events' && <EventPanel />}
      </div>
    </div>
  );
}
