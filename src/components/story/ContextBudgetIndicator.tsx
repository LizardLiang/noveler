import { useState } from 'react';
import type { ContextBudgetInfo } from '@/types/ipc';

interface ContextBudgetIndicatorProps {
  budget: ContextBudgetInfo | null;
}

export function ContextBudgetIndicator({ budget }: ContextBudgetIndicatorProps) {
  const [showDetail, setShowDetail] = useState(false);

  if (!budget) return null;

  const percentage = Math.min(100, Math.round(budget.percentage));
  const isWarning = percentage >= 80;
  const isCritical = percentage >= 95;

  const barColor = isCritical
    ? 'var(--color-error)'
    : isWarning
    ? 'var(--color-warning)'
    : 'var(--color-accent)';

  const segments = [
    { label: '系統提示', used: budget.used.system, budget: budget.budget.system, color: '#897af9' },
    { label: '世界記憶', used: budget.used.worldMemory, budget: budget.budget.worldMemory, color: '#5cc49a' },
    { label: '故事歷史', used: budget.used.storyHistory, budget: budget.budget.storyHistory, color: '#5ca0e8' },
    { label: '使用者輸入', used: budget.used.userInput, budget: budget.budget.userInput, color: '#f7b740' },
  ];

  return (
    <div
      style={{ position: 'relative', flexShrink: 0 }}
      onMouseEnter={() => setShowDetail(true)}
      onMouseLeave={() => setShowDetail(false)}
    >
      {/* Progress bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'default',
        }}
      >
        <div
          style={{
            width: 80,
            height: 4,
            borderRadius: 2,
            background: 'var(--color-bg-tertiary)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${percentage}%`,
              height: '100%',
              background: barColor,
              borderRadius: 2,
              transition: 'width var(--transition-normal)',
            }}
          />
        </div>
        <span
          style={{
            fontSize: 11,
            color: isWarning ? barColor : 'var(--color-text-muted)',
            fontWeight: isWarning ? 500 : 400,
            minWidth: 32,
          }}
        >
          {percentage}%
        </span>
      </div>

      {/* Detail tooltip */}
      {showDetail && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            right: 0,
            background: 'var(--color-surface-overlay)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            minWidth: 200,
            zIndex: 100,
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
            上下文預算 ({percentage}% / {budget.totalTokens.toLocaleString()} tokens)
          </div>

          {segments.map(seg => (
            <div key={seg.label} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>{seg.label}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {seg.used.toLocaleString()} / {seg.budget.toLocaleString()}
                </span>
              </div>
              <div
                style={{
                  height: 3,
                  borderRadius: 2,
                  background: 'var(--color-bg-tertiary)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, (seg.used / seg.budget) * 100)}%`,
                    height: '100%',
                    background: seg.color,
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>
          ))}

          {budget.isSummarized && (
            <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 8 }}>
              故事歷史已摘要壓縮
            </div>
          )}
        </div>
      )}
    </div>
  );
}
