import type { ReactNode } from 'react';

export function MCPShowcase(): ReactNode {
	return (
		<section className="mcp-showcase">
			<h2 className="section-title">MCP Tools</h2>
			<p className="section-subtitle">
				Twenty-five tools that give your AI access to everything you know.
			</p>

			<h3 className="tools-category">Document Tools</h3>
			<div className="mcp-tools-grid">
				<div className="mcp-tool">
					<code className="mcp-tool-name">search</code>
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
					<code className="mcp-tool-name">build_knowledge</code>
					<p className="mcp-tool-description">Batch store facts and relations</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">query_memory</code>
					<p className="mcp-tool-description">Search, list, or look up entities</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">relate_entities</code>
					<p className="mcp-tool-description">Create entity relationships</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">forget_entity</code>
					<p className="mcp-tool-description">Delete entity and memories</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">extract_memories</code>
					<p className="mcp-tool-description">Extract entities from text via LLM</p>
				</div>
			</div>

			<h3 className="tools-category">Conversation Tools</h3>
			<div className="mcp-tools-grid">
				<div className="mcp-tool">
					<code className="mcp-tool-name">save_conversation_context</code>
					<p className="mcp-tool-description">Save conversation for recall</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">query_conversations</code>
					<p className="mcp-tool-description">Search, list, or get conversations</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">delete_conversation</code>
					<p className="mcp-tool-description">Delete a conversation session</p>
				</div>
			</div>

			<h3 className="tools-category">Insight Tools</h3>
			<div className="mcp-tools-grid">
				<div className="mcp-tool">
					<code className="mcp-tool-name">get_insights</code>
					<p className="mcp-tool-description">View discovered patterns and connections</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">discover_connections</code>
					<p className="mcp-tool-description">Trigger insight scan</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">dismiss_insight</code>
					<p className="mcp-tool-description">Dismiss an insight</p>
				</div>
			</div>

			<h3 className="tools-category">Unified Tools</h3>
			<div className="mcp-tools-grid">
				<div className="mcp-tool">
					<code className="mcp-tool-name">ask</code>
					<p className="mcp-tool-description">Unified RAG across all sources</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">daily_briefing</code>
					<p className="mcp-tool-description">Daily summary and resurfaced knowledge</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">save_url</code>
					<p className="mcp-tool-description">Save web pages as documents</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">timeline</code>
					<p className="mcp-tool-description">Browse knowledge chronologically</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">get_stats</code>
					<p className="mcp-tool-description">Statistics across all features</p>
				</div>
			</div>

			<h3 className="tools-category">Postgres Analysis</h3>
			<div className="mcp-tools-grid">
				<div className="mcp-tool">
					<code className="mcp-tool-name">pg_analyze</code>
					<p className="mcp-tool-description">Database health analysis</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">pg_recommendations</code>
					<p className="mcp-tool-description">Optimization recommendations</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">pg_report_history</code>
					<p className="mcp-tool-description">Compare analysis over time</p>
				</div>
			</div>
		</section>
	);
}
