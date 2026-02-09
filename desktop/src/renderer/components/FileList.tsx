import type { FileProgress, ScannedFile } from '../../shared/types';

interface FileListProps {
	files: ScannedFile[];
	fileProgress: Map<string, FileProgress>;
	onClear: () => void;
}

export const FILE_ICONS: Record<string, string> = {
	mbox: '📧',
	'mbox-bundle': '📧',
	eml: '✉️',
	html: '🌐',
	takeout: '📦',
	facebook: '📘',
	instagram: '📷',
	spotify: '🎵',
	reddit: '🔶',
	pdf: '📄',
	docx: '📝',
	doc: '📝',
	rtf: '📝',
	odt: '📝',
	xlsx: '📊',
	xls: '📊',
	xlsb: '📊',
	csv: '📊',
	ods: '📊',
	pptx: '📽️',
	ppt: '📽️',
	odp: '📽️',
	txt: '📃',
	md: '📃',
	text: '📃',
	rtfd: '📝',
	xml: '🔖',
	json: '🔖',
	zip: '📦',
	unknown: '❓',
};

const STATUS_ICONS: Record<string, string> = {
	pending: '○',
	processing: '◐',
	complete: '✓',
	error: '✗',
	skipped: '−',
};

export function FileList({ files, fileProgress, onClear }: FileListProps) {
	return (
		<div class="file-list">
			<div class="file-list-header">
				<span>{files.length} file(s) found</span>
				<button type="button" class="btn-small" onClick={onClear}>
					Clear
				</button>
			</div>
			<div class="file-list-content">
				{files.map((file) => {
					const progress = fileProgress.get(file.id);
					const status = progress?.status || 'pending';
					const icon = FILE_ICONS[file.type] || FILE_ICONS.unknown;
					const statusIcon = STATUS_ICONS[status];

					return (
						<div key={file.id} class="file-item">
							<span class="file-icon">{icon}</span>
							<div class="file-info">
								<div class="file-name" title={file.path}>
									{file.name}
								</div>
								<div class="file-type">
									{file.type}
									{file.isDirectory && ' (folder)'}
									{status === 'processing' && progress?.message && (
										<span class="file-progress-detail"> — {progress.message}</span>
									)}
								</div>
							</div>
							<span class={`file-status ${status}`} title={progress?.message || status}>
								{status === 'processing' ? <span class="spinner" /> : statusIcon}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
