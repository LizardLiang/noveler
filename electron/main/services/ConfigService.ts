import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { GlobalConfig, RecentProject } from '../../shared/types.js';

const DEFAULT_CONFIG: GlobalConfig = {
  theme: 'system',
  fontSize: 16,
  defaultStoragePath: '',
  activeProviderId: null,
  onboardingCompleted: false,
  locale: 'zh-TW',
  windowBounds: {
    x: 0,
    y: 0,
    width: 1280,
    height: 800,
    isMaximized: false,
  },
};

class ConfigService {
  private configPath: string;
  private recentProjectsPath: string;
  private config: GlobalConfig;
  private recentProjects: RecentProject[];

  constructor() {
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'config.json');
    this.recentProjectsPath = path.join(userDataPath, 'recent-projects.json');
    this.config = this.loadConfig();
    this.recentProjects = this.loadRecentProjects();
  }

  private loadConfig(): GlobalConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) as Partial<GlobalConfig> };
      }
    } catch {
      // ignore parse errors, use defaults
    }
    return { ...DEFAULT_CONFIG };
  }

  private loadRecentProjects(): RecentProject[] {
    try {
      if (fs.existsSync(this.recentProjectsPath)) {
        const raw = fs.readFileSync(this.recentProjectsPath, 'utf-8');
        return JSON.parse(raw) as RecentProject[];
      }
    } catch {
      // ignore
    }
    return [];
  }

  private saveConfig(): void {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  private saveRecentProjects(): void {
    fs.writeFileSync(this.recentProjectsPath, JSON.stringify(this.recentProjects, null, 2), 'utf-8');
  }

  get<K extends keyof GlobalConfig>(key: K): GlobalConfig[K] {
    return this.config[key];
  }

  set<K extends keyof GlobalConfig>(key: K, value: GlobalConfig[K]): void {
    this.config[key] = value;
    this.saveConfig();
  }

  getAll(): GlobalConfig {
    return { ...this.config };
  }

  setAll(config: Partial<GlobalConfig>): void {
    this.config = { ...this.config, ...config };
    this.saveConfig();
  }

  getRecentProjects(): RecentProject[] {
    return [...this.recentProjects];
  }

  addRecentProject(project: RecentProject): void {
    // Remove existing entry for same id or path
    this.recentProjects = this.recentProjects.filter(
      p => p.id !== project.id && p.path !== project.path,
    );
    // Add to front
    this.recentProjects.unshift(project);
    // Keep max 20 recent projects
    this.recentProjects = this.recentProjects.slice(0, 20);
    this.saveRecentProjects();
  }

  removeRecentProject(projectId: string): void {
    this.recentProjects = this.recentProjects.filter(p => p.id !== projectId);
    this.saveRecentProjects();
  }

  isFirstLaunch(): boolean {
    return !this.config.onboardingCompleted;
  }
}

// Singleton export
let instance: ConfigService | null = null;

export function getConfigService(): ConfigService {
  if (!instance) {
    instance = new ConfigService();
  }
  return instance;
}

export { ConfigService };
export type { GlobalConfig, RecentProject };
