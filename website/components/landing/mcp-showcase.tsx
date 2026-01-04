import type { ReactNode } from 'react';

export function MCPShowcase(): ReactNode {
	return (
		<section className="mcp-showcase">
			<h2 className="section-title">MCP Tools</h2>
			<p className="section-subtitle">
				Five tools that give your AI access to everything you know.
			</p>
			<div className="mcp-tools-grid">
				<div className="mcp-tool">
					<code className="mcp-tool-name">search_knowledge</code>
					<p className="mcp-tool-description">
						Hybrid semantic + full-text search
					</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">get_document</code>
					<p className="mcp-tool-description">Retrieve full document content</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">list_documents</code>
					<p className="mcp-tool-description">Browse with pagination and filters</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">update_document</code>
					<p className="mcp-tool-description">Update document metadata</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">add_note</code>
					<p className="mcp-tool-description">Create notes with auto-embedding</p>
				</div>
			</div>
		</section>
	);
}
