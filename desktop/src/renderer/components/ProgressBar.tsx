import type { OverallProgress } from '../../shared/types';

interface ProgressBarProps {
	progress: OverallProgress;
	isConverting: boolean;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds}s`;
	return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
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
	const hasFileCounts = progress.totalFiles > 0;
	const label = isConverting ? 'Converting' : 'Uploading';

	const statusText = isComplete
		? hasErrors
			? `Completed with ${progress.errorCount} error(s)`
			: 'Complete'
		: hasFileCounts
			? `${label}... ${progress.completedFiles} / ${progress.totalFiles} files`
			: `${label}...`;

	const fillClass = isComplete ? (hasErrors ? 'error' : 'complete') : '';

	// Time tracking
	const elapsedMs = progress.elapsedMs ?? 0;
	const elapsedText = elapsedMs > 0 ? formatDuration(elapsedMs) : '';

	let etaText = '';
	if (
		!isComplete &&
		progress.completedFiles > 0 &&
		progress.totalFiles > 0 &&
		percent > 5 &&
		elapsedMs > 0
	) {
		const msPerFile = elapsedMs / progress.completedFiles;
		const remainingFiles = progress.totalFiles - progress.completedFiles;
		const etaMs = msPerFile * remainingFiles;
		etaText = `~${formatDuration(etaMs)} remaining`;
	}

	return (
		<div class="progress-section">
			<div class="progress-header">
				<span>{statusText}</span>
				<span>{percent}%</span>
			</div>
			<div class="progress-bar">
				<div class={`progress-fill ${fillClass}`} style={{ width: `${percent}%` }} />
			</div>
			{(elapsedText || etaText) && (
				<div class="progress-time">
					{elapsedText && <span>Elapsed: {elapsedText}</span>}
					{etaText && <span>{etaText}</span>}
				</div>
			)}
		</div>
	);
}
