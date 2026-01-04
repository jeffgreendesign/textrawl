interface ResponseViewerProps {
  data: unknown;
}

export function ResponseViewer({ data }: ResponseViewerProps) {
  const json = JSON.stringify(data, null, 2);

  return (
    <div className="response-viewer">
      <div className="response-header">
        <span>Response</span>
        <button
          className="copy-btn"
          onClick={() => navigator.clipboard.writeText(json)}
        >
          Copy
        </button>
      </div>
      <pre className="response-content">
        <code>{json}</code>
      </pre>

      <style>{`
        .response-viewer {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .response-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .response-header span {
          font-weight: 500;
          color: var(--sl-color-text);
        }

        .copy-btn {
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--sl-color-hairline);
          border-radius: 4px;
          background: transparent;
          color: var(--sl-color-text);
          cursor: pointer;
          font-size: 0.8rem;
        }

        .copy-btn:hover {
          background: rgba(99, 102, 241, 0.1);
        }

        .response-content {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid var(--sl-color-hairline);
          border-radius: 8px;
          padding: 1rem;
          overflow-x: auto;
          max-height: 400px;
          overflow-y: auto;
        }

        .response-content code {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 0.85rem;
          color: var(--sl-color-text);
          white-space: pre;
        }
      `}</style>
    </div>
  );
}
