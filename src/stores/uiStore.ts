import { create } from 'zustand';

type Theme = 'dark' | 'light' | 'system';

interface UIState {
  // Panel visibility
  sidebarCollapsed: boolean;
  worldMemoryPanelCollapsed: boolean;

  // Theme
  theme: Theme;

  // Font size (12 | 14 | 16 | 18 | 20)
  fontSize: number;

  // Active tab in world memory panel
  worldMemoryTab: 'characters' | 'relationships' | 'events';

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleWorldMemoryPanel: () => void;
  setWorldMemoryPanelCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: Theme) => void;
  setFontSize: (size: number) => void;
  setWorldMemoryTab: (tab: 'characters' | 'relationships' | 'events') => void;
}

export const useUIStore = create<UIState>(set => ({
  sidebarCollapsed: false,
  worldMemoryPanelCollapsed: true,  // starts collapsed, auto-expands on first world change (FR-068)
  theme: 'dark',
  fontSize: 16,
  worldMemoryTab: 'characters',

  toggleSidebar: () =>
    set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed: boolean) =>
    set({ sidebarCollapsed: collapsed }),
  toggleWorldMemoryPanel: () =>
    set(state => ({ worldMemoryPanelCollapsed: !state.worldMemoryPanelCollapsed })),
  setWorldMemoryPanelCollapsed: (collapsed: boolean) =>
    set({ worldMemoryPanelCollapsed: collapsed }),
  setTheme: (theme: Theme) =>
    set({ theme }),
  setFontSize: (size: number) =>
    set({ fontSize: size }),
  setWorldMemoryTab: (tab: 'characters' | 'relationships' | 'events') =>
    set({ worldMemoryTab: tab }),
}));
