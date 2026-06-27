import type { EmbeddingProvider } from '../../shared/types.js';

interface SettingsPanelProps {
	outputDir: string;
	tags: string;
	onOutputDirChange: (value: string) => void;
	onTagsChange: (value: string) => void;
	onSelectFolder: () => void;
	// Connection settings — passed through to the upload CLI (Neon + embedding provider).
	databaseUrl: string;
	embeddingProvider: EmbeddingProvider;
	openaiApiKey: string;
	googleApiKey: string;
	ollamaBaseUrl: string;
	onDatabaseUrlChange: (value: string) => void;
	onEmbeddingProviderChange: (value: EmbeddingProvider) => void;
	onOpenaiApiKeyChange: (value: string) => void;
	onGoogleApiKeyChange: (value: string) => void;
	onOllamaBaseUrlChange: (value: string) => void;
	onSaveConnection: () => void;
}

export function SettingsPanel({
	outputDir,
	tags,
	onOutputDirChange,
	onTagsChange,
	onSelectFolder,
	databaseUrl,
	embeddingProvider,
	openaiApiKey,
	googleApiKey,
	ollamaBaseUrl,
	onDatabaseUrlChange,
	onEmbeddingProviderChange,
	onOpenaiApiKeyChange,
	onGoogleApiKeyChange,
	onOllamaBaseUrlChange,
	onSaveConnection,
}: SettingsPanelProps) {
	return (
		<div class="settings-panel">
			<div class="setting-row">
				<label htmlFor="output-folder">Output folder</label>
				<input
					id="output-folder"
					type="text"
					value={outputDir}
					placeholder="/path/to/output"
					onInput={(e) => onOutputDirChange((e.target as HTMLInputElement).value)}
				/>
				<button type="button" class="btn-small" onClick={onSelectFolder}>
					Browse
				</button>
			</div>
			<div class="setting-row">
				<label htmlFor="tags-input">Tags</label>
				<input
					id="tags-input"
					type="text"
					value={tags}
					placeholder="tag1, tag2, tag3"
					onInput={(e) => onTagsChange((e.target as HTMLInputElement).value)}
				/>
			</div>

			<div class="setting-section">Connection</div>
			<div class="setting-row">
				<label htmlFor="database-url">Database URL</label>
				<input
					id="database-url"
					type="password"
					value={databaseUrl}
					placeholder="postgresql://…@…neon.tech/…"
					onInput={(e) => onDatabaseUrlChange((e.target as HTMLInputElement).value)}
				/>
			</div>
			<div class="setting-row">
				<label htmlFor="embedding-provider">Embedding provider</label>
				<select
					id="embedding-provider"
					value={embeddingProvider}
					onChange={(e) =>
						onEmbeddingProviderChange((e.target as HTMLSelectElement).value as EmbeddingProvider)
					}
				>
					<option value="openai">OpenAI (1536d)</option>
					<option value="google">Google AI (3072d)</option>
					<option value="ollama">Ollama (1024d/768d)</option>
				</select>
			</div>
			{embeddingProvider === 'openai' && (
				<div class="setting-row">
					<label htmlFor="openai-key">OpenAI API key</label>
					<input
						id="openai-key"
						type="password"
						value={openaiApiKey}
						placeholder="sk-…"
						onInput={(e) => onOpenaiApiKeyChange((e.target as HTMLInputElement).value)}
					/>
				</div>
			)}
			{embeddingProvider === 'google' && (
				<div class="setting-row">
					<label htmlFor="google-key">Google AI API key</label>
					<input
						id="google-key"
						type="password"
						value={googleApiKey}
						placeholder="AIza…"
						onInput={(e) => onGoogleApiKeyChange((e.target as HTMLInputElement).value)}
					/>
				</div>
			)}
			{embeddingProvider === 'ollama' && (
				<div class="setting-row">
					<label htmlFor="ollama-url">Ollama base URL</label>
					<input
						id="ollama-url"
						type="text"
						value={ollamaBaseUrl}
						placeholder="http://localhost:11434"
						onInput={(e) => onOllamaBaseUrlChange((e.target as HTMLInputElement).value)}
					/>
				</div>
			)}
			<div class="setting-row">
				<button type="button" class="btn-small" onClick={onSaveConnection}>
					Save connection
				</button>
			</div>
		</div>
	);
}
