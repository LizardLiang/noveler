import { createHashRouter } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { ProjectListPage } from '@/pages/ProjectListPage';
import { StoryPage } from '@/pages/StoryPage';
import { SettingsPage } from '@/pages/SettingsPage';

// createHashRouter is required for file:// protocol in Electron
export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout showSidebar={false} showWorldMemoryPanel={false} />,
    children: [
      {
        index: true,
        element: <ProjectListPage />,
      },
    ],
  },
  {
    path: '/project/:projectId',
    element: <AppLayout showSidebar={true} showWorldMemoryPanel={true} />,
    children: [
      {
        index: true,
        element: <StoryPage />,
      },
    ],
  },
  {
    path: '/settings',
    element: <AppLayout showSidebar={false} showWorldMemoryPanel={false} />,
    children: [
      {
        index: true,
        element: <SettingsPage />,
      },
    ],
  },
]);
