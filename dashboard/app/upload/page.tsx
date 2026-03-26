/**
 * Upload — drag-and-drop file upload with progress tracking.
 */
'use client';

import { AlertCircle, Archive, CheckCircle, FileText, Image, Music, Upload, X } from 'lucide-react';
import { useCallback, useState } from 'react';

interface UploadFile {
	id: string;
	file: File;
	status: 'pending' | 'uploading' | 'complete' | 'error';
	progress: number;
	error?: string;
}

const FILE_ICONS: Record<string, typeof FileText> = {
	'application/pdf': FileText,
	'image/png': Image,
	'image/jpeg': Image,
	'image/webp': Image,
	'audio/mpeg': Music,
	'audio/wav': Music,
	'application/zip': Archive,
};

export default function UploadPage() {
	const [files, setFiles] = useState<UploadFile[]>([]);
	const [isDragging, setIsDragging] = useState(false);
	const [tags, setTags] = useState('');
	const [isUploading, setIsUploading] = useState(false);

	const addFiles = useCallback((fileList: FileList) => {
		const newFiles: UploadFile[] = Array.from(fileList).map((file) => ({
			id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
			file,
			status: 'pending' as const,
			progress: 0,
		}));
		setFiles((prev) => [...prev, ...newFiles]);
	}, []);

	const removeFile = useCallback(
		(id: string) => {
			if (isUploading) return;
			setFiles((prev) => prev.filter((f) => f.id !== id));
		},
		[isUploading],
	);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setIsDragging(false);
			if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
		},
		[addFiles],
	);

	const handleUploadAll = useCallback(async () => {
		if (isUploading) return;
		setIsUploading(true);
		try {
			const pending = files.filter((f) => f.status === 'pending');
			const tagList = tags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);

			const token = typeof window !== 'undefined' ? localStorage.getItem('textrawl_token') : null;
			const baseUrl =
				typeof window !== 'undefined' ? localStorage.getItem('textrawl_server') || '' : '';

			if (baseUrl) {
				try {
					new URL(baseUrl);
				} catch {
					for (const f of pending) {
						setFiles((prev) =>
							prev.map((p) =>
								p.id === f.id
									? { ...p, status: 'error' as const, error: 'Invalid server URL in settings' }
									: p,
							),
						);
					}
					return;
				}
			}

			for (const uploadFile of pending) {
				setFiles((prev) =>
					prev.map((f) =>
						f.id === uploadFile.id ? { ...f, status: 'uploading' as const, progress: 30 } : f,
					),
				);

				try {
					const formData = new FormData();
					formData.append('file', uploadFile.file);
					if (tagList.length) formData.append('tags', JSON.stringify(tagList));

					const res = await fetch(`${baseUrl}/api/upload`, {
						method: 'POST',
						headers: token ? { Authorization: `Bearer ${token}` } : {},
						body: formData,
					});

					if (!res.ok) {
						let errorMsg = res.statusText;
						try {
							const body = await res.json();
							errorMsg = body.error || body.message || errorMsg;
						} catch {}
						throw new Error(`Upload failed: ${errorMsg}`);
					}

					setFiles((prev) =>
						prev.map((f) =>
							f.id === uploadFile.id ? { ...f, status: 'complete' as const, progress: 100 } : f,
						),
					);
				} catch (err) {
					setFiles((prev) =>
						prev.map((f) =>
							f.id === uploadFile.id
								? {
										...f,
										status: 'error' as const,
										error: err instanceof Error ? err.message : 'Upload failed',
									}
								: f,
						),
					);
				}
			}
		} finally {
			setIsUploading(false);
		}
	}, [files, tags, isUploading]);

	const getIcon = (mimeType: string) => FILE_ICONS[mimeType] || FileText;

	return (
		<div>
			<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>Upload</h2>

			{/* Drop zone */}
			{/* biome-ignore lint/a11y/useSemanticElements: drag-and-drop zone needs div */}
			<div
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						document.getElementById('file-input')?.click();
					}
				}}
				onDragOver={(e) => {
					e.preventDefault();
					setIsDragging(true);
				}}
				onDragLeave={() => setIsDragging(false)}
				onDrop={handleDrop}
				onClick={() => document.getElementById('file-input')?.click()}
				style={{
					border: `2px dashed ${isDragging ? 'var(--text-accent)' : 'var(--border-default)'}`,
					borderRadius: '0.75rem',
					padding: '3rem',
					textAlign: 'center',
					cursor: 'pointer',
					backgroundColor: isDragging ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
					transition: 'all 0.2s',
					marginBottom: '1.5rem',
				}}
			>
				<Upload size={40} style={{ margin: '0 auto 1rem', color: 'var(--text-muted)' }} />
				<p style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.5rem' }}>
					Drop files here or click to browse
				</p>
				<p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
					PDF, DOCX, TXT, MD, HTML, images, audio, MBOX, EML, ZIP
				</p>
				<input
					id="file-input"
					type="file"
					multiple
					onChange={(e) => {
						if (e.target.files) addFiles(e.target.files);
						e.target.value = '';
					}}
					style={{ display: 'none' }}
				/>
			</div>

			{/* Tags input */}
			{files.length > 0 && (
				<div style={{ marginBottom: '1rem' }}>
					<label
						htmlFor="upload-tags"
						style={{
							fontSize: '0.8125rem',
							color: 'var(--text-muted)',
							display: 'block',
							marginBottom: '0.375rem',
						}}
					>
						Tags (comma-separated)
					</label>
					<input
						id="upload-tags"
						type="text"
						value={tags}
						onChange={(e) => setTags(e.target.value)}
						placeholder="research, article, project-x"
						style={{
							width: '100%',
							padding: '0.5rem 0.75rem',
							backgroundColor: 'var(--bg-secondary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.5rem',
							color: 'var(--text-primary)',
							fontSize: '0.875rem',
						}}
					/>
				</div>
			)}

			{/* File list */}
			{files.length > 0 && (
				<div
					style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}
				>
					{files.map((f) => {
						const Icon = getIcon(f.file.type);
						return (
							<div
								key={f.id}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: '0.75rem',
									padding: '0.75rem 1rem',
									backgroundColor: 'var(--bg-secondary)',
									border: '1px solid var(--border-default)',
									borderRadius: '0.5rem',
								}}
							>
								<Icon size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
								<div style={{ flex: 1, minWidth: 0 }}>
									<p
										style={{
											fontSize: '0.875rem',
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											whiteSpace: 'nowrap',
										}}
									>
										{f.file.name}
									</p>
									<p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
										{(f.file.size / 1024).toFixed(1)} KB
									</p>
									{f.error && (
										<p style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.125rem' }}>
											{f.error}
										</p>
									)}
								</div>
								{f.status === 'complete' && (
									<CheckCircle size={18} style={{ color: '#22c55e', flexShrink: 0 }} />
								)}
								{f.status === 'error' && (
									<AlertCircle size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
								)}
								{f.status === 'uploading' && (
									<div
										style={{
											width: 60,
											height: 4,
											backgroundColor: 'var(--bg-tertiary)',
											borderRadius: 2,
										}}
									>
										<div
											style={{
												width: `${f.progress}%`,
												height: '100%',
												backgroundColor: 'var(--text-accent)',
												borderRadius: 2,
												transition: 'width 0.3s',
											}}
										/>
									</div>
								)}
								{f.status === 'pending' && (
									<button
										type="button"
										aria-label={`Remove ${f.file.name}`}
										onClick={(e) => {
											e.stopPropagation();
											removeFile(f.id);
										}}
										style={{
											background: 'none',
											border: 'none',
											cursor: 'pointer',
											color: 'var(--text-muted)',
											padding: '0.25rem',
										}}
									>
										<X size={16} />
									</button>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* Upload button */}
			{(() => {
				const pendingCount = files.filter((f) => f.status === 'pending').length;
				if (!pendingCount && !isUploading) return null;
				return (
					<button
						type="button"
						onClick={handleUploadAll}
						disabled={isUploading}
						style={{
							padding: '0.625rem 1.5rem',
							backgroundColor: isUploading ? 'var(--bg-tertiary)' : 'var(--text-accent)',
							color: isUploading ? 'var(--text-muted)' : '#000',
							border: 'none',
							borderRadius: '0.5rem',
							fontWeight: 600,
							fontSize: '0.875rem',
							cursor: isUploading ? 'not-allowed' : 'pointer',
						}}
					>
						{isUploading
							? 'Uploading\u2026'
							: `Upload ${pendingCount} file${pendingCount !== 1 ? 's' : ''}`}
					</button>
				);
			})()}
		</div>
	);
}
