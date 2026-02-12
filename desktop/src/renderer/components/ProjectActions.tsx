import type { ProjectStats } from '../../shared/types';

interface ProjectActionsProps {
	stats: ProjectStats;
	selectedCount: number;
	disabled?: boolean;
	onConvertAll: () => void;
	onConvertSelected: () => void;
	onUpload: () => void;
	onRetry: () => void;
	onConvertOversized: () => void;
	onDismissErrors: () => void;
}

export function ProjectActions({
	stats,
	selectedCount,
	disabled,
	onConvertAll,
	onConvertSelected,
	onUpload,
	onRetry,
	onConvertOversized,
	onDismissErrors,
}: ProjectActionsProps) {
	return (
		<div class={`project-actions${disabled ? ' project-actions--disabled' : ''}`}>
			{stats.pending > 0 && (
				<button type="button" class="btn btn-primary" disabled={disabled} onClick={onConvertAll}>
					Convert All Pending
				</button>
			)}
			{selectedCount > 0 && (
				<button
					type="button"
					class="btn btn-secondary"
					disabled={disabled}
					onClick={onConvertSelected}
				>
					Convert Selected ({selectedCount})
				</button>
			)}
			{stats.oversized > 0 && (
				<button
					type="button"
					class="btn btn-secondary"
					disabled={disabled}
					onClick={onConvertOversized}
				>
					Convert Oversized ({stats.oversized})
				</button>
			)}
			{stats.converted > 0 && (
				<button type="button" class="btn btn-primary" disabled={disabled} onClick={onUpload}>
					Upload Converted
				</button>
			)}
			{stats.errors > 0 && (
				<>
					<button type="button" class="btn btn-secondary" disabled={disabled} onClick={onRetry}>
						Retry Failed ({stats.errors})
					</button>
					<button
						type="button"
						class="btn btn-secondary"
						disabled={disabled}
						onClick={onDismissErrors}
					>
						Dismiss Errors
					</button>
				</>
			)}
		</div>
	);
}
