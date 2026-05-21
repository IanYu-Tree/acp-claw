import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  watch,
  type FSWatcher,
} from 'fs';
import { join } from 'path';
import cron, { type ScheduledTask as CronJob } from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import type { ScheduledTask, CronConfig } from './types.js';

export interface CronLogger {
  info(msg: string): void;
  error(msg: string, err?: unknown): void;
}

const defaultLogger: CronLogger = {
  info: (msg) => console.log(`[cron] ${msg}`),
  error: (msg, err) => console.error(`[cron] ${msg}`, err ?? ''),
};

export class CronService {
  private workDir: string;
  private configPath: string;
  private config: CronConfig = { tasks: [] };
  private cronJobs = new Map<string, CronJob>();
  private onTrigger?: (task: ScheduledTask) => Promise<void> | void;
  private runningTasks = new Set<Promise<void>>();
  private watcher: FSWatcher | null = null;
  private logger: CronLogger;

  // 防抖和自触发保护
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isSaving = false;
  private static readonly DEBOUNCE_MS = 200;

  constructor(
    workDir: string,
    onTrigger?: (task: ScheduledTask) => Promise<void> | void,
    logger?: CronLogger,
  ) {
    this.workDir = workDir;
    this.onTrigger = onTrigger;
    this.logger = logger ?? defaultLogger;
    const schedulerDir = join(workDir, 'scheduler');
    if (!existsSync(schedulerDir)) {
      mkdirSync(schedulerDir, { recursive: true });
    }
    this.configPath = join(schedulerDir, 'tasks.json');
    // 构造时加载配置，确保 CLI 等场景下也能正常工作
    this.loadConfig();
  }

  start(): void {
    for (const task of this.config.tasks) {
      if (task.enabled) {
        this.startCronJob(task);
      }
    }
    this.startWatcher();
    this.logger.info('CronService started');
  }

