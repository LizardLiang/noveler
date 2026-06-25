import { useCallback, useState } from 'react';
import { zhTW } from '@/i18n/zh-TW';
import type { PromptLog, PromptLogMessage, ParagraphUsageLog } from '@/types/ipc';
import { stepLabel, fmt } from '@/lib/usageFormatters';

interface PromptViewerModalProps {
  loading: boolean;
  log: PromptLog | null;
  onClose: () => void;
  usageLog?: ParagraphUsageLog | null;
}

const t = zhTW.promptViewer;

function roleLabel(role: string): string {
  switch (role) {
    case 'system': return t.roleSystem;
    case 'user': return t.roleUser;
    case 'assistant': return t.roleAssistant;
    case 'tool': return t.roleTool;
    default: return t.roleOther;
  }
}

function roleColor(role: string): string {
  switch (role) {
    case 'system': return 'var(--color-warning)';
    case 'user': return 'var(--color-accent)';
    case 'assistant': return 'var(--color-info)';
    case 'tool': return 'var(--color-text-muted)';
    default: return 'var(--color-text-secondary)';
  }
}

/** Render a single message's body — text, tool-call requests, or both. */
function messageBody(msg: PromptLogMessage): string {
  const parts: string[] = [];
  if (msg.content) parts.push(msg.content);
  if (msg.toolCalls?.length) {
    parts.push(
      `【${t.toolCalls}】\n` +
        msg.toolCalls.map(tc => `${tc.name}(${tc.arguments})`).join('\n'),
    );
  }
  return parts.join('\n\n');
}

/** Flatten a whole log into copyable plain text. */
function logToText(log: PromptLog): string {
  return log.messages
    .map(m => `=== ${roleLabel(m.role)} (${m.role}) ===\n${messageBody(m)}`)
    .join('\n\n');
}


export function PromptViewerModal({ loading, log, onClose, usageLog }: PromptViewerModalProps) {
  const [activeTab, setActiveTab] = useState<'prompt' | 'usage'>('prompt');

  const handleCopyAll = useCallback(() => {
    if (!log) return;
    navigator.clipboard.writeText(logToText(log)).catch(() => { /* ignore */ });
  }, [log]);

  const tabStyle = (active: boolean) => ({
    padding: '6px 14px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: active ? 'var(--color-accent)' : 'var(--color-surface)',
    color: active ? 'white' : 'var(--color-text-secondary)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          width: 'min(860px, 100%)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg, 0 12px 40px rgba(0,0,0,0.35))',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--color-border)',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {t.title}
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t.subtitle}</span>
            {log && (
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {t.model}：{log.model} ・ {t.generatedAt}：
                {new Date(log.createdAt).toLocaleString('zh-TW')}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
            {/* Tab switcher */}
            <button style={tabStyle(activeTab === 'prompt')} onClick={() => setActiveTab('prompt')}>
              {t.title}
            </button>
            <button style={tabStyle(activeTab === 'usage')} onClick={() => setActiveTab('usage')}>
              {t.usageTab}
            </button>
            {activeTab === 'prompt' && log && log.messages.length > 0 && (
              <button
                onClick={handleCopyAll}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {t.copyAll}
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: 'var(--color-accent)',
                color: 'white',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {t.close}
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {activeTab === 'prompt' ? (
            loading ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                {t.loading}
              </div>
            ) : !log || log.messages.length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                {t.empty}
              </div>
            ) : (
              log.messages.map((msg, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: roleColor(msg.role),
                    }}
                  >
                    {roleLabel(msg.role)}
                  </span>
                  <pre
                    style={{
                      margin: 0,
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg-secondary)',
                      color: 'var(--color-text-primary)',
                      fontSize: 12.5,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    }}
                  >
                    {messageBody(msg)}
                  </pre>
                </div>
              ))
            )
          ) : (
            /* Usage tab */
            !usageLog ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                {t.usageEmpty}
              </div>
            ) : (
              <UsageTable usageLog={usageLog} />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function UsageTable({ usageLog }: { usageLog: ParagraphUsageLog }) {
  const headerStyle: React.CSSProperties = {
    padding: '6px 10px',
    textAlign: 'right',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    borderBottom: '1px solid var(--color-border)',
    whiteSpace: 'nowrap',
  };
  const cellStyle: React.CSSProperties = {
    padding: '6px 10px',
    textAlign: 'right',
    fontSize: 12,
    color: 'var(--color-text-primary)',
    borderBottom: '1px solid var(--color-border)',
  };
  const labelStyle: React.CSSProperties = {
    ...cellStyle,
    textAlign: 'left',
    color: 'var(--color-text-secondary)',
    fontWeight: 500,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...headerStyle, textAlign: 'left' }}>{t.usageStep}</th>
            <th style={headerStyle}>{t.usagePrompt}</th>
            <th style={headerStyle}>{t.usageCompletion}</th>
            <th style={headerStyle}>{t.usageReasoning}</th>
            <th style={headerStyle}>{t.usageTotal}</th>
            <th style={headerStyle}>{t.usageLatency}</th>
          </tr>
        </thead>
        <tbody>
          {usageLog.steps.map((step, idx) => (
            <tr key={idx}>
              <td style={labelStyle}>{stepLabel(step.step)}</td>
              <td style={cellStyle}>{fmt(step.promptTokens)}</td>
              <td style={cellStyle}>{fmt(step.completionTokens)}</td>
              <td style={cellStyle}>{fmt(step.reasoningTokens)}</td>
              <td style={cellStyle}>{fmt(step.totalTokens)}</td>
              <td style={cellStyle}>{step.latencyMs != null ? Math.round(step.latencyMs).toLocaleString() : '—'}</td>
            </tr>
          ))}
          {/* Rollup row */}
          <tr style={{ background: 'var(--color-bg-secondary)' }}>
            <td style={{ ...labelStyle, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {t.usageRollup} ({usageLog.rollup.callCount} {t.usageCallCount})
            </td>
            <td style={{ ...cellStyle, fontWeight: 700 }}>{fmt(usageLog.rollup.promptTokens)}</td>
            <td style={{ ...cellStyle, fontWeight: 700 }}>{fmt(usageLog.rollup.completionTokens)}</td>
            <td style={{ ...cellStyle, fontWeight: 700 }}>{fmt(usageLog.rollup.reasoningTokens)}</td>
            <td style={{ ...cellStyle, fontWeight: 700 }}>{fmt(usageLog.rollup.totalTokens)}</td>
            <td style={{ ...cellStyle, fontWeight: 700 }}>{Math.round(usageLog.rollup.latencyMs).toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
