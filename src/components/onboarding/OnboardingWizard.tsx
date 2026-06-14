import { useState } from 'react';
import { settingsApi, aiApi, oauthApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';
import type { ProviderType } from '@/types/ipc';

interface OnboardingWizardProps {
  onComplete: () => void;
}

type Step = 'welcome' | 'api' | 'first-story';

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center', textAlign: 'center' }}>
      <div style={{
        width: 72,
        height: 72,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--color-accent) 0%, #7c3aed 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 6h24v24H6V6z" rx="2" />
          <line x1="11" y1="13" x2="25" y2="13" />
          <line x1="11" y1="18" x2="25" y2="18" />
          <line x1="11" y1="23" x2="19" y2="23" />
        </svg>
      </div>

      <div>
        <h1 style={{ margin: '0 0 12px', fontSize: 26, fontWeight: 700, color: 'var(--color-text-primary)' }}>
          {zhTW.onboarding.welcomeTitle}
        </h1>
        <p style={{ margin: 0, fontSize: 15, color: 'var(--color-text-secondary)', lineHeight: 1.7, maxWidth: 420 }}>
          {zhTW.onboarding.welcomeDesc}
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 12,
        width: '100%',
        maxWidth: 480,
      }}>
        {[
          { icon: '✍️', text: zhTW.onboarding.featureAI },
          { icon: '🌍', text: zhTW.onboarding.featureWorld },
          { icon: '🌿', text: zhTW.onboarding.featureBranch },
        ].map((f, i) => (
          <div key={i} style={{
            padding: '12px 8px',
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            textAlign: 'center',
            lineHeight: 1.5,
          }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{f.icon}</div>
            {f.text}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button
          onClick={onSkip}
          style={{
            padding: '10px 24px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {zhTW.onboarding.skip}
        </button>
        <button
          onClick={onNext}
          style={{
            padding: '10px 28px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: 'var(--color-accent)',
            color: 'white',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {zhTW.onboarding.start}
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: API Key Setup ────────────────────────────────────────────────────

const PROVIDER_PRESETS: Array<{
  id: ProviderType;
  name: string;
  baseUrl: string;
  defaultModel: string;
}> = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o' },
  { id: 'nvidia', name: 'Nvidia NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: 'meta/llama-3.1-70b-instruct' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.1' },
  { id: 'openwebui', name: 'Open WebUI', baseUrl: 'http://localhost:3000/api', defaultModel: 'llama3.1' },
];

// Ollama's OpenAI-compatible server needs no API key, but the SDK + DB still
// require a non-empty value — send this conventional placeholder when blank.
const OLLAMA_PLACEHOLDER_KEY = 'ollama';

function ApiStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [providerIdx, setProviderIdx] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthResult, setOauthResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const preset = PROVIDER_PRESETS[providerIdx];
  const isOllama = preset.id === 'ollama';
  // Ollama needs no key; fall back to the placeholder so test/save still work.
  const effectiveKey = apiKey.trim() || (isOllama ? OLLAMA_PLACEHOLDER_KEY : '');

  const handleTest = async () => {
    if (!effectiveKey) return;
    setTesting(true);
    setTestResult(null);
    try {
      // Save provider temporarily so test can use it
      const saved = await settingsApi.saveProvider({
        providerType: preset.id,
        baseUrl: preset.baseUrl,
        apiKey: effectiveKey,
        defaultModel: preset.defaultModel,
      });
      const savedId = saved.success ? saved.data.id : undefined;
      const result = await aiApi.testConnection(savedId);
      if (result.success) {
        setTestResult({ ok: true, msg: result.data.message || zhTW.settings.connectionSuccess });
      } else {
        setTestResult({ ok: false, msg: result.error.message });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveAndContinue = async () => {
    if (!effectiveKey) {
      onNext();
      return;
    }
    setSaving(true);
    try {
      const saved = await settingsApi.saveProvider({
        providerType: preset.id,
        baseUrl: preset.baseUrl,
        apiKey: effectiveKey,
        defaultModel: preset.defaultModel,
      });
      if (saved.success) {
        await settingsApi.setActiveProvider(saved.data.id);
      }
    } finally {
      setSaving(false);
      onNext();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: 'var(--color-text-primary)' }}>
          {zhTW.onboarding.apiTitle}
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)' }}>
          {zhTW.onboarding.apiDesc}
        </p>
      </div>

      {/* Provider selector */}
      <div style={{ display: 'flex', gap: 8 }}>
        {PROVIDER_PRESETS.map((p, i) => (
          <button
            key={p.id}
            onClick={() => { setProviderIdx(i); setTestResult(null); }}
            style={{
              flex: 1,
              padding: '8px 4px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${i === providerIdx ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: i === providerIdx ? 'rgba(var(--color-accent-rgb, 99, 102, 241), 0.1)' : 'var(--color-bg-secondary)',
              color: i === providerIdx ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: i === providerIdx ? 600 : 400,
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* API Key input */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {zhTW.settings.apiKey}
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={isOllama ? 'Ollama 不需要 API 金鑰（可留空）' : zhTW.onboarding.apiKeyPlaceholder}
            style={{
              flex: 1,
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
          <button
            onClick={handleTest}
            disabled={!effectiveKey || testing}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-primary)',
              cursor: effectiveKey && !testing ? 'pointer' : 'not-allowed',
              fontSize: 13,
              opacity: !effectiveKey || testing ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {testing ? zhTW.onboarding.testing : zhTW.settings.testConnection}
          </button>
        </div>
        {testResult && (
          <p style={{
            margin: 0,
            fontSize: 13,
            color: testResult.ok ? 'var(--color-success, #22c55e)' : 'var(--color-error)',
          }}>
            {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
          </p>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
        {zhTW.onboarding.apiNote}
      </p>

      {/* OAuth alternative (only for OpenAI) */}
      {providerIdx === 0 && (
        <div style={{
          borderTop: '1px solid var(--color-border)',
          paddingTop: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {zhTW.onboarding.oauthAlt}
          </p>
          <button
            onClick={async () => {
              setOauthLoading(true);
              setOauthResult(null);
              try {
                const codeResult = await oauthApi.requestCode();
                if (!codeResult.success) {
                  setOauthResult({ ok: false, msg: codeResult.error.message });
                  setOauthLoading(false);
                  return;
                }
                setOauthResult({ ok: true, msg: `${zhTW.settings.oauthDeviceCode} ${codeResult.data.userCode}` });
                window.open(codeResult.data.verificationUrl, '_blank');

                const pollResult = await oauthApi.poll(codeResult.data.deviceAuthId, codeResult.data.userCode);
                if (pollResult.success) {
                  await settingsApi.setActiveProvider(pollResult.data.providerId);
                  setOauthResult({ ok: true, msg: zhTW.onboarding.oauthSuccess });
                  setTimeout(onNext, 1000);
                } else {
                  setOauthResult({ ok: false, msg: pollResult.error.message });
                }
              } catch {
                setOauthResult({ ok: false, msg: zhTW.settings.oauthError });
              } finally {
                setOauthLoading(false);
              }
            }}
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
            {oauthLoading ? zhTW.onboarding.oauthSigningIn : zhTW.onboarding.oauthSignIn}
          </button>
          {oauthResult && (
            <p style={{
              margin: 0,
              fontSize: 13,
              color: oauthResult.ok ? 'var(--color-success, #22c55e)' : 'var(--color-error)',
              fontFamily: oauthResult.ok && oauthLoading ? 'monospace' : 'inherit',
            }}>
              {oauthResult.ok ? '✓ ' : '✗ '}{oauthResult.msg}
            </p>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
        <button
          onClick={onSkip}
          style={{
            padding: '9px 22px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {zhTW.onboarding.skip}
        </button>
        <button
          onClick={handleSaveAndContinue}
          disabled={saving}
          style={{
            padding: '9px 26px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: 'var(--color-accent)',
            color: 'white',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {saving ? zhTW.onboarding.saving : zhTW.onboarding.next}
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: First Story ──────────────────────────────────────────────────────

function FirstStoryStep({ onComplete, onSkip }: { onComplete: () => void; onSkip: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center', textAlign: 'center' }}>
      <div style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
          <circle cx="15" cy="15" r="12" />
          <path d="M10 15l4 4 7-7" />
        </svg>
      </div>

      <div>
        <h2 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)' }}>
          {zhTW.onboarding.readyTitle}
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.7, maxWidth: 400 }}>
          {zhTW.onboarding.readyDesc}
        </p>
      </div>

      <div style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
        width: '100%',
        maxWidth: 440,
        textAlign: 'left',
      }}>
        <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {zhTW.onboarding.tipTitle}
        </p>
        <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          <li>{zhTW.onboarding.tip1}</li>
          <li>{zhTW.onboarding.tip2}</li>
          <li>{zhTW.onboarding.tip3}</li>
        </ul>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
        <button
          onClick={onSkip}
          style={{
            padding: '10px 24px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {zhTW.onboarding.skip}
        </button>
        <button
          onClick={onComplete}
          style={{
            padding: '10px 28px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: 'var(--color-accent)',
            color: 'white',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {zhTW.onboarding.createFirst}
        </button>
      </div>
    </div>
  );
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: i === current ? 24 : 8,
            height: 8,
            borderRadius: 4,
            background: i === current
              ? 'var(--color-accent)'
              : i < current
                ? 'var(--color-accent)'
                : 'var(--color-border)',
            transition: 'all 0.2s ease',
            opacity: i < current ? 0.4 : 1,
          }}
        />
      ))}
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('welcome');

  const steps: Step[] = ['welcome', 'api', 'first-story'];
  const currentIdx = steps.indexOf(step);

  const markCompleted = async () => {
    await settingsApi.set('onboardingCompleted', true);
    onComplete();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl, 16px)',
          padding: '40px 44px',
          width: '100%',
          maxWidth: 560,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}
      >
        <StepIndicator current={currentIdx} total={steps.length} />

        {step === 'welcome' && (
          <WelcomeStep
            onNext={() => setStep('api')}
            onSkip={markCompleted}
          />
        )}
        {step === 'api' && (
          <ApiStep
            onNext={() => setStep('first-story')}
            onSkip={markCompleted}
          />
        )}
        {step === 'first-story' && (
          <FirstStoryStep
            onComplete={markCompleted}
            onSkip={markCompleted}
          />
        )}
      </div>
    </div>
  );
}
