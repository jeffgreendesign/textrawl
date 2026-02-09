import type { ProjectStats as ProjectStatsType } from '../../shared/types';

interface ProjectStatsProps {
	stats: ProjectStatsType;
}

const STAT_ITEMS: { key: keyof ProjectStatsType; label: string; className: string }[] = [
	{ key: 'pending', label: 'pending', className: 'project-stats__item--pending' },
	{ key: 'converted', label: 'converted', className: 'project-stats__item--converted' },
	{ key: 'uploaded', label: 'uploaded', className: 'project-stats__item--uploaded' },
	{ key: 'errors', label: 'errors', className: 'project-stats__item--error' },
	{ key: 'oversized', label: 'oversized', className: 'project-stats__item--oversized' },
	{ key: 'unsupported', label: 'unsupported', className: 'project-stats__item--unsupported' },
];

export function ProjectStats({ stats }: ProjectStatsProps) {
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
			{visible.map((item, i) => (
				<span key={item.key}>
					<span class={`project-stats__item ${item.className}`}>
						{stats[item.key]} {item.label}
					</span>
					{i < visible.length - 1 && <span class="project-stats__separator"> · </span>}
				</span>
			))}
		</div>
	);
}
