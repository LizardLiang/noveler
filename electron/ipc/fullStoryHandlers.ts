import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from './channels.js';
import type { FullStoryJob, FullStoryStartRequest, IpcResult } from '../shared/types.js';
import { getFullStoryService } from '../main/services/FullStoryService.js';

function failure(code: string, error: unknown): IpcResult<never> {
  return {
    success: false,
    error: { code, message: error instanceof Error ? error.message : String(error), details: error },
  };
}

export function registerFullStoryHandlers(): void {
  const service = getFullStoryService();

  ipcMain.handle(IPC_CHANNELS.FULL_STORY_START, (event: IpcMainInvokeEvent, req: FullStoryStartRequest): IpcResult<FullStoryJob> => {
    try {
      return { success: true, data: service.start(req, event.sender) };
    } catch (error) {
      return failure('FULL_STORY_START_ERROR', error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FULL_STORY_GET_STATUS, (_event, projectId: string): IpcResult<FullStoryJob | null> => {
    try {
      return { success: true, data: service.getStatus(projectId) };
    } catch (error) {
      return failure('FULL_STORY_STATUS_ERROR', error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FULL_STORY_RESUME, (event: IpcMainInvokeEvent, projectId: string): IpcResult<FullStoryJob> => {
    try {
      return { success: true, data: service.resume(projectId, event.sender) };
    } catch (error) {
      return failure('FULL_STORY_RESUME_ERROR', error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FULL_STORY_CANCEL, (_event, projectId: string): IpcResult<void> => {
    try {
      service.cancel(projectId);
      return { success: true, data: undefined };
    } catch (error) {
      return failure('FULL_STORY_CANCEL_ERROR', error);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FULL_STORY_DISCARD, (_event, projectId: string): IpcResult<void> => {
    try {
      service.discard(projectId);
      return { success: true, data: undefined };
    } catch (error) {
      return failure('FULL_STORY_DISCARD_ERROR', error);
    }
  });
}
