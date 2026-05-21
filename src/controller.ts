import { FeishuChannel, type FeishuMessage } from './channel/feishu.js';
import { SessionManager } from './session/manager.js';
import { SessionStore } from './session/store.js';
import { getSessionKey } from './session/router.js';
import { buildPrompt, formatUserMessage } from './acp/prompt-builder.js';
import { parseSlashCommand } from './commands/parser.js';
import { handleCommand } from './commands/handlers.js';
import { type AcpClawConfig, readMemoryFile, isTemplateOnly } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { CronService } from './cron/service.js';
import type { ScheduledTask } from './cron/types.js';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import type { Lang } from './commands/i18n.js';

export function buildInitialContext(workDir: string): string[] {
  const files: string[] = [];
  const dirs = [join(workDir, 'knowledge'), join(workDir, 'memory')];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith('.md')) {
          files.push(join(dir, entry));
        }
      }
    } catch {}
  }

  // Scan skills/*/SKILL.md
  const skillsDir = join(workDir, 'skills');
  if (existsSync(skillsDir)) {
    try {
      const skillFolders = readdirSync(skillsDir, { withFileTypes: true });
      for (const folder of skillFolders) {
        if (folder.isDirectory()) {
          const skillFile = join(skillsDir, folder.name, 'SKILL.md');
          if (existsSync(skillFile)) {
            files.push(skillFile);
          }
        }
      }
    } catch {}
  }

  return files;
}

export class Controller {
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

