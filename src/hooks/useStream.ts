import { useEffect, useCallback, useRef } from 'react';
import { ipcOn, aiApi } from '@/lib/ipc';
import { useStoryStore } from '@/stores/storyStore';
import { useWorldMemoryStore } from '@/stores/worldMemoryStore';
import type { IpcRendererEvent } from 'electron';
import type { StreamChunkPayload, StreamCompletePayload } from '@/types/ipc';

interface StreamChunkExtended {
  paragraphId: string;
  delta: string;
  done: boolean;
  type?: string;
  meta?: Record<string, unknown>;
}

interface UseStreamOptions {
  onContextBudget?: (budget: import('@/types/ipc').StreamCompletePayload['contextBudget']) => void;
  onTruncation?: (isTruncated: boolean, truncatedCount: number) => void;
  onComplete?: () => void;
}

export function useStream(projectId: string | undefined, options?: UseStreamOptions) {
  const {
    addParagraph,
    updateParagraph,
    startStreaming,
    appendStreamDelta,
    finishStreaming,
    setGenerating,
    setParagraphContent,
    setRefiningParagraphId,
    setRefineUnavailableNotify,
    setParagraphRefined,
    setGenerationError,
    appendReasoning,
  } = useStoryStore();

  const { setParagraphParseStatus, loadAll } = useWorldMemoryStore();

  const streamingParagraphIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    // Listen for stream chunks
    const offChunk = ipcOn<StreamChunkExtended>('stream:chunk', (_event: IpcRendererEvent, data: StreamChunkExtended) => {
      if (data.type === 'user_paragraph_created' && data.meta) {
        // Add user paragraph to store
        const meta = data.meta as Record<string, unknown>;
        const paraId = String(meta.id);
        addParagraph({
          id: paraId,
          projectId: String(meta.projectId ?? meta.project_id ?? ''),
          branchId: String(meta.branchId ?? meta.branch_id ?? ''),
          type: 'user',
          status: 'normal',
          position: Number(meta.position ?? 0),
          activeVersion: Number(meta.activeVersion ?? meta.active_version ?? 1),
          totalVersions: Number(meta.totalVersions ?? meta.total_versions ?? 1),
          modelUsed: null,
          tokenCount: 0,
          detectionHistory: [],
          createdAt: String(meta.createdAt ?? meta.created_at ?? new Date().toISOString()),
          updatedAt: String(meta.updatedAt ?? meta.updated_at ?? new Date().toISOString()),
        });
        if (meta.content) {
          setParagraphContent(paraId, String(meta.content));
        }
        return;
      }

      if (data.type === 'ai_paragraph_created' && data.meta) {
        // Add AI paragraph in generating state
        const meta = data.meta as Record<string, unknown>;
        const paraId = String(meta.id);
        streamingParagraphIdRef.current = paraId;
        addParagraph({
          id: paraId,
          projectId: String(meta.projectId ?? meta.project_id ?? ''),
          branchId: String(meta.branchId ?? meta.branch_id ?? ''),
          type: 'ai',
          status: 'generating',
          position: Number(meta.position ?? 0),
          activeVersion: 1,
          totalVersions: 1,
          modelUsed: String(meta.modelUsed ?? meta.model_used ?? ''),
          tokenCount: 0,
          detectionHistory: [],
          createdAt: String(meta.createdAt ?? meta.created_at ?? new Date().toISOString()),
          updatedAt: String(meta.updatedAt ?? meta.updated_at ?? new Date().toISOString()),
        });
        startStreaming(paraId);
        return;
      }

      if (data.type === 'regenerate_start') {
        // Regeneration started for existing paragraph
        streamingParagraphIdRef.current = data.paragraphId;
        updateParagraph(data.paragraphId, { status: 'generating' });
        startStreaming(data.paragraphId);
        return;
      }

      if (data.type === 'dialogue_refining') {
        // Dialogue editor pass started or finished — toggle the refining indicator
        const refining = Boolean((data.meta as Record<string, unknown> | undefined)?.refining);
        setRefiningParagraphId(refining ? data.paragraphId : null);
        return;
      }

      if (data.type === 'dialogue_refine_failed') {
        // W3 / FR-D012: dialogue pass failed — surface the refineUnavailable notification
        setRefineUnavailableNotify(true);
        return;
      }

      if (data.type === 'narration_refining') {
        // Narration editor pass started or finished — share the refining indicator
        const refining = Boolean((data.meta as Record<string, unknown> | undefined)?.refining);
        setRefiningParagraphId(refining ? data.paragraphId : null);
        return;
      }

      if (data.type === 'narration_refine_failed') {
        // Narration pass failed — surface the same refineUnavailable notification
        setRefineUnavailableNotify(true);
        return;
      }

      if (data.type === 'reasoning') {
        // Thinking-model reasoning — accumulate separately; never part of the story.
        if (!data.done && data.delta) appendReasoning(data.paragraphId, data.delta);
        return;
      }

      if (!data.done && data.delta) {
        appendStreamDelta(data.paragraphId, data.delta);
      }
    });

    // Listen for stream complete
    const offComplete = ipcOn<StreamCompletePayload>('stream:complete', (_event: IpcRendererEvent, data: StreamCompletePayload) => {
      finishStreaming();
      streamingParagraphIdRef.current = null;
      setParagraphContent(data.paragraphId, data.fullText);
      const versionPatch: Partial<import('@/types/models').ParagraphMeta> = {
        status: 'normal',
        tokenCount: data.tokenUsage.completionTokens,
      };
      if (typeof data.activeVersion === 'number') versionPatch.activeVersion = data.activeVersion;
      if (typeof data.totalVersions === 'number') versionPatch.totalVersions = data.totalVersions;
      updateParagraph(data.paragraphId, versionPatch);
      // Dialogue-editor visibility: badge paragraphs whose active version was refined
      setParagraphRefined(data.paragraphId, !!data.refined);
      setGenerating(false);

      // AC-018: propagate context budget to caller
      if (data.contextBudget && options?.onContextBudget) {
        options.onContextBudget(data.contextBudget);
      }

      // AC-019: propagate truncation info to caller
      if (options?.onTruncation) {
        options.onTruncation(!!data.isTruncated, data.truncatedCount ?? 0);
      }

      // Phase 3: Handle world changes (auto-applied on backend — reload local state)
      if (data.worldChanges && data.worldChanges.length > 0) {
        const branchId = useStoryStore.getState().currentBranchId;
        if (projectId && branchId) {
          loadAll(projectId, branchId);
        }
      }

      // Track parse status for the paragraph (for suggestion bar display)
      setParagraphParseStatus(data.paragraphId, {
        parseError: data.parseError,
        noDetection: data.noDetection,
        hasChanges: !!(data.worldChanges && data.worldChanges.length > 0),
      });

      if (options?.onComplete) {
        options.onComplete();
      }
    });

    // Listen for stream error
    const offError = ipcOn<{ paragraphId: string; error: { code: string; message: string } }>('stream:error', (_event: IpcRendererEvent, data: { paragraphId: string; error: { code: string; message: string } }) => {
      finishStreaming();
      streamingParagraphIdRef.current = null;
      updateParagraph(data.paragraphId, { status: 'draft' });
      setGenerating(false);
      setRefiningParagraphId(null); // defensive clear
      // Surface the failure instead of leaving a silent empty paragraph.
      setGenerationError(data.error?.message ?? '生成失敗');
    });

    return () => {
      offChunk();
      offComplete();
      offError();
    };
  // options callbacks are stable refs from parent; including them would cause re-subscription on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, addParagraph, updateParagraph, startStreaming, appendStreamDelta, finishStreaming, setGenerating, setParagraphContent, setRefiningParagraphId, setRefineUnavailableNotify, setParagraphRefined, setGenerationError, appendReasoning, setParagraphParseStatus, loadAll]);

  const cancelGeneration = useCallback(() => {
    if (!projectId) return;
    aiApi.cancel(projectId).catch(() => { /* best effort */ });
    finishStreaming();
    if (streamingParagraphIdRef.current) {
      updateParagraph(streamingParagraphIdRef.current, { status: 'draft' });
      streamingParagraphIdRef.current = null;
    }
    setGenerating(false);
  }, [projectId, finishStreaming, updateParagraph, setGenerating]);

  return { cancelGeneration };
}
