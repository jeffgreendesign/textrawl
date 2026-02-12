import type { PipelineStatus, ProjectStats as ProjectStatsType } from '../../shared/types.js';

interface ProjectStatsProps {
	stats: ProjectStatsType;
	activeFilter?: PipelineStatus | null;
	onFilterClick?: (status: PipelineStatus) => void;
	onInfoClick?: (status: PipelineStatus) => void;
}

const STAT_ITEMS: {
	key: keyof ProjectStatsType;
	status: PipelineStatus;
	label: string;
	className: string;
}[] = [
	{
		key: 'pending',
		status: 'pending',
		label: 'pending',
		className: 'project-stats__item--pending',
	},
	{
		key: 'converted',
		status: 'converted',
		label: 'converted',
		className: 'project-stats__item--converted',
	},
	{
		key: 'uploaded',
		status: 'uploaded',
		label: 'uploaded',
		className: 'project-stats__item--uploaded',
	},
	{ key: 'errors', status: 'error', label: 'errors', className: 'project-stats__item--error' },
	{
		key: 'oversized',
		status: 'oversized',
		label: 'oversized',
		className: 'project-stats__item--oversized',
	},
	{
		key: 'unsupported',
		status: 'unsupported',
		label: 'unsupported',
		className: 'project-stats__item--unsupported',
	},
];

export function ProjectStats({
	stats,
	activeFilter,
	onFilterClick,
	onInfoClick,
}: ProjectStatsProps) {
	const visible = STAT_ITEMS.filter((item) => stats[item.key] > 0);

	if (visible.length === 0) {
		return (
			<div class="project-stats">
				<span class="project-stats__item project-stats__item--pending">No files</span>
			</div>
		);
	}

	return (
		<div class="project-stats">
			{visible.map((item, i) => {
				const isActive = activeFilter === item.status;
				return (
					<span key={item.key}>
						<button
							type="button"
							class={`project-stats__item ${item.className} ${isActive ? 'project-stats__item--active' : ''}`}
							onClick={() => onFilterClick?.(item.status)}
							title={`Filter by ${item.label}`}
						>
							{stats[item.key]} {item.label}
						</button>
						<button
							type="button"
							class="project-stats__info"
							onClick={(e) => {
								e.stopPropagation();
								onInfoClick?.(item.status);
							}}
							title={`About ${item.label}`}
						>
							?
						</button>
						{i < visible.length - 1 && <span class="project-stats__separator"> · </span>}
					</span>
				);
			})}
		</div>
	);
}
