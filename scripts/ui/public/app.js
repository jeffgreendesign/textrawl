/**
 * Textrawl Converter UI - Client-side JavaScript
 *
 * Handles drag-drop, file upload, SSE streaming, and expandable log entries
 */

console.log('[APP] Script loaded');

// Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const outputDir = document.getElementById('outputDir');
const tagsInput = document.getElementById('tags');
const autoUpload = document.getElementById('autoUpload');
const progressSection = document.getElementById('progressSection');
const progressStatus = document.getElementById('progressStatus');
const progressPercent = document.getElementById('progressPercent');
const progressFill = document.getElementById('progressFill');
const uploadButtonContainer = document.getElementById('uploadButtonContainer');
const uploadButton = document.getElementById('uploadButton');
const logSection = document.getElementById('logSection');
const logContainer = document.getElementById('logContainer');
const clearLogs = document.getElementById('clearLogs');

// Preview section elements
const previewSection = document.getElementById('previewSection');
const previewFilename = document.getElementById('previewFilename');
const previewFileSize = document.getElementById('previewFileSize');
const previewEmailCount = document.getElementById('previewEmailCount');
const previewEstimatedFiles = document.getElementById('previewEstimatedFiles');
const previewEstimatedSize = document.getElementById('previewEstimatedSize');
const previewDateRange = document.getElementById('previewDateRange');
const startConversionBtn = document.getElementById('startConversion');
const cancelConversionBtn = document.getElementById('cancelConversion');

// State
let currentJobId = null;
let eventSource = null;
let logEntries = [];
let lastOutputDir = null;
let pendingFile = null;

// Drag and drop handlers
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
	e.preventDefault();
	dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
	dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
	e.preventDefault();
	dropzone.classList.remove('dragover');

	const files = e.dataTransfer.files;
	if (files.length > 0) {
		handleFile(files[0]);
	}
});

fileInput.addEventListener('change', () => {
	if (fileInput.files.length > 0) {
		handleFile(fileInput.files[0]);
	}
});

// Clear logs button
clearLogs.addEventListener('click', () => {
	logEntries = [];
	logContainer.innerHTML = '';
});

// Upload button handler
uploadButton.addEventListener('click', handleUpload);

// Preview action handlers
startConversionBtn.addEventListener('click', () => {
	if (pendingFile) {
		previewSection.classList.add('hidden');
		startConversion(pendingFile);
		pendingFile = null;
	}
});

cancelConversionBtn.addEventListener('click', () => {
	previewSection.classList.add('hidden');
	pendingFile = null;
});

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Handle file selection - analyze first for mbox, then proceed
 */
async function handleFile(file) {
	console.log('[APP] handleFile called with:', file.name);

	// Validate file type
	const validTypes = ['.mbox', '.eml', '.zip', '.html', '.htm', '.pdf', '.docx', '.txt', '.md'];
	const ext = `.${file.name.split('.').pop().toLowerCase()}`;

	if (!validTypes.includes(ext)) {
		alert(`Unsupported file type: ${ext}\n\nSupported: ${validTypes.join(', ')}`);
		return;
	}

	// For mbox and zip files, analyze first to show preview
	if (ext === '.mbox' || ext === '.zip') {
		await analyzeFile(file);
		return;
	}

	// For other files, proceed directly to conversion
	startConversion(file);
}

/**
 * Analyze mbox file and show preview
 */
