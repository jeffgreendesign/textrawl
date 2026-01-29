import type { ReactNode } from 'react';

export function MCPShowcase(): ReactNode {
	return (
		<section className="mcp-showcase">
			<h2 className="section-title">MCP Tools</h2>
			<p className="section-subtitle">
				Twenty-two tools that give your AI access to everything you know.
			</p>

			<h3 className="tools-category">Document Tools</h3>
			<div className="mcp-tools-grid">
				<div className="mcp-tool">
					<code className="mcp-tool-name">search_knowledge</code>
					<p className="mcp-tool-description">Hybrid semantic + full-text search</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">search_with_context</code>
					<p className="mcp-tool-description">Search documents, memories, and conversations</p>
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
				<div className="mcp-tool">
					<code className="mcp-tool-name">knowledge_stats</code>
					<p className="mcp-tool-description">Knowledge base statistics</p>
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
					<code className="mcp-tool-name">recall_conversation</code>
					<p className="mcp-tool-description">Search past conversations</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">list_conversations</code>
					<p className="mcp-tool-description">Browse conversation history</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">get_conversation</code>
					<p className="mcp-tool-description">Get full conversation transcript</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">delete_conversation</code>
					<p className="mcp-tool-description">Delete a conversation session</p>
				</div>
				<div className="mcp-tool">
					<code className="mcp-tool-name">conversation_stats</code>
					<p className="mcp-tool-description">Conversation storage statistics</p>
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
				<div className="mcp-tool">
					<code className="mcp-tool-name">insight_stats</code>
					<p className="mcp-tool-description">Insight queue statistics</p>
				</div>
			</div>
		</section>
	);
}
