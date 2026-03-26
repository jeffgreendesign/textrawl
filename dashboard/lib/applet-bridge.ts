/**
 * Applet sandbox bridge — postMessage protocol for iframe ↔ parent communication.
 *
 * The parent dashboard injects this bridge into each applet iframe.
 * Applet code accesses the API via window.textrawl.search(), etc.
 * The iframe sends postMessage requests; the parent proxies them to the REST API.
 */

export interface AppletMessage {
	type: 'textrawl_request';
	id: string;
	method: 'search' | 'documents' | 'memory' | 'stats';
	params?: Record<string, unknown>;
}

export interface AppletResponse {
	type: 'textrawl_response';
	id: string;
	data?: unknown;
	error?: string;
}

/**
 * Generate the JavaScript bridge code that gets injected into the applet iframe.
 * This creates a `window.textrawl` object inside the sandbox.
 */
export function generateBridgeScript(parentOrigin = '*'): string {
	return `
<script>
(function() {
  const pending = new Map();
  let nextId = 0;

  var expectedOrigin = '${parentOrigin}';
  window.addEventListener('message', function(e) {
    if (expectedOrigin !== '*' && e.origin !== expectedOrigin) return;
    if (e.data && e.data.type === 'textrawl_response') {
      const resolve = pending.get(e.data.id);
      if (resolve) {
        pending.delete(e.data.id);
        if (e.data.error) {
          resolve.reject(new Error(e.data.error));
        } else {
          resolve.resolve(e.data.data);
        }
      }
    }
  });

  function request(method, params) {
    return new Promise(function(resolve, reject) {
      const id = 'req_' + (nextId++);
      pending.set(id, { resolve: resolve, reject: reject });
      parent.postMessage({
        type: 'textrawl_request',
        id: id,
        method: method,
        params: params || {}
      }, expectedOrigin);
      setTimeout(function() {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  window.textrawl = {
    search: function(query, limit) { return request('search', { query: query, limit: limit }); },
    documents: function(limit, offset) { return request('documents', { limit: limit, offset: offset }); },
    memory: function(query) { return request('memory', { query: query }); },
    stats: function() { return request('stats', {}); }
  };
})();
</script>`;
}
