/**
 * Memory Graph — visualize entities and relationships with a force-directed canvas graph.
 */
'use client';

import { AlertCircle, ArrowLeft, ArrowRight, Brain, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { EntityContext, MemoryGraph, MemoryGraphEdge, MemoryGraphNode } from '@/lib/api';
import { useMemoryEntity, useMemoryGraph } from '@/lib/queries';

// --- Constants ---

const ENTITY_TYPE_COLORS: Record<string, string> = {
	person: '#3b82f6',
	concept: '#8b5cf6',
	project: '#22c55e',
	preference: '#f59e0b',
	fact: '#71717a',
	location: '#ef4444',
	organization: '#06b6d4',
};

function getTypeColor(type: string): string {
	return ENTITY_TYPE_COLORS[type.toLowerCase()] ?? '#71717a';
}

// --- Force simulation types ---

interface SimNode {
	id: string;
	name: string;
	type: string;
	description: string | null;
	x: number;
	y: number;
	vx: number;
	vy: number;
	radius: number;
	connections: number;
	pinned: boolean;
}

interface SimEdge {
	source: string;
	target: string;
	type: string;
	strength: number;
}

// --- Helpers ---

function truncate(str: string, max: number): string {
	if (str.length <= max) return str;
	return `${str.slice(0, max - 1)}\u2026`;
}

function timeAgo(dateStr: string): string {
	const now = Date.now();
	const then = new Date(dateStr).getTime();
	const seconds = Math.floor((now - then) / 1000);
	if (seconds < 60) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	return `${months}mo ago`;
}

// --- Shimmer for loading ---

const shimmerStyle = {
	background:
		'linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-hover) 50%, var(--bg-tertiary) 75%)',
	backgroundSize: '200% 100%',
	animation: 'shimmer 1.5s infinite',
	borderRadius: '0.375rem',
} as const;

// --- Force Directed Graph Component ---

function ForceGraph({
	nodes,
	edges,
	activeTypes,
	selectedNodeId,
	onSelectNode,
}: {
	nodes: MemoryGraphNode[];
	edges: MemoryGraphEdge[];
	activeTypes: Set<string>;
	selectedNodeId: string | null;
	onSelectNode: (id: string | null) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const simNodesRef = useRef<Map<string, SimNode>>(new Map());
	const simEdgesRef = useRef<SimEdge[]>([]);
	const animFrameRef = useRef<number>(0);
	const dragNodeRef = useRef<string | null>(null);
	const hoveredNodeRef = useRef<string | null>(null);
	const mouseRef = useRef({ x: 0, y: 0 });
	const sizeRef = useRef({ w: 800, h: 600 });

	// Build simulation data from filtered nodes/edges
	const { filteredNodes, filteredEdges } = useMemo(() => {
		const fn = nodes.filter((n) => activeTypes.has(n.type.toLowerCase()));
		const nodeIds = new Set(fn.map((n) => n.id));
		const fe = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
		return { filteredNodes: fn, filteredEdges: fe };
	}, [nodes, edges, activeTypes]);

	// Count connections per node
	const connectionCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const e of filteredEdges) {
			counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
			counts.set(e.target, (counts.get(e.target) ?? 0) + 1);
		}
		return counts;
	}, [filteredEdges]);

	// Initialize / update sim nodes
	useEffect(() => {
		const existing = simNodesRef.current;
		const newMap = new Map<string, SimNode>();
		const w = sizeRef.current.w;
		const h = sizeRef.current.h;

		for (const n of filteredNodes) {
			const prev = existing.get(n.id);
			const conns = connectionCounts.get(n.id) ?? 0;
			const radius = Math.min(24, Math.max(8, 6 + conns * 2));
			if (prev) {
				prev.radius = radius;
				prev.connections = conns;
				prev.name = n.name;
				prev.type = n.type;
				prev.description = n.description;
				newMap.set(n.id, prev);
			} else {
				newMap.set(n.id, {
					id: n.id,
					name: n.name,
					type: n.type,
					description: n.description,
					x: w / 2 + (Math.random() - 0.5) * w * 0.6,
					y: h / 2 + (Math.random() - 0.5) * h * 0.6,
					vx: 0,
					vy: 0,
					radius,
					connections: conns,
					pinned: false,
				});
			}
		}

		simNodesRef.current = newMap;
		simEdgesRef.current = filteredEdges.map((e) => ({
			source: e.source,
			target: e.target,
			type: e.type,
			strength: e.strength,
		}));
	}, [filteredNodes, filteredEdges, connectionCounts]);

	// Resize handler
	useEffect(() => {
		const container = containerRef.current;
		const canvas = canvasRef.current;
		if (!container || !canvas) return;

		function resize() {
			if (!container || !canvas) return;
			const rect = container.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			sizeRef.current = { w: rect.width, h: rect.height };
			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
			canvas.style.width = `${rect.width}px`;
			canvas.style.height = `${rect.height}px`;
			const ctx = canvas.getContext('2d');
			if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}

		resize();
		window.addEventListener('resize', resize);
		return () => window.removeEventListener('resize', resize);
	}, []);

	// Find node at position
	const findNodeAt = useCallback((mx: number, my: number): SimNode | null => {
		const nodeList = Array.from(simNodesRef.current.values());
		// Iterate in reverse so topmost (last drawn) is picked first
		for (let i = nodeList.length - 1; i >= 0; i--) {
			const n = nodeList[i];
			const dx = mx - n.x;
			const dy = my - n.y;
			if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) {
				return n;
			}
		}
		return null;
	}, []);

	// Mouse handlers — drag threshold distinguishes click from drag
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const cvs = canvas; // local const for closure type narrowing
		const DRAG_THRESHOLD = 5;
		let mouseDownPos: { x: number; y: number } | null = null;
		let pendingNodeId: string | null = null;
		let isDragging = false;

		function getPos(e: MouseEvent) {
			const rect = cvs.getBoundingClientRect();
			return { x: e.clientX - rect.left, y: e.clientY - rect.top };
		}

		function onMouseDown(e: MouseEvent) {
			const pos = getPos(e);
			mouseDownPos = pos;
			isDragging = false;
			const node = findNodeAt(pos.x, pos.y);
			pendingNodeId = node?.id ?? null;
		}

		function onMouseMove(e: MouseEvent) {
			const pos = getPos(e);
			mouseRef.current = pos;

			// Start drag if threshold exceeded
			if (mouseDownPos && !isDragging && pendingNodeId) {
				const dx = pos.x - mouseDownPos.x;
				const dy = pos.y - mouseDownPos.y;
				if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
					isDragging = true;
					dragNodeRef.current = pendingNodeId;
					const node = simNodesRef.current.get(pendingNodeId);
					if (node) node.pinned = true;
				}
			}

			if (dragNodeRef.current) {
				const node = simNodesRef.current.get(dragNodeRef.current);
				if (node) {
					node.x = pos.x;
					node.y = pos.y;
					node.vx = 0;
					node.vy = 0;
				}
			}

			const hovered = findNodeAt(pos.x, pos.y);
			hoveredNodeRef.current = hovered?.id ?? null;
			cvs.style.cursor = hovered ? 'pointer' : 'default';
		}

		function onMouseUp(e: MouseEvent) {
			const pos = getPos(e);
			if (isDragging && dragNodeRef.current) {
				const node = simNodesRef.current.get(dragNodeRef.current);
				if (node) node.pinned = false;
				dragNodeRef.current = null;
			} else {
				// Click — no drag occurred
				const node = findNodeAt(pos.x, pos.y);
				onSelectNode(node?.id ?? null);
			}
			mouseDownPos = null;
			pendingNodeId = null;
			isDragging = false;
		}

		canvas.addEventListener('mousedown', onMouseDown);
		canvas.addEventListener('mousemove', onMouseMove);
		canvas.addEventListener('mouseup', onMouseUp);

		return () => {
			canvas.removeEventListener('mousedown', onMouseDown);
			canvas.removeEventListener('mousemove', onMouseMove);
			canvas.removeEventListener('mouseup', onMouseUp);
		};
	}, [findNodeAt, onSelectNode]);

	// Animation loop
	useEffect(() => {
		const REPULSION = 3000;
		const SPRING_K = 0.005;
		const SPRING_REST = 100;
		const CENTER_FORCE = 0.0005;
		const DAMPING = 0.92;
		const MIN_DIST = 20;

		function tick() {
			const nodesMap = simNodesRef.current;
			const edgesList = simEdgesRef.current;
			const nodeArr = Array.from(nodesMap.values());
			const w = sizeRef.current.w;
			const h = sizeRef.current.h;
			const cx = w / 2;
			const cy = h / 2;

			// Repulsion between all pairs
			for (let i = 0; i < nodeArr.length; i++) {
				for (let j = i + 1; j < nodeArr.length; j++) {
					const a = nodeArr[i];
					const b = nodeArr[j];
					const dx = a.x - b.x;
					const dy = a.y - b.y;
					const dist = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DIST);
					const force = REPULSION / (dist * dist);
					const fx = (dx / dist) * force;
					const fy = (dy / dist) * force;
					if (!a.pinned) {
						a.vx += fx;
						a.vy += fy;
					}
					if (!b.pinned) {
						b.vx -= fx;
						b.vy -= fy;
					}
				}
			}

			// Spring forces along edges
			for (const edge of edgesList) {
				const a = nodesMap.get(edge.source);
				const b = nodesMap.get(edge.target);
				if (!a || !b) continue;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				let dist = Math.sqrt(dx * dx + dy * dy);
				if (dist < 1) dist = 1;
				const displacement = dist - SPRING_REST;
				const force = SPRING_K * displacement * (0.5 + edge.strength * 0.5);
				const fx = (dx / dist) * force;
				const fy = (dy / dist) * force;
				if (!a.pinned) {
					a.vx += fx;
					a.vy += fy;
				}
				if (!b.pinned) {
					b.vx -= fx;
					b.vy -= fy;
				}
			}

			// Centering + damping + position update
			for (const n of nodeArr) {
				if (n.pinned) continue;
				n.vx += (cx - n.x) * CENTER_FORCE;
				n.vy += (cy - n.y) * CENTER_FORCE;
				n.vx *= DAMPING;
				n.vy *= DAMPING;
				n.x += n.vx;
				n.y += n.vy;
				// Keep in bounds
				n.x = Math.max(n.radius, Math.min(w - n.radius, n.x));
				n.y = Math.max(n.radius, Math.min(h - n.radius, n.y));
			}

			// Draw
			const canvas = canvasRef.current;
			if (!canvas) return;
			const ctx = canvas.getContext('2d');
			if (!ctx) return;

			ctx.clearRect(0, 0, w, h);

			const selectedEdges = new Set<string>();
			if (selectedNodeId) {
				for (const edge of edgesList) {
					if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
						selectedEdges.add(`${edge.source}-${edge.target}`);
					}
				}
			}

			// Draw edges
			for (const edge of edgesList) {
				const a = nodesMap.get(edge.source);
				const b = nodesMap.get(edge.target);
				if (!a || !b) continue;

				const edgeKey = `${edge.source}-${edge.target}`;
				const isHighlighted = selectedEdges.has(edgeKey);
				const lineWidth = 1 + edge.strength * 2;

				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
				ctx.strokeStyle = isHighlighted ? '#ffffff60' : '#ffffff18';
				ctx.lineWidth = isHighlighted ? lineWidth + 1 : lineWidth;
				ctx.stroke();
			}

			// Draw nodes
			for (const n of nodeArr) {
				const isSelected = n.id === selectedNodeId;
				const isHovered = n.id === hoveredNodeRef.current;
				const color = getTypeColor(n.type);

				// Glow for selected
				if (isSelected) {
					ctx.beginPath();
					ctx.arc(n.x, n.y, n.radius + 6, 0, Math.PI * 2);
					ctx.fillStyle = `${color}40`;
					ctx.fill();
				}

				// Node circle
				ctx.beginPath();
				ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
				ctx.fillStyle = isSelected || isHovered ? color : `${color}cc`;
				ctx.fill();

				// Border
				ctx.strokeStyle = isSelected ? '#ffffff' : `${color}60`;
				ctx.lineWidth = isSelected ? 2 : 1;
				ctx.stroke();

				// Label
				ctx.font = '11px system-ui, -apple-system, sans-serif';
				ctx.textAlign = 'center';
				ctx.fillStyle = isSelected ? '#ffffff' : '#ffffffaa';
				ctx.fillText(truncate(n.name, 16), n.x, n.y + n.radius + 14);
			}

			// Tooltip for hovered node
			if (hoveredNodeRef.current && hoveredNodeRef.current !== selectedNodeId) {
				const hNode = nodesMap.get(hoveredNodeRef.current);
				if (hNode) {
					const text = `${hNode.name} (${hNode.type})`;
					ctx.font = '12px system-ui, -apple-system, sans-serif';
					const metrics = ctx.measureText(text);
					const tx = mouseRef.current.x + 12;
					const ty = mouseRef.current.y - 12;
					const pw = 8;
					const ph = 4;

					ctx.fillStyle = '#1a1a2e';
					ctx.strokeStyle = '#ffffff30';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.roundRect(tx - pw, ty - 14 - ph, metrics.width + pw * 2, 18 + ph * 2, 4);
					ctx.fill();
					ctx.stroke();

					ctx.fillStyle = '#ffffff';
					ctx.textAlign = 'left';
					ctx.fillText(text, tx, ty);
				}
			}

			animFrameRef.current = requestAnimationFrame(tick);
		}

		animFrameRef.current = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(animFrameRef.current);
	}, [selectedNodeId]);

	return (
		<div
			ref={containerRef}
			style={{
				width: '100%',
				height: '100%',
				minHeight: 400,
				position: 'relative',
			}}
		>
			<canvas
				ref={canvasRef}
				style={{
					display: 'block',
					width: '100%',
					height: '100%',
				}}
			/>
		</div>
	);
}

