import { useState, useEffect } from 'react';
import { ipcInvoke } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';
import type { StoryStats as StoryStatsData } from '@/types/stats';
import { stepLabel, fmt } from '@/lib/usageFormatters';

const tu = zhTW.tokenUsage;

interface StoryStatsProps {
  projectId: string;
  branchId: string;
  onClose: () => void;
}

export function StoryStats({ projectId, branchId, onClose }: StoryStatsProps) {
  const [stats, setStats] = useState<StoryStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    ipcInvoke<{ success: boolean; data?: StoryStatsData; error?: { message: string } }>(
      'stats:get',
      projectId,
      branchId,
    ).then(result => {
      if (result.success && result.data) {
        setStats(result.data);
      } else {
        setError(result.error?.message ?? zhTW.errors.unknown);
      }
    }).catch(e => {
      setError(String(e));
    }).finally(() => {
      setLoading(false);
    });
  }, [projectId, branchId]);

  // Compute max word count for bar chart scaling
  const maxDaily = stats ? Math.max(...stats.dailyTrend.map(d => d.wordCount), 1) : 1;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '28px 32px',
          width: '100%',
          maxWidth: 560,
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {zhTW.stats.title}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              padding: 4,
            }}
            title={zhTW.stats.close}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="3" y1="3" x2="15" y2="15" />
              <line x1="15" y1="3" x2="3" y2="15" />
            </svg>
          </button>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-tertiary)' }}>
            載入中...
          </div>
        )}

        {error && (
          <div style={{ padding: 16, background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', color: 'var(--color-error)', fontSize: 14 }}>
            {error}
          </div>
        )}

        {stats && !loading && (
          <>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <StatCard
                label={zhTW.stats.totalWords}
                value={stats.totalWordCount.toLocaleString()}
                unit={zhTW.stats.wordsUnit}
                icon={
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 5h14M3 9h10M3 13h12M3 17h8" strokeLinecap="round" />
                  </svg>
                }
              />
              <StatCard
                label={zhTW.stats.totalParagraphs}
                value={String(stats.totalParagraphs)}
                unit={zhTW.stats.paragraphsUnit}
                icon={
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="14" height="14" rx="2" />
                    <line x1="7" y1="8" x2="13" y2="8" strokeLinecap="round" />
                    <line x1="7" y1="12" x2="11" y2="12" strokeLinecap="round" />
                  </svg>
                }
              />
            </div>

            {/* Character appearances */}
            <div>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {zhTW.stats.characterAppearances}
              </h3>
              {stats.characterAppearances.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-tertiary)' }}>{zhTW.stats.noCharacters}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {stats.characterAppearances.slice(0, 8).map(c => {
                    const maxAppearances = stats.characterAppearances[0]?.paragraphCount ?? 1;
                    const pct = Math.round((c.paragraphCount / maxAppearances) * 100);
                    return (
                      <div key={c.characterId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{
                          width: 80,
                          fontSize: 13,
                          color: 'var(--color-text-secondary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          flexShrink: 0,
                        }}>
                          {c.characterName}
                        </span>
                        <div style={{
                          flex: 1,
                          height: 10,
                          background: 'var(--color-bg-tertiary)',
                          borderRadius: 5,
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%',
                            width: `${pct}%`,
                            background: 'var(--color-accent)',
                            borderRadius: 5,
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', width: 40, textAlign: 'right', flexShrink: 0 }}>
                          {c.paragraphCount}{zhTW.stats.timesUnit}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Token usage summary */}
            <div>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {tu.title}
              </h3>
              {!stats.tokenUsage.hasData ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-tertiary)' }}>{tu.noData}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Grand total cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <TokenMiniCard label={tu.totalTokens} value={fmt(stats.tokenUsage.grandTotal.totalTokens)} />
                    <TokenMiniCard label={tu.callCount} value={fmt(stats.tokenUsage.grandTotal.callCount)} />
                    <TokenMiniCard label={tu.promptTokens} value={fmt(stats.tokenUsage.grandTotal.promptTokens)} />
                    <TokenMiniCard label={tu.completionTokens} value={fmt(stats.tokenUsage.grandTotal.completionTokens)} />
                    {stats.tokenUsage.grandTotal.reasoningTokens != null && (
                      <TokenMiniCard label={tu.reasoningTokens} value={fmt(stats.tokenUsage.grandTotal.reasoningTokens)} />
                    )}
                  </div>
                  {/* Per-step table */}
                  <div>
                    <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{tu.perStep}</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '3px 6px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>步驟</th>
                          <th style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>呼叫</th>
                          <th style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>Token 合計</th>
                          <th style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>平均延遲</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.tokenUsage.perStep.map(s => (
                          <tr key={s.step}>
                            <td style={{ padding: '3px 6px', color: 'var(--color-text-secondary)' }}>{stepLabel(s.step)}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-text-primary)' }}>{s.callCount}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-text-primary)' }}>{fmt(s.totalPromptTokens + s.totalCompletionTokens)}</td>
                            <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-text-primary)' }}>{s.avgLatencyMs.toLocaleString()}ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Per-model */}
                  {stats.tokenUsage.perModel.length > 0 && (
                    <div>
                      <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{tu.perModel}</p>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', padding: '3px 6px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>{tu.model}</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>呼叫</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>Token 合計</th>
                            <th style={{ textAlign: 'right', padding: '3px 6px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>{tu.avgTokens}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.tokenUsage.perModel.map(m => (
                            <tr key={m.model}>
                              <td style={{ padding: '3px 6px', color: 'var(--color-text-secondary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.model}>{m.model}</td>
                              <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-text-primary)' }}>{m.callCount}</td>
                              <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-text-primary)' }}>{fmt(m.totalTokens)}</td>
                              <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-text-primary)' }}>{fmt(m.avgTokens)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {/* Token daily trend (FR-023) */}
                  {stats.tokenUsage.dailyTrend.length > 0 && (
                    <div data-testid="token-daily-trend">
                      <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{tu.dailyTrend}</p>
                      {(() => {
                        const maxTokenDaily = Math.max(...stats.tokenUsage.dailyTrend.map(d => d.totalTokens), 1);
                        return (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 60, paddingBottom: 4 }}>
                              {stats.tokenUsage.dailyTrend.map(day => {
                                const h = maxTokenDaily > 0 ? Math.max((day.totalTokens / maxTokenDaily) * 54, day.totalTokens > 0 ? 4 : 0) : 0;
                                const isToday = day.date === new Date().toISOString().slice(0, 10);
                                return (
                                  <div
                                    key={day.date}
                                    title={`${day.date}: ${day.totalTokens.toLocaleString()} tokens`}
                                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}
                                  >
                                    <div style={{
                                      width: '100%',
                                      height: h,
                                      background: isToday ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                                      borderRadius: '3px 3px 0 0',
                                      minHeight: day.totalTokens > 0 ? 4 : 0,
                                    }} />
                                  </div>
                                );
                              })}
                            </div>
                            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                              {stats.tokenUsage.dailyTrend.map((day, i) => {
                                const showLabel = i === 0 || i === Math.floor(stats.tokenUsage.dailyTrend.length / 2) || i === stats.tokenUsage.dailyTrend.length - 1;
                                return (
                                  <div key={day.date} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                                    {showLabel ? day.date.slice(5) : ''}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Daily word count trend */}
            <div>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {zhTW.stats.dailyTrend}
              </h3>
              {stats.dailyTrend.every(d => d.wordCount === 0) ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-tertiary)' }}>{zhTW.stats.noTrend}</p>
              ) : (
                <div>
                  {/* Bar chart */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 4,
                    height: 80,
                    paddingBottom: 4,
                  }}>
                    {stats.dailyTrend.map(day => {
                      const h = maxDaily > 0 ? Math.max((day.wordCount / maxDaily) * 72, day.wordCount > 0 ? 4 : 0) : 0;
                      const isToday = day.date === new Date().toISOString().slice(0, 10);
                      return (
                        <div
                          key={day.date}
                          title={`${day.date}: ${day.wordCount}字`}
                          style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: 3,
                          }}
                        >
                          <div style={{
                            width: '100%',
                            height: h,
                            background: isToday ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                            borderRadius: '3px 3px 0 0',
                            minHeight: day.wordCount > 0 ? 4 : 0,
                            transition: 'height 0.3s ease',
                          }} />
                        </div>
                      );
                    })}
                  </div>
                  {/* Date labels */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {stats.dailyTrend.map((day, i) => {
                      const showLabel = i === 0 || i === Math.floor(stats.dailyTrend.length / 2) || i === stats.dailyTrend.length - 1;
                      return (
                        <div key={day.date} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                          {showLabel ? day.date.slice(5) : ''}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helper: Stat card ─────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  unit: string;
  icon: React.ReactNode;
}

function StatCard({ label, value, unit, icon }: StatCardProps) {
  return (
    <div style={{
      padding: '16px',
      background: 'var(--color-bg-secondary)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--color-border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-tertiary)' }}>
        {icon}
        <span style={{ fontSize: 12 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{unit}</span>
      </div>
    </div>
  );
}

// ── Helper: Token mini card ───────────────────────────────────────────────────

function TokenMiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--color-bg-secondary)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--color-border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>{value}</span>
    </div>
  );
}
