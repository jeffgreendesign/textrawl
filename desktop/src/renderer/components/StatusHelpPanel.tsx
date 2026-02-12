import { useState } from 'preact/hooks';
import type { PipelineStatus, StatusReport } from '../../shared/types.js';

interface StatusHelpPanelProps {
	status: PipelineStatus;
	report?: StatusReport | null;
	onClose: () => void;
	onConvertOversized?: () => void;
	onGenerateReport?: () => void;
}

const STATUS_HELP: Record<
	PipelineStatus,
	{ title: string; description: string; actionLabel?: string }
> = {
	pending: {
		title: 'Pending Conversion',
		description:
			'Files that have been scanned but not yet converted to markdown. Click "Convert All Pending" or select specific files to convert.',
	},
	converting: {
		title: 'Converting',
		description: 'Files currently being converted to markdown.',
	},
	converted: {
		title: 'Converted',
		description:
			'Successfully converted to markdown and ready for upload to Supabase. Click "Upload Converted" to index them for search.',
	},
	uploading: {
		title: 'Uploading',
		description: 'Files currently being uploaded to Supabase.',
	},
	uploaded: {
		title: 'Uploaded',
		description:
			'Successfully uploaded to Supabase and indexed for search. These files are available via MCP tools.',
	},
	error: {
		title: 'Failed',
		description:
			'Conversion or upload failed. Hover over the file in the tree to see the error message. Click "Retry Failed" to re-attempt.',
	},
	oversized: {
		title: 'Oversized (>10MB)',
		description:
			'Files larger than 10MB. MBOX files are automatically split by date during conversion and are safe to convert. Other file types (PDF, DOCX, etc.) may take longer but can still be attempted.',
		actionLabel: 'Convert Oversized Files',
	},
	unsupported: {
		title: 'Unsupported Format',
		description:
			'Files with unknown or unrecognized formats that cannot be converted.\n\nSupported formats: MBOX, EML, HTML, PDF, DOCX, DOC, RTF, XLSX, XLS, CSV, PPTX, PPT, TXT, MD, XML, JSON, ZIP archives (Takeout, Facebook, Instagram, Spotify, Reddit exports).\n\nFiles without extensions are identified via macOS metadata when possible.',
		actionLabel: 'Generate Report',
	},
};

export function StatusHelpPanel({
	status,
	report,
	onClose,
	onConvertOversized,
	onGenerateReport,
}: StatusHelpPanelProps) {
	const [copied, setCopied] = useState(false);
	const help = STATUS_HELP[status];

	const handleAction = () => {
		if (status === 'oversized' && onConvertOversized) {
			onConvertOversized();
		} else if (status === 'unsupported' && onGenerateReport) {
			onGenerateReport();
		}
	};

	const formatReportMarkdown = (r: StatusReport): string => {
		const lines: string[] = ['# File Status Report', ''];

		if (r.totalOversized > 0) {
			lines.push(`## Oversized Files (${r.totalOversized})`, '');
			for (const g of r.oversized) {
				lines.push(`- **${g.extension}**: ${g.count} files (${g.totalSizeMB.toFixed(1)} MB total)`);
				if (g.examples.length > 0) {
					lines.push(`  Examples: ${g.examples.join(', ')}`);
				}
			}
			lines.push('');
		}

		if (r.totalUnsupported > 0) {
			lines.push(`## Unsupported Files (${r.totalUnsupported})`, '');
			for (const g of r.unsupported) {
				lines.push(`- **${g.extension}**: ${g.count} files`);
				if (g.examples.length > 0) {
					lines.push(`  Examples: ${g.examples.join(', ')}`);
				}
			}
			lines.push('');
		}

		return lines.join('\n');
	};

	const handleCopyReport = () => {
		if (!report) return;
		const text = formatReportMarkdown(report);
		window.electronAPI.copyToClipboard(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div class="status-help-panel">
			<div class="status-help-panel__header">
				<strong>{help.title}</strong>
				<button type="button" class="btn-small" onClick={onClose}>
					✕
				</button>
			</div>
			<div class="status-help-panel__body">
				{help.description.split('\n').map((line) => (
					<p key={line || '-'}>{line}</p>
				))}
			</div>
			{help.actionLabel && (
				<div class="status-help-panel__actions">
					<button type="button" class="btn btn-secondary" onClick={handleAction}>
						{help.actionLabel}
					</button>
				</div>
			)}
			{report && (
				<div class="status-help-panel__report">
					<div class="status-help-panel__report-header">
						<strong>Report</strong>
						<button type="button" class="btn-small" onClick={handleCopyReport}>
							{copied ? 'Copied!' : 'Copy'}
						</button>
					</div>
					{report.totalOversized > 0 && (
						<div class="status-help-panel__report-section">
							<div class="status-help-panel__report-title">Oversized ({report.totalOversized})</div>
							{report.oversized.map((g) => (
								<div key={g.extension} class="status-help-panel__report-row">
									<span class="status-help-panel__report-ext">{g.extension}</span>
									<span>
										{g.count} files ({g.totalSizeMB.toFixed(1)} MB)
									</span>
								</div>
							))}
						</div>
					)}
					{report.totalUnsupported > 0 && (
						<div class="status-help-panel__report-section">
							<div class="status-help-panel__report-title">
								Unsupported ({report.totalUnsupported})
							</div>
							{report.unsupported.map((g) => (
								<div key={g.extension} class="status-help-panel__report-row">
									<span class="status-help-panel__report-ext">{g.extension}</span>
									<span>{g.count} files</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
