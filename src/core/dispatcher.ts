import type { EventBus, ControllerEvents } from './events.js';
import { PromptPipeline } from './pipeline.js';
import type { SessionManager } from '../session/manager.js';
import type { AcpClawConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { buildPrompt, formatUserMessage } from '../acp/prompt-builder.js';
import { parseSlashCommand } from '../commands/parser.js';
import { handleCommand } from '../commands/handlers.js';
import type { Lang } from '../commands/i18n.js';
import { readMemoryFile, isTemplateOnly } from '../config.js';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

export interface ChannelReply {
  reply: (messageId: string, text: string) => Promise<void>;
  send: (chatId: string, text: string) => Promise<void>;
  clearReaction: (messageId: string) => Promise<void>;
}

export class MessageDispatcher {
  private eventBus: EventBus;
  private pipeline: PromptPipeline;
  private sessionManager: SessionManager;
  private config: AcpClawConfig;
  private workDir: string;
  private logger: Logger;
  private channel?: ChannelReply;
  private unsubscribes: Array<() => void> = [];

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

    const unsub = this.eventBus.on('message-arrived', (payload) => {
      void this.handleMessage(payload);
    });
    this.unsubscribes.push(unsub);
  }

  setChannel(channel: ChannelReply): void {
    this.channel = channel;
  }

  destroy(): void {
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
  }

  private async handleMessage(payload: ControllerEvents['message-arrived']): Promise<void> {
    const { message: msg, sessionKey, userPrefix } = payload;

    // Check for slash command
    const command = parseSlashCommand(msg.content);
    if (command) {
      const session = this.sessionManager.getSession(sessionKey);
      const isBusy = session?.busy ?? false;
      const result = await handleCommand(command.name, command.args, {
        sessionKey,
        userPrefix,
        sessionManager: this.sessionManager,
        config: this.config,
        isBusy,
        workDir: this.workDir,
        language: (this.config.language ?? 'zh') as Lang,
      });
      if (msg.id) {
        await this.channel?.reply(msg.id, result.text);
      } else if (msg.chatId) {
        await this.channel?.send(msg.chatId, result.text);
      }
      return;
    }

    // Normal message processing
    try {
      // Extract text from message JSON
      let text = msg.content;
      try {
        const parsed = JSON.parse(msg.content);
        if (typeof parsed === 'object' && parsed !== null && typeof parsed.text === 'string') {
          text = parsed.text;
        }
      } catch { }

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

      // 只在新创建 session 时附带 memory/knowledge 文件
      let parts: ReturnType<typeof buildPrompt>;
      if (isNewSession) {
        const filePaths = this.getContextFiles();
        const initGuidance = this.buildInitGuidance();
        const userMsg = formatUserMessage(payload.channel, msg.senderId, text);
        const promptText = initGuidance ? `${initGuidance}\n\n---\n\n${userMsg}` : userMsg;
        parts = buildPrompt(promptText, filePaths);
        session.isNew = false;
      } else {
        parts = buildPrompt(formatUserMessage(payload.channel, msg.senderId, text));
      }

      // Log the prompt being sent
      const promptPreview = text.length > 200 ? text.slice(0, 200) + '...' : text;
      this.logger.info('prompt', `[${sessionKey}] ${promptPreview}`);

      // Execute via pipeline
      const result = await this.pipeline.execute(sessionKey, parts, {
        onText: async (chunk) => {
          console.log(`📝 [agent] ${chunk}`);
          this.logger.info('agent-text-complete', chunk);
          if (msg.id) {
            await this.channel?.reply(msg.id, chunk);
          } else if (msg.chatId) {
            await this.channel?.send(msg.chatId, chunk);
          }
        },
        onTool: async (toolLog) => {
          console.log(`🔧 [tool] ${toolLog}`);
          this.logger.info('agent-tool', `[${sessionKey}] ${toolLog}`);

          // 转发工具调用到 channel（默认关闭，需配置 forwardToolMessages: true）
          if (this.config.forwardToolMessages) {
            const toolMsg = `🔧 工具调用: ${toolLog}`;
            if (msg.id) {
              this.channel?.reply(msg.id, toolMsg).catch(() => { });
            } else if (msg.chatId) {
              this.channel?.send(msg.chatId, toolMsg).catch(() => { });
            }
          }
        },
      });

      // 如果已发送过消息，清除 working emoji
      if (result.hasSentMessage && msg.id) {
        await this.channel?.clearReaction(msg.id);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Error handling message:`, errMsg);
      this.logger.error('error', `[${sessionKey}] ${errMsg}`);
      if (msg.id) {
        await this.channel?.reply(msg.id, `❌ 处理失败: ${errMsg}`);
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
    const files: string[] = [];
    const dirs = [join(this.workDir, 'knowledge'), join(this.workDir, 'memory')];

    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (entry.endsWith('.md')) {
            files.push(join(dir, entry));
          }
        }
      } catch { }
    }

    // Scan skills/*/SKILL.md
    const skillsDir = join(this.workDir, 'skills');
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
      } catch { }
    }

    return files;
  }
}
