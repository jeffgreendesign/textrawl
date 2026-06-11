/**
 * Upload — drag-and-drop file upload with real progress tracking.
 *
 * Small files (≤ UPLOAD_THRESHOLD_MB) take the direct single-shot POST; larger
 * files use the resumable flow (init → chunked PUT to GCS → complete → poll
 * processing status). Progress is real: byte-based during upload, entry-based
 * during processing.
 */
'use client';

import {
	AlertCircle,
	AlertTriangle,
	Archive,
	CheckCircle,
	FileText,
	Image,
	Music,
	Upload,
	X,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { UPLOAD_THRESHOLD_MB, cancelUpload, getApiBase, resumableUpload } from '@/lib/api';

type UploadStatus = 'pending' | 'uploading' | 'processing' | 'complete' | 'partial' | 'error';

interface UploadFile {
	id: string;
	file: File;
	status: UploadStatus;
	/** 0–100 for a known fraction; -1 for an indeterminate bar. */
	progress: number;
	detail?: string;
	error?: string;
	uploadId?: string;
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

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isLocalUnconfigured(apiBase: string): boolean {
	return (
		apiBase === 'http://localhost:3000/api' &&
		typeof window !== 'undefined' &&
		!LOCAL_HOSTS.has(window.location.hostname)
	);
}

export default function UploadPage() {
	const [files, setFiles] = useState<UploadFile[]>([]);
	const [isDragging, setIsDragging] = useState(false);
	const [tags, setTags] = useState('');
	const [isUploading, setIsUploading] = useState(false);
	// AbortControllers for in-flight resumable uploads, keyed by file id.
	const controllers = useRef<Map<string, AbortController>>(new Map());

	const patchFile = useCallback((id: string, patch: Partial<UploadFile>) => {
		setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
	}, []);

	const addFiles = useCallback((fileList: FileList) => {
		const newFiles: UploadFile[] = Array.from(fileList).map((file) => ({
			id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
			file,
			status: 'pending' as const,
			progress: 0,
		}));
		setFiles((prev) => [...prev, ...newFiles]);
	}, []);

	const removeFile = useCallback((id: string) => {
		setFiles((prev) => prev.filter((f) => f.id !== id));
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setIsDragging(false);
			if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
		},
		[addFiles],
	);

	const uploadDirect = useCallback(
		async (uploadFile: UploadFile, apiBase: string, token: string | null, tagList: string[]) => {
			patchFile(uploadFile.id, { status: 'uploading', progress: -1, detail: undefined });

			const formData = new FormData();
			formData.append('file', uploadFile.file);
			if (tagList.length) formData.append('tags', JSON.stringify(tagList));

			const res = await fetch(`${apiBase}/upload`, {
				method: 'POST',
				headers: token ? { Authorization: `Bearer ${token}` } : {},
				body: formData,
			});

			if (!res.ok) {
				let errorMsg = res.statusText;
				try {
					const body = await res.json();
					errorMsg =
						body?.error?.message ||
						(typeof body?.error === 'string' ? body.error : undefined) ||
						body?.message ||
						errorMsg;
				} catch {}
				throw new Error(errorMsg);
			}

			patchFile(uploadFile.id, { status: 'complete', progress: 100 });
		},
		[patchFile],
	);

	const uploadResumable = useCallback(
		async (uploadFile: UploadFile) => {
			const controller = new AbortController();
			controllers.current.set(uploadFile.id, controller);
			patchFile(uploadFile.id, {
				status: 'uploading',
				progress: 0,
				detail: undefined,
				error: undefined,
			});

			try {
				const final = await resumableUpload(uploadFile.file, {
					signal: controller.signal,
					onInit: (init) => patchFile(uploadFile.id, { uploadId: init.uploadId }),
					onUploadProgress: (loaded, total) =>
						patchFile(uploadFile.id, {
							status: 'uploading',
							progress: total ? Math.round((loaded / total) * 100) : -1,
						}),
					onProcessingUpdate: (status) => {
						const { entriesTotal, entriesProcessed } = status.progress;
						patchFile(uploadFile.id, {
							status: 'processing',
							progress: entriesTotal ? Math.round((entriesProcessed / entriesTotal) * 100) : -1,
							detail: entriesTotal ? `${entriesProcessed}/${entriesTotal} entries` : 'Processing…',
						});
					},
				});

				if (final.state === 'completed') {
					patchFile(uploadFile.id, { status: 'complete', progress: 100, detail: undefined });
				} else if (final.state === 'partial') {
					const { entriesProcessed, entriesTotal, entriesFailed } = final.progress;
					patchFile(uploadFile.id, {
						status: 'partial',
						progress: 100,
						detail: `${entriesProcessed}/${entriesTotal} imported · ${entriesFailed} failed`,
					});
				} else {
					// failed | expired | cancelled
					patchFile(uploadFile.id, {
						status: 'error',
						error: final.error?.message ?? `Upload ${final.state}`,
						detail: undefined,
					});
				}
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') {
					patchFile(uploadFile.id, {
						status: 'error',
						error: 'Upload cancelled',
						detail: undefined,
					});
				} else {
					patchFile(uploadFile.id, {
						status: 'error',
						error: err instanceof Error ? err.message : 'Upload failed',
						detail: undefined,
					});
				}
			} finally {
				controllers.current.delete(uploadFile.id);
			}
		},
		[patchFile],
	);

	const uploadOne = useCallback(
		async (uploadFile: UploadFile) => {
			const apiBase = getApiBase();
			const token = typeof window !== 'undefined' ? localStorage.getItem('textrawl_token') : null;

			if (isLocalUnconfigured(apiBase)) {
				patchFile(uploadFile.id, {
					status: 'error',
					error: 'No server configured. Go to Settings to set your server URL.',
				});
				return;
			}

			const tagList = tags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);

			const thresholdBytes = UPLOAD_THRESHOLD_MB * 1024 * 1024;
			try {
				if (uploadFile.file.size <= thresholdBytes) {
					await uploadDirect(uploadFile, apiBase, token, tagList);
				} else {
					await uploadResumable(uploadFile);
				}
			} catch (err) {
				patchFile(uploadFile.id, {
					status: 'error',
					error: err instanceof Error ? err.message : 'Upload failed',
					detail: undefined,
				});
			}
		},
		[tags, patchFile, uploadDirect, uploadResumable],
	);

	const handleUploadAll = useCallback(async () => {
		if (isUploading) return;
		setIsUploading(true);
		try {
			const pending = files.filter((f) => f.status === 'pending');
			for (const uploadFile of pending) {
				await uploadOne(uploadFile);
			}
		} finally {
			setIsUploading(false);
		}
	}, [files, isUploading, uploadOne]);

	const retryFile = useCallback(
		(uploadFile: UploadFile) => {
			void uploadOne({ ...uploadFile, status: 'pending', progress: 0, error: undefined });
		},
		[uploadOne],
	);

	const cancelFile = useCallback((uploadFile: UploadFile) => {
		controllers.current.get(uploadFile.id)?.abort();
		if (uploadFile.uploadId) void cancelUpload(uploadFile.uploadId).catch(() => {});
	}, []);

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
					padding: 'var(--drop-zone-padding)',
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
						const inFlight = f.status === 'uploading' || f.status === 'processing';
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
										{f.detail ? ` · ${f.detail}` : ''}
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
								{f.status === 'partial' && (
									<AlertTriangle size={18} style={{ color: '#eab308', flexShrink: 0 }} />
								)}
								{f.status === 'error' && (
									<>
										<AlertCircle size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
										<button
											type="button"
											onClick={() => retryFile(f)}
											style={{
												background: 'none',
												border: '1px solid var(--border-default)',
												borderRadius: '0.375rem',
												cursor: 'pointer',
												color: 'var(--text-primary)',
												fontSize: '0.75rem',
												padding: '0.25rem 0.5rem',
											}}
										>
											Retry
										</button>
									</>
								)}
								{inFlight && (
									<div
										style={{
											width: 60,
											height: 4,
											backgroundColor: 'var(--bg-tertiary)',
											borderRadius: 2,
											overflow: 'hidden',
											flexShrink: 0,
										}}
									>
										<div
											style={{
												width: f.progress < 0 ? '100%' : `${f.progress}%`,
												height: '100%',
												backgroundColor: 'var(--text-accent)',
												borderRadius: 2,
												opacity: f.progress < 0 ? 0.5 : 1,
												transition: 'width 0.3s',
											}}
										/>
									</div>
								)}
								{inFlight && (
									<button
										type="button"
										aria-label={`Cancel ${f.file.name}`}
										onClick={() => cancelFile(f)}
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
							? 'Uploading…'
							: `Upload ${pendingCount} file${pendingCount !== 1 ? 's' : ''}`}
					</button>
				);
			})()}
		</div>
	);
}
