import type { ToolName } from './schemas';

interface CodeGeneratorProps {
  tool: ToolName;
  parameters: Record<string, unknown>;
  serverUrl: string;
}

export function CodeGenerator({ tool, parameters, serverUrl }: CodeGeneratorProps) {
  // Filter out empty values
  const filteredParams = Object.fromEntries(
    Object.entries(parameters).filter(([, v]) => v !== undefined && v !== '')
  );

  const tsCode = `import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const client = new Client({ name: 'my-app', version: '1.0.0' });

await client.connect(new StreamableHTTPClientTransport('${serverUrl}/mcp'));

const result = await client.callTool({
  name: '${tool}',
  arguments: ${JSON.stringify(filteredParams, null, 2)}
});

console.log(result.content);`;

  const curlCode = `curl -X POST ${serverUrl}/mcp \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: filteredParams },
  })}'`;

  return (
    <div className="code-generator">
      <details>
        <summary>Generated Code</summary>

        <div className="code-section">
          <h4>TypeScript (MCP SDK)</h4>
          <pre><code>{tsCode}</code></pre>
        </div>

        <div className="code-section">
          <h4>cURL</h4>
          <pre><code>{curlCode}</code></pre>
        </div>
      </details>

      <style>{`
        .code-generator {
          margin-top: 1rem;
        }

        .code-generator details {
          border: 1px solid var(--sl-color-hairline);
          border-radius: 8px;
          padding: 0.75rem;
        }

        .code-generator summary {
          cursor: pointer;
          font-weight: 500;
          color: var(--sl-color-text);
        }

        .code-section {
          margin-top: 1rem;
        }

        .code-section h4 {
          margin: 0 0 0.5rem 0;
          font-size: 0.9rem;
          color: var(--sl-color-text-accent);
        }

        .code-section pre {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid var(--sl-color-hairline);
          border-radius: 6px;
          padding: 0.75rem;
          overflow-x: auto;
          font-size: 0.8rem;
        }

        .code-section code {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          color: var(--sl-color-text);
          white-space: pre;
        }
      `}</style>
    </div>
  );
}
