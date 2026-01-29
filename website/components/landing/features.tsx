import { Brain, Cpu, FileText, Lightbulb, Lock, Search } from 'lucide-react';
import type { ReactNode } from 'react';

const features = [
	{
		icon: FileText,
		title: 'Crawl Everything',
		description: 'Markdown, PDF, HTML, email, DOCX. Your documents, structured for AI.',
	},
	{
		icon: Search,
		title: 'Semantic Search',
		description:
			'Find by meaning, not just keywords. Hybrid search fuses keyword and vector results.',
	},
	{
		icon: Brain,
		title: 'Persistent Memory',
		description:
			'Remember facts, track conversations, and build a knowledge graph across sessions.',
	},
	{
		icon: Lightbulb,
		title: 'Proactive Insights',
		description:
			'Automatically discover connections, patterns, and outliers across your knowledge base.',
	},
	{
		icon: Cpu,
		title: 'MCP Native',
		description:
			'Built for Claude and other MCP clients. 22 tools for your knowledge in every chat.',
	},
	{
		icon: Lock,
		title: 'Local First',
		description: 'Run entirely on your machine. Your data never leaves.',
	},
] as const;

export function Features(): ReactNode {
	return (
		<section className="features-section">
			<h2 className="section-title">Why textrawl?</h2>
			<div className="features-grid">
				{features.map((feature) => (
					<div key={feature.title} className="feature-card">
						<feature.icon className="feature-icon" size={24} strokeWidth={1.5} />
						<h3 className="feature-title">{feature.title}</h3>
						<p className="feature-description">{feature.description}</p>
					</div>
				))}
			</div>
		</section>
	);
}
