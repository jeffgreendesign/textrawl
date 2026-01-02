/**
 * IPC channel names for main <-> renderer communication
 */
export const IPC = {
  // Invoke channels (renderer → main, returns promise)
  SCAN_PATHS: 'scan:paths',
  CONVERT_START: 'convert:start',
  CONVERT_CANCEL: 'convert:cancel',
  UPLOAD_START: 'upload:start',
  SELECT_FOLDER: 'dialog:selectFolder',
  SELECT_FILES: 'dialog:selectFiles',
  SETTINGS_LOAD: 'settings:load',
  SETTINGS_SAVE: 'settings:save',

  // Send channels (main → renderer, event-based)
  PROGRESS: 'progress',
  LOG: 'log',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const;

export type IPCChannel = (typeof IPC)[keyof typeof IPC];
