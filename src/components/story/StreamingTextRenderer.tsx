import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

interface StreamingTextRendererProps {
  content: string;
  isStreaming: boolean;
  className?: string;
}

export function StreamingTextRenderer({ content, isStreaming, className }: StreamingTextRendererProps) {
  const cursorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (cursorRef.current) {
      cursorRef.current.style.display = isStreaming ? 'inline-block' : 'none';
    }
  }, [isStreaming]);

  if (isStreaming) {
    // During streaming: render plain text for performance + blinking cursor
    return (
      <div
        className={className}
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: '1.8',
          fontSize: 'var(--font-size-story)',
          color: 'var(--color-text-primary)',
        }}
      >
        {content}
        <span
          ref={cursorRef}
          style={{
            display: 'inline-block',
            width: 2,
            height: '1em',
            background: 'var(--color-accent)',
            marginLeft: 1,
            verticalAlign: 'text-bottom',
            animation: 'blink-cursor 0.8s step-end infinite',
          }}
        />
        <style>{`
          @keyframes blink-cursor {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
          }
        `}</style>
      </div>
    );
  }

  // Completed: render markdown
  if (!content) {
    return (
      <div
        className={className}
        style={{
          color: 'var(--color-text-tertiary)',
          fontSize: 'var(--font-size-story)',
          fontStyle: 'italic',
        }}
      >
        （空白段落）
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        lineHeight: '1.8',
        fontSize: 'var(--font-size-story)',
        color: 'var(--color-text-primary)',
        wordBreak: 'break-word',
      }}
    >
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <p style={{ margin: '0 0 0.8em', lineHeight: '1.8' }}>{children}</p>
          ),
          strong: ({ children }) => (
            <strong style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ fontStyle: 'italic', color: 'var(--color-text-secondary)' }}>{children}</em>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
