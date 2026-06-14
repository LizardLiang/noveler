import { useState, useCallback } from 'react';
import { branchApi } from '@/lib/ipc';
import { useProjectStore } from '@/stores/projectStore';
import { useStoryStore } from '@/stores/storyStore';
import { paragraphApi } from '@/lib/ipc';
import { zhTW } from '@/i18n/zh-TW';

interface BranchNode {
  branch: {
    id: string;
    projectId: string;
    parentBranchId: string | null;
    forkParagraphId: string | null;
    name: string;
    isMain: boolean;
    createdAt: string;
    updatedAt: string;
  };
  children: BranchNode[];
}

interface TimelineTreeProps {
  branches: BranchNode[];
  currentBranchId: string | null;
  onBranchSwitch: (branchId: string) => void;
  onBranchCreated: () => void;
}

interface BranchNodeViewProps {
  node: BranchNode;
  depth: number;
  currentBranchId: string | null;
  projectId: string;
  onBranchSwitch: (branchId: string) => void;
  onRefresh: () => void;
}

function BranchNodeView({
  node,
  depth,
  currentBranchId,
  projectId,
  onBranchSwitch,
  onRefresh,
}: BranchNodeViewProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameName, setRenameName] = useState(node.branch.name);
  const [showMenu, setShowMenu] = useState(false);
  const isCurrent = node.branch.id === currentBranchId;

  const handleRename = async () => {
    if (!renameName.trim()) return;
    await branchApi.rename(projectId, node.branch.id, renameName.trim());
    setIsRenaming(false);
    onRefresh();
  };

  const handleDelete = async () => {
    if (!window.confirm(zhTW.branch.deleteConfirm)) return;
    await branchApi.delete(projectId, node.branch.id);
    onRefresh();
  };

  const handleSetMain = async () => {
    await branchApi.setMain(projectId, node.branch.id);
    setShowMenu(false);
    onRefresh();
  };

  return (
    <div>
      {/* Branch node */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginLeft: depth * 16,
          position: 'relative',
        }}
      >
        {/* Connector line for children */}
        {depth > 0 && (
          <div
            style={{
              position: 'absolute',
              left: -8,
              top: '50%',
              width: 8,
              height: 1,
              background: 'var(--color-border)',
            }}
          />
        )}

        <button
          onClick={() => !isCurrent && onBranchSwitch(node.branch.id)}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 8px',
            borderRadius: 'var(--radius-sm)',
            border: isCurrent ? '1px solid var(--color-accent)' : '1px solid transparent',
            background: isCurrent ? 'var(--color-accent-subtle)' : 'transparent',
            color: isCurrent ? 'var(--color-accent)' : 'var(--color-text-primary)',
            cursor: isCurrent ? 'default' : 'pointer',
            textAlign: 'left',
            fontSize: 13,
            minWidth: 0,
          }}
        >
          {/* Branch icon */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            style={{ flexShrink: 0 }}
          >
            <circle cx="6" cy="6" r="3" fill={isCurrent ? 'currentColor' : 'none'} />
          </svg>

          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              fontWeight: isCurrent ? 500 : 400,
            }}
          >
            {isRenaming ? (
              <input
                value={renameName}
                onChange={e => setRenameName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') setIsRenaming(false);
                }}
                onClick={e => e.stopPropagation()}
                autoFocus
                style={{
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-accent)',
                  color: 'var(--color-text-primary)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '1px 4px',
                  fontSize: 13,
                  width: '100%',
                }}
              />
            ) : (
              node.branch.name
            )}
          </span>

          {node.branch.isMain && (
            <span
              style={{
                fontSize: 10,
                padding: '1px 5px',
                borderRadius: 999,
                background: 'var(--color-accent-subtle)',
                color: 'var(--color-accent)',
                flexShrink: 0,
              }}
            >
              {zhTW.branch.main}
            </span>
          )}

          {isCurrent && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-accent)',
                flexShrink: 0,
              }}
            />
          )}
        </button>

        {/* Context menu button */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={e => {
              e.stopPropagation();
              setShowMenu(v => !v);
            }}
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              borderRadius: 'var(--radius-sm)',
              padding: 0,
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="6" cy="2" r="1" />
              <circle cx="6" cy="6" r="1" />
              <circle cx="6" cy="10" r="1" />
            </svg>
          </button>

          {showMenu && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                zIndex: 20,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-md)',
                minWidth: 120,
                padding: 4,
              }}
              onMouseLeave={() => setShowMenu(false)}
            >
              <button
                onClick={() => { setIsRenaming(true); setShowMenu(false); }}
                style={menuItemStyle}
              >
                {zhTW.branch.rename}
              </button>
              {!node.branch.isMain && (
                <button onClick={handleSetMain} style={menuItemStyle}>
                  {zhTW.branch.setMain}
                </button>
              )}
              {!node.branch.isMain && (
                <button
                  onClick={handleDelete}
                  style={{ ...menuItemStyle, color: 'var(--color-error)' }}
                >
                  {zhTW.branch.delete}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Children nodes */}
      {node.children.length > 0 && (
        <div style={{ position: 'relative' }}>
          {/* Vertical connector line */}
          <div
            style={{
              position: 'absolute',
              left: depth * 16 + 6,
              top: 0,
              bottom: 0,
              width: 1,
              background: 'var(--color-border)',
            }}
          />
          {node.children.map(child => (
            <BranchNodeView
              key={child.branch.id}
              node={child}
              depth={depth + 1}
              currentBranchId={currentBranchId}
              projectId={projectId}
              onBranchSwitch={onBranchSwitch}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 10px',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 'var(--radius-sm)',
};

interface CreateBranchFormProps {
  projectId: string;
  currentBranchId: string;
  onCreated: () => void;
  onCancel: () => void;
}

function CreateBranchForm({ projectId, currentBranchId, onCreated, onCancel }: CreateBranchFormProps) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await branchApi.create(projectId, currentBranchId, null, name.trim());
      onCreated();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      style={{
        padding: '8px 10px',
        background: 'var(--color-bg-secondary)',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={zhTW.branch.namePlaceholder}
        autoFocus
        onKeyDown={e => {
          if (e.key === 'Enter') handleCreate();
          if (e.key === 'Escape') onCancel();
        }}
        style={{
          width: '100%',
          padding: '5px 8px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-primary)',
          color: 'var(--color-text-primary)',
          fontSize: 13,
          outline: 'none',
          marginBottom: 6,
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          style={{
            flex: 1,
            padding: '5px 8px',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            background: 'var(--color-accent)',
            color: 'white',
            fontSize: 12,
            cursor: creating ? 'not-allowed' : 'pointer',
          }}
        >
          {creating ? '建立中...' : zhTW.branch.create}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '5px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {zhTW.worldMemory.cancel}
        </button>
      </div>
    </div>
  );
}

export function TimelineTree() {
  const { currentProject, currentBranchId, branches, setBranches, setCurrentBranchId } = useProjectStore();
  const { setParagraphs, setBulkContents, setCurrentBranchId: setStoryBranchId } = useStoryStore();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadBranchTree = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    try {
      const result = await branchApi.getTree(currentProject.id);
      if (result.success) {
        // Flatten to set in store
        const flat: typeof branches = [];
        function flatten(nodes: BranchNode[]) {
          for (const n of nodes) {
            flat.push(n.branch as typeof branches[0]);
            flatten(n.children);
          }
        }
        flatten(result.data as BranchNode[]);
        setBranches(flat);
      }
    } finally {
      setLoading(false);
    }
  }, [currentProject, setBranches]);

  const handleBranchSwitch = useCallback(
    async (branchId: string) => {
      if (!currentProject) return;
      const result = await branchApi.switch(currentProject.id, branchId);
      if (result.success) {
        setCurrentBranchId(branchId);
        setStoryBranchId(branchId);

        // Load paragraphs for new branch
        const paragraphResult = await paragraphApi.list(currentProject.id, branchId);
        if (paragraphResult.success) {
          setParagraphs(paragraphResult.data);
          // Load contents
          const contents = new Map<string, string>();
          await Promise.all(
            paragraphResult.data.map(async p => {
              const contentResult = await paragraphApi.getContent(currentProject.id, branchId, p.id);
              if (contentResult.success) {
                contents.set(p.id, contentResult.data);
              }
            }),
          );
          setBulkContents(contents);
        }
      }
    },
    [currentProject, setCurrentBranchId, setStoryBranchId, setParagraphs, setBulkContents],
  );

  if (!currentProject) return null;

  // Build tree from flat branches list
  const branchMap = new Map<string, BranchNode>();
  for (const b of branches) {
    branchMap.set(b.id, { branch: b, children: [] });
  }
  const roots: BranchNode[] = [];
  for (const node of branchMap.values()) {
    if (node.branch.parentBranchId && branchMap.has(node.branch.parentBranchId)) {
      branchMap.get(node.branch.parentBranchId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {zhTW.sidebar.timeline}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={loadBranchTree}
            disabled={loading}
            title="重新整理"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" />
              <polyline points="6,0 8,2 6,4" />
            </svg>
          </button>
          <button
            onClick={() => setShowCreateForm(v => !v)}
            title={zhTW.branch.newBranch}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="1" x2="6" y2="11" />
              <line x1="1" y1="6" x2="11" y2="6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Branch tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 6px' }}>
        {roots.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 6px' }}>
            尚無分支
          </div>
        ) : (
          roots.map(root => (
            <BranchNodeView
              key={root.branch.id}
              node={root}
              depth={0}
              currentBranchId={currentBranchId}
              projectId={currentProject.id}
              onBranchSwitch={handleBranchSwitch}
              onRefresh={loadBranchTree}
            />
          ))
        )}
      </div>

      {/* Create branch form */}
      {showCreateForm && currentBranchId && (
        <CreateBranchForm
          projectId={currentProject.id}
          currentBranchId={currentBranchId}
          onCreated={() => {
            setShowCreateForm(false);
            loadBranchTree();
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}
    </div>
  );
}
