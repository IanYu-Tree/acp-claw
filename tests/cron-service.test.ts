import { describe, it, expect, beforeEach, afterEach } from '@rstest/core';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CronService } from '../src/cron/service';
import type { ScheduledTask } from '../src/cron/types';

describe('CronService', () => {
  let workDir: string;
  let service: CronService;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'cron-service-test-'));
    service = new CronService(workDir);
  });

  afterEach(() => {
    service.stop();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('should create scheduler directory on construction', () => {
    expect(existsSync(join(workDir, 'scheduler'))).toBe(true);
  });

  describe('addTask', () => {
    it('should add a task successfully', () => {
      const result = service.addTask({
        name: 'test-task',
        schedule: '*/5 * * * *',
        prompt: 'Hello from cron',
      });
      expect(result.success).toBe(true);
    });

    it('should persist task to tasks.json', () => {
      service.addTask({
        name: 'persist-test',
        schedule: '0 9 * * *',
        prompt: 'Daily reminder',
        chatId: 'chat_123',
      });

      const configPath = join(workDir, 'scheduler', 'tasks.json');
      expect(existsSync(configPath)).toBe(true);

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.tasks).toHaveLength(1);
      expect(config.tasks[0].name).toBe('persist-test');
      expect(config.tasks[0].schedule).toBe('0 9 * * *');
      expect(config.tasks[0].prompt).toBe('Daily reminder');
      expect(config.tasks[0].chatId).toBe('chat_123');
      expect(config.tasks[0].enabled).toBe(true);
      expect(config.tasks[0].oneShot).toBe(false);
      expect(config.tasks[0].nextRun).toBeTruthy();
    });

    it('should reject invalid cron expression', () => {
      const result = service.addTask({
        name: 'bad-cron',
        schedule: 'not-a-cron',
        prompt: 'test',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid cron expression');
    });

    it('should reject duplicate task name', () => {
      service.addTask({
        name: 'dup-task',
        schedule: '*/5 * * * *',
        prompt: 'first',
      });
      const result = service.addTask({
        name: 'dup-task',
        schedule: '*/10 * * * *',
        prompt: 'second',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should reject missing required fields', () => {
      expect(
        service.addTask({
          name: '',
          schedule: '* * * * *',
          prompt: 'x',
        }).success,
      ).toBe(false);
      expect(
        service.addTask({
          name: 'x',
          schedule: '',
          prompt: 'x',
        }).success,
      ).toBe(false);
      expect(
        service.addTask({
          name: 'x',
          schedule: '* * * * *',
          prompt: '',
        }).success,
      ).toBe(false);
    });
  });

  describe('deleteTask', () => {
    it('should delete an existing task', () => {
      service.addTask({
        name: 'to-delete',
        schedule: '*/5 * * * *',
        prompt: 'msg',
      });
      const result = service.deleteTask('to-delete');
      expect(result.success).toBe(true);
      expect(service.listTasks()).toHaveLength(0);
    });

    it('should fail when task does not exist', () => {
      const result = service.deleteTask('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Task not found');
    });
  });

  describe('toggleTask', () => {
    it('should disable and re-enable a task', () => {
      service.addTask({
        name: 'toggleable',
        schedule: '*/5 * * * *',
        prompt: 'msg',
      });

      const disableResult = service.toggleTask('toggleable', false);
      expect(disableResult.success).toBe(true);
      expect(service.listTasks()[0].enabled).toBe(false);
      expect(service.listTasks()[0].nextRun).toBeNull();

      const enableResult = service.toggleTask('toggleable', true);
      expect(enableResult.success).toBe(true);
      expect(service.listTasks()[0].enabled).toBe(true);
      expect(service.listTasks()[0].nextRun).toBeTruthy();
    });

    it('should fail when task does not exist', () => {
      const result = service.toggleTask('ghost', true);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Task not found');
    });
  });

  describe('listTasks', () => {
    it('should list all tasks', () => {
      service.addTask({
        name: 'task-a',
        schedule: '*/5 * * * *',
        prompt: 'a',
      });
      service.addTask({
        name: 'task-b',
        schedule: '*/10 * * * *',
        prompt: 'b',
      });
      expect(service.listTasks()).toHaveLength(2);
    });

    it('should return empty array when no tasks', () => {
      expect(service.listTasks()).toHaveLength(0);
    });
  });

  describe('persistence and reload', () => {
    it('should reload tasks from disk on new instance', () => {
      service.addTask({
        name: 'reload-test',
        schedule: '*/5 * * * *',
        prompt: 'hello',
      });
      service.stop();

      // 新实例构造时自动 loadConfig
      const service2 = new CronService(workDir);

      const tasks = service2.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe('reload-test');
      expect(tasks[0].prompt).toBe('hello');

      service2.stop();
    });

    it('should handle corrupted config gracefully', () => {
      const configPath = join(workDir, 'scheduler', 'tasks.json');
      writeFileSync(configPath, '{ invalid json }}}', 'utf-8');

      const service2 = new CronService(workDir);

      expect(service2.listTasks()).toHaveLength(0);

      service2.stop();
    });

    it('should backup corrupted config file', () => {
      const configPath = join(workDir, 'scheduler', 'tasks.json');
      writeFileSync(configPath, '{ invalid json }}}', 'utf-8');

      new CronService(workDir);

      // 应该存在 .corrupted.xxx 备份文件
      const schedulerDir = join(workDir, 'scheduler');
      const files = readdirSync(schedulerDir);
      const backupFiles = files.filter((f) => f.includes('.corrupted.'));
      expect(backupFiles.length).toBeGreaterThan(0);
    });
  });

  describe('oneShot tasks', () => {
    it('should store oneShot flag', () => {
      service.addTask({
        name: 'one-shot',
        schedule: '*/5 * * * *',
        prompt: 'fire once',
        oneShot: true,
      });

      const tasks = service.listTasks();
      expect(tasks[0].oneShot).toBe(true);
    });
  });

  describe('onTrigger callback', () => {
    it('should register and not fire on add', () => {
      const triggered: ScheduledTask[] = [];
      const cbWorkDir = mkdtempSync(join(tmpdir(), 'cron-cb-test-'));
      const serviceWithCallback = new CronService(cbWorkDir, (task) =>
        triggered.push(task),
      );

      serviceWithCallback.addTask({
        name: 'trigger-test',
        schedule: '*/5 * * * *',
        prompt: 'test',
      });

      expect(triggered).toHaveLength(0);

      serviceWithCallback.stop();
      rmSync(cbWorkDir, { recursive: true, force: true });
    });
  });
});
