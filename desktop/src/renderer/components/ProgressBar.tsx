import type { OverallProgress } from '../../shared/types';

interface ProgressBarProps {
  progress: OverallProgress;
  isConverting: boolean;
}

export function ProgressBar({ progress, isConverting }: ProgressBarProps) {
  const percent = Number(progress.percentComplete) || 0;
  const isComplete =
    (Number.isFinite(percent) && percent >= 99.9) ||
    (Number.isFinite(progress.completedFiles) &&
      Number.isFinite(progress.totalFiles) &&
      progress.totalFiles > 0 &&
      progress.completedFiles >= progress.totalFiles);
  const hasErrors = progress.errorCount > 0;

  const statusText = isConverting
    ? `Converting... ${progress.completedFiles}/${progress.totalFiles}`
    : isComplete
    ? hasErrors
      ? `Completed with ${progress.errorCount} error(s)`
      : 'Conversion complete'
    : `${progress.completedFiles}/${progress.totalFiles} files`;

  const fillClass = isComplete
    ? hasErrors
      ? 'error'
      : 'complete'
    : '';

  return (
    <div class="progress-section">
      <div class="progress-header">
        <span>{statusText}</span>
        <span>{progress.percentComplete}%</span>
      </div>
      <div class="progress-bar">
        <div
          class={`progress-fill ${fillClass}`}
          style={{ width: `${progress.percentComplete}%` }}
        />
      </div>
    </div>
  );
}
