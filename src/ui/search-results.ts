/**
 * Search Results UI Template for MCP Apps
 *
 * Interactive search results viewer with animations and filtering.
 */

export function getSearchResultsHTML(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1a1a1a;
      background: #fafafa;
      padding: 16px;
      max-height: 400px;
      overflow-y: auto;
    }

    @media (prefers-color-scheme: dark) {
      body {
        background: #1a1a1a;
        color: #e5e5e5;
      }
      .result {
        background: #2a2a2a;
        border-color: #3a3a3a;
      }
      .result:hover {
        border-color: #4a4a4a;
        background: #333;
      }
      .result-title {
        color: #fff;
      }
      .result-meta {
        color: #888;
      }
      .tag {
        background: #3a3a3a;
        color: #aaa;
      }
      .score-bar-bg {
        background: #3a3a3a;
      }
      .header {
        border-color: #3a3a3a;
      }
      .query-text {
        color: #aaa;
      }
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e5e5e5;
    }

    .result-count {
      font-weight: 600;
      font-size: 13px;
    }

    .query-text {
      font-size: 12px;
      color: #666;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .results-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .result {
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      opacity: 0;
      transform: translateY(8px);
      animation: fadeSlideIn 0.3s ease forwards;
    }

    .result:hover {
      border-color: #ccc;
      background: #f9f9f9;
    }

    @keyframes fadeSlideIn {
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .result:nth-child(1) { animation-delay: 0ms; }
    .result:nth-child(2) { animation-delay: 50ms; }
    .result:nth-child(3) { animation-delay: 100ms; }
    .result:nth-child(4) { animation-delay: 150ms; }
    .result:nth-child(5) { animation-delay: 200ms; }
    .result:nth-child(6) { animation-delay: 250ms; }
    .result:nth-child(7) { animation-delay: 300ms; }
    .result:nth-child(8) { animation-delay: 350ms; }
    .result:nth-child(9) { animation-delay: 400ms; }
    .result:nth-child(10) { animation-delay: 450ms; }

    .result-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 6px;
    }

    .result-title {
      font-weight: 600;
      font-size: 14px;
      color: #111;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .score-container {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .score-bar-bg {
      width: 40px;
      height: 4px;
      background: #e5e5e5;
      border-radius: 2px;
      overflow: hidden;
    }

    .score-bar {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #34d399);
      border-radius: 2px;
      width: 0%;
      animation: fillBar 0.6s ease forwards;
    }

    @keyframes fillBar {
      to {
        width: var(--score-width);
      }
    }

    .score-text {
      font-size: 11px;
      font-weight: 500;
      color: #10b981;
      min-width: 32px;
      text-align: right;
    }

    .result-content {
      font-size: 13px;
      color: #555;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .result-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: #888;
    }

    .source-type {
      text-transform: uppercase;
      font-weight: 500;
      letter-spacing: 0.5px;
    }

    .tags {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .tag {
      background: #f0f0f0;
      color: #666;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
    }

    .empty-state {
      text-align: center;
      padding: 32px;
      color: #888;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 32px;
    }

    .loading-dot {
      width: 6px;
      height: 6px;
      background: #888;
      border-radius: 50%;
      animation: pulse 1.4s ease-in-out infinite;
    }

    .loading-dot:nth-child(1) { animation-delay: 0ms; }
    .loading-dot:nth-child(2) { animation-delay: 160ms; }
    .loading-dot:nth-child(3) { animation-delay: 320ms; }

    @keyframes pulse {
      0%, 80%, 100% {
        transform: scale(0.6);
        opacity: 0.4;
      }
      40% {
        transform: scale(1);
        opacity: 1;
      }
    }
  </style>
</head>
<body>
  <div id="app">
    <div class="loading">
      <div class="loading-dot"></div>
      <div class="loading-dot"></div>
      <div class="loading-dot"></div>
    </div>
  </div>

  <script type="module">
    const app = document.getElementById('app');

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderResults(data) {
      const { query, totalResults, results } = data;

      if (!results || results.length === 0) {
        app.innerHTML = \`
          <div class="empty-state">
            No results found for "<strong>\${escapeHtml(query)}</strong>"
          </div>
        \`;
        return;
      }

      const resultsHtml = results.map((r, i) => {
        const scorePercent = Math.round((r.score || 0) * 100);
        const tags = (r.tags || []).slice(0, 3);
        const tagsHtml = tags.map(t => \`<span class="tag">\${escapeHtml(t)}</span>\`).join('');

        return \`
          <div class="result" data-id="\${escapeHtml(r.documentId || '')}">
            <div class="result-header">
              <div class="result-title">\${escapeHtml(r.documentTitle || 'Untitled')}</div>
              <div class="score-container">
                <div class="score-bar-bg">
                  <div class="score-bar" style="--score-width: \${scorePercent}%; animation-delay: \${i * 50 + 300}ms"></div>
                </div>
                <span class="score-text">\${scorePercent}%</span>
              </div>
            </div>
            <div class="result-content">\${escapeHtml(r.content || '')}</div>
            <div class="result-meta">
              <span class="source-type">\${escapeHtml(r.sourceType || 'unknown')}</span>
              \${tags.length ? '<span>·</span><div class="tags">' + tagsHtml + '</div>' : ''}
            </div>
          </div>
        \`;
      }).join('');

      app.innerHTML = \`
        <div class="header">
          <span class="result-count">\${totalResults} result\${totalResults === 1 ? '' : 's'}</span>
          <span class="query-text" title="\${escapeHtml(query)}">\${escapeHtml(query)}</span>
        </div>
        <div class="results-list">
          \${resultsHtml}
        </div>
      \`;
    }

    // Listen for tool result from host
    window.addEventListener('message', (event) => {
      try {
        const msg = event.data;
        if (msg && msg.jsonrpc === '2.0') {
          if (msg.method === 'ui/notifications/tool-result' && msg.params) {
            const content = msg.params.content;
            if (content && content[0] && content[0].text) {
              const data = JSON.parse(content[0].text);
              renderResults(data);
            }
          }
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    });

    // Signal ready to host
    window.parent.postMessage({
      jsonrpc: '2.0',
      method: 'ui/ready',
      params: {}
    }, '*');
  </script>
</body>
</html>`;
}
