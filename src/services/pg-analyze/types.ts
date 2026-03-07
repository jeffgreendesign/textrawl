export type Severity = 'info' | 'warning' | 'critical';

export interface TableStat {
	schema: string;
	table: string;
	rowEstimate: number;
	totalSize: string;
	tableSize: string;
	indexSize: string;
	toastSize: string;
	deadTuples: number;
	liveTuples: number;
	deadTupleRatio: number;
}

export interface IndexStat {
	schema: string;
	table: string;
	index: string;
	size: string;
	scans: number;
	tuplesRead: number;
	tuplesFetched: number;
	indexDef: string;
}

export interface VacuumStat {
	schema: string;
	table: string;
	lastVacuum: string | null;
	lastAutovacuum: string | null;
	lastAnalyze: string | null;
	lastAutoanalyze: string | null;
	deadTuples: number;
	liveTuples: number;
	vacuumCount: number;
	autovacuumCount: number;
}

export interface ConnectionStat {
	totalConnections: number;
	activeConnections: number;
	idleConnections: number;
	idleInTransaction: number;
	maxConnections: number;
	connectionUsagePercent: number;
	longRunningQueries: Array<{
		pid: number;
		duration: string;
		state: string;
		query: string;
	}>;
}

export interface QueryStat {
	queryId: string;
	query: string;
	calls: number;
	totalTime: number;
	meanTime: number;
	minTime: number;
	maxTime: number;
	rows: number;
}

export interface BloatEstimate {
	schema: string;
	table: string;
	type: 'table';
	currentSize: string;
	estimatedBloat: string;
	bloatRatio: number;
}

export interface TextrawlCheck {
	name: string;
	status: 'ok' | 'warning' | 'missing' | 'error';
	detail: string;
}

export interface Recommendation {
	severity: Severity;
	category: 'maintenance' | 'performance' | 'storage' | 'security' | 'textrawl';
	title: string;
	description: string;
	suggestion: string;
	reference?: string;
}

export interface AnalysisReport {
	timestamp: string;
	databaseVersion: string;
	databaseSize: string;
	tables: TableStat[];
	indexes: IndexStat[];
	vacuum: VacuumStat[];
	connections: ConnectionStat;
	queries: QueryStat[];
	pgStatStatementsAvailable: boolean;
	bloat: BloatEstimate[];
	textrawl: TextrawlCheck[];
	recommendations: Recommendation[];
}
