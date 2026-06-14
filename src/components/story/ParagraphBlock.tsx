import { useState, useCallback } from 'react';
import { StreamingTextRenderer } from './StreamingTextRenderer';
import { zhTW } from '@/i18n/zh-TW';
import type { ParagraphMeta } from '@/types/models';

const STATUS_LABELS: Record<ParagraphMeta['status'], string> = {
  normal: '',
  generating: zhTW.paragraph.generating,
  detached: zhTW.paragraph.detached,
  draft: zhTW.paragraph.draft,
  review_pending: zhTW.paragraph.reviewPending,
};

const TYPE_LABELS: Record<ParagraphMeta['type'], string> = {
  user: zhTW.paragraph.user,
  ai: zhTW.paragraph.ai,
  system: zhTW.paragraph.system,
};

interface ParagraphBlockProps {
  paragraph: ParagraphMeta;
  content: string;
  streamingContent?: string;
  /** Thinking-model reasoning for this paragraph (display-only, not the saved story). */
  thinking?: string;
  isStreaming?: boolean;
  isRefining?: boolean;
  isRefined?: boolean;
  onDelete?: (id: string) => void;
  onRegenerate?: (id: string) => void;
  onRollback?: (id: string) => void;
  onCopy?: (content: string) => void;
  onSwitchVersion?: (id: string, version: number) => void;
}

