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

	// Project channels (invoke — renderer → main, returns promise)
	PROJECT_GET_RECENT: 'project:getRecent',
	PROJECT_REMOVE_RECENT: 'project:removeRecent',
	PROJECT_LOAD: 'project:load',
	PROJECT_UNLOAD: 'project:unload',
	PROJECT_REFRESH: 'project:refresh',
	PROJECT_GET_TREE: 'project:getTree',
	PROJECT_CONVERT: 'project:convert',
	PROJECT_CONVERT_SELECTED: 'project:convertSelected',
	PROJECT_CONVERT_OVERSIZED: 'project:convertOversized',
	PROJECT_UPLOAD: 'project:upload',
	PROJECT_RETRY: 'project:retry',
	PROJECT_DISMISS_ERRORS: 'project:dismissErrors',
	PROJECT_GENERATE_REPORT: 'project:generateReport',

	// Send channels (main → renderer, event-based)
	PROGRESS: 'progress',
	LOG: 'log',
	COMPLETE: 'complete',
	ERROR: 'error',

	// Project channels (send — main → renderer, event-based)
	PROJECT_FILE_UPDATE: 'project:fileUpdate',
	PROJECT_STATS_UPDATE: 'project:statsUpdate',
	PROJECT_TREE_SYNC: 'project:treeSync',
} as const;

export type IPCChannel = (typeof IPC)[keyof typeof IPC];
