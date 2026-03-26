/**
 * Agents — orchestration panel for connected agents and tasks.
 */
'use client';

import { Bot, Clock, Play, RefreshCw, Shield } from 'lucide-react';
import { useState } from 'react';

interface AgentTask {
	id: string;
	name: string;
	status: 'idle' | 'running' | 'completed';
	lastRun?: string;
	description: string;
}

const MANUAL_TASKS: AgentTask[] = [
	{
		id: 'insight-scan',
		name: 'Run Insight Scan',
		status: 'idle',
		description: 'Analyze recent documents for cross-source patterns and connections.',
	},
	{
		id: 'generate-briefing',
		name: 'Generate Briefing',
		status: 'idle',
		description: 'Create a daily briefing from recent additions and resurfaced knowledge.',
	},
	{
		id: 'memory-extraction',
		name: 'Extract Memories',
		status: 'idle',
		description: 'Extract entities and relationships from recent uploads.',
	},
	{
		id: 'staleness-check',
		name: 'Staleness Check',
		status: 'idle',
		description: 'Flag entities with observations older than 90 days.',
	},
];

export default function AgentsPage() {
	const [tasks, setTasks] = useState(MANUAL_TASKS);

	const triggerTask = (taskId: string) => {
		setTasks((prev) =>
			prev.map((t) => (t.id === taskId ? { ...t, status: 'running' as const } : t)),
		);
		// Simulate completion
		setTimeout(() => {
			setTasks((prev) =>
				prev.map((t) =>
					t.id === taskId
						? { ...t, status: 'completed' as const, lastRun: new Date().toLocaleTimeString() }
						: t,
				),
			);
		}, 2000);
	};

	return (
		<div>
			<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>
				Agent Orchestration
			</h2>

			{/* Connected Agents */}
			<section style={{ marginBottom: '2rem' }}>
				<h3
					style={{
						fontSize: '1rem',
						fontWeight: 600,
						marginBottom: '0.75rem',
						color: 'var(--text-muted)',
					}}
				>
					Connected Agents
				</h3>
				<div
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						padding: '1.5rem',
					}}
				>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.75rem',
							marginBottom: '0.75rem',
						}}
					>
						<Bot size={20} style={{ color: 'var(--text-accent)' }} />
						<div>
							<p style={{ fontWeight: 500 }}>Textrawl Knowledge Agent</p>
							<p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Local — A2A + MCP</p>
						</div>
						<span
							style={{
								marginLeft: 'auto',
								fontSize: '0.6875rem',
								padding: '0.25rem 0.625rem',
								borderRadius: '9999px',
								backgroundColor: 'rgba(132, 204, 22, 0.15)',
								color: 'var(--text-accent)',
							}}
						>
							Active
						</span>
					</div>
					<div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
						{['search', 'save', 'memory', 'insights'].map((skill) => (
							<span
								key={skill}
								style={{
									fontSize: '0.6875rem',
									padding: '0.125rem 0.5rem',
									borderRadius: '0.25rem',
									backgroundColor: 'var(--bg-tertiary)',
									color: 'var(--text-muted)',
								}}
							>
								{skill}
							</span>
						))}
					</div>
				</div>
				<p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '0.75rem' }}>
					External agents discovered via A2A will appear here.
				</p>
			</section>

			{/* Manual Tasks */}
			<section style={{ marginBottom: '2rem' }}>
				<h3
					style={{
						fontSize: '1rem',
						fontWeight: 600,
						marginBottom: '0.75rem',
						color: 'var(--text-muted)',
					}}
				>
					Manual Tasks
				</h3>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
					{tasks.map((task) => (
						<div
							key={task.id}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '0.75rem',
								padding: '0.875rem 1rem',
								backgroundColor: 'var(--bg-secondary)',
								border: '1px solid var(--border-default)',
								borderRadius: '0.5rem',
							}}
						>
							<div style={{ flex: 1 }}>
								<p style={{ fontSize: '0.875rem', fontWeight: 500 }}>{task.name}</p>
								<p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
									{task.description}
								</p>
							</div>
							{task.lastRun && (
								<span
									style={{
										fontSize: '0.6875rem',
										color: 'var(--text-muted)',
										display: 'flex',
										alignItems: 'center',
										gap: '0.25rem',
									}}
								>
									<Clock size={12} /> {task.lastRun}
								</span>
							)}
							<button
								type="button"
								onClick={() => triggerTask(task.id)}
								disabled={task.status === 'running'}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: '0.375rem',
									padding: '0.375rem 0.75rem',
									backgroundColor:
										task.status === 'running' ? 'var(--bg-tertiary)' : 'var(--text-accent)',
									color: task.status === 'running' ? 'var(--text-muted)' : '#000',
									border: 'none',
									borderRadius: '0.375rem',
									fontSize: '0.75rem',
									fontWeight: 600,
									cursor: task.status === 'running' ? 'not-allowed' : 'pointer',
								}}
							>
								{task.status === 'running' ? (
									<RefreshCw size={12} className="animate-spin" />
								) : (
									<Play size={12} />
								)}
								{task.status === 'running' ? 'Running...' : 'Run'}
							</button>
						</div>
					))}
				</div>
			</section>

			{/* Agent Access Log */}
			<section>
				<h3
					style={{
						fontSize: '1rem',
						fontWeight: 600,
						marginBottom: '0.75rem',
						color: 'var(--text-muted)',
					}}
				>
					Access Log
				</h3>
				<div
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						padding: '1.5rem',
					}}
				>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.5rem',
							color: 'var(--text-muted)',
						}}
					>
						<Shield size={16} />
						<p style={{ fontSize: '0.875rem' }}>
							Agent access history and permission logs will appear here when agents interact with
							your knowledge.
						</p>
					</div>
				</div>
			</section>
		</div>
	);
}
