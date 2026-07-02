import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { projectApi, aiApi, paragraphApi, branchApi, settingsApi, fullStoryApi, ipcOn } from '@/lib/ipc';
import { useProjectStore } from '@/stores/projectStore';
import { useStoryStore } from '@/stores/storyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorldMemoryStore } from '@/stores/worldMemoryStore';
import { useStream } from '@/hooks/useStream';
import { ChatInput } from '@/components/story/ChatInput';
import { ParagraphBlock } from '@/components/story/ParagraphBlock';
import { ContextBudgetIndicator } from '@/components/story/ContextBudgetIndicator';
import { StorySuggestions } from '@/components/story/StorySuggestions';
import { OpeningInput } from '@/components/story/OpeningInput';
import { DirectorPanel } from '@/components/story/DirectorPanel';
import { PromptViewerModal } from '@/components/story/PromptViewerModal';
import { FullStoryGenerator } from '@/components/story/FullStoryGenerator';
import { SystemPromptEditor } from '@/components/settings/SystemPromptEditor';
import { WorldRulesEditor } from '@/components/settings/WorldRulesEditor';
import { WritingStyleConfig } from '@/components/settings/WritingStyleConfig';
import { DialogueEditorConfig } from '@/components/settings/DialogueEditorConfig';
import { NarrationEditorConfig } from '@/components/settings/NarrationEditorConfig';
import { PlotComplianceConfig } from '@/components/settings/PlotComplianceConfig';
import { FontSizeControl } from '@/components/settings/FontSizeControl';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { StoryStats } from '@/components/stats/StoryStats';
import { zhTW } from '@/i18n/zh-TW';
import type { ParagraphMeta } from '@/types/models';
import type { ContextBudgetInfo, PromptLog, ParagraphUsageLog, FullStoryJob, FullStoryProgressPayload } from '@/types/ipc';
import type { IpcRendererEvent } from 'electron';

