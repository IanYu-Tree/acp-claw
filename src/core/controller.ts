import { FeishuChannel, type FeishuMessage } from '../channel/feishu.js';
import { SessionManager, getUserPrefix } from '../session/manager.js';
import { SessionStore } from '../session/store.js';
import { type AcpClawConfig } from '../config.js';
import { createLogger, type Logger } from '../logger.js';
import { CronService } from '../cron/service.js';
import type { ScheduledTask } from '../cron/types.js';
import { EventBus } from './events.js';
import { MessageDispatcher } from './dispatcher.js';
import { CronDispatcher } from './cron-dispatcher.js';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

export class Controller {
  private eventBus: EventBus;
  private dispatcher: MessageDispatcher;
  private cronDispatcher: CronDispatcher;
  private feishuChannel?: FeishuChannel;
  private cronService?: CronService;
  private sessionManager: SessionManager;
  private store: SessionStore;
  private config: AcpClawConfig;
  private workDir: string;
  private stopped = false;
  private saveInterval?: ReturnType<typeof setInterval>;
  private startedAt = Date.now();
  private logger: Logger;

  constructor(config: AcpClawConfig, workDir: string) {
    this.config = config;
    this.workDir = workDir;
    this.logger = createLogger(workDir);

    // Ensure directories
    const sessionsDir = join(workDir, 'sessions');
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }

    this.store = new SessionStore(sessionsDir);
    this.sessionManager = new SessionManager(config, workDir);

    // 初始化 EventBus
    this.eventBus = new EventBus();

    // 初始化 MessageDispatcher
    this.dispatcher = new MessageDispatcher({
      eventBus: this.eventBus,
      sessionManager: this.sessionManager,
      config,
      workDir,
      logger: this.logger,
    });

    // 初始化 CronDispatcher
    this.cronDispatcher = new CronDispatcher({
      eventBus: this.eventBus,
      sessionManager: this.sessionManager,
      config,
      workDir,
      logger: this.logger,
    });
  }

  async start(): Promise<void> {
    console.log('🚀 Starting ACP Claw');
    this.logger.cleanOldLogs(30);
    console.log(`   Work directory: ${this.workDir}`);
    console.log(`   Default agent: ${this.config.defaultAgent}`);

    // Restore previous sessions
    await this.sessionManager.restore();

    // Start Feishu channel if configured
    if (this.config.feishu) {
      this.feishuChannel = new FeishuChannel(this.config.feishu);

      // 注册消息处理：feishu onMessage → eventBus.emit('message-arrived')
      this.feishuChannel.onMessage((msg: FeishuMessage) => {
        const userPrefix = getUserPrefix('feishu', msg.senderId);
        const sessionKey = this.sessionManager.getActiveSessionKey(userPrefix);
        this.eventBus.emit('message-arrived', {
          message: {
            id: msg.id,
            content: msg.content,
            senderId: msg.senderId,
            chatId: msg.chatId,
            chatType: msg.chatType,
          },
          channel: 'feishu',
          sessionKey,
          userPrefix,
        });
      });

      // 注入 channel 给 dispatcher
      this.dispatcher.setChannel({
        reply: (id, text) => this.feishuChannel!.reply(id, text),
        send: (chatId, text) => this.feishuChannel!.send(chatId, text),
        clearReaction: (id) => this.feishuChannel!.clearReaction(id),
      });
      this.cronDispatcher.setChannel({
        send: (chatId, text) => this.feishuChannel!.send(chatId, text),
      });

      await this.feishuChannel.start();
      console.log('✅ Feishu Channel started');
    } else {
      console.log('⚠️  Feishu Channel not configured');
    }

    // Start CronService
    this.cronService = new CronService(this.workDir, (task: ScheduledTask) => this.cronDispatcher.handleTrigger(task));
    this.cronService.start();
    console.log('✅ CronService started');

    // Periodic state saving
    this.saveInterval = setInterval(() => this.saveState(), this.config.stateSaveIntervalMs ?? 30_000);

    // Signal handlers
    this.registerSignalHandlers();
    console.log('✅ ACP Claw is running');

    await this.keepAlive();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    console.log('🛑 Stopping ACP Claw');

    if (this.saveInterval) clearInterval(this.saveInterval);
    this.saveState();
    this.dispatcher.destroy();
    this.cronService?.stop();
    await this.feishuChannel?.stop();
    await this.sessionManager.shutdownAll();
    this.eventBus.removeAll();
  }

  private saveState(): void {
    this.sessionManager.saveAll();
    this.store.saveControllerState({
      startedAt: this.startedAt,
      lastActivityAt: Date.now(),
      activeSessions: this.sessionManager.listActive().map(s => s.sessionKey),
    });
  }

  private registerSignalHandlers(): void {
    const gracefulShutdown = async () => {
      await this.stop();
      process.exit(0);
    };
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    process.on('beforeExit', () => this.saveState());
  }

  private keepAlive(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.stopped) { resolve(); return; }
        setTimeout(check, 5000);
      };
      check();
    });
  }
}
