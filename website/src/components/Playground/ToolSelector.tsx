import type { ToolName } from './schemas';
import { TOOL_SCHEMAS } from './schemas';

interface ToolSelectorProps {
  tools: ToolName[];
  selected: ToolName;
  onSelect: (tool: ToolName) => void;
}

export function ToolSelector({ tools, selected, onSelect }: ToolSelectorProps) {
  return (
    <div className="tool-selector">
      <label>Select Tool</label>
      <div className="tool-list">
        {tools.map((tool) => (
          <button
            key={tool}
            className={`tool-item ${selected === tool ? 'active' : ''}`}
            onClick={() => onSelect(tool)}
          >
            <span className="tool-name">{tool}</span>
            <span className="tool-desc">{TOOL_SCHEMAS[tool].description}</span>
          </button>
        ))}
      </div>

      <style>{`
        .tool-selector {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .tool-selector label {
          font-weight: 500;
          color: var(--sl-color-text);
        }

        .tool-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .tool-item {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 0.75rem;
          border: 1px solid var(--sl-color-hairline);
          border-radius: 6px;
          background: transparent;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
        }

        .tool-item:hover {
          background: rgba(99, 102, 241, 0.1);
        }

        .tool-item.active {
          background: rgba(99, 102, 241, 0.2);
          border-color: var(--sl-color-accent);
        }

        .tool-name {
          font-family: monospace;
          font-weight: 600;
          color: var(--sl-color-text-accent);
        }

        .tool-desc {
          font-size: 0.85rem;
          color: var(--sl-color-text);
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}