    // Ensure directories exist
    const sessionsDir = join(workDir, 'sessions');
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }

    this.store = new SessionStore(sessionsDir);
    this.sessionManager = new SessionManager(config, workDir);
  }

  async start(): Promise<void> {
    console.log('🚀 Starting ACP Claw');
    // Clean old logs on startup
    this.logger.cleanOldLogs(30);
    console.log(`   Work directory: ${this.workDir}`);
    console.log(`   Default agent: ${this.config.defaultAgent}`);

    // Restore previous sessions
    await this.sessionManager.restore();

    // Start Feishu channel if configured
    if (this.config.feishu) {
      this.feishuChannel = new FeishuChannel(this.config.feishu);
      this.feishuChannel.onMessage((msg) => this.handleMessage(msg));
      await this.feishuChannel.start();
      console.log('✅ Feishu Channel started');
    } else {
      console.log('⚠️  Feishu Channel not configured');
    }

    // Start CronService
    this.cronService = new CronService(this.workDir, (task) => this.handleCronTrigger(task));
    this.cronService.start();
    console.log('✅ CronService started');

    // Start periodic state saving
    this.saveInterval = setInterval(() => {
      this.saveState();
    }, this.config.stateSaveIntervalMs ?? 30_000);

    // Register crash protection
    this.registerSignalHandlers();

    console.log('✅ ACP Claw is running');

    // Keep the process alive
    await this.keepAlive();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    console.log('🛑 Stopping ACP Claw');

    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }

    this.saveState();
    this.cronService?.stop();
    await this.feishuChannel?.stop();
    await this.sessionManager.closeAll();
  }

  private async handleMessage(msg: FeishuMessage): Promise<void> {
    const sessionKey = getSessionKey('feishu', msg.senderId);

    // Check for slash command
    const command = parseSlashCommand(msg.content);
    if (command) {
      const session = this.sessionManager.getSession(sessionKey);
      const isBusy = session?.busy ?? false;
      const result = await handleCommand(command.name, command.args, {
        sessionKey,
        sessionManager: this.sessionManager,
        config: this.config,
        isBusy,
        workDir: this.workDir,
        language: (this.config.language ?? 'zh') as Lang,
      });
      // Reply with command result
      if (msg.id) {
        await this.feishuChannel?.reply(msg.id, result.text);
      } else if (msg.chatId) {
        await this.feishuChannel?.send(msg.chatId, result.text);
      }
      return;
    }

    // Normal message → forward to ACP session
    try {
      // Extract text from Feishu message JSON
      let text = msg.content;
      try {
        const parsed = JSON.parse(msg.content);
        if (typeof parsed === 'object' && parsed !== null && typeof parsed.text === 'string') {
          text = parsed.text;
        }
      } catch {}

      // 群聊消息去掉 @BotName 前缀
      if (msg.chatType === 'group' && this.config.feishu?.appName) {
        text = text.replace(new RegExp(`@${this.config.feishu.appName}\\s*`), '').trim();
      }

      // 检查 session 是否正在处理中，如果是则打断
      const existingSession = this.sessionManager.getSession(sessionKey);
      if (existingSession?.busy) {
        console.log(`⚡ [interrupt] Cancelling current prompt on ${sessionKey}`);
        await this.sessionManager.cancel(sessionKey);
      }

      // Ensure session exists, check if it's newly created
      const session = await this.sessionManager.getOrCreate(sessionKey);
      const isNewSession = session.isNew;

      // 只在新创建 session 时附带 memory/knowledge 文件（类似 claw 初始化）
      // 后续消息只传用户文本
      let parts: ReturnType<typeof buildPrompt>;
      if (isNewSession) {
        const filePaths = this.getContextFiles();

        // 检测 memory 是否需要初始化引导
        const initGuidance = this.buildInitGuidance();
        const userMsg = formatUserMessage('feishu', msg.senderId, text);
        const promptText = initGuidance ? `${initGuidance}\n\n---\n\n${userMsg}` : userMsg;
        parts = buildPrompt(promptText, filePaths);

        // 标记为非新 session，下次不再传 memory
        session.isNew = false;
      } else {
        parts = buildPrompt(formatUserMessage('feishu', msg.senderId, text));
      }

      // Log the prompt being sent
      const promptPreview = text.length > 200 ? text.slice(0, 200) + '...' : text;
      this.logger.info('prompt', `[${sessionKey}] ${promptPreview}`);

      // 流式转发状态
      let textBuffer = '';
      let hasSentMessage = false;

      const flushBuffer = async () => {
        if (!textBuffer || !textBuffer.trim()) {
          textBuffer = '';
          return;
        }
        const text = textBuffer;
        textBuffer = '';
        hasSentMessage = true;
        console.log(`📝 [agent] ${text}`);
        this.logger.info('agent-text-complete', text);
        if (msg.id) {
          await this.feishuChannel?.reply(msg.id, text);
        } else if (msg.chatId) {
          await this.feishuChannel?.send(msg.chatId, text);
        }
      };

      await this.sessionManager.prompt(sessionKey, parts, (update) => {
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.text) {
          textBuffer += update.content.text;
        } else if (update.sessionUpdate && update.sessionUpdate !== 'agent_message_chunk') {
          // 收到非文本事件（tool call 等）时，先 flush 已累积的文本
          if (textBuffer.trim()) {
            flushBuffer();
          }

          if (update.title) {
            let toolLog = `🔧 [tool] ${update.title}`;
            if (update.rawInput !== undefined) {
              toolLog += ` | input: ${truncate(JSON.stringify(update.rawInput), 300)}`;
            }
            if (update.rawOutput !== undefined) {
              toolLog += ` | output: ${truncate(JSON.stringify(update.rawOutput), 300)}`;
            }
            console.log(toolLog);
            this.logger.info('agent-tool', `[${sessionKey}] ${toolLog}`);

            // 转发工具调用到 channel（默认关闭，需配置 forwardToolMessages: true）
            if (this.config.forwardToolMessages) {
              let toolMsg = `🔧 工具调用: ${update.title}`;
              if (update.rawInput !== undefined) {
                toolMsg += `\n参数: ${truncate(JSON.stringify(update.rawInput), 300)}`;
              }
              if (msg.id) {
                this.feishuChannel?.reply(msg.id, toolMsg).catch(() => {});
              } else if (msg.chatId) {
                this.feishuChannel?.send(msg.chatId, toolMsg).catch(() => {});
              }
            }
          }
        }
      });

      // prompt 结束后统一发送累积的文本
      await flushBuffer();

      // 如果已发送过消息，清除 working emoji
      if (hasSentMessage && msg.id) {
        await this.feishuChannel?.clearReaction(msg.id);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Error handling message:`, errMsg);
      this.logger.error('error', `[${sessionKey}] ${errMsg}`);
      if (msg.id) {
        await this.feishuChannel?.reply(msg.id, `❌ 处理失败: ${errMsg}`);
      }
    }
  }

  private buildInitGuidance(): string | null {
    const identity = readMemoryFile(this.workDir, 'IDENTITY.md');
    const user = readMemoryFile(this.workDir, 'USER.md');
    const soul = readMemoryFile(this.workDir, 'SOUL.md');
    const agents = readMemoryFile(this.workDir, 'AGENTS.md');
    const tools = readMemoryFile(this.workDir, 'TOOLS.md');

    const hasIdentity = identity && !isTemplateOnly(identity);
    const hasUser = user && !isTemplateOnly(user);
    const hasSoul = soul && !isTemplateOnly(soul);
    const hasAgents = agents && !isTemplateOnly(agents);
    const hasTools = tools && !isTemplateOnly(tools);

    const missingFiles: string[] = [];
    if (!hasIdentity) missingFiles.push('IDENTITY.md');
    if (!hasUser) missingFiles.push('USER.md');
    if (!hasSoul) missingFiles.push('SOUL.md');
    if (!hasAgents) missingFiles.push('AGENTS.md');
    if (!hasTools) missingFiles.push('TOOLS.md');

    if (missingFiles.length === 0) return null;

    let guidance = `## ⚠️ MEMORY SETUP REQUIRED (FIRST PRIORITY)\n\n`;
    guidance += `The following memory files are not yet configured: **${missingFiles.join(', ')}**\n\n`;
    guidance += `You MUST guide the user to set up these files, starting with **IDENTITY.md**.\n\n`;
    guidance += `### Setup Steps for IDENTITY.md:\n`;
    guidance += `1. **Greet the user** and explain you need to set up your identity\n`;
    guidance += `2. **Ask the user** the following questions:\n`;
    guidance += `   - What name would you like to call me?\n`;
    guidance += `   - What type of assistant should I be? (e.g., personal assistant, coding helper, project manager)\n`;
    guidance += `   - What emoji represents me best?\n`;
    guidance += `   - What personality/style should I have?\n`;
    guidance += `   - Any specific self-introduction you'd like me to use?\n\n`;
    guidance += `3. **After collecting information**, update \`${this.workDir}/memory/IDENTITY.md\` with the identity info\n\n`;
    guidance += `### Other Memory Files (set up after IDENTITY.md):\n`;
    guidance += `- **USER.md**: Ask user about their background, work field, preferences\n`;
    guidance += `- **SOUL.md**: You can evolve this yourself based on behavioral insights\n`;
    guidance += `- **AGENTS.md**: You can add better workflows and rules as you learn\n`;
    guidance += `- **TOOLS.md**: Add environment info, paths, configurations as you discover them\n\n`;
    guidance += `**This is your FIRST priority when interacting with a new user. Do NOT skip this step.**`;

    return guidance;
  }

  private getContextFiles(): string[] {
    return buildInitialContext(this.workDir);
  }

  private async handleCronTrigger(task: ScheduledTask): Promise<void> {
    const sessionKey = `cron_${task.name}`;
    console.log(`⏰ [cron] Triggered: "${task.name}" → session ${sessionKey}`);
    this.logger.info('cron-trigger', `Task "${task.name}" triggered`, {
      name: task.name,
      schedule: task.schedule,
      prompt: task.prompt,
      chatId: task.chatId,
      oneShot: task.oneShot,
    });

    try {
      const session = await this.sessionManager.getOrCreate(sessionKey);
      const isNewSession = session.isNew;

      let parts: ReturnType<typeof buildPrompt>;
      if (isNewSession) {
        const filePaths = buildInitialContext(this.workDir);
        const initGuidance = this.buildInitGuidance();
        const promptText = initGuidance ? `${initGuidance}\n\n---\n\n${task.prompt}` : task.prompt;
        parts = buildPrompt(promptText, filePaths);
        session.isNew = false;
      } else {
        parts = buildPrompt(task.prompt);
      }

      let textBuffer = '';
      let fullText = '';

      const flushBuffer = () => {
        if (!textBuffer || !textBuffer.trim()) {
          textBuffer = '';
          return;
        }
        const text = textBuffer;
        textBuffer = '';
        fullText += text;
        console.log(`📝 [cron:${task.name}] ${text}`);
        this.logger.info('agent-text-complete', `[${sessionKey}] ${text}`);
      };

      await this.sessionManager.prompt(sessionKey, parts, (update) => {
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.text) {
          textBuffer += update.content.text;
        } else if (update.sessionUpdate && update.sessionUpdate !== 'agent_message_chunk') {
          // 收到非文本事件时，先 flush 已累积的文本
          if (textBuffer.trim()) {
            flushBuffer();
          }

          if (update.title) {
            let toolLog = `🔧 [tool] ${update.title}`;
            if (update.rawInput !== undefined) {
              toolLog += ` | input: ${truncate(JSON.stringify(update.rawInput), 300)}`;
            }
            if (update.rawOutput !== undefined) {
              toolLog += ` | output: ${truncate(JSON.stringify(update.rawOutput), 300)}`;
            }
            console.log(toolLog);
            this.logger.info('agent-tool', `[${sessionKey}] ${toolLog}`);
          }
        }
      });

      // prompt 结束后 flush 剩余文本
      flushBuffer();

      // Send result to feishu if chatId is configured
      if (fullText.trim() && task.chatId && this.feishuChannel) {
        await this.feishuChannel.send(task.chatId, fullText.trim());
      }

      console.log(`✅ [cron] Completed: "${task.name}"`);
      this.logger.info('cron-complete', `Task "${task.name}" completed`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ [cron] Error executing "${task.name}":`, errMsg);
      this.logger.error('cron-error', `[${sessionKey}] ${errMsg}`);
    }
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
        if (this.stopped) {
          resolve();
          return;
        }
        setTimeout(check, 5000);
      };
      check();
    });
  }
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}
