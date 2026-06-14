import fs from 'node:fs';
import path from 'node:path';
import type { RecoverySnapshot } from '../../shared/types.js';

class AutoSaveService {
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly DEBOUNCE_MS = 30_000; // 30 seconds

  // Schedule a debounced save for a project
  scheduleSave(projectPath: string, snapshot: RecoverySnapshot): void {
    const existing = this.saveTimers.get(projectPath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.writeRecoveryFile(projectPath, snapshot);
      this.saveTimers.delete(projectPath);
    }, this.DEBOUNCE_MS);

    this.saveTimers.set(projectPath, timer);
  }

  // Immediate save (bypass debounce)
  saveNow(projectPath: string, snapshot: RecoverySnapshot): void {
    const existing = this.saveTimers.get(projectPath);
    if (existing) {
      clearTimeout(existing);
      this.saveTimers.delete(projectPath);
    }
    this.writeRecoveryFile(projectPath, snapshot);
  }

  private writeRecoveryFile(projectPath: string, snapshot: RecoverySnapshot): void {
    const autosaveDir = path.join(projectPath, 'autosave');
    fs.mkdirSync(autosaveDir, { recursive: true });
    fs.writeFileSync(
      path.join(autosaveDir, 'recovery.json'),
      JSON.stringify({ ...snapshot, timestamp: new Date().toISOString() }, null, 2),
      'utf-8',
    );
  }

  // Check if a recovery file exists and return it
  checkRecovery(projectPath: string): RecoverySnapshot | null {
    const recoveryPath = path.join(projectPath, 'autosave', 'recovery.json');
    if (!fs.existsSync(recoveryPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(recoveryPath, 'utf-8')) as RecoverySnapshot;
    } catch {
      return null;
    }
  }

  // Discard recovery file
  discardRecovery(projectPath: string): void {
    const recoveryPath = path.join(projectPath, 'autosave', 'recovery.json');
    if (fs.existsSync(recoveryPath)) {
      fs.unlinkSync(recoveryPath);
    }
  }

  // Cancel all pending saves
  cancelAll(): void {
    for (const timer of this.saveTimers.values()) {
      clearTimeout(timer);
    }
    this.saveTimers.clear();
  }
}

let instance: AutoSaveService | null = null;

export function getAutoSaveService(): AutoSaveService {
  if (!instance) {
    instance = new AutoSaveService();
  }
  return instance;
}

export { AutoSaveService };
