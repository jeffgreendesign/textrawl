import { useState } from 'react';
import { ToolSelector } from './ToolSelector';
import { ParameterForm } from './ParameterForm';
import { ResponseViewer } from './ResponseViewer';
import { CodeGenerator } from './CodeGenerator';
import { TOOL_SCHEMAS, DEMO_RESPONSES, type ToolName } from './schemas';

export default function PlaygroundWrapper() {
  const [selectedTool, setSelectedTool] = useState<ToolName>('search_knowledge');
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [response, setResponse] = useState<unknown | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');

  const handleExecute = async () => {
    setIsLoading(true);

    if (mode === 'demo') {
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 500));
      setResponse(DEMO_RESPONSES[selectedTool]);
    } else {
      try {
        const res = await fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: selectedTool, arguments: parameters },
          }),
        });
        const data = await res.json();
        setResponse(data);
      } catch (error) {
        setResponse({ error: 'Connection failed', message: String(error) });
      }
    }

    setIsLoading(false);
  };

  return (
    <div className="playground-container">
      <div className="playground-header">
        <div className="mode-toggle">
          <button
            className={`mode-btn ${mode === 'demo' ? 'active' : ''}`}
            onClick={() => setMode('demo')}
          >
            Demo Mode
          </button>
          <button
            className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
            onClick={() => setMode('live')}
          >
            Live Mode
          </button>
        </div>

        {mode === 'live' && (
          <div className="server-config">
            <label>Server URL:</label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:3000"
            />
          </div>
        )}
      </div>

      <div className="playground-main">
        <div className="playground-left">
          <ToolSelector
            tools={Object.keys(TOOL_SCHEMAS) as ToolName[]}
            selected={selectedTool}
            onSelect={(tool) => {
              setSelectedTool(tool);
              setParameters({});
              setResponse(null);
            }}
          />

          <ParameterForm
            schema={TOOL_SCHEMAS[selectedTool]}
            values={parameters}
            onChange={setParameters}
          />

          <button
            className="execute-btn"
            onClick={handleExecute}
            disabled={isLoading}
          >
            {isLoading ? 'Executing...' : 'Execute'}
          </button>
        </div>

        <div className="playground-right">
          <div className="tabs">
            <span className="tab active">Response</span>
            <span className="tab">Code</span>
          </div>

          {response ? (
            <ResponseViewer data={response} />
          ) : (
            <div className="empty-response">
              <p>Execute a tool to see the response</p>
            </div>
          )}

          <CodeGenerator
            tool={selectedTool}
            parameters={parameters}
            serverUrl={serverUrl}
          />
        </div>
      </div>

      <style>{`
        .playground-container {
          background: var(--sl-color-bg-sidebar, #0f0f17);
          border: 1px solid var(--sl-color-hairline, rgba(99, 102, 241, 0.2));
          border-radius: 12px;
          padding: 1.5rem;
          min-height: 600px;
        }

        .playground-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid var(--sl-color-hairline);
        }

        .mode-toggle {
          display: flex;
          gap: 0.5rem;
        }

        .mode-btn {
          padding: 0.5rem 1rem;
          border: 1px solid var(--sl-color-hairline);
          border-radius: 6px;
          background: transparent;
          color: var(--sl-color-text);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .mode-btn:hover {
          background: rgba(99, 102, 241, 0.1);
        }

        .mode-btn.active {
          background: rgba(99, 102, 241, 0.2);
          border-color: var(--sl-color-accent);
          color: var(--sl-color-text-accent);
        }

        .server-config {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .server-config input {
          padding: 0.5rem;
          border: 1px solid var(--sl-color-hairline);
          border-radius: 4px;
          background: var(--sl-color-bg);
          color: var(--sl-color-text);
          width: 250px;
        }

        .playground-main {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
        }

        @media (max-width: 900px) {
          .playground-main {
            grid-template-columns: 1fr;
          }
        }

        .playground-left,
        .playground-right {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .execute-btn {
          padding: 0.75rem 1.5rem;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 500;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .execute-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(99, 102, 241, 0.4);
        }

        .execute-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .tabs {
          display: flex;
          gap: 1rem;
          border-bottom: 1px solid var(--sl-color-hairline);
          padding-bottom: 0.5rem;
        }

        .tab {
          padding: 0.5rem;
          cursor: pointer;
          opacity: 0.6;
        }

        .tab.active {
          opacity: 1;
          border-bottom: 2px solid var(--sl-color-accent);
        }

        .empty-response {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 200px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
          color: var(--sl-color-text);
          opacity: 0.6;
        }
      `}</style>
    </div>
  );
}
