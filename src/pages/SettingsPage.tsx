import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { settingsApi, aiApi, oauthApi } from '@/lib/ipc';
import { useSettingsStore } from '@/stores/settingsStore';
import { FontSizeControl } from '@/components/settings/FontSizeControl';
import { useTheme } from '@/hooks/useTheme';
import { zhTW } from '@/i18n/zh-TW';
import type { ProviderInfo, SaveProviderRequest, AuthMethod, ProviderType } from '@/types/ipc';

import type { ThemeMode } from '@/hooks/useTheme';
type Theme = ThemeMode;

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'dark', label: zhTW.settings.themeDark },
  { value: 'light', label: zhTW.settings.themeLight },
  { value: 'system', label: zhTW.settings.themeSystem },
];

const PROVIDER_OPTIONS: { value: ProviderType; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'nvidia', label: 'Nvidia NIM' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openwebui', label: 'Open WebUI' },
];

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; defaultModel: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-sonnet-4' },
  nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: 'meta/llama-3.1-70b-instruct' },
  ollama: { baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.1' },
  // Open WebUI's OpenAI-compatible endpoint is /api/chat/completions; the SDK
  // appends /chat/completions, so the base URL ends in /api. Requires a Bearer key.
  openwebui: { baseUrl: 'http://localhost:3000/api', defaultModel: 'llama3.1' },
};

// Ollama's OpenAI-compatible server needs no API key, but the SDK + DB still
// require a non-empty value — send this conventional placeholder when blank.
const OLLAMA_PLACEHOLDER_KEY = 'ollama';

