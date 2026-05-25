import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export class Logger {
  private logsDir: string;
  private currentDate = '';
  private currentFile = '';

  constructor(workDir: string) {
    this.logsDir = join(workDir, 'logs');
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
  }

  log(
    level: LogLevel,
    category: string,
    message: string,
    data?: unknown,
  ): void {
    const now = new Date();
    const dateStr = this.formatDate(now);
    const timeStr = this.formatTime(now);

    if (dateStr !== this.currentDate) {
      this.currentDate = dateStr;
      this.currentFile = join(this.logsDir, `${dateStr}.log`);
    }

    let line = `[${timeStr}] [${level.toUpperCase()}] [${category}] ${message}`;
    if (data !== undefined) {
      try {
        line += ` ${JSON.stringify(data)}`;
      } catch {
        line += ` [unserializable]`;
      }
    }

    try {
      appendFileSync(this.currentFile, line + '\n', 'utf-8');
    } catch {
      // Silently ignore write errors
    }
  }

  info(category: string, message: string, data?: unknown): void {
    this.log('info', category, message, data);
  }

  warn(category: string, message: string, data?: unknown): void {
    this.log('warn', category, message, data);
  }

  error(category: string, message: string, data?: unknown): void {
    this.log('error', category, message, data);
  }

  debug(category: string, message: string, data?: unknown): void {
    this.log('debug', category, message, data);
  }

  cleanOldLogs(maxAgeDays = 30): void {
    if (!existsSync(this.logsDir)) return;

    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    try {
      const files = readdirSync(this.logsDir);
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        const dateStr = file.replace('.log', '');
        const fileDate = new Date(dateStr);
        if (isNaN(fileDate.getTime())) continue;

        if (now - fileDate.getTime() > maxAgeMs) {
          try {
            unlinkSync(join(this.logsDir, file));
          } catch {}
        }
      }
    } catch {}
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private formatTime(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
}

export function createLogger(workDir: string): Logger {
  return new Logger(workDir);
}
