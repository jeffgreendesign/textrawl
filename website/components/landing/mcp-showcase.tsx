import type { ReactNode } from 'react';

export function MCPShowcase(): ReactNode {
	return (
		<section className="mcp-showcase">
			<h2 className="section-title">MCP Tools</h2>
			<p className="section-subtitle">
				Twelve tools that give your AI access to everything you know.
			</p>

			<h3 className="tools-category">Document Tools</h3>
			<div className="mcp-tools-grid">
				<div className="mcp-tool">
					<code className="mcp-tool-name">search_knowledge</code>
					<p className="mcp-tool-description">Hybrid semantic + full-text search</p>
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

			<h3 className="tools-category">Memory Tools</h3>
			<div className="mcp-tools-grid">
				<div className="mcp-tool">
					<code className="mcp-tool-name">remember_fact</code>
					<p className="mcp-tool-description">Store facts about entities</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">recall_memories</code>
					<p className="mcp-tool-description">Search stored memories</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">relate_entities</code>
					<p className="mcp-tool-description">Create entity relationships</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">get_entity_context</code>
					<p className="mcp-tool-description">Get all info about an entity</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">list_entities</code>
					<p className="mcp-tool-description">Browse known entities</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">forget_entity</code>
					<p className="mcp-tool-description">Delete entity and memories</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">memory_stats</code>
					<p className="mcp-tool-description">View memory statistics</p>
				</div>
			</div>
		</section>
	);
}
