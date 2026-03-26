/**
 * UploadZone — reusable drag-and-drop upload component.
 */
'use client';

import { Upload } from 'lucide-react';
import { useCallback, useState } from 'react';

interface UploadZoneProps {
	onFiles: (files: File[]) => void;
	accept?: string;
	compact?: boolean;
}

export default function UploadZone({ onFiles, accept, compact = false }: UploadZoneProps) {
	const [isDragging, setIsDragging] = useState(false);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setIsDragging(false);
			if (e.dataTransfer.files.length) {
				onFiles(Array.from(e.dataTransfer.files));
			}
		},
		[onFiles],
	);

	return (
		// biome-ignore lint/a11y/useSemanticElements: drag-and-drop zone requires div
		<div
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					document.getElementById('upload-zone-input')?.click();
				}
			}}
			onDragOver={(e) => {
				e.preventDefault();
				setIsDragging(true);
			}}
			onDragLeave={() => setIsDragging(false)}
			onDrop={handleDrop}
			onClick={() => document.getElementById('upload-zone-input')?.click()}
			style={{
				border: `2px dashed ${isDragging ? 'var(--text-accent)' : 'var(--border-default)'}`,
				borderRadius: '0.75rem',
				padding: compact ? '1.5rem' : '3rem',
				textAlign: 'center',
				cursor: 'pointer',
				backgroundColor: isDragging ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
				transition: 'all 0.2s',
			}}
		>
			<Upload
				size={compact ? 24 : 40}
				style={{ margin: '0 auto 0.75rem', color: 'var(--text-muted)' }}
			/>
			<p
				style={{
					fontSize: compact ? '0.8125rem' : '1rem',
					fontWeight: 500,
					marginBottom: '0.25rem',
				}}
			>
				Drop files here or click to browse
			</p>
			{!compact && (
				<p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
					PDF, DOCX, TXT, MD, HTML, images, audio, MBOX, EML, ZIP
				</p>
			)}
			<input
				id="upload-zone-input"
				type="file"
				multiple
				accept={accept}
				onChange={(e) => e.target.files && onFiles(Array.from(e.target.files))}
				style={{ display: 'none' }}
			/>
		</div>
	);
}
