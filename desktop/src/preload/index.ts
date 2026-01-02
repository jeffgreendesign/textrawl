/**
 * Textrawl Desktop - Preload Script
 * Exposes safe APIs to the renderer process via contextBridge
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels.js';
import type {
  AppSettings,
  ConversionOptions,
  LogEntry,
  ProgressUpdate,
  ScannedFile,
  UploadOptions,
} from '../shared/types.js';

// API exposed to renderer
const electronAPI = {
  // Scan dropped files/folders
  scanPaths: (paths: string[]): Promise<ScannedFile[]> => {
    return ipcRenderer.invoke(IPC.SCAN_PATHS, paths);
  },

  // Start conversion
  startConversion: (
    files: ScannedFile[],
    options: ConversionOptions
  ): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC.CONVERT_START, files, options);
  },

  // Cancel conversion
  cancelConversion: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC.CONVERT_CANCEL);
  },

  // Start upload
  startUpload: (
    options: UploadOptions
  ): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC.UPLOAD_START, options);
  },

  // Select folder dialog
  selectFolder: (): Promise<string | null> => {
    return ipcRenderer.invoke(IPC.SELECT_FOLDER);
  },

  // Select files/folders dialog
  selectFiles: (): Promise<string[]> => {
    return ipcRenderer.invoke(IPC.SELECT_FILES);
  },

  // Settings
  loadSettings: (): Promise<AppSettings> => {
    return ipcRenderer.invoke(IPC.SETTINGS_LOAD);
  },

  saveSettings: (settings: AppSettings): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC.SETTINGS_SAVE, settings);
  },

  // Event listeners (main → renderer)
  onProgress: (callback: (update: ProgressUpdate) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, update: ProgressUpdate) => {
      callback(update);
    };
    ipcRenderer.on(IPC.PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.PROGRESS, handler);
  },

  onLog: (callback: (entry: LogEntry) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: LogEntry) => {
      callback(entry);
    };
    ipcRenderer.on(IPC.LOG, handler);
    return () => ipcRenderer.removeListener(IPC.LOG, handler);
  },

  onComplete: (callback: (data: { type: 'conversion' | 'upload'; success: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { type: 'conversion' | 'upload'; success: boolean }) => {
      callback(data);
    };
    ipcRenderer.on(IPC.COMPLETE, handler);
    return () => ipcRenderer.removeListener(IPC.COMPLETE, handler);
  },

  onError: (callback: (error: { message: string; details?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: { message: string; details?: string }) => {
      callback(error);
    };
    ipcRenderer.on(IPC.ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.ERROR, handler);
  },

  // Remove all listeners
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners(IPC.PROGRESS);
    ipcRenderer.removeAllListeners(IPC.LOG);
    ipcRenderer.removeAllListeners(IPC.COMPLETE);
    ipcRenderer.removeAllListeners(IPC.ERROR);
  },
};

// Expose to renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for renderer
export type ElectronAPI = typeof electronAPI;
