import { app, BrowserWindow, shell } from 'electron';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { update } from './update.js';
import { openGlobalDatabase, closeGlobalDatabase } from './services/database.js';
import { getConfigService } from './services/ConfigService.js';
import { registerWindowHandlers } from '../ipc/windowHandlers.js';
import { registerProjectHandlers } from '../ipc/projectHandlers.js';
import { registerSettingsHandlers } from '../ipc/settingsHandlers.js';
import { registerAutosaveHandlers } from '../ipc/autosaveHandlers.js';
import { registerAIHandlers } from '../ipc/aiHandlers.js';
import { registerParagraphHandlers } from '../ipc/paragraphHandlers.js';
import { registerWorldMemoryHandlers } from '../ipc/worldMemoryHandlers.js';
import { registerBranchHandlers } from '../ipc/branchHandlers.js';
import { registerTemplateHandlers } from '../ipc/templateHandlers.js';
import { registerSearchHandlers } from '../ipc/searchHandlers.js';
import { registerStatsHandlers } from '../ipc/statsHandlers.js';
import { registerFullStoryHandlers } from '../ipc/fullStoryHandlers.js';
import { getTemplateService } from './services/TemplateService.js';
import { getGlobalDatabase } from './services/database.js';
import { getAutoSaveService } from './services/AutoSaveService.js';

// createRequire for native modules
export const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, '../..');

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

// Disable GPU Acceleration for Windows 7
if (process.platform === 'win32' && os.release().startsWith('6.1'))
  app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName());

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win: BrowserWindow | null = null;
const preload = path.join(__dirname, '../preload/index.mjs');
const indexHtml = path.join(RENDERER_DIST, 'index.html');

async function createWindow() {
  // Initialize services (must happen after app.ready)
  const userDataPath = app.getPath('userData');
  await openGlobalDatabase(userDataPath);
  const configService = getConfigService();

  // Restore window bounds
  const bounds = configService.get('windowBounds');

  win = new BrowserWindow({
    title: 'Noveler',
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    // Frameless window for custom titlebar
    frame: false,
    // Minimum size
    minWidth: 1280,
    minHeight: 800,
    // Restore saved bounds
    x: bounds.x || undefined,
    y: bounds.y || undefined,
    width: bounds.width,
    height: bounds.height,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#1a1a2e',
    show: false, // Don't show until ready-to-show
  });

  // Restore maximized state
  if (bounds.isMaximized) {
    win.maximize();
  }

  win.once('ready-to-show', () => {
    win?.show();
  });

  // Register IPC handlers
  registerWindowHandlers(win);
  registerProjectHandlers();
  registerSettingsHandlers();
  registerAutosaveHandlers();
  registerAIHandlers();
  registerParagraphHandlers();
  registerWorldMemoryHandlers();
  registerBranchHandlers();
  registerTemplateHandlers();
  registerSearchHandlers();
  registerStatsHandlers();
  registerFullStoryHandlers();

  // Seed built-in templates on startup
  try {
    getTemplateService().seedBuiltinTemplates(getGlobalDatabase());
  } catch {
    // DB may not be initialized yet at this point; templates will be seeded on first template:list call
  }

  // Save window bounds on close
  win.on('close', () => {
    if (win) {
      const isMaximized = win.isMaximized();
      const winBounds = win.getBounds();
      configService.set('windowBounds', {
        x: winBounds.x,
        y: winBounds.y,
        width: winBounds.width,
        height: winBounds.height,
        isMaximized,
      });
    }
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    // Open devTool if the app is not packaged
    win.webContents.openDevTools();
  } else {
    win.loadFile(indexHtml);
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString());
  });

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Auto update
  update(win);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  win = null;
  // Save any pending autosaves on exit
  getAutoSaveService().cancelAll();
  closeGlobalDatabase();
  if (process.platform !== 'darwin') app.quit();
});

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length) {
    allWindows[0].focus();
  } else {
    createWindow();
  }
});
