import { useState, useCallback } from 'preact/hooks';

declare global {
  interface Window {
    electronAPI: {
      selectFiles: () => Promise<string[]>;
    };
  }
}

interface DropZoneProps {
  onDrop: (paths: string[]) => void;
  isScanning?: boolean;
}

export function DropZone({ onDrop, isScanning = false }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleClick = useCallback(async () => {
    if (isScanning) return;
    const paths = await window.electronAPI.selectFiles();
    if (paths.length > 0) {
      onDrop(paths);
    }
  }, [onDrop, isScanning]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Extract file paths
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Electron provides the path property on File objects
        const path = (file as any).path;
        if (path) {
          paths.push(path);
        }
      }

      if (paths.length > 0) {
        onDrop(paths);
      }
    },
    [onDrop]
  );

  return (
    <div
      class={`dropzone ${isDragOver ? 'dragover' : ''} ${isScanning ? 'scanning' : ''}`}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isScanning ? (
        <>
          <div class="dropzone-icon">⏳</div>
          <div class="dropzone-text">
            <strong>Scanning files...</strong>
            <span>Please wait while we analyze your files</span>
          </div>
        </>
      ) : (
        <>
          <div class="dropzone-icon">📁</div>
          <div class="dropzone-text">
            <strong>Drop files or folders here, or click to browse</strong>
            <span>
              Supports MBOX, EML, HTML, PDF, DOCX, Excel, PowerPoint, and more
            </span>
          </div>
        </>
      )}
    </div>
  );
}
