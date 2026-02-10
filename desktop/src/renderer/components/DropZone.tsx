import { useCallback, useState } from 'preact/hooks';

interface DropZoneProps {
	onDrop: (paths: string[]) => void;
	isScanning?: boolean;
}

export function DropZone({ onDrop, isScanning = false }: DropZoneProps) {
	const [isDragOver, setIsDragOver] = useState(false);

	const handleClick = useCallback(async () => {
		if (isScanning) return;
		const paths = await window.electronAPI.selectFiles();
		if (paths.length > 0) {
			onDrop(paths);
		}
	}, [onDrop, isScanning]);

	const handleDragOver = useCallback((e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragOver(true);
	}, []);

	const handleDragLeave = useCallback((e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragOver(false);
	}, []);

	const handleDrop = useCallback(
		(e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragOver(false);

			const files = e.dataTransfer?.files;
			if (!files || files.length === 0) return;

			// Extract file paths using webUtils.getPathForFile (Electron 32+)
			const paths: string[] = [];
			for (let i = 0; i < files.length; i++) {
				const filePath = window.electronAPI.getPathForFile(files[i]);
				if (filePath) {
					paths.push(filePath);
				}
			}

			if (paths.length > 0) {
				onDrop(paths);
			}
		},
		[onDrop],
	);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				handleClick();
			}
		},
		[handleClick],
	);

	return (
		<div
			class={`dropzone ${isDragOver ? 'dragover' : ''} ${isScanning ? 'scanning' : ''}`}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			role="button"
			tabIndex={0}
		>
			{isScanning ? (
				<>
					<div class="dropzone-icon">⏳</div>
					<div class="dropzone-text">
						<strong>Scanning files...</strong>
						<span>Please wait while we analyze your files</span>
					</div>
				</>
			) : (
				<>
					<div class="dropzone-icon">📁</div>
					<div class="dropzone-text">
						<strong>Drop files or folders here, or click to browse</strong>
						<span>Supports MBOX, EML, HTML, PDF, DOCX, Excel, PowerPoint, and more</span>
					</div>
				</>
			)}
		</div>
	);
}