export function ParagraphBlock({
  paragraph,
  content,
  streamingContent,
  thinking,
  isStreaming = false,
  isRefining = false,
  isRefined = false,
  onDelete,
  onRegenerate,
  onRollback,
  onCopy,
  onSwitchVersion,
}: ParagraphBlockProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  const rawContent = isStreaming ? (streamingContent ?? '') : content;
  const displayContent = rawContent.split('---WORLD_CHANGES---')[0].trimEnd();

  const isDetached = paragraph.status === 'detached';
  const isDraft = paragraph.status === 'draft';
  const isReviewPending = paragraph.status === 'review_pending';
  const isGenerating = paragraph.status === 'generating';
  const isUserBlock = paragraph.type === 'user';

  const handleDelete = useCallback(() => {
    if (confirmDelete) {
      onDelete?.(paragraph.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  }, [confirmDelete, onDelete, paragraph.id]);

  const handleCopy = useCallback(() => {
    onCopy?.(displayContent);
    navigator.clipboard.writeText(displayContent).catch(() => { /* ignore */ });
  }, [displayContent, onCopy]);

  const statusLabel = STATUS_LABELS[paragraph.status];
  const typeLabel = TYPE_LABELS[paragraph.type];

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setConfirmDelete(false); }}
      style={{
        position: 'relative',
        marginBottom: 16,
        opacity: isDetached ? 0.45 : 1,
        transition: 'opacity var(--transition-fast)',
      }}
    >
      {/* Dialogue refining indicator — shown after streaming, during the dialogue pass */}
      {isRefining && !isGenerating && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            fontWeight: 500,
            padding: '2px 8px',
            borderRadius: 99,
            marginBottom: 4,
            background: 'var(--color-accent-subtle)',
            color: 'var(--color-accent)',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'currentColor',
              animation: 'pulse 1.4s ease-in-out infinite',
              display: 'inline-block',
            }}
          />
          {zhTW.paragraph.refining}
        </div>
      )}

      {/* Dialogue-refined badge — persists after the pass to show this paragraph's
          dialogue was refined (the raw draft is kept as a prior version to compare). */}
      {isRefined && !isRefining && !isGenerating && (
        <div
          title={zhTW.paragraph.refinedHint}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            fontWeight: 500,
            padding: '2px 8px',
            borderRadius: 99,
            marginBottom: 4,
            background: 'var(--color-accent-subtle)',
            color: 'var(--color-accent)',
          }}
        >
          ✨ {zhTW.paragraph.refined}
        </div>
      )}

      {/* Status badge for non-normal states */}
      {statusLabel && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            fontWeight: 500,
            padding: '2px 8px',
            borderRadius: 99,
            marginBottom: 4,
            background: isDetached
              ? 'var(--color-bg-tertiary)'
              : isDraft
              ? 'rgba(245, 166, 35, 0.15)'
              : isReviewPending
              ? 'rgba(74, 144, 217, 0.15)'
              : isGenerating
              ? 'var(--color-accent-subtle)'
              : 'transparent',
            color: isDetached
              ? 'var(--color-text-muted)'
              : isDraft
              ? 'var(--color-warning)'
              : isReviewPending
              ? 'var(--color-info)'
              : isGenerating
              ? 'var(--color-accent)'
              : 'transparent',
          }}
        >
          {isGenerating && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'currentColor',
                animation: 'pulse 1.4s ease-in-out infinite',
                display: 'inline-block',
              }}
            />
          )}
          {statusLabel}
        </div>
      )}

      {/* Thinking-model reasoning — collapsible, dimmed, never part of the story */}
      {thinking && thinking.trim() && (
        <div style={{ marginBottom: 6 }}>
          <button
            onClick={() => setThinkingExpanded(v => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: 500,
              padding: '2px 8px',
              borderRadius: 99,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
            }}
          >
            💭 {zhTW.paragraph.thinking}
            <span style={{ fontSize: 9 }}>{(thinkingExpanded || isGenerating) ? '▾' : '▸'}</span>
          </button>
          {(thinkingExpanded || isGenerating) && (
            <div
              style={{
                marginTop: 4,
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-tertiary)',
                fontSize: 12,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                fontStyle: 'italic',
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              {thinking}
            </div>
          )}
        </div>
      )}

      <div>
        {/* Block content */}
        <div
          style={{
            background: isUserBlock ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
            border: `1px solid ${
              isReviewPending
                ? 'var(--color-info)'
                : isDetached
                ? 'var(--color-border)'
                : isGenerating
                ? 'var(--color-accent)'
                : 'var(--color-border)'
            }`,
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            transition: 'border-color var(--transition-fast)',
            borderLeft: isUserBlock
              ? '3px solid var(--color-accent)'
              : `1px solid ${isGenerating ? 'var(--color-accent)' : 'var(--color-border)'}`,
          }}
        >
          {/* Block header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: isUserBlock ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {typeLabel}
            </span>

            {/* Version switcher */}
            {paragraph.totalVersions > 1 && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>版本：</span>
                {Array.from({ length: paragraph.totalVersions }, (_, i) => i + 1).map(v => (
                  <button
                    key={v}
                    onClick={() => onSwitchVersion?.(paragraph.id, v)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      border: `1px solid ${v === paragraph.activeVersion ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: v === paragraph.activeVersion ? 'var(--color-accent-subtle)' : 'transparent',
                      color: v === paragraph.activeVersion ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 500,
                      lineHeight: 1,
                      padding: 0,
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Content */}
          <StreamingTextRenderer
            content={displayContent}
            isStreaming={isStreaming && isGenerating}
          />

          {/* Metadata (expandable) */}
          {metaExpanded && (
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px solid var(--color-border)',
                fontSize: 12,
                color: 'var(--color-text-muted)',
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              {paragraph.modelUsed && (
                <span>模型：{paragraph.modelUsed}</span>
              )}
              {paragraph.tokenCount > 0 && (
                <span>Token：{paragraph.tokenCount}</span>
              )}
              <span>建立：{new Date(paragraph.createdAt).toLocaleString('zh-TW')}</span>
              <span>版本 v{paragraph.activeVersion}/{paragraph.totalVersions}</span>
            </div>
          )}
        </div>

        {/* Toolbar — visible on hover, absolutely positioned to avoid layout shift */}
        {isHovered && !isGenerating && (
          <div
            style={{
              position: 'absolute',
              top: statusLabel ? 28 : 0,
              right: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              zIndex: 10,
            }}
          >
            {/* Copy */}
            <ToolbarButton
              title={zhTW.paragraph.copy}
              onClick={handleCopy}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="4" y="4" width="8" height="9" rx="1" />
                <path d="M4 4V3a1 1 0 011-1h5a1 1 0 011 1v1" />
              </svg>
            </ToolbarButton>

            {/* Expand metadata */}
            <ToolbarButton
              title="展開/收合元資訊"
              onClick={() => setMetaExpanded(v => !v)}
              active={metaExpanded}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="7" cy="7" r="5" />
                <line x1="7" y1="5" x2="7" y2="9" />
                <line x1="5" y1="7" x2="9" y2="7" />
              </svg>
            </ToolbarButton>

            {/* Regenerate (AI only) */}
            {paragraph.type === 'ai' && onRegenerate && (
              <ToolbarButton
                title={zhTW.chat.regenerate}
                onClick={() => onRegenerate(paragraph.id)}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 7A5 5 0 1 1 7 12" />
                  <polyline points="2,4 2,7 5,7" />
                </svg>
              </ToolbarButton>
            )}

            {/* Rollback */}
            {onRollback && (
              <ToolbarButton
                title={zhTW.paragraph.rollback}
                onClick={() => onRollback(paragraph.id)}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M7 2L2 7l5 5" />
                  <line x1="2" y1="7" x2="12" y2="7" />
                </svg>
              </ToolbarButton>
            )}

            {/* Delete */}
            {onDelete && (
              <ToolbarButton
                title={confirmDelete ? '點擊確認刪除' : zhTW.paragraph.delete}
                onClick={handleDelete}
                danger={confirmDelete}
              >
                {confirmDelete ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 2l10 10M12 2L2 12" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <polyline points="1,3 13,3" />
                    <path d="M4 3V2a1 1 0 011-1h4a1 1 0 011 1v1" />
                    <rect x="2" y="3" width="10" height="10" rx="1" />
                  </svg>
                )}
              </ToolbarButton>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}

interface ToolbarButtonProps {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  danger?: boolean;
}

function ToolbarButton({ title, onClick, children, active, danger }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${danger ? 'var(--color-error)' : active ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: danger
          ? 'rgba(229, 83, 83, 0.1)'
          : active
          ? 'var(--color-accent-subtle)'
          : 'var(--color-surface)',
        color: danger
          ? 'var(--color-error)'
          : active
          ? 'var(--color-accent)'
          : 'var(--color-text-secondary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        transition: 'all var(--transition-fast)',
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        if (!danger && !active) {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-accent)';
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-accent)';
        }
      }}
      onMouseLeave={e => {
        if (!danger && !active) {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)';
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
        }
      }}
    >
      {children}
    </button>
  );
}
