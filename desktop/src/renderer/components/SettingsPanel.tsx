interface SettingsPanelProps {
  outputDir: string;
  tags: string;
  onOutputDirChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onSelectFolder: () => void;
}

export function SettingsPanel({
  outputDir,
  tags,
  onOutputDirChange,
  onTagsChange,
  onSelectFolder,
}: SettingsPanelProps) {
  return (
    <div class="settings-panel">
      <div class="setting-row">
        <label>Output folder</label>
        <input
          type="text"
          value={outputDir}
          placeholder="/path/to/output"
          onInput={(e) => onOutputDirChange((e.target as HTMLInputElement).value)}
        />
        <button class="btn-small" onClick={onSelectFolder}>
          Browse
        </button>
      </div>
      <div class="setting-row">
        <label>Tags</label>
        <input
          type="text"
          value={tags}
          placeholder="tag1, tag2, tag3"
          onInput={(e) => onTagsChange((e.target as HTMLInputElement).value)}
        />
      </div>
    </div>
  );
}
