import type { IpcRendererEvent } from 'electron';

export interface IpcRenderer {
  on(channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void): IpcRenderer;
  off(channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => void): IpcRenderer;
  send(channel: string, ...args: unknown[]): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

declare global {
  interface Window {
    ipcRenderer: IpcRenderer;
  }
}
