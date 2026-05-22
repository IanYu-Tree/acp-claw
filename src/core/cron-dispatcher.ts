import type { EventBus } from './events.js';
import { PromptPipeline } from './pipeline.js';
import type { SessionManager } from '../session/manager.js';
import type { AcpClawConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { buildPrompt } from '../acp/prompt-builder.js';
import type { ScheduledTask } from '../cron/types.js';
import { buildInitialContext, buildInitGuidance } from './context.js';

export interface CronChannelSend {
  send: (chatId: string, text: string) => Promise<void>;
}

export class CronDispatcher {
  private eventBus: EventBus;
  private pipeline: PromptPipeline;
  private sessionManager: SessionManager;
  private config: AcpClawConfig;
  private workDir: string;
  private logger: Logger;
  private channel?: CronChannelSend;

  constructor(params: {
    eventBus: EventBus;
    sessionManager: SessionManager;
    config: AcpClawConfig;
    workDir: string;
    logger: Logger;
  }) {
    this.eventBus = params.eventBus;
    this.sessionManager = params.sessionManager;
    this.config = params.config;
    this.workDir = params.workDir;
    this.logger = params.logger;
    this.pipeline = new PromptPipeline(params.sessionManager, params.config, params.logger);
  }

  setChannel(channel: CronChannelSend): void {
    this.channel = channel;
  }

  /**
   * 处理 cron 触发。由 CronService 回调直接调用。
   */
  async handleTrigger(task: ScheduledTask): Promise<void> {
    const sessionKey = `cron_${task.name}`;
    console.log(`⏰ [cron] Triggered: "${task.name}" → session ${sessionKey}`);
    this.logger.info('cron-trigger', `Task "${task.name}" triggered`, {
      name: task.name,
      schedule: task.schedule,
      prompt: task.prompt,
      chatId: task.chatId,
      oneShot: task.oneShot,
    });

    let fullText = '';

    try {
      const session = await this.sessionManager.getOrCreate(sessionKey);
      const isNewSession = session.isNew;

      let parts: ReturnType<typeof buildPrompt>;
      if (isNewSession) {
        const filePaths = buildInitialContext(this.workDir);
        const initGuidance = buildInitGuidance(this.workDir);
        const promptText = initGuidance ? `${initGuidance}\n\n---\n\n${task.prompt}` : task.prompt;
        parts = buildPrompt(promptText, filePaths);
        session.isNew = false;
      } else {
        parts = buildPrompt(task.prompt);
      }

      const result = await this.pipeline.execute(sessionKey, parts, {
        onText: (text) => {
          fullText += text;
          console.log(`📝 [cron:${task.name}] ${text}`);
          this.logger.info('agent-text-complete', `[${sessionKey}] ${text}`);
        },
        onTool: (toolLog) => {
          console.log(`🔧 [cron:${task.name}] ${toolLog}`);
          this.logger.info('agent-tool', `[${sessionKey}] ${toolLog}`);
        },
      });

      // Send result to channel if chatId is configured
      if (fullText.trim() && task.chatId && this.channel) {
        await this.channel.send(task.chatId, fullText.trim());
      }

      console.log(`✅ [cron] Completed: "${task.name}"`);
      this.logger.info('cron-complete', `Task "${task.name}" completed`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // If there's accumulated content, send it before reporting error
      if (fullText.trim() && task.chatId && this.channel) {
        await this.channel.send(task.chatId, fullText.trim());
        console.warn(`⚠️ [cron:stale-error] Turn already produced output for "${task.name}", suppressing:`, errMsg);
        this.logger.warn('cron-stale-error', `[${sessionKey}] ${errMsg}`);
      } else {
        console.error(`❌ [cron] Error executing "${task.name}":`, errMsg);
        this.logger.error('cron-error', `[${sessionKey}] ${errMsg}`);
      }
    }
  }
}
