import { create } from 'zustand';
import type { Project, Branch } from '@/types/models';

interface ProjectState {
  // Current open project
  currentProject: Project | null;
  currentBranchId: string | null;
  branches: Branch[];

  // Project list
  projects: Project[];
  isLoading: boolean;
  error: string | null;

  // Actions
  setCurrentProject: (project: Project | null) => void;
  setCurrentBranchId: (branchId: string | null) => void;
  setBranches: (branches: Branch[]) => void;
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (projectId: string) => void;
  updateProject: (projectId: string, updates: Partial<Project>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProjectStore = create<ProjectState>(set => ({
  currentProject: null,
  currentBranchId: null,
  branches: [],
  projects: [],
  isLoading: false,
  error: null,

  setCurrentProject: (project: Project | null) =>
    set({ currentProject: project, currentBranchId: null }),
  setCurrentBranchId: (branchId: string | null) =>
    set({ currentBranchId: branchId }),
  setBranches: (branches: Branch[]) =>
    set({ branches }),
  setProjects: (projects: Project[]) =>
    set({ projects }),
  addProject: (project: Project) =>
    set(state => ({ projects: [project, ...state.projects] })),
  removeProject: (projectId: string) =>
    set(state => ({ projects: state.projects.filter(p => p.id !== projectId) })),
  updateProject: (projectId: string, updates: Partial<Project>) =>
    set(state => ({
      projects: state.projects.map(p => p.id === projectId ? { ...p, ...updates } : p),
      currentProject:
        state.currentProject?.id === projectId
          ? { ...state.currentProject, ...updates }
          : state.currentProject,
    })),
  setLoading: (loading: boolean) =>
    set({ isLoading: loading }),
  setError: (error: string | null) =>
    set({ error }),
}));
