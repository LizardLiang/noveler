import { useState } from 'react';
import type { FullStoryJob } from '@/types/ipc';

interface Props {
  job: FullStoryJob | null;
  disabled?: boolean;
  onStart: (prompt: string, targetCharacterCount: number) => Promise<string | null>;
  onResume: () => Promise<void>;
  onCancel: () => Promise<void>;
  onDiscard: () => Promise<void>;
}

export function FullStoryGenerator({ job, disabled, onStart, onResume, onCancel, onDiscard }: Props) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [target, setTarget] = useState(5_000);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (job?.status === 'completed') return null;

  if (job) {
    const active = job.status === 'planning' || job.status === 'generating';
    const totalSections = job.sections.length;
    const completed = job.sections.filter(section => section.status === 'completed').length;
    const percent = totalSections > 0 ? Math.round((completed / totalSections) * 100) : 0;
    return (
      <div style={{ margin: '12px 0', padding: 16, border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', background: 'var(--color-accent-subtle)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>完整故事生成</div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>
              {active ? '生成中' : job.status === 'failed' ? '生成失敗，可從未完成段落繼續' : '已暫停'} · {completed}/{totalSections || '—'} 節 · {job.finalCharacterCount.toLocaleString()}/{job.targetCharacterCount.toLocaleString()} 字
            </div>
            {job.lastError && <div style={{ marginTop: 5, fontSize: 12, color: 'var(--color-error)' }}>{job.lastError}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {active ? (
              <button onClick={() => void onCancel()} style={secondaryButton}>暫停</button>
            ) : (
              <>
                <button onClick={() => void onResume()} style={primaryButton}>繼續生成</button>
                <button
                  onClick={() => { if (window.confirm('要捨棄目前已生成的完整故事內容嗎？')) void onDiscard(); }}
                  style={dangerButton}
                >捨棄</button>
              </>
            )}
          </div>
        </div>
        <div style={{ height: 6, marginTop: 12, borderRadius: 999, background: 'var(--color-bg-tertiary)', overflow: 'hidden' }}>
          <div style={{ width: `${percent}%`, height: '100%', background: 'var(--color-accent)', transition: 'width 200ms ease' }} />
        </div>
      </div>
    );
  }

  return (
    <>
      <button disabled={disabled} onClick={() => setOpen(true)} style={{ ...primaryButton, padding: '10px 18px', opacity: disabled ? 0.5 : 1 }}>
        由 AI 生成完整故事
      </button>
      {open && (
        <div style={overlay} onClick={event => { if (event.target === event.currentTarget && !submitting) setOpen(false); }}>
          <div style={modal}>
            <h2 style={{ margin: 0, fontSize: 18 }}>生成完整故事</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              AI 會規劃並完成整篇故事。完成條件為總字數在目標的 ±5% 內，且主要衝突與伏筆有明確結局。
            </p>
            <label style={labelStyle}>故事提示</label>
            <textarea
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              rows={7}
              placeholder="描述題材、角色、背景與希望發生的故事……"
              style={inputStyle}
              autoFocus
            />
            <label style={labelStyle}>目標字數（1,000–20,000）</label>
            <input
              type="number"
              min={1_000}
              max={20_000}
              step={500}
              value={target}
              onChange={event => setTarget(Number(event.target.value))}
              style={{ ...inputStyle, minHeight: 0 }}
            />
            {error && <div style={{ fontSize: 13, color: 'var(--color-error)' }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button disabled={submitting} onClick={() => setOpen(false)} style={secondaryButton}>取消</button>
              <button
                disabled={submitting || !prompt.trim() || target < 1_000 || target > 20_000}
                onClick={async () => {
                  setSubmitting(true);
                  setError('');
                  const message = await onStart(prompt.trim(), target);
                  setSubmitting(false);
                  if (message) setError(message); else setOpen(false);
                }}
                style={primaryButton}
              >{submitting ? '啟動中……' : '開始生成'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const primaryButton: React.CSSProperties = { border: 0, borderRadius: 'var(--radius-md)', padding: '8px 14px', background: 'var(--color-accent)', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
const secondaryButton: React.CSSProperties = { ...primaryButton, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)' };
const dangerButton: React.CSSProperties = { ...secondaryButton, borderColor: 'var(--color-error)', color: 'var(--color-error)' };
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 };
const modal: React.CSSProperties = { width: 560, maxWidth: '100%', padding: 24, borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: 'var(--shadow-lg)' };
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 4 };
const inputStyle: React.CSSProperties = { width: '100%', minHeight: 120, padding: '10px 12px', boxSizing: 'border-box', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', resize: 'vertical', fontFamily: 'inherit', fontSize: 14 };
