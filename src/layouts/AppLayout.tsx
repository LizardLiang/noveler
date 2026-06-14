import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { TitleBar } from '@/components/TitleBar';
import { useUIStore } from '@/stores/uiStore';
import { zhTW } from '@/i18n/zh-TW';
import { WorldMemoryPanel } from '@/components/worldMemory/WorldMemoryPanel';
import { TimelineTree } from '@/components/sidebar/TimelineTree';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

interface AppLayoutProps {
  showSidebar?: boolean;
  showWorldMemoryPanel?: boolean;
}

export function AppLayout({ showSidebar = true, showWorldMemoryPanel = false }: AppLayoutProps) {
  const {
    sidebarCollapsed,
    worldMemoryPanelCollapsed,
    toggleSidebar,
    toggleWorldMemoryPanel,
    fontSize,
  } = useUIStore();
  const navigate = useNavigate();

  // Apply font size to document root
  useEffect(() => {
    document.documentElement.style.setProperty('--font-size-story', `${fontSize}px`);
  }, [fontSize]);

  // Register global keyboard shortcuts
  useKeyboardShortcuts({
    onNewProject: () => navigate('/'),
    onOpenSettings: () => navigate('/settings'),
    onToggleSidebar: toggleSidebar,
    onToggleWorldMemory: toggleWorldMemoryPanel,
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
      }}
    >
      {/* Custom Titlebar */}
      <TitleBar />

      {/* Main content area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* Left Sidebar */}
        {showSidebar && (
          <>
            <aside
              style={{
                width: sidebarCollapsed ? 0 : 'var(--sidebar-width)',
                overflow: 'hidden',
                flexShrink: 0,
                background: 'var(--sidebar-bg)',
                borderRight: '1px solid var(--color-border)',
                transition: 'width var(--transition-normal)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ width: 'var(--sidebar-width)', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {showSidebar && <TimelineTree />}
              </div>
            </aside>

            {/* Sidebar toggle button */}
            <button
              onClick={toggleSidebar}
              title={sidebarCollapsed ? zhTW.sidebar.expand : zhTW.sidebar.collapse}
              style={{
                position: 'absolute',
                left: sidebarCollapsed ? 0 : 'var(--sidebar-width)',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 10,
                width: 16,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderLeft: sidebarCollapsed ? '1px solid var(--color-border)' : 'none',
                borderRadius: sidebarCollapsed ? '0 4px 4px 0' : '0 4px 4px 0',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
                transition: 'left var(--transition-normal)',
                padding: 0,
              }}
            >
              <svg
                width="8"
                height="12"
                viewBox="0 0 8 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {sidebarCollapsed ? (
                  <polyline points="2,2 6,6 2,10" />
                ) : (
                  <polyline points="6,2 2,6 6,10" />
                )}
              </svg>
            </button>
          </>
        )}

        {/* Main content */}
        <main
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--color-bg-primary)',
          }}
        >
          <Outlet />
        </main>

        {/* Right World Memory Panel */}
        {showWorldMemoryPanel && (
          <>
            {/* Panel toggle button */}
            <button
              onClick={toggleWorldMemoryPanel}
              title={worldMemoryPanelCollapsed ? zhTW.worldMemory.expand : zhTW.worldMemory.collapse}
              style={{
                position: 'absolute',
                right: worldMemoryPanelCollapsed ? 0 : 'var(--world-panel-width)',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 10,
                width: 16,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRight: worldMemoryPanelCollapsed ? '1px solid var(--color-border)' : 'none',
                borderRadius: worldMemoryPanelCollapsed ? '4px 0 0 4px' : '4px 0 0 4px',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
                transition: 'right var(--transition-normal)',
                padding: 0,
              }}
            >
              <svg
                width="8"
                height="12"
                viewBox="0 0 8 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {worldMemoryPanelCollapsed ? (
                  <polyline points="6,2 2,6 6,10" />
                ) : (
                  <polyline points="2,2 6,6 2,10" />
                )}
              </svg>
            </button>

            <aside
              style={{
                width: worldMemoryPanelCollapsed ? 0 : 'var(--world-panel-width)',
                overflow: 'hidden',
                flexShrink: 0,
                background: 'var(--world-panel-bg)',
                borderLeft: '1px solid var(--color-border)',
                transition: 'width var(--transition-normal)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  width: 'var(--world-panel-width)',
                  height: '100%',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <WorldMemoryPanel />
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