async function analyzeFile(file) {
	console.log('[APP] Analyzing file:', file.name);
	pendingFile = file;

	// Show analyzing state in dropzone
	dropzone.classList.add('analyzing');
	const originalText = dropzone.querySelector('.dropzone-text strong').textContent;
	dropzone.querySelector('.dropzone-text strong').textContent = 'Analyzing...';

	const formData = new FormData();
	formData.append('file', file);

	try {
		const response = await fetch('/api/analyze', {
			method: 'POST',
			body: formData,
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Analysis failed');
		}

		const analysis = await response.json();
		console.log('[APP] Analysis result:', analysis);
		showPreview(analysis);
	} catch (error) {
		console.error('[APP] Analysis error:', error);
		alert(`Failed to analyze file: ${error.message}`);
		pendingFile = null;
	} finally {
		dropzone.classList.remove('analyzing');
		dropzone.querySelector('.dropzone-text strong').textContent = originalText;
	}
}

/**
 * Get item label based on format
 */
function getItemLabel(format) {
	const labels = {
		mbox: 'emails',
		spotify: 'tracks',
		reddit: 'posts/comments',
		facebook: 'messages',
		instagram: 'messages',
		takeout: 'items',
	};
	return labels[format] || 'items';
}

/**
 * Show preview with analysis results
 */
function showPreview(analysis) {
	previewFilename.textContent = analysis.filename;
	previewFileSize.textContent = formatBytes(analysis.fileSizeBytes);

	// Update labels and values based on format
	const itemLabel = getItemLabel(analysis.format);
	const itemLabelEl = document.querySelector('#previewEmailCount + .stat-label');
	if (itemLabelEl) {
		itemLabelEl.textContent = itemLabel;
	}

	// Show total items (emailCount for mbox, totalItems for others)
	const totalItems = analysis.emailCount ?? analysis.totalItems ?? 0;
	previewEmailCount.textContent = totalItems.toLocaleString();
	previewEstimatedFiles.textContent = (analysis.estimatedOutputFiles ?? 0).toLocaleString();
	previewEstimatedSize.textContent = formatBytes(analysis.estimatedOutputSizeBytes ?? 0);

	// Show date range if available
	if (analysis.dateRange) {
		const oldest = new Date(analysis.dateRange.oldest).toLocaleDateString();
		const newest = new Date(analysis.dateRange.newest).toLocaleDateString();
		previewDateRange.textContent = `${oldest} — ${newest}`;
		previewDateRange.classList.remove('hidden');
	} else {
		previewDateRange.classList.add('hidden');
	}

	// Show breakdown if available (for multi-type exports like Spotify, Facebook)
	const breakdownEl = document.getElementById('previewBreakdown');
	if (breakdownEl) {
		if (analysis.breakdown && Object.keys(analysis.breakdown).length > 0) {
			const items = Object.entries(analysis.breakdown)
				.map(([key, value]) => `${key}: ${value.toLocaleString()}`)
				.join(' | ');
			breakdownEl.textContent = items;
			breakdownEl.classList.remove('hidden');
		} else {
			breakdownEl.classList.add('hidden');
		}
	}

	previewSection.classList.remove('hidden');
}

/**
 * Start conversion (upload and convert)
 */
async function startConversion(file) {
	console.log('[APP] Starting conversion for:', file.name);

	// Show progress section
	progressSection.classList.remove('hidden');
	logSection.classList.remove('hidden');

	// Reset progress
	updateProgress(0, 'Uploading...');
	progressFill.classList.remove('complete', 'error');
	uploadButtonContainer.classList.add('hidden');

	// Prepare form data
	const formData = new FormData();
	formData.append('file', file);
	formData.append('output', outputDir.value || './converted');
	formData.append('tags', tagsInput.value || '');
	formData.append('autoUpload', autoUpload.checked.toString());

	console.log('[APP] Uploading to /api/convert...');

	try {
		// Upload file
		const response = await fetch('/api/convert', {
			method: 'POST',
			body: formData,
		});

		console.log('[APP] Response status:', response.status);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Upload failed');
		}

		const { jobId, format, filename, outputDir: outDir } = await response.json();
		console.log('[APP] Got jobId:', jobId);
		currentJobId = jobId;
		lastOutputDir = outDir;

		// Add initial log entry
		addLogEntry({
			id: `file-${jobId}`,
			icon: 'processing',
			message: `Converting ${filename} (${format.toUpperCase()})`,
			details: `Output: ${outDir}\nJob ID: ${jobId}`,
		});

		// Connect to SSE for updates
		console.log('[APP] Calling connectSSE...');
		connectSSE(jobId);
	} catch (error) {
		updateProgress(0, `Error: ${error.message}`, true);
		addLogEntry({
			id: 'error',
			icon: 'error',
			message: `Upload failed: ${error.message}`,
		});
	}
}

/**
 * Connect to SSE for real-time updates
 */
