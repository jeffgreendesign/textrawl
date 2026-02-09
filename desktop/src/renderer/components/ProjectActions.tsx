import type { ProjectStats } from '../../shared/types';

interface ProjectActionsProps {
	stats: ProjectStats;
	selectedCount: number;
	onConvertAll: () => void;
	onConvertSelected: () => void;
	onUpload: () => void;
	onRetry: () => void;
}

export function ProjectActions({
	stats,
	selectedCount,
	onConvertAll,
	onConvertSelected,
	onUpload,
	onRetry,
}: ProjectActionsProps) {
	return (
		<div class="project-actions">
			{stats.pending > 0 && (
				<button type="button" class="btn btn-primary" onClick={onConvertAll}>
					Convert All Pending
				</button>
			)}
			{selectedCount > 0 && (
				<button type="button" class="btn btn-secondary" onClick={onConvertSelected}>
					Convert Selected ({selectedCount})
				</button>
			)}
			{stats.converted > 0 && (
				<button type="button" class="btn btn-primary" onClick={onUpload}>
					Upload Converted
				</button>
			)}
			{stats.errors > 0 && (
				<button type="button" class="btn btn-secondary" onClick={onRetry}>
					Retry Failed ({stats.errors})
				</button>
			)}
		</div>
	);
}