  async stop(): Promise<void> {
    this.stopWatcher();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const job of this.cronJobs.values()) {
      job.stop();
    }
    this.cronJobs.clear();
    // 等待所有正在执行的任务完成
    if (this.runningTasks.size > 0) {
      this.logger.info(`Waiting for ${this.runningTasks.size} running task(s) to complete...`);
      await Promise.allSettled([...this.runningTasks]);
    }
    this.logger.info('CronService stopped');
  }

  addTask(params: {
    name: string;
    schedule: string;
    prompt: string;
    chatId?: string;
    oneShot?: boolean;
  }): { success: boolean; error?: string } {
    if (!params.name) return { success: false, error: 'name is required' };
    if (!params.schedule) return { success: false, error: 'schedule is required' };
    if (!params.prompt) return { success: false, error: 'prompt is required' };

    if (!cron.validate(params.schedule)) {
      return { success: false, error: `Invalid cron expression: ${params.schedule}` };
    }

    const existing = this.config.tasks.find((t) => t.name === params.name);
    if (existing) {
      return { success: false, error: `Task "${params.name}" already exists` };
    }

    const task: ScheduledTask = {
      name: params.name,
      schedule: params.schedule,
      prompt: params.prompt,
      chatId: params.chatId,
      oneShot: params.oneShot ?? false,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRun: null,
      nextRun: this.calculateNextRun(params.schedule),
    };

    this.config.tasks.push(task);
    this.saveConfig();
    this.startCronJob(task);

    this.logger.info(`Task added: "${params.name}" [${params.schedule}]`);
    return { success: true };
  }

  deleteTask(name: string): { success: boolean; error?: string } {
    const index = this.config.tasks.findIndex((t) => t.name === name);
    if (index === -1) return { success: false, error: `Task not found: ${name}` };

    const job = this.cronJobs.get(name);
    if (job) {
      job.stop();
      this.cronJobs.delete(name);
    }

    this.config.tasks.splice(index, 1);
    this.saveConfig();

    this.logger.info(`Task deleted: "${name}"`);
    return { success: true };
  }

  listTasks(): ScheduledTask[] {
    return [...this.config.tasks];
  }

  toggleTask(name: string, enabled: boolean): { success: boolean; error?: string } {
    const task = this.config.tasks.find((t) => t.name === name);
    if (!task) return { success: false, error: `Task not found: ${name}` };

    task.enabled = enabled;

    if (enabled) {
      task.nextRun = this.calculateNextRun(task.schedule);
      this.startCronJob(task);
    } else {
      task.nextRun = null;
      const job = this.cronJobs.get(name);
      if (job) {
        job.stop();
        this.cronJobs.delete(name);
      }
    }

    this.saveConfig();
    this.logger.info(`Task toggled: "${name}" → ${enabled ? 'enabled' : 'disabled'}`);
    return { success: true };
  }

  private startCronJob(task: ScheduledTask): void {
    const existing = this.cronJobs.get(task.name);
    if (existing) {
      existing.stop();
    }

    const taskName = task.name;
    const job = cron.schedule(task.schedule, () => {
      try {
        const currentTask = this.config.tasks.find((t) => t.name === taskName);
        if (currentTask) {
          this.executeTask(currentTask);
        }
      } catch (err) {
        this.logger.error(`Error executing task "${taskName}"`, err);
      }
    });

    this.cronJobs.set(task.name, job);
  }

  private executeTask(task: ScheduledTask): void {
    task.lastRun = new Date().toISOString();
    task.nextRun = this.calculateNextRun(task.schedule);

    const run = async () => {
      try {
        await this.onTrigger?.(task);
      } catch (err) {
        this.logger.error(`onTrigger error for task "${task.name}"`, err);
      }

      if (task.oneShot) {
        this.saveConfig();
        setImmediate(() => this.deleteTask(task.name));
      } else {
        this.saveConfig();
      }
    };

    const promise = run();
    this.runningTasks.add(promise);
    promise.finally(() => this.runningTasks.delete(promise));
  }

  private calculateNextRun(schedule: string): string | null {
    try {
      const interval = CronExpressionParser.parse(schedule);
      return interval.next().toISOString();
    } catch {
      return null;
    }
  }

  private loadConfig(): void {
    if (existsSync(this.configPath)) {
      try {
        const raw = readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(raw) as CronConfig;
      } catch (err) {
        // 备份损坏的配置文件
        const backupPath = this.configPath + `.corrupted.${Date.now()}`;
        try {
          copyFileSync(this.configPath, backupPath);
          this.logger.error(`Config corrupted, backed up to ${backupPath}`, err);
        } catch {
          this.logger.error('Config corrupted and backup failed', err);
        }
        this.config = { tasks: [] };
        this.saveConfig();
      }
    } else {
      this.config = { tasks: [] };
      this.saveConfig();
    }
  }

  private saveConfig(): void {
    this.isSaving = true;
    try {
      const tmpPath = this.configPath + '.tmp';
      writeFileSync(tmpPath, JSON.stringify(this.config, null, 2), 'utf-8');
      renameSync(tmpPath, this.configPath);
    } finally {
      // 延迟重置标志，给 fs.watch 事件时间传播
      setTimeout(() => {
        this.isSaving = false;
      }, 50);
    }
  }

  private startWatcher(): void {
    // 确保 configPath 存在（loadConfig 已保证创建）
    if (!existsSync(this.configPath)) {
      this.saveConfig();
    }

    this.watcher = watch(this.configPath, (eventType) => {
      if (eventType === 'change') {
        // 自触发保护：忽略自己 saveConfig 引发的变更
        if (this.isSaving) return;

        // 防抖：合并短时间内的多次事件
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          this.reconcile();
        }, CronService.DEBOUNCE_MS);
      }
    });
  }

  private stopWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private reconcile(): void {
    let newConfig: CronConfig;
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      newConfig = JSON.parse(raw) as CronConfig;
    } catch {
      return;
    }

    const newTaskNames = new Set(newConfig.tasks.map((t) => t.name));
    const oldTaskNames = new Set(this.config.tasks.map((t) => t.name));

    // Stop removed tasks
    for (const name of oldTaskNames) {
      if (!newTaskNames.has(name)) {
        const job = this.cronJobs.get(name);
        if (job) {
          job.stop();
          this.cronJobs.delete(name);
        }
      }
    }

    // Start new or changed tasks
    for (const task of newConfig.tasks) {
      if (!oldTaskNames.has(task.name)) {
        if (task.enabled) {
          this.startCronJob(task);
        }
      } else {
        const oldTask = this.config.tasks.find((t) => t.name === task.name);
        if (oldTask && (oldTask.schedule !== task.schedule || oldTask.enabled !== task.enabled)) {
          const job = this.cronJobs.get(task.name);
          if (job) {
            job.stop();
            this.cronJobs.delete(task.name);
          }
          if (task.enabled) {
            this.startCronJob(task);
          }
        }
      }
    }

    this.config = newConfig;
    this.logger.info(`Config reloaded: ${newConfig.tasks.length} tasks`);
  }
}