function connectSSE(jobId) {
	// Close existing connection
	if (eventSource) {
		eventSource.close();
	}

	console.log('[SSE] Connecting to:', `/api/events/${jobId}`);
	eventSource = new EventSource(`/api/events/${jobId}`);

	eventSource.onopen = () => {
		console.log('[SSE] Connection opened');
	};

	eventSource.onmessage = (event) => {
		console.log('[SSE] Message received:', event.data);
		const data = JSON.parse(event.data);

		switch (data.type) {
			case 'log':
				addLogEntry({
					id: `log-${Date.now()}`,
					icon: 'processing',
					message: data.message,
				});
				break;

			case 'progress':
				updateProgress(data.value, 'Processing...');
				break;

			case 'complete':
				updateProgress(100, 'Complete!');
				progressFill.classList.add('complete');
				updateLogIcon(`file-${jobId}`, 'complete');
				addLogEntry({
					id: 'complete',
					icon: 'complete',
					message: data.message || 'Conversion complete!',
				});
				// Show upload button if auto-upload is not enabled
				if (!autoUpload.checked) {
					uploadButtonContainer.classList.remove('hidden');
				}
				break;

			case 'error':
				updateProgress(progressFill.style.width || 0, 'Error');
				progressFill.classList.add('error');
				updateLogIcon(`file-${jobId}`, 'error');
				addLogEntry({
					id: 'error',
					icon: 'error',
					message: data.message || 'Conversion failed',
				});
				break;

			case 'upload_complete':
				addLogEntry({
					id: 'upload-complete',
					icon: 'complete',
					message: data.message || 'Upload complete!',
				});
				// Hide upload button after successful upload
				uploadButtonContainer.classList.add('hidden');
				uploadButton.disabled = false;
				uploadButton.querySelector('.btn-icon').textContent = '⬆';
				break;

			case 'upload_error':
				addLogEntry({
					id: 'upload-error',
					icon: 'error',
					message: data.message || 'Upload failed',
				});
				// Re-enable button on error
				uploadButton.disabled = false;
				uploadButton.querySelector('.btn-icon').textContent = '⬆';
				break;
		}
	};

	eventSource.onerror = (error) => {
		console.log('[SSE] Error or connection closed:', error);
		// Connection closed, probably conversion complete
		eventSource.close();
	};
}

/**
 * Update progress bar
 */
function updateProgress(percent, status, isError = false) {
	progressPercent.textContent = `${Math.round(percent)}%`;
	progressStatus.textContent = status;
	progressFill.style.width = `${percent}%`;

	if (isError) {
		progressFill.classList.add('error');
	}
}

/**
 * Add a log entry
 */
function addLogEntry({ id, icon, message, details }) {
	// Create entry element
	const entry = document.createElement('div');
	entry.className = 'log-entry';
	entry.dataset.id = id;

	entry.innerHTML = `
    <span class="log-icon ${icon}">${getIconChar(icon)}</span>
    <div class="log-content">
      <div class="log-summary">
        <span class="log-message">${escapeHtml(message)}</span>
        ${details ? '<span class="log-toggle"></span>' : ''}
      </div>
      ${details ? `<div class="log-details">${escapeHtml(details)}</div>` : ''}
    </div>
  `;

	// Add click handler for expansion
	if (details) {
		entry.addEventListener('click', () => {
			entry.classList.toggle('expanded');
		});
	}

	// Add to container and scroll to bottom
	logContainer.appendChild(entry);
	logContainer.scrollTop = logContainer.scrollHeight;

	// Store in array
	logEntries.push({ id, icon, message, details });
}

/**
 * Update log entry icon
 */
function updateLogIcon(id, icon) {
	const entry = logContainer.querySelector(`[data-id="${id}"]`);
	if (entry) {
		const iconEl = entry.querySelector('.log-icon');
		iconEl.className = `log-icon ${icon}`;
		iconEl.textContent = getIconChar(icon);
	}
}

/**
 * Get icon character for status
 */
function getIconChar(icon) {
	switch (icon) {
		case 'pending':
			return '◌';
		case 'processing':
			return '⚙';
		case 'complete':
			return '✓';
		case 'error':
			return '✗';
		default:
			return '•';
	}
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

/**
 * Handle manual upload
 */
async function handleUpload() {
	if (!lastOutputDir) {
		addLogEntry({
			id: 'upload-error',
			icon: 'error',
			message: 'No output directory available',
		});
		return;
	}

	// Disable button during upload
	uploadButton.disabled = true;
	uploadButton.querySelector('.btn-icon').textContent = '⏳';

	addLogEntry({
		id: 'upload-start',
		icon: 'processing',
		message: `Uploading files from ${lastOutputDir}...`,
	});

	try {
		const response = await fetch('/api/upload', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				directory: lastOutputDir,
				tags: tagsInput.value ? tagsInput.value.split(',').map((t) => t.trim()) : [],
			}),
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Upload failed');
		}

		const { jobId } = await response.json();

		// Connect to SSE for upload updates
		connectSSE(jobId);
	} catch (error) {
		addLogEntry({
			id: 'upload-error',
			icon: 'error',
			message: `Upload failed: ${error.message}`,
		});
		uploadButton.disabled = false;
		uploadButton.querySelector('.btn-icon').textContent = '⬆';
	}
}