export function SettingsPage() {
  const navigate = useNavigate();
  const { config, providers, setConfig, setProviders, addOrUpdateProvider } = useSettingsStore();
  const { theme, setTheme } = useTheme();
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

  // Add/Edit provider form state
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [rotatingKeyId, setRotatingKeyId] = useState<string | null>(null);
  const [rotatingKeyValue, setRotatingKeyValue] = useState('');
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<{ userCode: string; deviceAuthId: string; verificationUrl: string } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [newProvider, setNewProvider] = useState<{
    providerType: ProviderType;
    authMethod: AuthMethod;
    apiKey: string;
    baseUrl: string;
    defaultModel: string;
  }>({
    providerType: 'openai',
    authMethod: 'api_key',
    apiKey: '',
    baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
    defaultModel: PROVIDER_DEFAULTS.openai.defaultModel,
  });

  useEffect(() => {
    // Load settings
    settingsApi.get().then(result => {
      if (result.success) setConfig(result.data);
    });
    settingsApi.getProviders().then(result => {
      if (result.success) setProviders(result.data);
    });
  }, [setConfig, setProviders]);

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
  };

  const handleProviderTypeChange = (type: ProviderType) => {
    const defaults = PROVIDER_DEFAULTS[type];
    setNewProvider(prev => ({
      ...prev,
      providerType: type,
      authMethod: type === 'openai' ? prev.authMethod : 'api_key',
      baseUrl: defaults.baseUrl,
      defaultModel: defaults.defaultModel,
    }));
  };

  const resetProviderForm = () => {
    setShowAddProvider(false);
    setEditingProviderId(null);
    setOauthError(null);
    setNewProvider({
      providerType: 'openai',
      authMethod: 'api_key',
      apiKey: '',
      baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
      defaultModel: PROVIDER_DEFAULTS.openai.defaultModel,
    });
  };

  const handleEditProvider = (provider: ProviderInfo) => {
    setEditingProviderId(provider.id);
    setShowAddProvider(true);
    setNewProvider({
      providerType: provider.providerType,
      authMethod: provider.authMethod ?? 'api_key',
      apiKey: '',
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
    });
  };

  const handleRotateKey = async (provider: ProviderInfo) => {
    if (!rotatingKeyValue.trim()) return;
    const result = await settingsApi.saveProvider({
      id: provider.id,
      providerType: provider.providerType,
      apiKey: rotatingKeyValue,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
    });
    if (result.success) {
      setRotatingKeyId(null);
      setRotatingKeyValue('');
    }
  };

  const handleOAuthSignIn = async () => {
    setOauthLoading(true);
    setOauthError(null);
    setDeviceCode(null);
    setCodeCopied(false);
    try {
      const codeResult = await oauthApi.requestCode();
      if (!codeResult.success) {
        setOauthError(codeResult.error.message);
        setOauthLoading(false);
        return;
      }
      setDeviceCode(codeResult.data);

      const pollResult = await oauthApi.poll(codeResult.data.deviceAuthId, codeResult.data.userCode);
      if (pollResult.success) {
        const providersResult = await settingsApi.getProviders();
        if (providersResult.success) setProviders(providersResult.data);
        setDeviceCode(null);
        resetProviderForm();
      } else {
        setOauthError(pollResult.error.message);
      }
    } catch {
      setOauthError(zhTW.settings.oauthError);
    } finally {
      setOauthLoading(false);
      setDeviceCode(null);
    }
  };

  const handleOAuthCancel = () => {
    oauthApi.cancel();
    setOauthLoading(false);
    setDeviceCode(null);
    setOauthError(null);
  };

  const handleOAuthReAuth = async (provider: ProviderInfo) => {
    await oauthApi.revoke(provider.id);
    setShowAddProvider(true);
    setEditingProviderId(null);
    setNewProvider({
      providerType: 'openai',
      authMethod: 'oauth',
      apiKey: '',
      baseUrl: PROVIDER_DEFAULTS.openai.baseUrl,
      defaultModel: PROVIDER_DEFAULTS.openai.defaultModel,
    });
    handleOAuthSignIn();
  };

  const handleSaveProvider = async () => {
    const isOllama = newProvider.providerType === 'ollama';
    // Ollama needs no key; every other provider requires one on create.
    if (!editingProviderId && !newProvider.apiKey.trim() && !isOllama) return;

    const req: SaveProviderRequest = {
      ...(editingProviderId ? { id: editingProviderId } : {}),
      providerType: newProvider.providerType,
      authMethod: newProvider.authMethod,
      apiKey: newProvider.apiKey,
      baseUrl: newProvider.baseUrl,
      defaultModel: newProvider.defaultModel,
    };

    if (!newProvider.apiKey.trim()) {
      // Keep the existing key when editing; otherwise fall back to the Ollama placeholder.
      req.apiKey = editingProviderId ? '__KEEP_EXISTING__' : OLLAMA_PLACEHOLDER_KEY;
    }

    const result = await settingsApi.saveProvider(req);
    if (result.success) {
      if (editingProviderId) {
        const active = providers.find(p => p.id === editingProviderId)?.isActive ?? false;
        addOrUpdateProvider({ ...result.data, isActive: active });
      } else {
        addOrUpdateProvider(result.data);
      }
      resetProviderForm();
    }
  };

  const handleSetActive = async (provider: ProviderInfo) => {
    await settingsApi.setActiveProvider(provider.id);
    setProviders(providers.map(p => ({ ...p, isActive: p.id === provider.id })));
  };

  const handleDeleteProvider = async (id: string) => {
    if (!window.confirm('確定要刪除此供應商設定嗎？')) return;
    await settingsApi.deleteProvider(id);
    setProviders(providers.filter(p => p.id !== id));
  };

  const handleTestConnection = async (provider: ProviderInfo) => {
    setTestingProvider(provider.id);
    setTestResult(null);
    const result = await aiApi.testConnection(provider.id);
    if (result.success) {
      setTestResult({ id: provider.id, success: true, message: zhTW.settings.connectionSuccess });
    } else {
      setTestResult({ id: provider.id, success: false, message: result.error.message });
    }
    setTestingProvider(null);
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden auto',
        padding: '24px 32px',
        maxWidth: 800,
        margin: '0 auto',
        width: '100%',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <polyline points="10,4 6,8 10,12" />
          </svg>
        </button>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)' }}>
          {zhTW.settings.title}
        </h1>
      </div>

      {/* Appearance section */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          外觀
        </h2>
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {/* Theme */}
          <div>
            <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', display: 'block', marginBottom: 10 }}>
              {zhTW.settings.theme}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {THEME_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleThemeChange(opt.value)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${theme === opt.value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: theme === opt.value ? 'var(--color-accent-subtle)' : 'transparent',
                    color: theme === opt.value ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: theme === opt.value ? 500 : 400,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Font size */}
          <FontSizeControl />
        </div>
      </section>

      {/* AI Providers section */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {zhTW.settings.aiProvider}
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {providers.map(provider => (
            <div
              key={provider.id}
              style={{
                background: 'var(--color-surface)',
                border: `1px solid ${provider.isActive ? 'var(--color-accent)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                    {PROVIDER_OPTIONS.find(p => p.value === provider.providerType)?.label ?? provider.providerType}
                    {provider.authMethod === 'oauth' && ' (ChatGPT)'}
                  </span>
                  {provider.isActive && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: 'var(--color-accent-subtle)',
                        color: 'var(--color-accent)',
                        fontWeight: 500,
                      }}
                    >
                      使用中
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  {provider.defaultModel} · {provider.authMethod === 'oauth'
                    ? `${zhTW.settings.oauthConnected}${provider.oauthEmail ? ` (${provider.oauthEmail})` : ''}`
                    : provider.hasApiKey ? 'API 金鑰已設定' : '未設定 API 金鑰'}
                </div>
                {testResult?.id === provider.id && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: testResult.success ? 'var(--color-success)' : 'var(--color-error)',
                    }}
                  >
                    {testResult.message}
                  </div>
                )}
                {rotatingKeyId === provider.id && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <input
                      type="password"
                      value={rotatingKeyValue}
                      onChange={e => setRotatingKeyValue(e.target.value)}
                      placeholder="輸入新的 API 金鑰..."
                      autoFocus
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-bg-secondary)',
                        color: 'var(--color-text-primary)',
                        fontSize: 13,
                        fontFamily: 'monospace',
                        outline: 'none',
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRotateKey(provider);
                        if (e.key === 'Escape') { setRotatingKeyId(null); setRotatingKeyValue(''); }
                      }}
                    />
                    <button
                      onClick={() => handleRotateKey(provider)}
                      disabled={!rotatingKeyValue.trim()}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: 'none',
                        background: 'var(--color-accent)',
                        color: 'white',
                        cursor: rotatingKeyValue.trim() ? 'pointer' : 'not-allowed',
                        fontSize: 13,
                        opacity: rotatingKeyValue.trim() ? 1 : 0.5,
                      }}
                    >
                      儲存
                    </button>
                    <button
                      onClick={() => { setRotatingKeyId(null); setRotatingKeyValue(''); }}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)',
                        background: 'transparent',
                        color: 'var(--color-text-tertiary)',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleTestConnection(provider)}
                  disabled={testingProvider === provider.id}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    background: 'transparent',
                    color: 'var(--color-text-secondary)',
                    cursor: testingProvider === provider.id ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                    opacity: testingProvider === provider.id ? 0.6 : 1,
                  }}
                >
                  {testingProvider === provider.id ? '測試中...' : zhTW.settings.testConnection}
                </button>
                {provider.authMethod === 'oauth' ? (
                  <button
                    onClick={() => handleOAuthReAuth(provider)}
                    disabled={oauthLoading}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-border)',
                      background: 'transparent',
                      color: 'var(--color-text-secondary)',
                      cursor: oauthLoading ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                      opacity: oauthLoading ? 0.6 : 1,
                    }}
                  >
                    {oauthLoading ? zhTW.settings.oauthSigningIn : zhTW.settings.oauthReAuth}
                  </button>
                ) : (
                  <button
                    onClick={() => { setRotatingKeyId(provider.id); setRotatingKeyValue(''); }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-border)',
                      background: 'transparent',
                      color: 'var(--color-text-secondary)',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    更換金鑰
                  </button>
                )}
                <button
                  onClick={() => handleEditProvider(provider)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    background: 'transparent',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  編輯
                </button>
                {!provider.isActive && (
                  <button
                    onClick={() => handleSetActive(provider)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-accent)',
                      background: 'transparent',
                      color: 'var(--color-accent)',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    設為使用中
                  </button>
                )}
                <button
                  onClick={() => handleDeleteProvider(provider.id)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid transparent',
                    background: 'transparent',
                    color: 'var(--color-text-tertiary)',
                    cursor: 'pointer',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polyline points="1,3 13,3" />
                    <path d="M4 3V2a1 1 0 011-1h4a1 1 0 011 1v1" />
                    <rect x="2" y="3" width="10" height="10" rx="1" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        {showAddProvider ? (
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {editingProviderId ? '編輯 AI 供應商' : '新增 AI 供應商'}
            </h3>

            {/* Provider type */}
            <div>
              <label style={{ fontSize: 13, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
                供應商類型
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {PROVIDER_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleProviderTypeChange(opt.value)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${newProvider.providerType === opt.value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: newProvider.providerType === opt.value ? 'var(--color-accent-subtle)' : 'transparent',
                      color: newProvider.providerType === opt.value ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Auth method toggle (only for OpenAI) */}
            {newProvider.providerType === 'openai' && (
              <div>
                <label style={{ fontSize: 13, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
                  {zhTW.settings.authMethod}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([
                    { value: 'api_key' as AuthMethod, label: zhTW.settings.authApiKey },
                    { value: 'oauth' as AuthMethod, label: zhTW.settings.authOAuth },
                  ]).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setNewProvider(prev => ({ ...prev, authMethod: opt.value }))}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${newProvider.authMethod === opt.value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        background: newProvider.authMethod === opt.value ? 'var(--color-accent-subtle)' : 'transparent',
                        color: newProvider.authMethod === opt.value ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* OAuth sign-in or API Key input */}
            {newProvider.providerType === 'openai' && newProvider.authMethod === 'oauth' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {deviceCode ? (
                  <>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {zhTW.settings.oauthDeviceCode}
                    </p>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      padding: '14px 20px',
                      background: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                    }}>
                      <code style={{
                        fontSize: 22,
                        fontWeight: 700,
                        letterSpacing: '0.15em',
                        color: 'var(--color-accent)',
                        userSelect: 'all',
                      }}>
                        {deviceCode.userCode}
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(deviceCode.userCode);
                          setCodeCopied(true);
                          setTimeout(() => setCodeCopied(false), 2000);
                        }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border)',
                          background: 'transparent',
                          color: codeCopied ? 'var(--color-success, #22c55e)' : 'var(--color-text-secondary)',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {codeCopied ? zhTW.settings.oauthCopied : zhTW.settings.oauthCopyCode}
                      </button>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                      {zhTW.settings.oauthWaitingAuth}
                    </p>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                      <button
                        onClick={() => window.open(deviceCode.verificationUrl, '_blank')}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-accent)',
                          background: 'transparent',
                          color: 'var(--color-accent)',
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        {zhTW.settings.oauthOpenBrowser}
                      </button>
                      <button
                        onClick={handleOAuthCancel}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border)',
                          background: 'transparent',
                          color: 'var(--color-text-tertiary)',
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        {zhTW.settings.oauthCancelAuth}
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={handleOAuthSignIn}
                    disabled={oauthLoading}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-accent)',
                      background: 'var(--color-accent-subtle)',
                      color: 'var(--color-accent)',
                      cursor: oauthLoading ? 'not-allowed' : 'pointer',
                      fontSize: 14,
                      fontWeight: 500,
                      opacity: oauthLoading ? 0.7 : 1,
                    }}
                  >
                    {oauthLoading ? zhTW.settings.oauthSigningIn : zhTW.settings.oauthSignIn}
                  </button>
                )}
                <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {zhTW.settings.oauthRequiresPlus}
                </p>
                {oauthError && (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--color-error)' }}>
                    {oauthError}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label style={{ fontSize: 13, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
                  {zhTW.settings.apiKey}
                </label>
                <input
                  type="password"
                  value={newProvider.apiKey}
                  onChange={e => setNewProvider(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={
                    newProvider.providerType === 'ollama'
                      ? 'Ollama 不需要 API 金鑰（可留空）'
                      : editingProviderId ? '留空則保留現有金鑰' : '輸入 API 金鑰...'
                  }
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-primary)',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
              </div>
            )}

            {/* Base URL — editable for all providers except OpenAI OAuth (backend pins that to api.openai.com) */}
            {!(newProvider.providerType === 'openai' && newProvider.authMethod === 'oauth') && (
              <div>
                <label style={{ fontSize: 13, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
                  API 端點（Base URL）
                </label>
                <input
                  type="text"
                  value={newProvider.baseUrl}
                  onChange={e => setNewProvider(prev => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="http://localhost:8080/api"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-primary)',
                    fontSize: 14,
                    outline: 'none',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
            )}

            {/* Default model */}
            <div>
              <label style={{ fontSize: 13, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>
                預設模型
              </label>
              <input
                type="text"
                value={newProvider.defaultModel}
                onChange={e => setNewProvider(prev => ({ ...prev, defaultModel: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-primary)',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </div>

            {!(newProvider.providerType === 'openai' && newProvider.authMethod === 'oauth' && !editingProviderId) && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  onClick={resetProviderForm}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    background: 'transparent',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  取消
                </button>
                <button
                  onClick={handleSaveProvider}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    background: 'var(--color-accent)',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  儲存
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowAddProvider(true)}
            style={{
              padding: '10px 16px',
              borderRadius: 'var(--radius-md)',
              border: '1px dashed var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: 14,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="7" y1="1" x2="7" y2="13" />
              <line x1="1" y1="7" x2="13" y2="7" />
            </svg>
            新增供應商
          </button>
        )}
      </section>

      {/* Version info */}
      <div style={{ marginTop: 'auto', paddingTop: 24, fontSize: 12, color: 'var(--color-text-muted)' }}>
        Noveler v{/* version */}1.0.0 — AI 互動小說生成器
      </div>
    </div>
  );
}
