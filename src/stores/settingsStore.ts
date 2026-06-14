import { create } from 'zustand';
import type { GlobalConfig } from '@/types/models';
import type { ProviderInfo } from '@/types/ipc';

interface SettingsState {
  config: GlobalConfig | null;
  providers: ProviderInfo[];
  isLoading: boolean;

  // Actions
  setConfig: (config: GlobalConfig) => void;
  updateConfig: (updates: Partial<GlobalConfig>) => void;
  setProviders: (providers: ProviderInfo[]) => void;
  addOrUpdateProvider: (provider: ProviderInfo) => void;
  removeProvider: (id: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useSettingsStore = create<SettingsState>(set => ({
  config: null,
  providers: [],
  isLoading: false,

  setConfig: (config: GlobalConfig) =>
    set({ config }),
  updateConfig: (updates: Partial<GlobalConfig>) =>
    set(state => ({
      config: state.config ? { ...state.config, ...updates } : null,
    })),
  setProviders: (providers: ProviderInfo[]) =>
    set({ providers }),
  addOrUpdateProvider: (provider: ProviderInfo) =>
    set(state => {
      const existing = state.providers.findIndex(p => p.id === provider.id);
      if (existing >= 0) {
        const updated = [...state.providers];
        updated[existing] = provider;
        return { providers: updated };
      }
      return { providers: [...state.providers, provider] };
    }),
  removeProvider: (id: string) =>
    set(state => ({ providers: state.providers.filter(p => p.id !== id) })),
  setLoading: (loading: boolean) =>
    set({ isLoading: loading }),
}));
