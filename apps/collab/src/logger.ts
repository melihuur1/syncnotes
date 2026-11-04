export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Minimal structured (JSON lines) logger — no dependency, easy to ship to any log collector. */
export function createLogger(instance: string, minLevel: Level = 'info'): Logger {
  const write = (level: Level, msg: string, meta?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, instance, msg, ...meta });
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
