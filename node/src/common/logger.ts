export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

let currentLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel): LogLevel {
  const previous = currentLevel;
  currentLevel = level;
  return previous;
}

const ts = () => new Date().toISOString();

export const logger = {
  debug: (tag: string, msg: string, ...args: unknown[]) => {
    if (currentLevel <= LogLevel.DEBUG) console.log(`${ts()} [${tag}] ${msg}`, ...args);
  },
  info: (tag: string, msg: string, ...args: unknown[]) => {
    if (currentLevel <= LogLevel.INFO) console.log(`${ts()} [${tag}] ${msg}`, ...args);
  },
  warn: (tag: string, msg: string, ...args: unknown[]) => {
    if (currentLevel <= LogLevel.WARN) console.warn(`${ts()} [${tag}] ${msg}`, ...args);
  },
  error: (tag: string, msg: string, ...args: unknown[]) => {
    if (currentLevel <= LogLevel.ERROR) console.error(`${ts()} [${tag}] ${msg}`, ...args);
  },
};