export function StoryPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { currentProject, setCurrentProject, setBranches, branches } = useProjectStore();
  const {
    paragraphs,
    paragraphContents,
    streaming,
    isGenerating,
    currentPhase,
    setCurrentPhase,
    currentBranchId,
    setCurrentBranchId,
    setParagraphs,
    addParagraph,
    updateParagraph,
    removeParagraph,
    setGenerating,
    setParagraphContent,
    setBulkContents,
    suggestions,
    suggestionsLoading,
    setSuggestions,
    setSuggestionsLoading,
    clearSuggestions,
    refiningParagraphId,
    refinedParagraphIds,
    refineUnavailableNotify,
    setRefineUnavailableNotify,
    generationError,
    setGenerationError,
    reasoningByParagraph,
    reset: resetStory,
  } = useStoryStore();
  const { providers, setProviders } = useSettingsStore();
  const { loadAll } = useWorldMemoryStore();

  const [loading, setLoading] = useState(true);
  const [openingCreating, setOpeningCreating] = useState(false);
  const [fullStoryJob, setFullStoryJob] = useState<FullStoryJob | null>(null);
  const [contextBudget, setContextBudget] = useState<ContextBudgetInfo | null>(null);
  const [truncationWarning, setTruncationWarning] = useState<{ count: number } | null>(null);
  const [showStorySettings, setShowStorySettings] = useState(false);
  const [showDirector, setShowDirector] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [compacting, setCompacting] = useState(false);
  // Per-generation target word count override; undefined = use the project default.
  const [genWordCount, setGenWordCount] = useState<number | undefined>(undefined);
  // One-off director steer for the next paragraph only (cleared after each send).
  const [directorNote, setDirectorNote] = useState('');
  // Prompt viewer modal — null when closed; holds the fetched prompt log + usage log otherwise.
  const [promptViewer, setPromptViewer] = useState<{ loading: boolean; log: PromptLog | null; usageLog: ParagraphUsageLog | null } | null>(null);
  // Cascade delete dialog state
  const [cascadeDialog, setCascadeDialog] = useState<{
    paragraphId: string;
    associatedItems: { type: string; name: string }[];
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const initialScrollPendingRef = useRef(false);

  const hasActiveProvider = providers.some(p => p.isActive);

  // Callbacks for stream events — stable references via useCallback
  const handleContextBudget = useCallback((budget: NonNullable<import('@/types/ipc').StreamCompletePayload['contextBudget']> | undefined) => {
    if (!budget) return;
    setContextBudget({
      totalTokens: budget.totalTokens,
      used: budget.used,
      budget: budget.budget,
      percentage: budget.percentage,
      isSummarized: false,
    });
  }, []);

  const handleTruncation = useCallback((isTruncated: boolean, truncatedCount: number) => {
    if (isTruncated && truncatedCount > 0) {
      setTruncationWarning({ count: truncatedCount });
    }
  }, []);

  // Fetch story suggestions
  const fetchSuggestions = useCallback(async (force = false) => {
    if (!projectId || !currentBranchId) return;
    setSuggestionsLoading(true);
    try {
      let result = await aiApi.suggestions({ projectId, branchId: currentBranchId, force });
      // Retry once if the call succeeded but yielded nothing (complements the
      // backend retry for the rare double-empty case).
      if (result.success && result.data.suggestions.length === 0) {
        result = await aiApi.suggestions({ projectId, branchId: currentBranchId, force: true });
      }
      if (result.success && result.data.suggestions.length > 0) {
        setSuggestions(result.data.suggestions);
      } else {
        setSuggestionsLoading(false);
      }
    } catch {
      setSuggestionsLoading(false);
    }
  }, [projectId, currentBranchId, setSuggestions, setSuggestionsLoading]);

  const fullStoryActive = fullStoryJob?.status === 'planning' || fullStoryJob?.status === 'generating';

  useEffect(() => {
    if (!projectId || loading) return;
    fullStoryApi.getStatus(projectId).then(result => {
      if (!result.success) return;
      setFullStoryJob(result.data);
      const active = result.data?.status === 'planning' || result.data?.status === 'generating';
      if (active) setGenerating(true);
    }).catch(() => { /* best effort */ });
  }, [projectId, loading, setGenerating]);

  useEffect(() => {
    if (!projectId) return;
    return ipcOn<FullStoryProgressPayload>('fullStory:progress', (_event: IpcRendererEvent, data) => {
      if (data.job.projectId !== projectId) return;
      setFullStoryJob(data.job);
      const active = data.job.status === 'planning' || data.job.status === 'generating';
      setGenerating(active);
      setCurrentPhase(active ? data.phase : null);
      if (data.paragraph) {
        const { content, ...paragraph } = data.paragraph;
        const exists = useStoryStore.getState().paragraphs.some(item => item.id === paragraph.id);
        if (exists) updateParagraph(paragraph.id, paragraph);
        else addParagraph(paragraph);
        setParagraphContent(paragraph.id, content ?? '');
      }
      if (data.phase === 'completed') fetchSuggestions();
      if (data.phase === 'failed' && data.message) setGenerationError(data.message);
    });
  }, [projectId, addParagraph, updateParagraph, setParagraphContent, setGenerating, setCurrentPhase, setGenerationError, fetchSuggestions]);

  // Manually compact older paragraphs into the running 前情提要 summary.
  const handleCompact = useCallback(async () => {
    if (!projectId || !currentBranchId || compacting) return;
    if (!window.confirm(zhTW.chat.compactConfirm)) return;
    setCompacting(true);
    try {
      const result = await aiApi.compact({ projectId, branchId: currentBranchId });
      if (result.success) {
        window.alert(
          result.data.compactedCount > 0
            ? zhTW.chat.compactDone.replace('{count}', String(result.data.compactedCount))
            : zhTW.chat.compactNothing,
        );
      } else {
        window.alert(`${zhTW.chat.compactFailed}：${result.error.message}`);
      }
    } catch (e) {
      window.alert(`${zhTW.chat.compactFailed}：${String(e)}`);
    } finally {
      setCompacting(false);
    }
  }, [projectId, currentBranchId, compacting]);

  const streamOptions = useMemo(() => ({
    onContextBudget: handleContextBudget,
    onTruncation: handleTruncation,
    onComplete: fetchSuggestions,
  }), [handleContextBudget, handleTruncation, fetchSuggestions]);

  // Initialize stream listeners
  const { cancelGeneration } = useStream(projectId, streamOptions);

  // Fetch suggestions on initial load and branch switch so the 3 options appear
  // every time a story is opened — not only after a generation completes.
  // Guards prevent double-fetching: skip while generating (handleSend clears
  // suggestions then sets generating; onComplete refetches), and skip when
  // suggestions already exist or a fetch is in flight.
  useEffect(() => {
    if (!projectId || !currentBranchId || !hasActiveProvider) return;
    if (isGenerating || suggestionsLoading || suggestions.length > 0) return;
    if (paragraphs.length === 0) return;
    fetchSuggestions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBranchId, hasActiveProvider, isGenerating, paragraphs.length]);

  // Auto-scroll to bottom when streaming
  useEffect(() => {
    if (!isGenerating || !shouldAutoScrollRef.current) return;
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  });

  // Scroll to bottom on initial paragraph load
  useEffect(() => {
    if (!initialScrollPendingRef.current) return;
    if (paragraphs.length === 0) return;
    initialScrollPendingRef.current = false;
    const container = scrollContainerRef.current;
    if (container) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, [paragraphs, paragraphContents]);

  // Detect if user scrolled up — stop auto-scroll
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 100;
  }, []);

  // Load project and paragraphs
  useEffect(() => {
    if (!projectId) {
      navigate('/');
      return;
    }

    let cancelled = false;

    async function loadProject() {
      // Load providers
      const providersResult = await settingsApi.getProviders();
      if (providersResult.success && !cancelled) {
        setProviders(providersResult.data);
      }

      // Load project info — use local variable to avoid stale closure
      let activeProject = currentProject;
      if (activeProject?.id !== projectId) {
        const result = await projectApi.list();
        if (cancelled) return;
        if (result.success) {
          const project = result.data.find(p => p.id === projectId);
          if (project) {
            setCurrentProject(project);
            activeProject = project;
          } else {
            navigate('/');
            return;
          }
        } else {
          navigate('/');
          return;
        }
      }

      // Reset story store for new project
      resetStory();

      const openResult = await projectApi.open(activeProject?.storagePath ?? '');
      if (cancelled) return;

      if (openResult.success) {
        const projId = openResult.data.id;
        // Load branch tree
        const branchResult = await branchApi.getTree(projId);
        if (!cancelled && branchResult.success) {
          interface BNode { branch: { id: string; projectId: string; parentBranchId: string | null; forkParagraphId: string | null; name: string; isMain: boolean; createdAt: string; updatedAt: string }; children: BNode[] }
          const flat: typeof branches = [];
          function flattenNodes(nodes: BNode[]) {
            for (const n of nodes) {
              flat.push(n.branch as typeof branches[0]);
              flattenNodes(n.children);
            }
          }
          flattenNodes(branchResult.data as BNode[]);
          setBranches(flat);

          // Set main branch as current
          const mainBranch = flat.find(b => b.isMain) ?? flat[0];
          if (mainBranch) {
            setCurrentBranchId(mainBranch.id);
          }
        }
        setLoading(false);
      } else {
        setLoading(false);
      }

    }

    loadProject().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Load paragraphs and world memory once we have a branchId
  useEffect(() => {
    if (!projectId || !currentBranchId) return;
    let cancelled = false;

    async function loadParagraphs() {
      if (!projectId || !currentBranchId) return;
      initialScrollPendingRef.current = true;
      const result = await paragraphApi.list(projectId, currentBranchId);
      if (cancelled || !result.success) return;

      setParagraphs(result.data as unknown as ParagraphMeta[]);

      // Load content for each paragraph
      const contentMap = new Map<string, string>();
      await Promise.all(
        (result.data as unknown as ParagraphMeta[]).map(async (para) => {
          const contentResult = await paragraphApi.getContent(projectId, currentBranchId, para.id);
          if (contentResult.success) {
            contentMap.set(para.id, contentResult.data);
          }
        }),
      );
      if (!cancelled) {
        setBulkContents(contentMap);
      }

      // Load world memory
      if (!cancelled) {
        loadAll(projectId, currentBranchId).catch(() => { /* best effort */ });
      }
    }

    loadParagraphs().catch(() => { /* best effort */ });
    return () => { cancelled = true; };
  }, [projectId, currentBranchId, setParagraphs, setBulkContents, loadAll]);

  // Generate handler
  const handleSend = useCallback(async (message: string) => {
    if (!projectId || isGenerating) return;
    clearSuggestions();
    setGenerating(true);
    setCurrentPhase('preparing');
    shouldAutoScrollRef.current = true;

    // One-off director note rides with this generation only, then is cleared.
    const note = directorNote.trim();

    const result = await aiApi.generate({
      projectId,
      branchId: currentBranchId ?? '',
      userMessage: message,
      targetWordCount: genWordCount,
      directorNote: note || undefined,
    });

    if (note) setDirectorNote('');

    if (!result.success) {
      setGenerating(false);
      // Surface IPC-level failures (no provider, handler threw, etc.). Mid-stream
      // failures are surfaced separately via the stream:error event in useStream.
      setGenerationError(result.error.message);
    } else {
      // If we didn't have a branchId yet, try to refresh paragraphs
      // The branch was auto-created during generate
      if (!currentBranchId) {
        // Fetch paragraphs to discover the branch
        const listResult = await paragraphApi.list(projectId, '');
        if (listResult.success && listResult.data.length > 0) {
          const firstPara = listResult.data[0] as unknown as ParagraphMeta;
          setCurrentBranchId(firstPara.branchId);
        }
      }
    }
  }, [projectId, isGenerating, currentBranchId, genWordCount, directorNote, setGenerating, setCurrentPhase, setCurrentBranchId, clearSuggestions, setGenerationError]);

  // Create opening (開場白) — save the user's opening prose as the story's first
  // paragraph. The suggestions effect (watching paragraphs.length) then auto-fetches
  // direction options, and picking one continues the story via handleSend.
  const handleOpeningSubmit = useCallback(async (text: string) => {
    if (!projectId || isGenerating || openingCreating) return;
    setOpeningCreating(true);
    shouldAutoScrollRef.current = true;
    try {
      const result = await paragraphApi.createOpening(projectId, currentBranchId ?? '', text);
      if (result.success) {
        const para = result.data as unknown as ParagraphMeta;
        if (!currentBranchId) setCurrentBranchId(para.branchId);
        addParagraph(para);
        setParagraphContent(para.id, text);
      } else {
        setGenerationError(result.error.message);
      }
    } finally {
      setOpeningCreating(false);
    }
  }, [projectId, isGenerating, openingCreating, currentBranchId, setCurrentBranchId, addParagraph, setParagraphContent, setGenerationError]);

  const handleFullStoryStart = useCallback(async (prompt: string, targetCharacterCount: number): Promise<string | null> => {
    if (!projectId) return '專案未開啟';
    setGenerationError(null);
    const result = await fullStoryApi.start({
      projectId,
      branchId: currentBranchId ?? '',
      prompt,
      targetCharacterCount,
    });
    if (!result.success) return result.error.message;
    setFullStoryJob(result.data);
    if (!currentBranchId) setCurrentBranchId(result.data.branchId);
    setGenerating(true);
    setCurrentPhase('planning');
    return null;
  }, [projectId, currentBranchId, setCurrentBranchId, setGenerating, setCurrentPhase, setGenerationError]);

  const handleFullStoryResume = useCallback(async () => {
    if (!projectId) return;
    setGenerationError(null);
    const result = await fullStoryApi.resume(projectId);
    if (result.success) {
      setFullStoryJob(result.data);
      setGenerating(true);
      setCurrentPhase(result.data.sections.length ? 'generating' : 'planning');
    } else {
      setGenerationError(result.error.message);
    }
  }, [projectId, setGenerating, setCurrentPhase, setGenerationError]);

  const handleFullStoryCancel = useCallback(async () => {
    if (!projectId) return;
    await fullStoryApi.cancel(projectId);
  }, [projectId]);

  const handleFullStoryDiscard = useCallback(async () => {
    if (!projectId) return;
    const result = await fullStoryApi.discard(projectId);
    if (!result.success) {
      setGenerationError(result.error.message);
      return;
    }
    setFullStoryJob(null);
    setParagraphs([]);
    setBulkContents(new Map());
    setGenerating(false);
  }, [projectId, setParagraphs, setBulkContents, setGenerating, setGenerationError]);

  // Delete paragraph — with cascade dialog for associated world memory
  const handleDelete = useCallback(async (paragraphId: string) => {
    if (!projectId || !currentBranchId) return;

    // Query for associated world memory items
    const linkedResult = await paragraphApi.getLinkedWorldMemory(projectId, paragraphId);
    const associated = linkedResult.success ? linkedResult.data : [];

    if (associated.length > 0) {
      // Show cascade dialog
      setCascadeDialog({ paragraphId, associatedItems: associated });
      return;
    }

    // No associated items — simple delete
    const result = await paragraphApi.delete(projectId, currentBranchId, paragraphId);
    if (result.success) {
      removeParagraph(paragraphId);
    }
  }, [projectId, currentBranchId, removeParagraph]);

  // Cascade delete — delete paragraph and associated world memory items
  const handleCascadeDelete = useCallback(async (paragraphId: string, cascade: boolean) => {
    if (!projectId || !currentBranchId) return;
    setCascadeDialog(null);
    const result = await paragraphApi.delete(projectId, currentBranchId, paragraphId, cascade);
    if (result.success) {
      removeParagraph(paragraphId);
    }
  }, [projectId, currentBranchId, removeParagraph]);

  // Regenerate paragraph
  const handleRegenerate = useCallback(async (paragraphId: string, extraPrompt?: string) => {
    if (!projectId || !currentBranchId || isGenerating) return;
    setGenerating(true);
    setCurrentPhase('preparing');
    shouldAutoScrollRef.current = true;

    const result = await paragraphApi.regenerate({
      projectId,
      branchId: currentBranchId,
      userMessage: '',
      targetParagraphId: paragraphId,
      targetWordCount: genWordCount,
      // One-off author steer for this rewrite only (not persisted, roadmap untouched).
      directorNote: extraPrompt,
    });

    if (!result.success) {
      setGenerating(false);
      // Surface IPC-level failures; mid-stream failures arrive via stream:error.
      setGenerationError(result.error.message);
      return;
    }

    // Backend detaches paragraphs after the target (and rolled back their world
    // changes) so the rewritten beat doesn't jump the timeline. Mirror that in the
    // store and refresh world memory to match.
    const targetIdx = paragraphs.findIndex(p => p.id === paragraphId);
    if (targetIdx >= 0) {
      paragraphs.slice(targetIdx + 1).forEach(p => {
        if (p.status !== 'detached') {
          updateParagraph(p.id, { status: 'detached' });
        }
      });
    }
    loadAll(projectId, currentBranchId);
  }, [projectId, currentBranchId, isGenerating, genWordCount, paragraphs, updateParagraph, loadAll, setGenerating, setCurrentPhase, setGenerationError]);

  // Rollback
  const handleRollback = useCallback(async (paragraphId: string) => {
    if (!projectId || !currentBranchId) return;
    const result = await paragraphApi.rollback(projectId, currentBranchId, paragraphId);
    if (result.success) {
      // Update local store: mark subsequent paragraphs as detached
      const targetIdx = paragraphs.findIndex(p => p.id === paragraphId);
      if (targetIdx >= 0) {
        paragraphs.slice(targetIdx + 1).forEach(p => {
          if (p.status !== 'detached') {
            updateParagraph(p.id, { status: 'detached' });
          }
        });
      }
      // Refresh world memory to reflect rollback
      loadAll(projectId, currentBranchId);
    }
  }, [projectId, currentBranchId, paragraphs, updateParagraph, loadAll]);

  // Switch version
  const handleSwitchVersion = useCallback(async (paragraphId: string, version: number) => {
    if (!projectId || !currentBranchId) return;
    const result = await paragraphApi.switchVersion(projectId, paragraphId, version);
    if (result.success) {
      updateParagraph(paragraphId, { activeVersion: version });
      // Reload content for this version
      const contentResult = await paragraphApi.getContent(projectId, currentBranchId, paragraphId, version);
      if (contentResult.success) {
        setParagraphContent(paragraphId, contentResult.data);
      }
    }
  }, [projectId, currentBranchId, updateParagraph, setParagraphContent]);

  // Edit paragraph — saves a new version and makes it active; next generation reads it.
  const handleEdit = useCallback(async (paragraphId: string, content: string) => {
    if (!projectId || !currentBranchId) return;
    const result = await paragraphApi.edit(projectId, currentBranchId, paragraphId, content);
    if (result.success) {
      const meta = result.data as unknown as ParagraphMeta;
      updateParagraph(paragraphId, { activeVersion: meta.activeVersion, totalVersions: meta.totalVersions });
      setParagraphContent(paragraphId, content);
    } else {
      setGenerationError(result.error.message);
    }
  }, [projectId, currentBranchId, updateParagraph, setParagraphContent, setGenerationError]);

  // Copy text to clipboard
  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content).catch(() => { /* ignore */ });
  }, []);

  // Open the prompt viewer for an AI paragraph — fetch prompt log and usage log in parallel.
  const handleViewPrompt = useCallback(async (paragraphId: string) => {
    if (!projectId || !currentBranchId) return;
    setPromptViewer({ loading: true, log: null, usageLog: null });
    const [promptResult, usageResult] = await Promise.all([
      paragraphApi.getPrompt(projectId, currentBranchId, paragraphId),
      paragraphApi.getUsage(projectId, currentBranchId, paragraphId),
    ]);
    setPromptViewer({
      loading: false,
      log: promptResult.success ? promptResult.data : null,
      usageLog: usageResult.success ? usageResult.data : null,
    });
  }, [projectId, currentBranchId]);

  // Jump to top / bottom of the story area
  const scrollToTop = useCallback(() => {
    shouldAutoScrollRef.current = false;
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const scrollToBottom = useCallback(() => {
    shouldAutoScrollRef.current = true;
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  if (loading) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-tertiary)',
        }}
      >
        載入中...
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Project header */}
      <div
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
          background: 'var(--color-bg-secondary)',
        }}
      >
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <polyline points="10,4 6,8 10,12" />
          </svg>
        </button>
        <h1
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            flex: 1,
          }}
        >
          {currentProject?.name ?? '故事'}
        </h1>

        {/* Context budget indicator */}
        <ContextBudgetIndicator budget={contextBudget} />

        {/* AC-019: Context truncation warning — compact icon */}
        {truncationWarning && (
          <button
            onClick={() => setTruncationWarning(null)}
            title={`${zhTW.paragraph.contextTruncated.replace('{count}', String(truncationWarning.count))}（${zhTW.paragraph.contextTruncatedDismiss}）`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-warning)',
              cursor: 'pointer',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1.5 15 14H1z" />
              <line x1="8" y1="6" x2="8" y2="9.5" />
              <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
            </svg>
          </button>
        )}

        {/* FR-D012 / W3: Dialogue refine unavailable — subtle dismissible icon */}
        {refineUnavailableNotify && (
          <button
            onClick={() => setRefineUnavailableNotify(false)}
            title={`${zhTW.dialogueEditor.refineUnavailable}（點擊關閉）`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="6" />
              <line x1="8" y1="5" x2="8" y2="8.5" />
              <circle cx="8" cy="10.5" r="0.5" fill="currentColor" />
            </svg>
          </button>
        )}

        {/* Search toggle */}
        <button
          onClick={() => setShowSearch(v => !v)}
          title="搜尋 (Ctrl+F)"
          style={{
            background: showSearch ? 'var(--color-accent-subtle)' : 'transparent',
            border: showSearch ? '1px solid var(--color-accent)' : '1px solid transparent',
            color: showSearch ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6" cy="6" r="4" />
            <line x1="9.5" y1="9.5" x2="13" y2="13" />
          </svg>
        </button>

        {/* Stats button */}
        <button
          onClick={() => setShowStats(v => !v)}
          title="故事統計"
          style={{
            background: showStats ? 'var(--color-accent-subtle)' : 'transparent',
            border: showStats ? '1px solid var(--color-accent)' : '1px solid transparent',
            color: showStats ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="7" width="3" height="6" rx="0.5" />
            <rect x="5.5" y="4" width="3" height="9" rx="0.5" />
            <rect x="10" y="1" width="3" height="12" rx="0.5" />
          </svg>
        </button>

        {/* Director (創作走向 brief + 大綱 re-plan) */}
        <button
          onClick={() => setShowDirector(v => !v)}
          title={zhTW.directorPanel.title}
          style={{
            background: showDirector ? 'var(--color-accent-subtle)' : 'transparent',
            border: showDirector ? '1px solid var(--color-accent)' : '1px solid transparent',
            color: showDirector ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
            <rect x="1" y="5" width="12" height="8" rx="0.5" />
            <path d="M1 5l2.5-3.5 3 2.5M5.5 4l3-2.5 3 2.5M1 8h12" />
          </svg>
        </button>

        {/* Story settings (system prompt / writing style) */}
        <button
          onClick={() => setShowStorySettings(v => !v)}
          title="故事設定"
          style={{
            background: showStorySettings ? 'var(--color-accent-subtle)' : 'transparent',
            border: showStorySettings ? '1px solid var(--color-accent)' : '1px solid transparent',
            color: showStorySettings ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            cursor: 'pointer',
            padding: '4px 6px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="2" />
            <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.6 2.6l1.1 1.1M10.3 10.3l1.1 1.1M10.3 3.7l-1.1 1.1M3.7 10.3l-1.1 1.1" />
          </svg>
        </button>

        {/* Compact story (前情提要) */}
        {hasActiveProvider && paragraphs.length > 0 && (
          <button
            onClick={handleCompact}
            disabled={compacting}
            title={zhTW.chat.compactTitle}
            style={{
              background: 'transparent',
              border: '1px solid transparent',
              color: compacting ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              cursor: compacting ? 'wait' : 'pointer',
              padding: '4px 6px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              opacity: compacting ? 0.6 : 1,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 3h10M2 7h10M2 11h10" />
              <path d="M9.5 5.5l-2 1.5 2 1.5" />
            </svg>
          </button>
        )}

        {/* Active provider badge */}
        {hasActiveProvider ? (
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 99,
              background: 'var(--color-accent-subtle)',
              color: 'var(--color-accent)',
              fontWeight: 500,
            }}
          >
            AI 已就緒
          </span>
        ) : (
          <button
            onClick={() => navigate('/settings')}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 99,
              background: 'rgba(229, 83, 83, 0.1)',
              color: 'var(--color-error)',
              fontWeight: 500,
              border: '1px solid rgba(229, 83, 83, 0.3)',
              cursor: 'pointer',
            }}
          >
            設定 AI 供應商
          </button>
        )}
      </div>

      {/* AC-003: Cascade delete dialog */}
      {cascadeDialog && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
          }}
        >
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '20px 24px',
              minWidth: 320,
              maxWidth: 480,
              boxShadow: 'var(--shadow-md)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 12 }}>
              {zhTW.paragraph.deleteConfirm}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
              {zhTW.paragraph.deleteAssociatedItems}
            </div>
            <ul style={{ margin: '0 0 12px 0', padding: '0 0 0 18px', fontSize: 13, color: 'var(--color-text-muted)' }}>
              {cascadeDialog.associatedItems.map((item, idx) => (
                <li key={idx}>{item.type === 'character' ? '角色' : item.type === 'event' ? '事件' : item.type}：{item.name}</li>
              ))}
            </ul>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
              {zhTW.paragraph.deleteChoicePrompt}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setCascadeDialog(null)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                }}
              >
                {zhTW.worldMemory.cancel}
              </button>
              <button
                onClick={() => handleCascadeDelete(cascadeDialog.paragraphId, false)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-accent)',
                  color: 'var(--color-accent)',
                  cursor: 'pointer',
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                }}
              >
                {zhTW.paragraph.deleteKeepWorldMemory}
              </button>
              <button
                onClick={() => handleCascadeDelete(cascadeDialog.paragraphId, true)}
                style={{
                  background: 'rgba(229, 83, 83, 0.1)',
                  border: '1px solid var(--color-error)',
                  color: 'var(--color-error)',
                  cursor: 'pointer',
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                }}
              >
                {zhTW.paragraph.deleteCascade}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search panel */}
      {showSearch && projectId && currentBranchId && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: 60,
            zIndex: 50,
          }}
          onClick={() => setShowSearch(false)}
        >
          <div onClick={e => e.stopPropagation()}>
            <GlobalSearch
              projectId={projectId}
              branchId={currentBranchId}
              onScrollToParagraph={pos => {
                // Find paragraph at position and scroll to it
                const para = paragraphs.find(p => p.position === pos);
                if (para) {
                  const el = document.getElementById(`paragraph-${para.id}`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }
                setShowSearch(false);
              }}
              onClose={() => setShowSearch(false)}
            />
          </div>
        </div>
      )}

      {/* Director panel */}
      {showDirector && projectId && currentBranchId && (
        <div
          style={{
            padding: '16px 24px',
            background: 'var(--color-bg-secondary)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            maxWidth: 800,
            width: '100%',
            alignSelf: 'center',
            boxSizing: 'border-box',
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          <DirectorPanel
            projectId={projectId}
            branchId={currentBranchId}
            disabled={!hasActiveProvider}
          />
        </div>
      )}

      {/* Story settings panel */}
      {showStorySettings && projectId && (
        <div
          style={{
            padding: '16px 24px',
            background: 'var(--color-bg-secondary)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            maxWidth: 800,
            width: '100%',
            alignSelf: 'center',
            boxSizing: 'border-box',
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          <FontSizeControl />
          <WorldRulesEditor projectId={projectId} />
          <SystemPromptEditor projectId={projectId} />
          <WritingStyleConfig projectId={projectId} />
          <DialogueEditorConfig projectId={projectId} />
          <NarrationEditorConfig projectId={projectId} />
          <PlotComplianceConfig projectId={projectId} />
        </div>
      )}

      {/* Story area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            maxWidth: 800,
            width: '100%',
            margin: '0 auto',
            padding: '24px',
            boxSizing: 'border-box',
          }}
        >
          {/* Empty state */}
          {paragraphs.length === 0 && (!isGenerating || !!fullStoryJob) && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 300,
                color: 'var(--color-text-tertiary)',
                textAlign: 'center',
              }}
            >
              <svg
                width="64"
                height="64"
                viewBox="0 0 64 64"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                style={{ marginBottom: 16, opacity: 0.3 }}
              >
                <rect x="8" y="8" width="48" height="48" rx="4" />
                <line x1="16" y1="24" x2="48" y2="24" />
                <line x1="16" y1="32" x2="40" y2="32" />
                <line x1="16" y1="40" x2="44" y2="40" />
              </svg>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>開始你的故事</p>
              <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                {hasActiveProvider
                  ? '在下方輸入框中輸入故事提示，按 Enter 開始生成，或以開場白起頭。'
                  : '請先在「設定」中配置 AI 供應商'}
              </p>

              {hasActiveProvider && (
                <div style={{ marginTop: 28, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                  {!fullStoryJob && <OpeningInput
                    onSubmit={handleOpeningSubmit}
                    creating={openingCreating}
                  />}
                  {!fullStoryJob && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>或</div>}
                  <FullStoryGenerator
                    job={fullStoryJob}
                    onStart={handleFullStoryStart}
                    onResume={handleFullStoryResume}
                    onCancel={handleFullStoryCancel}
                    onDiscard={handleFullStoryDiscard}
                  />
                </div>
              )}
            </div>
          )}

          {/* Paragraph blocks */}
          {paragraphs.map(para => {
            const isStreamingThis = streaming?.paragraphId === para.id && isGenerating;
            const isRefiningThis = refiningParagraphId === para.id;
            const isRefinedThis = refinedParagraphIds.has(para.id);
            const content = paragraphContents.get(para.id) ?? '';
            return (
              <div key={para.id} id={`paragraph-${para.id}`}>
                <ParagraphBlock
                  paragraph={para}
                  content={content}
                  streamingContent={isStreamingThis ? streaming.content : undefined}
                  thinking={reasoningByParagraph.get(para.id)}
                  isStreaming={isStreamingThis}
                  isRefining={isRefiningThis}
                  isRefined={isRefinedThis}
                  onDelete={handleDelete}
                  onRegenerate={para.type === 'ai' ? handleRegenerate : undefined}
                  onRollback={handleRollback}
                  onCopy={handleCopy}
                  onSwitchVersion={handleSwitchVersion}
                  onEdit={handleEdit}
                  onViewPrompt={para.type === 'ai' ? handleViewPrompt : undefined}
                />
              </div>
            );
          })}

          {fullStoryJob && fullStoryJob.status !== 'completed' && paragraphs.length > 0 && (
            <FullStoryGenerator
              job={fullStoryJob}
              onStart={handleFullStoryStart}
              onResume={handleFullStoryResume}
              onCancel={handleFullStoryCancel}
              onDiscard={handleFullStoryDiscard}
            />
          )}

          {/* Story suggestions */}
          {!isGenerating && paragraphs.length > 0 && hasActiveProvider && (!fullStoryJob || fullStoryJob.status === 'completed') && (suggestions.length > 0 || suggestionsLoading) && (
            <StorySuggestions
              suggestions={suggestions}
              loading={suggestionsLoading}
              onSelect={(suggestion) => handleSend(suggestion)}
              onContinue={() => handleSend('繼續故事')}
              onRetry={() => fetchSuggestions(true)}
            />
          )}

          {/* Continue button when no suggestions loaded yet — plus a regenerate
              button so skipped/empty suggestions can always be retried */}
          {!isGenerating && paragraphs.length > 0 && hasActiveProvider && (!fullStoryJob || fullStoryJob.status === 'completed') && !suggestionsLoading && suggestions.length === 0 && (
            <div style={{ padding: '12px 0', display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleSend('繼續故事')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  flex: 1,
                  padding: '10px 20px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                  transition: 'all var(--transition-fast)',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-accent)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-accent)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-subtle)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-surface)';
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
                {zhTW.chat.continueStory}
              </button>
              <button
                onClick={() => fetchSuggestions(true)}
                title={zhTW.chat.suggestionsRetry}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                  transition: 'all var(--transition-fast)',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-accent)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-accent)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-subtle)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-surface)';
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 8A6 6 0 1 1 8 14" />
                  <polyline points="2,4 2,8 6,8" />
                </svg>
                {zhTW.chat.suggestionsRetry}
              </button>
            </div>
          )}

          {/* Bottom padding for scrolling */}
          <div style={{ height: 16 }} />
        </div>
      </div>

      {/* Jump to top / bottom — floating controls over the story area */}
      {paragraphs.length > 0 && (
        <div
          style={{
            position: 'absolute',
            right: 24,
            bottom: 96,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            zIndex: 40,
          }}
        >
          <button
            onClick={scrollToTop}
            title="跳到最上方"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-md)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-accent)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-accent)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10l4-4 4 4" />
              <line x1="4" y1="4" x2="12" y2="4" />
            </svg>
          </button>
          <button
            onClick={scrollToBottom}
            title="跳到最下方"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-md)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-accent)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-accent)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)';
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6l4 4 4-4" />
              <line x1="4" y1="12" x2="12" y2="12" />
            </svg>
          </button>
        </div>
      )}

      {/* Generation error banner — surfaces failures that would otherwise be a silent empty paragraph */}
      {generationError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            margin: '0 16px 8px',
            padding: '10px 14px',
            background: 'rgba(229, 83, 83, 0.1)',
            border: '1px solid var(--color-error)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-error)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="8" cy="8" r="6" />
            <line x1="8" y1="5" x2="8" y2="8.5" />
            <circle cx="8" cy="10.5" r="0.5" fill="currentColor" />
          </svg>
          <span style={{ flex: 1, wordBreak: 'break-word' }}>{zhTW.chat.generationFailed}{generationError}</span>
          <button
            onClick={() => setGenerationError(null)}
            title="關閉"
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              color: 'var(--color-error)',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="3" y1="3" x2="11" y2="11" />
              <line x1="11" y1="3" x2="3" y2="11" />
            </svg>
          </button>
        </div>
      )}

      {/* One-off director note — steers only the next paragraph, then clears */}
      {hasActiveProvider && paragraphs.length > 0 && (!fullStoryJob || fullStoryJob.status === 'completed') && (
        <div style={{ maxWidth: 800, width: '100%', alignSelf: 'center', boxSizing: 'border-box', padding: '0 24px', marginBottom: 4 }}>
          <input
            type="text"
            value={directorNote}
            onChange={e => setDirectorNote(e.target.value)}
            disabled={isGenerating}
            placeholder={zhTW.chat.directorNotePlaceholder}
            title={zhTW.chat.directorNoteHint}
            style={{
              width: '100%',
              padding: '7px 12px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${directorNote.trim() ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {/* Chat input */}
      <ChatInput
        onSend={handleSend}
        onCancel={fullStoryActive ? handleFullStoryCancel : cancelGeneration}
        isGenerating={isGenerating}
        phase={currentPhase}
        disabled={!hasActiveProvider || (!!fullStoryJob && fullStoryJob.status !== 'completed')}
        wordCount={genWordCount}
        onWordCountChange={setGenWordCount}
      />

      {/* Story stats modal */}
      {showStats && projectId && currentBranchId && (
        <StoryStats
          projectId={projectId}
          branchId={currentBranchId}
          onClose={() => setShowStats(false)}
        />
      )}

      {/* Prompt viewer modal — the messages sent to the model for a paragraph */}
      {promptViewer && (
        <PromptViewerModal
          loading={promptViewer.loading}
          log={promptViewer.log}
          onClose={() => setPromptViewer(null)}
          usageLog={promptViewer.usageLog}
        />
      )}
    </div>
  );
}
