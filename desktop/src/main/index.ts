/**
 * Textrawl Desktop - Electron Main Process
 *
 * Note: ELECTRON_RUN_AS_NODE must be unset for Electron to work properly.
 * The npm scripts in package.json handle this automatically.
 */
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, dirname } from 'path';
import { IPC } from '../shared/ipc-channels.js';
import type { AppSettings, ConversionOptions, ScannedFile, UploadOptions } from '../shared/types.js';
import { scanPaths } from './services/file-router.js';
import { ConversionManager } from './services/conversion-manager.js';
import { SettingsStore } from './services/settings-store.js';
import { UploadManager } from './services/upload-manager.js';

// __dirname is available in CJS bundle

let mainWindow: BrowserWindow | null = null;
let conversionManager: ConversionManager | null = null;
let uploadManager: UploadManager | null = null;
const settingsStore = new SettingsStore();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the renderer
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Initialize managers
  conversionManager = new ConversionManager(mainWindow);
  uploadManager = new UploadManager(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
    conversionManager = null;
    uploadManager = null;
  });
}

// IPC Handlers
function setupIpcHandlers(): void {
  // Scan dropped files/folders
  ipcMain.handle(IPC.SCAN_PATHS, async (_event, paths: string[]) => {
    return scanPaths(paths);
  });

  // Start conversion
  ipcMain.handle(
    IPC.CONVERT_START,
    async (_event, files: ScannedFile[], options: ConversionOptions) => {
      if (!conversionManager) return { success: false, error: 'No window' };
      return conversionManager.startConversion(files, options);
    }
  );

  // Cancel conversion
  ipcMain.handle(IPC.CONVERT_CANCEL, async () => {
    conversionManager?.cancel();
    return { success: true };
  });

  // Start upload
  ipcMain.handle(IPC.UPLOAD_START, async (_event, options: UploadOptions) => {
    if (!uploadManager) return { success: false, error: 'No window' };
    return uploadManager.startUpload(options);
  });

  // Select folder dialog
  ipcMain.handle(IPC.SELECT_FOLDER, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Select files/folders dialog (for drop zone click)
  ipcMain.handle(IPC.SELECT_FILES, async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      message: 'Select files or folders to convert',
    });
    return result.canceled ? [] : result.filePaths;
  });

  // Load settings
  ipcMain.handle(IPC.SETTINGS_LOAD, async () => {
    return settingsStore.get();
  });

  // Save settings
  ipcMain.handle(IPC.SETTINGS_SAVE, async (_event, settings: AppSettings) => {
    settingsStore.set(settings);
    return { success: true };
  });
}

// App lifecycle
app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
