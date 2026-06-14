import { useCallback, useRef, useState } from 'react';

export interface UndoRedoCommand<T> {
  /** Human-readable description (optional, for debugging) */
  description?: string;
  /** Apply the "do" operation — perform the change forward */
  execute: () => T | Promise<T>;
  /** Apply the "undo" operation — revert the change */
  undo: () => T | Promise<T>;
}

export interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  historySize: number;
}

const MAX_HISTORY = 50;

/**
 * Generic undo/redo hook using the Command pattern.
 *
 * Usage:
 *   const { execute, undo, redo, state } = useUndoRedo();
 *
 *   // Wrap any reversible operation:
 *   await execute({
 *     execute: () => updateCharacter(id, newValue),
 *     undo: () => updateCharacter(id, oldValue),
 *   });
 *
 *   // Undo / redo:
 *   await undo();
 *   await redo();
 */
export function useUndoRedo() {
  // undoStack: list of commands that have been executed (can be undone)
  const undoStack = useRef<UndoRedoCommand<unknown>[]>([]);
  // redoStack: list of commands that have been undone (can be redone)
  const redoStack = useRef<UndoRedoCommand<unknown>[]>([]);

  // Force re-render when stacks change
  const [, forceUpdate] = useState(0);
  const bump = useCallback(() => forceUpdate(n => n + 1), []);

  const execute = useCallback(async <T>(command: UndoRedoCommand<T>): Promise<T> => {
    const result = await command.execute();

    // Push to undo stack; clear redo stack (new action invalidates redo history)
    undoStack.current.push(command as UndoRedoCommand<unknown>);
    if (undoStack.current.length > MAX_HISTORY) {
      undoStack.current.shift(); // Remove oldest
    }
    redoStack.current = [];

    bump();
    return result;
  }, [bump]);

  const undo = useCallback(async (): Promise<boolean> => {
    const command = undoStack.current.pop();
    if (!command) return false;

    await command.undo();
    redoStack.current.push(command);

    bump();
    return true;
  }, [bump]);

  const redo = useCallback(async (): Promise<boolean> => {
    const command = redoStack.current.pop();
    if (!command) return false;

    await command.execute();
    undoStack.current.push(command);
    if (undoStack.current.length > MAX_HISTORY) {
      undoStack.current.shift();
    }

    bump();
    return true;
  }, [bump]);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    bump();
  }, [bump]);

  const state: UndoRedoState = {
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    historySize: undoStack.current.length,
  };

  return { execute, undo, redo, clear, state };
}
