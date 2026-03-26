/**
 * AppletSandbox — renders applet code in a sandboxed iframe with postMessage bridge.
 */
'use client';

import { useCallback, useEffect, useRef } from 'react';

interface AppletSandboxProps {
	code: string;
	title?: string;
	style?: React.CSSProperties;
}

const BRIDGE_SCRIPT = `
<script>
window.textrawl = {
  _call: function(method, args) {
    return new Promise(function(resolve, reject) {
      var id = Math.random().toString(36).slice(2);
      function handler(e) {
        if (e.data && e.data.id === id) {
          window.removeEventListener('message', handler);
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.result);
        }
      }
      window.addEventListener('message', handler);
      parent.postMessage({ type: 'textrawl_api', method: method, args: args || [], id: id }, '*');
      setTimeout(function() { window.removeEventListener('message', handler); reject(new Error('Timeout')); }, 10000);
    });
  },
  search: function(q) { return this._call('search', [q]); },
  documents: function(opts) { return this._call('documents', [opts]); },
  memory: function(opts) { return this._call('memory', [opts]); },
  stats: function() { return this._call('stats', []); },
};
</script>
`;

const SANDBOX_STYLES = `
<style>
  body {
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
    color: #e5e5e5;
    background: #1a1a1a;
    line-height: 1.5;
  }
  * { box-sizing: border-box; }
</style>
`;

export default function AppletSandbox({ code, title = 'Applet', style }: AppletSandboxProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);

	const handleMessage = useCallback(async (event: MessageEvent) => {
		if (event.data?.type !== 'textrawl_api') return;

		const { method, args, id } = event.data;
		const iframe = iframeRef.current;
		if (!iframe?.contentWindow) return;

		try {
			const token = localStorage.getItem('textrawl_token');
			const baseUrl = localStorage.getItem('textrawl_server') || '';
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (token) headers.Authorization = `Bearer ${token}`;

			let result: unknown;

			switch (method) {
				case 'search': {
					const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(args[0] || '')}`, {
						headers,
					});
					result = await res.json();
					break;
				}
				case 'documents': {
					const res = await fetch(`${baseUrl}/api/documents`, { headers });
					result = await res.json();
					break;
				}
				case 'memory': {
					const res = await fetch(`${baseUrl}/api/memory/entities`, { headers });
					result = await res.json();
					break;
				}
				case 'stats': {
					const res = await fetch(`${baseUrl}/api/stats`, { headers });
					result = await res.json();
					break;
				}
				default:
					throw new Error(`Unknown method: ${method}`);
			}

			iframe.contentWindow.postMessage({ id, result }, '*');
		} catch (err) {
			iframe.contentWindow.postMessage(
				{ id, error: err instanceof Error ? err.message : 'API call failed' },
				'*',
			);
		}
	}, []);

	useEffect(() => {
		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	}, [handleMessage]);

	const srcDoc = `<!DOCTYPE html><html><head>${SANDBOX_STYLES}${BRIDGE_SCRIPT}</head><body>${code}</body></html>`;

	return (
		<iframe
			ref={iframeRef}
			sandbox="allow-scripts"
			srcDoc={srcDoc}
			title={title}
			style={{ width: '100%', height: '100%', border: 'none', ...style }}
		/>
	);
}
