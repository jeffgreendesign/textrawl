import { useState, useEffect } from 'preact/hooks';
import type { ScannedFile, LogEntry, FileProgress, OverallProgress, AppSettings } from '../shared/types';
import { DropZone } from './components/DropZone';
import { FileList } from './components/FileList';
import { ProgressBar } from './components/ProgressBar';
import { LogViewer } from './components/LogViewer';
import { SettingsPanel } from './components/SettingsPanel';

// Type for the electron API exposed via preload
declare global {
  interface Window {
    electronAPI: import('../preload/index').ElectronAPI;
  }
}

type AppState = 'idle' | 'scanning' | 'ready' | 'converting' | 'complete' | 'uploading';

export function App() {
  const [state, setState] = useState<AppState>('idle');
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [fileProgress, setFileProgress] = useState<Map<string, FileProgress>>(new Map());
  const [overallProgress, setOverallProgress] = useState<OverallProgress | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    outputDir: '',
    defaultTags: [],
    autoUpload: false,
  });
  const [outputDir, setOutputDir] = useState('');
  const [tags, setTags] = useState('');

  // Load settings on mount
  useEffect(() => {
    window.electronAPI.loadSettings().then((loaded) => {
      setSettings(loaded);
      setOutputDir(loaded.outputDir || '');
      setTags(loaded.defaultTags?.join(', ') || '');
    });

    // Set up event listeners
    const unsubProgress = window.electronAPI.onProgress((update) => {
      if (update.type === 'file') {
        const fileData = update.data as FileProgress;
        setFileProgress((prev) => new Map(prev).set(fileData.fileId, fileData));
      } else {
        setOverallProgress(update.data as OverallProgress);
      }
    });

    const unsubLog = window.electronAPI.onLog((entry) => {
      setLogs((prev) => [...prev, entry]);
    });

    const unsubComplete = window.electronAPI.onComplete((data) => {
      if (data.type === 'conversion') {
        setState(data.success ? 'complete' : 'ready');
      } else if (data.type === 'upload') {
        setState('complete');
      }
    });

    const unsubError = window.electronAPI.onError((error) => {
      addLog('error', error.message, error.details);
    });

    return () => {
      unsubProgress();
      unsubLog();
      unsubComplete();
      unsubError();
      window.electronAPI.removeAllListeners();
    };
  }, []);

  const addLog = (level: LogEntry['level'], message: string, details?: string) => {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      level,
      message,
      details,
    };
    setLogs((prev) => [...prev, entry]);
  };

  const handleDrop = async (paths: string[]) => {
    setState('scanning');
    addLog('info', `Scanning ${paths.length} item(s)...`);

    try {
      const scanned = await window.electronAPI.scanPaths(paths);
      setFiles(scanned);
      if (scanned.length === 0) {
        addLog('warn', 'No convertible files found. Try dropping a supported file type.');
        setState('idle');
      } else {
        addLog('info', `Found ${scanned.length} convertible file(s)`);
        setState('ready');
      }
    } catch (error) {
      addLog('error', 'Failed to scan files', String(error));
      setState('idle');
    }
  };

  const handleConvert = async () => {
    if (!outputDir) {
      addLog('error', 'Please select an output directory');
      return;
    }

    setState('converting');
    setFileProgress(new Map());
    setOverallProgress(null);

    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      await window.electronAPI.startConversion(files, {
        outputDir,
        tags: tagList,
        dryRun: false,
        verbose: true,
      });
    } catch (error) {
      addLog('error', 'Conversion failed', String(error));
      setState('ready');
    }
  };

  const handleCancel = async () => {
    await window.electronAPI.cancelConversion();
    setState('ready');
    addLog('info', 'Conversion cancelled');
  };

  const handleUpload = async () => {
    setState('uploading');
    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      await window.electronAPI.startUpload({
        directory: outputDir,
        tags: tagList,
      });
    } catch (error) {
      addLog('error', 'Upload failed', String(error));
      setState('complete');
    }
  };

  const handleSelectFolder = async () => {
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
      setOutputDir(folder);
    }
  };

  const handleClearFiles = () => {
    setFiles([]);
    setFileProgress(new Map());
    setOverallProgress(null);
    setState('idle');
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  return (
    <div class="app">
      <header>
        <h1>Textrawl</h1>
        <p class="subtitle">Convert files to searchable markdown</p>
      </header>

      <main>
        {(state === 'idle' || state === 'scanning' || (state === 'ready' && files.length === 0)) && (
          <DropZone onDrop={handleDrop} isScanning={state === 'scanning'} />
        )}

        {files.length > 0 && (
          <>
            <FileList
              files={files}
              fileProgress={fileProgress}
              onClear={handleClearFiles}
            />

            {overallProgress && (
              <ProgressBar
                progress={overallProgress}
                isConverting={state === 'converting'}
              />
            )}

            <SettingsPanel
              outputDir={outputDir}
              tags={tags}
              onOutputDirChange={setOutputDir}
              onTagsChange={setTags}
              onSelectFolder={handleSelectFolder}
            />

            <div class="actions">
              {state === 'ready' && (
                <button class="btn btn-primary" onClick={handleConvert}>
                  Convert {files.length} file(s)
                </button>
              )}

              {state === 'converting' && (
                <button class="btn btn-secondary" onClick={handleCancel}>
                  Cancel
                </button>
              )}

              {state === 'complete' && (
                <>
                  <button class="btn btn-primary" onClick={handleUpload}>
                    Upload to Supabase
                  </button>
                  <button class="btn btn-secondary" onClick={handleClearFiles}>
                    Start Over
                  </button>
                </>
              )}

              {state === 'uploading' && (
                <button class="btn btn-secondary" disabled>
                  Uploading...
                </button>
              )}
            </div>
          </>
        )}

        {logs.length > 0 && (
          <LogViewer logs={logs} onClear={handleClearLogs} />
        )}
      </main>
    </div>
  );
}