// --- Entity Detail Panel ---

function EntityDetailPanel({
	nodeId,
	nodes,
	onClose,
	onSelectEntity,
}: {
	nodeId: string;
	nodes: MemoryGraphNode[];
	onClose: () => void;
	onSelectEntity: (name: string) => void;
}) {
	const node = nodes.find((n) => n.id === nodeId);
	const entityName = node?.name ?? '';
	const { data: context, isLoading, isError, error } = useMemoryEntity(entityName);

	const typeColor = getTypeColor(node?.type ?? 'fact');

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				overflow: 'hidden',
			}}
		>
			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '1rem',
					borderBottom: '1px solid var(--border-default)',
					flexShrink: 0,
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
					<span
						style={{
							fontWeight: 600,
							fontSize: '0.9375rem',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
						title={entityName}
					>
						{entityName}
					</span>
					{node && (
						<span
							style={{
								display: 'inline-block',
								padding: '0.125rem 0.5rem',
								fontSize: '0.6875rem',
								fontFamily: 'var(--font-mono)',
								fontWeight: 500,
								borderRadius: '9999px',
								backgroundColor: `${typeColor}18`,
								color: typeColor,
								textTransform: 'uppercase',
								letterSpacing: '0.025em',
								flexShrink: 0,
							}}
						>
							{node.type}
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={onClose}
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: 28,
						height: 28,
						borderRadius: '0.375rem',
						border: '1px solid var(--border-default)',
						backgroundColor: 'transparent',
						color: 'var(--text-muted)',
						cursor: 'pointer',
						flexShrink: 0,
					}}
				>
					<X size={14} />
				</button>
			</div>

			{/* Body */}
			<div
				style={{
					flex: 1,
					overflow: 'auto',
					padding: '1rem',
					display: 'flex',
					flexDirection: 'column',
					gap: '1.25rem',
				}}
			>
				{isLoading && (
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.5rem',
							color: 'var(--text-muted)',
							fontSize: '0.8125rem',
						}}
					>
						<Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
						Loading entity details...
					</div>
				)}

				{isError && (
					<div
						style={{
							backgroundColor: 'rgba(239, 68, 68, 0.08)',
							border: '1px solid rgba(239, 68, 68, 0.3)',
							borderRadius: '0.5rem',
							padding: '0.75rem',
							fontSize: '0.8125rem',
							color: '#fca5a5',
						}}
					>
						{(error as Error)?.message ?? 'Failed to load entity'}
					</div>
				)}

				{context && (
					<>
						{/* Description */}
						{context.entity_description && (
							<div>
								<h4
									style={{
										margin: '0 0 0.375rem',
										fontSize: '0.6875rem',
										fontFamily: 'var(--font-mono)',
										textTransform: 'uppercase',
										color: 'var(--text-muted)',
										letterSpacing: '0.05em',
									}}
								>
									Description
								</h4>
								<p
									style={{
										margin: 0,
										fontSize: '0.8125rem',
										lineHeight: 1.6,
										color: 'var(--text-secondary, #ccc)',
									}}
								>
									{context.entity_description}
								</p>
							</div>
						)}

						{/* Observations */}
						{context.observations.length > 0 && (
							<div>
								<h4
									style={{
										margin: '0 0 0.5rem',
										fontSize: '0.6875rem',
										fontFamily: 'var(--font-mono)',
										textTransform: 'uppercase',
										color: 'var(--text-muted)',
										letterSpacing: '0.05em',
									}}
								>
									Observations ({context.observations.length})
								</h4>
								<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
									{context.observations.map((obs) => (
										<div
											key={obs.id}
											style={{
												padding: '0.625rem 0.75rem',
												backgroundColor: 'var(--bg-tertiary, #1a1a2e)',
												borderRadius: '0.5rem',
												fontSize: '0.8125rem',
												lineHeight: 1.6,
											}}
										>
											<p style={{ margin: '0 0 0.375rem', color: 'var(--text-primary, #eee)' }}>
												{obs.content}
											</p>
											<div
												style={{
													display: 'flex',
													alignItems: 'center',
													gap: '0.5rem',
													fontSize: '0.6875rem',
													fontFamily: 'var(--font-mono)',
													color: 'var(--text-muted)',
												}}
											>
												{obs.source && <span>{obs.source}</span>}
												{obs.source && obs.created_at && <span>&middot;</span>}
												{obs.created_at && <span>{timeAgo(obs.created_at)}</span>}
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Relations */}
						{(context.outgoing_relations.length > 0 || context.incoming_relations.length > 0) && (
							<div>
								<h4
									style={{
										margin: '0 0 0.5rem',
										fontSize: '0.6875rem',
										fontFamily: 'var(--font-mono)',
										textTransform: 'uppercase',
										color: 'var(--text-muted)',
										letterSpacing: '0.05em',
									}}
								>
									Relations ({context.outgoing_relations.length + context.incoming_relations.length}
									)
								</h4>
								<div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
									{context.outgoing_relations.map((rel, i) => (
										<button
											type="button"
											key={`out-${rel.to_entity}-${rel.relation_type}-${i}`}
											onClick={() => onSelectEntity(rel.to_entity)}
											style={{
												display: 'flex',
												alignItems: 'center',
												gap: '0.5rem',
												padding: '0.5rem 0.625rem',
												backgroundColor: 'var(--bg-tertiary, #1a1a2e)',
												border: '1px solid var(--border-default)',
												borderRadius: '0.375rem',
												cursor: 'pointer',
												fontSize: '0.8125rem',
												textAlign: 'left',
												color: 'var(--text-primary, #eee)',
												width: '100%',
											}}
										>
											<ArrowRight size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
											<span
												style={{
													fontFamily: 'var(--font-mono)',
													fontSize: '0.6875rem',
													color: 'var(--text-muted)',
													flexShrink: 0,
												}}
											>
												{rel.relation_type}
											</span>
											<span
												style={{
													overflow: 'hidden',
													textOverflow: 'ellipsis',
													whiteSpace: 'nowrap',
												}}
											>
												{rel.to_entity}
											</span>
											<span
												style={{
													marginLeft: 'auto',
													fontSize: '0.625rem',
													fontFamily: 'var(--font-mono)',
													color: getTypeColor(rel.to_entity_type),
													textTransform: 'uppercase',
													flexShrink: 0,
												}}
											>
												{rel.to_entity_type}
											</span>
										</button>
									))}
									{context.incoming_relations.map((rel, i) => (
										<button
											type="button"
											key={`in-${rel.from_entity}-${rel.relation_type}-${i}`}
											onClick={() => onSelectEntity(rel.from_entity)}
											style={{
												display: 'flex',
												alignItems: 'center',
												gap: '0.5rem',
												padding: '0.5rem 0.625rem',
												backgroundColor: 'var(--bg-tertiary, #1a1a2e)',
												border: '1px solid var(--border-default)',
												borderRadius: '0.375rem',
												cursor: 'pointer',
												fontSize: '0.8125rem',
												textAlign: 'left',
												color: 'var(--text-primary, #eee)',
												width: '100%',
											}}
										>
											<ArrowLeft size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
											<span
												style={{
													fontFamily: 'var(--font-mono)',
													fontSize: '0.6875rem',
													color: 'var(--text-muted)',
													flexShrink: 0,
												}}
											>
												{rel.relation_type}
											</span>
											<span
												style={{
													overflow: 'hidden',
													textOverflow: 'ellipsis',
													whiteSpace: 'nowrap',
												}}
											>
												{rel.from_entity}
											</span>
											<span
												style={{
													marginLeft: 'auto',
													fontSize: '0.625rem',
													fontFamily: 'var(--font-mono)',
													color: getTypeColor(rel.from_entity_type),
													textTransform: 'uppercase',
													flexShrink: 0,
												}}
											>
												{rel.from_entity_type}
											</span>
										</button>
									))}
								</div>
							</div>
						)}

						{/* Empty context */}
						{!context.entity_description &&
							context.observations.length === 0 &&
							context.outgoing_relations.length === 0 &&
							context.incoming_relations.length === 0 && (
								<p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', margin: 0 }}>
									No additional details for this entity.
								</p>
							)}
					</>
				)}
			</div>
		</div>
	);
}

// --- Main Page ---

export default function MemoryPage() {
	const { data, isLoading, isError, error, refetch } = useMemoryGraph();
	const [activeTypes, setActiveTypes] = useState<Set<string> | null>(null);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

	const nodes = data?.nodes ?? [];
	const edges = data?.edges ?? [];

	// Count nodes per type for badge display
	const typeCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const n of nodes) {
			const t = n.type.toLowerCase();
			counts.set(t, (counts.get(t) ?? 0) + 1);
		}
		return counts;
	}, [nodes]);

	// Derive present types from data (sorted by count descending)
	const presentTypes = useMemo(() => {
		return Array.from(typeCounts.keys()).sort(
			(a, b) => (typeCounts.get(b) ?? 0) - (typeCounts.get(a) ?? 0),
		);
	}, [typeCounts]);

	// Default activeTypes to all present types when data first loads
	const resolvedActiveTypes = useMemo(() => {
		if (activeTypes !== null) return activeTypes;
		return new Set(presentTypes);
	}, [activeTypes, presentTypes]);

	function toggleType(type: string) {
		const current = resolvedActiveTypes;
		const next = new Set(current);
		if (next.has(type)) {
			next.delete(type);
		} else {
			next.add(type);
		}
		setActiveTypes(next);
	}

	// Select entity by name (used from detail panel relation clicks)
	function handleSelectEntityByName(name: string) {
		const node = nodes.find((n) => n.name === name);
		if (node) {
			setSelectedNodeId(node.id);
			// Ensure the type is active
			if (!resolvedActiveTypes.has(node.type.toLowerCase())) {
				setActiveTypes(new Set([...resolvedActiveTypes, node.type.toLowerCase()]));
			}
		}
	}

	// Loading state
	if (isLoading) {
		return (
			<div>
				<style>
					{
						'@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }'
					}
					{
						'@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'
					}
				</style>
				<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>
					Memory Graph
				</h2>
				<div
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						padding: '2rem',
						minHeight: 500,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<div style={{ textAlign: 'center' }}>
						<Loader2
							size={32}
							style={{
								color: 'var(--text-muted)',
								animation: 'spin 1s linear infinite',
								margin: '0 auto 1rem',
							}}
						/>
						<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
							Loading memory graph...
						</p>
					</div>
				</div>
			</div>
		);
	}

	// Error state
	if (isError) {
		return (
			<div>
				<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>
					Memory Graph
				</h2>
				<div
					style={{
						backgroundColor: 'rgba(239, 68, 68, 0.08)',
						border: '1px solid rgba(239, 68, 68, 0.3)',
						borderRadius: '0.75rem',
						padding: '1.5rem',
						display: 'flex',
						alignItems: 'center',
						gap: '0.75rem',
					}}
				>
					<AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
					<div style={{ flex: 1 }}>
						<p style={{ color: '#fca5a5', fontSize: '0.875rem', margin: 0 }}>
							{(error as Error)?.message ?? 'Failed to load memory graph'}
						</p>
					</div>
					<button
						type="button"
						onClick={() => refetch()}
						style={{
							padding: '0.375rem 0.75rem',
							fontSize: '0.8125rem',
							borderRadius: '0.375rem',
							backgroundColor: 'rgba(239, 68, 68, 0.15)',
							border: '1px solid rgba(239, 68, 68, 0.3)',
							color: '#fca5a5',
							cursor: 'pointer',
							flexShrink: 0,
						}}
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	// Empty state
	if (nodes.length === 0) {
		return (
			<div>
				<h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>
					Memory Graph
				</h2>
				<div
					style={{
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						padding: '3rem',
						textAlign: 'center',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: '0.75rem',
					}}
				>
					<Brain size={32} style={{ color: 'var(--text-muted)' }} />
					<p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
						No memory entities yet. Use the memory tools via MCP to create entities.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div>
			<style>
				{'@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}
			</style>

			{/* Header */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					flexWrap: 'wrap',
					gap: '0.75rem',
					marginBottom: '1rem',
				}}
			>
				<h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Memory Graph</h2>
				<span
					style={{
						display: 'inline-block',
						padding: '0.125rem 0.5rem',
						fontSize: '0.6875rem',
						fontFamily: 'var(--font-mono)',
						fontWeight: 500,
						borderRadius: '9999px',
						backgroundColor: 'var(--bg-tertiary, #1a1a2e)',
						color: 'var(--text-muted)',
					}}
				>
					{nodes.length} {nodes.length === 1 ? 'entity' : 'entities'}
				</span>
			</div>

			{/* Type filter pills */}
			{presentTypes.length > 0 && (
				<div
					style={{
						display: 'flex',
						flexWrap: 'wrap',
						gap: '0.375rem',
						marginBottom: '1rem',
					}}
				>
					{presentTypes.map((type) => {
						const isActive = resolvedActiveTypes.has(type);
						const color = getTypeColor(type);
						const count = typeCounts.get(type) ?? 0;
						return (
							<button
								key={type}
								type="button"
								onClick={() => toggleType(type)}
								style={{
									display: 'inline-flex',
									alignItems: 'center',
									gap: '0.375rem',
									padding: '0.25rem 0.625rem',
									fontSize: '0.75rem',
									fontFamily: 'var(--font-mono)',
									borderRadius: '9999px',
									border: `1px solid ${isActive ? color : 'var(--border-default)'}`,
									backgroundColor: isActive ? `${color}18` : 'transparent',
									color: isActive ? color : 'var(--text-muted)',
									cursor: 'pointer',
									textTransform: 'capitalize',
									transition: 'all 0.15s ease',
									opacity: isActive ? 1 : 0.6,
								}}
							>
								<span
									style={{
										width: 8,
										height: 8,
										borderRadius: '50%',
										backgroundColor: isActive ? color : 'var(--text-muted)',
										flexShrink: 0,
									}}
								/>
								{type}
								<span style={{ fontSize: '0.625rem', opacity: 0.8 }}>{count}</span>
							</button>
						);
					})}
				</div>
			)}

			{/* Main two-panel layout */}
			<div
				style={{
					display: 'flex',
					gap: '1rem',
					height: 'calc(100vh - 220px)',
					minHeight: 500,
				}}
			>
				{/* Left panel: Canvas graph */}
				<div
					style={{
						flex: selectedNodeId ? '0 0 70%' : '1 1 100%',
						backgroundColor: 'var(--bg-secondary)',
						border: '1px solid var(--border-default)',
						borderRadius: '0.75rem',
						overflow: 'hidden',
						transition: 'flex 0.2s ease',
					}}
				>
					<ForceGraph
						nodes={nodes}
						edges={edges}
						activeTypes={resolvedActiveTypes}
						selectedNodeId={selectedNodeId}
						onSelectNode={setSelectedNodeId}
					/>
				</div>

				{/* Right panel: Entity detail */}
				{selectedNodeId && (
					<div
						style={{
							flex: '0 0 30%',
							backgroundColor: 'var(--bg-secondary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.75rem',
							overflow: 'hidden',
							minWidth: 260,
						}}
					>
						<EntityDetailPanel
							nodeId={selectedNodeId}
							nodes={nodes}
							onClose={() => setSelectedNodeId(null)}
							onSelectEntity={handleSelectEntityByName}
						/>
					</div>
				)}

				{/* Hint when no node selected */}
				{!selectedNodeId && (
					<div
						style={{
							position: 'absolute',
							bottom: '2rem',
							left: '50%',
							transform: 'translateX(-50%)',
							padding: '0.5rem 1rem',
							backgroundColor: 'var(--bg-secondary)',
							border: '1px solid var(--border-default)',
							borderRadius: '0.5rem',
							fontSize: '0.8125rem',
							color: 'var(--text-muted)',
							pointerEvents: 'none',
							opacity: 0.8,
						}}
					>
						Click a node to view details
					</div>
				)}
			</div>
		</div>
	);
}
