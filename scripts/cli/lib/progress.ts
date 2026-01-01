/**
 * Progress reporting utilities
 *
 * Uses cli-progress for batch operation feedback
 * All output goes to stderr (stdout reserved for MCP JSON-RPC)
 * Falls back to plain text when not running in a TTY (e.g., piped to web UI)
 */

import cliProgress from 'cli-progress';

// Check if we're running in a TTY (terminal) vs piped output
const isTTY = process.stderr.isTTY;

/**
 * Progress reporter for batch operations
 * Uses fancy progress bars in TTY mode, plain text otherwise
 */
export class ProgressReporter {
  private bar: cliProgress.SingleBar | null = null;
  private current: number = 0;
  private total: number;
  private verbose: boolean;
  private lastStatus: string = '';

  constructor(total: number, options: { verbose?: boolean; format?: string } = {}) {
    this.total = total;
    this.verbose = options.verbose || false;

    // Only use progress bar in TTY mode
    if (isTTY) {
      const format =
        options.format ||
        '{bar} {percentage}% | {value}/{total} | {status}';

      this.bar = new cliProgress.SingleBar(
        {
          format,
          barCompleteChar: '\u2588',
          barIncompleteChar: '\u2591',
          hideCursor: true,
          clearOnComplete: false,
          stream: process.stderr, // CRITICAL: stderr only
        },
        cliProgress.Presets.shades_classic
      );
    }
  }

  /**
   * Start the progress bar
   */
  start(): void {
    if (this.bar) {
      this.bar.start(this.total, 0, { status: 'Starting...' });
    } else {
      console.error(`[PROGRESS] Starting... (0/${this.total})`);
    }
  }

  /**
   * Update progress with optional status message
   */
  update(value: number, status?: string): void {
    this.current = value;
    this.lastStatus = status || '';
    if (this.bar) {
      this.bar.update(value, { status: this.lastStatus });
    } else {
      const percent = Math.round((value / this.total) * 100);
      console.error(`[PROGRESS] ${percent}% (${value}/${this.total}) ${this.lastStatus}`);
    }
  }

  /**
   * Increment progress by one
   */
  increment(status?: string): void {
    this.current++;
    this.lastStatus = status || this.lastStatus;
    if (this.bar) {
      this.bar.update(this.current, { status: this.lastStatus });
    } else {
      const percent = Math.round((this.current / this.total) * 100);
      console.error(`[PROGRESS] ${percent}% (${this.current}/${this.total}) ${this.lastStatus}`);
    }
  }

  /**
   * Log a message (only in verbose mode)
   */
  log(message: string): void {
    if (this.verbose) {
      if (this.bar) {
        // Stop bar temporarily to print message
        this.bar.stop();
        console.error(message);
        this.bar.start(this.total, this.current);
      } else {
        console.error(message);
      }
    }
  }

  /**
   * Finish the progress bar
   */
  finish(message?: string): void {
    if (this.bar) {
      if (message) {
        this.bar.update(this.current, { status: message });
      }
      this.bar.stop();
    } else {
      console.error(`[PROGRESS] 100% - ${message || 'Complete'}`);
    }
  }
}

/**
 * Multi-bar progress reporter for concurrent operations
 */
export class MultiProgressReporter {
  private multibar: cliProgress.MultiBar;
  private bars: Map<string, cliProgress.SingleBar> = new Map();

  constructor() {
    this.multibar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: '{name} | {bar} | {percentage}% | {status}',
        stream: process.stderr,
      },
      cliProgress.Presets.shades_classic
    );
  }

  /**
   * Add a new progress bar
   */
  addBar(id: string, name: string, total: number): void {
    const bar = this.multibar.create(total, 0, { name, status: 'Starting...' });
    this.bars.set(id, bar);
  }

  /**
   * Update a specific bar
   */
  updateBar(id: string, value: number, status?: string): void {
    const bar = this.bars.get(id);
    if (bar) {
      bar.update(value, { status: status || '' });
    }
  }

  /**
   * Increment a specific bar
   */
  incrementBar(id: string, status?: string): void {
    const bar = this.bars.get(id);
    if (bar) {
      bar.increment(1, { status: status || '' });
    }
  }

  /**
   * Stop all bars
   */
  stop(): void {
    this.multibar.stop();
  }
}

/**
 * Simple logger that writes to stderr
 */
export const logger = {
  info: (message: string, context?: Record<string, unknown>) => {
    console.error(`[INFO] ${message}`, context ? JSON.stringify(context) : '');
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    console.error(`[WARN] ${message}`, context ? JSON.stringify(context) : '');
  },
  error: (message: string, context?: Record<string, unknown>) => {
    console.error(`[ERROR] ${message}`, context ? JSON.stringify(context) : '');
  },
  debug: (message: string, context?: Record<string, unknown>) => {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] ${message}`, context ? JSON.stringify(context) : '');
    }
  },
};
