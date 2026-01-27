/**
 * Knowledge Stats UI Template for MCP Apps
 *
 * Dashboard showing knowledge base statistics with animated visualizations.
 */

export function getKnowledgeStatsHTML(): string {
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
      max-height: 350px;
      overflow-y: auto;
    }

    @media (prefers-color-scheme: dark) {
      body {
        background: #1a1a1a;
        color: #e5e5e5;
      }
      .stat-card {
        background: #2a2a2a;
        border-color: #3a3a3a;
      }
      .stat-label {
        color: #888;
      }
      .breakdown-item {
        background: #333;
      }
      .breakdown-label {
        color: #aaa;
      }
      .section-title {
        color: #888;
      }
    }

    .dashboard {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .stat-card {
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 10px;
      padding: 16px;
      text-align: center;
      opacity: 0;
      transform: scale(0.95);
      animation: popIn 0.4s ease forwards;
    }

    .stat-card:nth-child(1) { animation-delay: 0ms; }
    .stat-card:nth-child(2) { animation-delay: 100ms; }
    .stat-card:nth-child(3) { animation-delay: 200ms; }

    @keyframes popIn {
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    .stat-value {
      font-size: 28px;
      font-weight: 700;
      color: #10b981;
      margin-bottom: 4px;
    }

    .stat-value span {
      display: inline-block;
      animation: countUp 0.6s ease-out forwards;
    }

    @keyframes countUp {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .stat-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }

    .section-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .breakdown-section {
      opacity: 0;
      animation: fadeIn 0.4s ease forwards;
      animation-delay: 300ms;
    }

    @keyframes fadeIn {
      to { opacity: 1; }
    }

    .breakdown-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .breakdown-item {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #f5f5f5;
      padding: 8px 12px;
      border-radius: 6px;
    }

    .breakdown-bar-container {
      flex: 1;
      height: 6px;
      background: #e0e0e0;
      border-radius: 3px;
      overflow: hidden;
    }

    .breakdown-bar {
      height: 100%;
      border-radius: 3px;
      width: 0%;
      animation: growBar 0.8s ease forwards;
    }

    .breakdown-bar.notes { background: linear-gradient(90deg, #3b82f6, #60a5fa); }
    .breakdown-bar.files { background: linear-gradient(90deg, #8b5cf6, #a78bfa); }
    .breakdown-bar.urls { background: linear-gradient(90deg, #f59e0b, #fbbf24); }

    @keyframes growBar {
      to {
        width: var(--bar-width);
      }
    }

    .breakdown-label {
      font-size: 12px;
      color: #555;
      min-width: 50px;
    }

    .breakdown-value {
      font-size: 12px;
      font-weight: 600;
      min-width: 40px;
      text-align: right;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 48px;
    }

    .loading-dot {
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      animation: bounce 1.4s ease-in-out infinite;
    }

    .loading-dot:nth-child(1) { animation-delay: 0ms; }
    .loading-dot:nth-child(2) { animation-delay: 160ms; }
    .loading-dot:nth-child(3) { animation-delay: 320ms; }

    @keyframes bounce {
      0%, 80%, 100% {
        transform: translateY(0);
      }
      40% {
        transform: translateY(-12px);
      }
    }

    .tags-section {
      opacity: 0;
      animation: fadeIn 0.4s ease forwards;
      animation-delay: 500ms;
    }

    .tags-cloud {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .tag-item {
      background: linear-gradient(135deg, #10b981, #34d399);
      color: white;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      opacity: 0;
      animation: tagPop 0.3s ease forwards;
    }

    .tag-item:nth-child(1) { animation-delay: 550ms; }
    .tag-item:nth-child(2) { animation-delay: 600ms; }
    .tag-item:nth-child(3) { animation-delay: 650ms; }
    .tag-item:nth-child(4) { animation-delay: 700ms; }
    .tag-item:nth-child(5) { animation-delay: 750ms; }

    @keyframes tagPop {
      0% {
        opacity: 0;
        transform: scale(0.8);
      }
      50% {
        transform: scale(1.1);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }

    .error-state {
      text-align: center;
      padding: 32px;
      color: #ef4444;
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

    function formatNumber(num) {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
      return num.toString();
    }

    function renderStats(data) {
      if (data.error) {
        app.innerHTML = \`<div class="error-state">\${escapeHtml(data.message || data.error)}</div>\`;
        return;
      }

      const totalDocs = data.totalDocuments || 0;
      const totalChunks = data.totalChunks || 0;
      const totalTags = data.totalUniqueTags || 0;

      const byType = data.documentsBySourceType || {};
      const notes = byType.note || 0;
      const files = byType.file || 0;
      const urls = byType.url || 0;
      const maxType = Math.max(notes, files, urls, 1);

      const topTags = (data.topTags || []).slice(0, 5);

      app.innerHTML = \`
        <div class="dashboard">
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value"><span>\${formatNumber(totalDocs)}</span></div>
              <div class="stat-label">Documents</div>
            </div>
            <div class="stat-card">
              <div class="stat-value"><span>\${formatNumber(totalChunks)}</span></div>
              <div class="stat-label">Chunks</div>
            </div>
            <div class="stat-card">
              <div class="stat-value"><span>\${formatNumber(totalTags)}</span></div>
              <div class="stat-label">Tags</div>
            </div>
          </div>

          <div class="breakdown-section">
            <div class="section-title">By Source Type</div>
            <div class="breakdown-list">
              <div class="breakdown-item">
                <span class="breakdown-label">Notes</span>
                <div class="breakdown-bar-container">
                  <div class="breakdown-bar notes" style="--bar-width: \${(notes / maxType) * 100}%; animation-delay: 400ms"></div>
                </div>
                <span class="breakdown-value">\${notes}</span>
              </div>
              <div class="breakdown-item">
                <span class="breakdown-label">Files</span>
                <div class="breakdown-bar-container">
                  <div class="breakdown-bar files" style="--bar-width: \${(files / maxType) * 100}%; animation-delay: 500ms"></div>
                </div>
                <span class="breakdown-value">\${files}</span>
              </div>
              <div class="breakdown-item">
                <span class="breakdown-label">URLs</span>
                <div class="breakdown-bar-container">
                  <div class="breakdown-bar urls" style="--bar-width: \${(urls / maxType) * 100}%; animation-delay: 600ms"></div>
                </div>
                <span class="breakdown-value">\${urls}</span>
              </div>
            </div>
          </div>

          \${topTags.length > 0 ? \`
            <div class="tags-section">
              <div class="section-title">Top Tags</div>
              <div class="tags-cloud">
                \${topTags.map(t => \`<span class="tag-item">\${escapeHtml(t.tag)} (\${t.count})</span>\`).join('')}
              </div>
            </div>
          \` : ''}
        </div>
      \`;
    }

    // Listen for tool result from host
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      try {
        const msg = event.data;
        if (msg && msg.jsonrpc === '2.0') {
          if (msg.method === 'ui/notifications/tool-result' && msg.params) {
            const content = msg.params.content;
            if (content && content[0] && content[0].text) {
              const data = JSON.parse(content[0].text);
              renderStats(data);
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
