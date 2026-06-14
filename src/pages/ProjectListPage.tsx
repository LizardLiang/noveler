import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectApi, settingsApi, templateApi } from '@/lib/ipc';
import { useProjectStore } from '@/stores/projectStore';
import { TemplateSelector } from '@/components/project/TemplateSelector';
import { zhTW } from '@/i18n/zh-TW';
import type { ProjectInfo } from '@/types/ipc';

// Dialog shown when a project's storage path is unavailable
interface StorageErrorDialogProps {
  projectName: string;
  storagePath: string;
  onRelocate: () => void;
  onRemove: () => void;
  onCancel: () => void;
}

function StorageErrorDialog({ projectName, storagePath, onRelocate, onRemove, onCancel }: StorageErrorDialogProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '28px 32px',
        width: 420,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'rgba(229,83,83,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="var(--color-error)" strokeWidth="1.8">
              <path d="M9 2L2 16h14L9 2z" strokeLinejoin="round" />
              <line x1="9" y1="7" x2="9" y2="11" strokeLinecap="round" />
              <circle cx="9" cy="14" r="0.5" fill="var(--color-error)" />
            </svg>
          </div>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              儲存路徑不存在
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              專案「{projectName}」的儲存位置無法存取：
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-tertiary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {storagePath}
            </p>
          </div>
        </div>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {zhTW.errors.storagePathMissing}
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            取消
          </button>
          <button
            onClick={onRemove}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(229,83,83,0.4)',
              background: 'rgba(229,83,83,0.08)',
              color: 'var(--color-error)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {zhTW.errors.storagePathRemove}
          </button>
          <button
            onClick={onRelocate}
            style={{
              padding: '8px 18px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: 'var(--color-accent)',
              color: 'white',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {zhTW.errors.storagePathRelocate}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

interface CreateProjectDialogProps {
  onClose: () => void;
  onCreated: (project: ProjectInfo) => void;
}

function CreateProjectDialog({ onClose, onCreated }: CreateProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const handleSelectPath = async () => {
    const result = await projectApi.selectPath();
    if (result.success) {
      setStoragePath(result.data);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('請輸入專案名稱');
      return;
    }
    if (!storagePath) {
      setError('請選擇儲存位置');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const result = await projectApi.create({
        name: name.trim(),
        description: description.trim(),
        storagePath,
      });

      if (result.success) {
        // Apply template if selected
        if (selectedTemplateId) {
          await templateApi.apply(result.data.id, selectedTemplateId);
        }
        onCreated(result.data);
        onClose();
      } else {
        setError(result.error.message);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: 32,
          width: 480,
          maxHeight: 'calc(100vh - 80px)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {zhTW.project.new}
        </h2>

        {/* Project name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
            {zhTW.project.name}
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={zhTW.project.namePlaceholder}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              fontSize: 14,
              outline: 'none',
            }}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
          />
        </div>

        {/* Description */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
            {zhTW.project.description}
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={zhTW.project.descriptionPlaceholder}
            rows={3}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              fontSize: 14,
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        {/* Storage path */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
            {zhTW.project.storagePath}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={storagePath}
              readOnly
              placeholder={zhTW.project.storagePathPlaceholder}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text-primary)',
                fontSize: 14,
                outline: 'none',
                cursor: 'pointer',
              }}
              onClick={handleSelectPath}
            />
            <button
              onClick={handleSelectPath}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
                fontSize: 14,
                whiteSpace: 'nowrap',
              }}
            >
              {zhTW.project.browse}
            </button>
          </div>
        </div>

        {/* Template selector */}
        <TemplateSelector
          selectedTemplateId={selectedTemplateId}
          onSelect={setSelectedTemplateId}
        />

        {/* Error message */}
        {error && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-error)' }}>{error}</p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {zhTW.project.cancel}
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{
              padding: '8px 20px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: creating ? 'var(--color-text-muted)' : 'var(--color-accent)',
              color: 'white',
              cursor: creating ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {creating ? '建立中...' : zhTW.project.create}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ImportNovelDialogProps {
  onClose: () => void;
  onImported: (project: ProjectInfo) => void;
}

function ImportNovelDialog({ onClose, onImported }: ImportNovelDialogProps) {
  const [name, setName] = useState('');
  const [filePath, setFilePath] = useState('');
  const [storagePath, setStoragePath] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);

  const handleSelectFile = async () => {
    const result = await projectApi.selectNovelFile();
    if (result.success) {
      setFilePath(result.data);
      // Default the project name to the file name (without extension)
      if (!name.trim()) {
        const base = result.data.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '');
        setName(base);
      }
    }
  };

  const handleSelectPath = async () => {
    const result = await projectApi.selectPath();
    if (result.success) {
      setStoragePath(result.data);
    }
  };

  const handleImport = async () => {
    if (!filePath) {
      setError(zhTW.project.importFileRequired);
      return;
    }
    if (!name.trim()) {
      setError('請輸入專案名稱');
      return;
    }
    if (!storagePath) {
      setError('請選擇儲存位置');
      return;
    }

    setImporting(true);
    setError('');

    try {
      const result = await projectApi.importNovel({
        name: name.trim(),
        description: '',
        storagePath,
        filePath,
      });

      if (result.success) {
        onImported(result.data.project);
        onClose();
      } else {
        setError(result.error.message);
      }
    } finally {
      setImporting(false);
    }
  };

  const inputStyle: CSSProperties = {
    padding: '8px 12px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-secondary)',
    color: 'var(--color-text-primary)',
    fontSize: 14,
    outline: 'none',
  };

  const browseButtonStyle: CSSProperties = {
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-tertiary)',
    color: 'var(--color-text-primary)',
    cursor: 'pointer',
    fontSize: 14,
    whiteSpace: 'nowrap',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: 32,
          width: 480,
          maxHeight: 'calc(100vh - 80px)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {zhTW.project.import}
        </h2>

        {/* Novel file */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
            {zhTW.project.importFile}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={filePath}
              readOnly
              placeholder={zhTW.project.importFilePlaceholder}
              style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}
              onClick={handleSelectFile}
            />
            <button onClick={handleSelectFile} style={browseButtonStyle}>
              {zhTW.project.browse}
            </button>
          </div>
        </div>

        {/* Project name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
            {zhTW.project.name}
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={zhTW.project.namePlaceholder}
            style={inputStyle}
          />
        </div>

        {/* Storage path */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
            {zhTW.project.storagePath}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={storagePath}
              readOnly
              placeholder={zhTW.project.storagePathPlaceholder}
              style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}
              onClick={handleSelectPath}
            />
            <button onClick={handleSelectPath} style={browseButtonStyle}>
              {zhTW.project.browse}
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-error)' }}>{error}</p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {zhTW.project.cancel}
          </button>
          <button
            onClick={handleImport}
            disabled={importing}
            style={{
              padding: '8px 20px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: importing ? 'var(--color-text-muted)' : 'var(--color-accent)',
              color: 'white',
              cursor: importing ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {importing ? zhTW.project.importing : zhTW.project.importButton}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectListPage() {
  const navigate = useNavigate();
  const { projects, setProjects, addProject, removeProject, isLoading, setLoading } = useProjectStore();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<{
    project: ProjectInfo;
    action: 'open';
  } | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const result = await projectApi.list();
      if (result.success) {
        setProjects(result.data);
      }
    } finally {
      setLoading(false);
    }
  }, [setLoading, setProjects]);

  // Load settings to apply theme
  useEffect(() => {
    settingsApi.get().then(result => {
      if (result.success) {
        const theme = result.data.theme;
        if (theme === 'light') {
          document.documentElement.setAttribute('data-theme', 'light');
        } else if (theme === 'dark') {
          document.documentElement.removeAttribute('data-theme');
        } else {
          // system: follow OS
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          if (!prefersDark) {
            document.documentElement.setAttribute('data-theme', 'light');
          }
        }
      }
    });
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleProjectCreated = (project: ProjectInfo) => {
    addProject(project);
    navigate(`/project/${project.id}`);
  };

  // Open a project folder created by this app (e.g. copied from another machine)
  const handleOpenExistingProject = async () => {
    const pathResult = await projectApi.selectPath(zhTW.project.openFolderTitle);
    if (!pathResult.success) return;

    const result = await projectApi.open(pathResult.data);
    if (result.success) {
      navigate(`/project/${result.data.id}`);
    } else {
      window.alert(`開啟專案失敗：${result.error.message}`);
    }
  };

  const handleOpenProject = async (project: ProjectInfo) => {
    const result = await projectApi.open(project.storagePath);
    if (result.success) {
      navigate(`/project/${result.data.id}`);
    } else {
      // Check if it's a path availability issue
      const code = (result as { success: false; error: { code: string } }).error.code;
      if (code === 'PROJECT_NOT_FOUND' || code === 'PROJECT_OPEN_ERROR') {
        setStorageError({ project, action: 'open' });
      } else {
        // Other errors — show via alert
        window.alert(`開啟專案失敗：${(result as { success: false; error: { message: string } }).error.message}`);
      }
    }
  };

  const handleStorageRelocate = async () => {
    if (!storageError) return;
    // Ask user to select new path
    const pathResult = await projectApi.selectPath();
    if (pathResult.success) {
      const newPath = pathResult.data;
      // Try to open from new path
      const result = await projectApi.open(newPath);
      if (result.success) {
        setStorageError(null);
        navigate(`/project/${result.data.id}`);
      } else {
        window.alert(`指定的路徑仍然無法開啟專案。`);
      }
    }
    setStorageError(null);
  };

  const handleStorageRemove = async () => {
    if (!storageError) return;
    const result = await projectApi.delete(storageError.project.id);
    if (result.success) {
      removeProject(storageError.project.id);
    }
    setStorageError(null);
  };

  const handleDeleteProject = async (project: ProjectInfo) => {
    if (!window.confirm(`${zhTW.project.deleteConfirm}\n\n「${project.name}」`)) {
      return;
    }
    setDeletingId(project.id);
    try {
      const result = await projectApi.delete(project.id);
      if (result.success) {
        removeProject(project.id);
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '40px 24px',
        overflowY: 'auto',
        background: 'var(--color-bg-primary)',
      }}
    >
      {/* Header */}
      <div
        style={{
          width: '100%',
          maxWidth: 800,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 32,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
            }}
          >
            {zhTW.app.title}
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-text-secondary)' }}>
            選擇或建立專案以開始創作
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleOpenExistingProject}
            style={{
              padding: '10px 20px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
              <path d="M1 3h4l1.5 1.5H13V12H1V3z" />
            </svg>
            {zhTW.project.open}
          </button>
          <button
            onClick={() => setShowImportDialog(true)}
            style={{
              padding: '10px 20px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 1v8" />
              <polyline points="4,6 7,9 10,6" />
              <path d="M1 10v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
            </svg>
            {zhTW.project.import}
          </button>
          <button
            onClick={() => setShowCreateDialog(true)}
            style={{
              padding: '10px 20px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: 'var(--color-accent)',
              color: 'white',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="7" y1="1" x2="7" y2="13" />
              <line x1="1" y1="7" x2="13" y2="7" />
            </svg>
            {zhTW.project.new}
          </button>
        </div>
      </div>

      {/* Project list */}
      <div style={{ width: '100%', maxWidth: 800 }}>
        {isLoading ? (
          <div
            style={{
              textAlign: 'center',
              padding: 40,
              color: 'var(--color-text-tertiary)',
            }}
          >
            載入中...
          </div>
        ) : projects.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: 60,
              color: 'var(--color-text-tertiary)',
              border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ margin: '0 auto 16px', display: 'block', opacity: 0.4 }}
            >
              <rect x="8" y="12" width="32" height="28" rx="3" />
              <path d="M16 12V8a2 2 0 012-2h12a2 2 0 012 2v4" />
              <line x1="24" y1="22" x2="24" y2="34" />
              <line x1="18" y1="28" x2="30" y2="28" />
            </svg>
            <p style={{ margin: 0, fontSize: 14 }}>{zhTW.project.noProjects}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {projects.map(project => (
              <div
                key={project.id}
                onClick={() => handleOpenProject(project)}
                style={{
                  padding: '16px 20px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'border-color var(--transition-fast), background var(--transition-fast)',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-accent)';
                  (e.currentTarget as HTMLDivElement).style.background = 'var(--color-surface-raised)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-border)';
                  (e.currentTarget as HTMLDivElement).style.background = 'var(--color-surface)';
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth="1.5"
                    >
                      <path d="M2 3h5l2 2h5v9H2V3z" />
                    </svg>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 15,
                        color: 'var(--color-text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {project.name}
                    </span>
                  </div>
                  {project.description && (
                    <p
                      style={{
                        margin: '0 0 6px',
                        fontSize: 13,
                        color: 'var(--color-text-secondary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {project.description}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                    <span>{zhTW.project.wordCount}: {project.wordCount.toLocaleString()}</span>
                    <span>{zhTW.project.paragraphCount}: {project.paragraphCount}</span>
                    <span>{zhTW.project.lastModified}: {formatDate(project.updatedAt)}</span>
                  </div>
                </div>

                {/* Delete button */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    handleDeleteProject(project);
                  }}
                  disabled={deletingId === project.id}
                  title={zhTW.project.delete}
                  style={{
                    marginLeft: 16,
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid transparent',
                    background: 'transparent',
                    color: 'var(--color-text-tertiary)',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'all var(--transition-fast)',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-error)';
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-error)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-tertiary)';
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polyline points="1,3 13,3" />
                    <path d="M4 3V2a1 1 0 011-1h4a1 1 0 011 1v1" />
                    <rect x="2" y="3" width="10" height="10" rx="1" />
                    <line x1="5.5" y1="6" x2="5.5" y2="10" />
                    <line x1="8.5" y1="6" x2="8.5" y2="10" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settings link */}
      <div style={{ marginTop: 'auto', paddingTop: 32 }}>
        <a
          href="#/settings"
          style={{
            fontSize: 13,
            color: 'var(--color-text-tertiary)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="2" />
            <path d="M7 1v1M7 12v1M1 7h1M12 7h1M3 3l.7.7M10.3 10.3l.7.7M3 11l.7-.7M10.3 3.7l.7-.7" />
          </svg>
          {zhTW.settings.title}
        </a>
      </div>

      {/* Create dialog */}
      {showCreateDialog && (
        <CreateProjectDialog
          onClose={() => setShowCreateDialog(false)}
          onCreated={handleProjectCreated}
        />
      )}

      {/* Import novel dialog */}
      {showImportDialog && (
        <ImportNovelDialog
          onClose={() => setShowImportDialog(false)}
          onImported={handleProjectCreated}
        />
      )}

      {/* Storage path error dialog */}
      {storageError && (
        <StorageErrorDialog
          projectName={storageError.project.name}
          storagePath={storageError.project.storagePath}
          onRelocate={handleStorageRelocate}
          onRemove={handleStorageRemove}
          onCancel={() => setStorageError(null)}
        />
      )}
    </div>
  );
}
