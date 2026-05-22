import type { SessionUpdate } from '../acp/client.js';
import { buildPrompt, type ContentBlock } from '../acp/prompt-builder.js';
import type { AcpClawConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { SessionManager } from '../session/manager.js';
import { DEFAULT_REFLEXION_PROMPT } from './reflexion-prompt.js';

export enum PipelineState {
  IDLE = 'IDLE',
  EXECUTING = 'EXECUTING',
  REFLECTING = 'REFLECTING',
  COMPLETED = 'COMPLETED',
}

export interface PipelineCallbacks {
  onText: (text: string) => void | Promise<void>;
  onTool: (toolLog: string) => void | Promise<void>;
}

export interface PipelineResult {
  hasSentMessage: boolean;
  turnCompleted: boolean;
  totalText: string;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

export class PromptPipeline {
  private sessionManager: SessionManager;
  private config: AcpClawConfig;
  private logger: Logger;
  private state: PipelineState = PipelineState.IDLE;

  constructor(
    sessionManager: SessionManager,
    config: AcpClawConfig,
    logger: Logger,
  ) {
    this.sessionManager = sessionManager;
    this.config = config;
    this.logger = logger;
  }

  get currentState(): PipelineState {
    return this.state;
  }

  /**
   * 执行 prompt，包含状态流转 + 可选反思注入。
   *
   * 流程：IDLE → EXECUTING → (REFLECTING) → COMPLETED
   *
   * @param sessionKey - 会话 key
   * @param parts - prompt 内容块
   * @param callbacks - onText/onTool 回调（仅 EXECUTING 阶段触发，REFLECTING 阶段不触发）
   * @returns PipelineResult
   */
  async execute(
    sessionKey: string,
    parts: ContentBlock[],
    callbacks: PipelineCallbacks,
  ): Promise<PipelineResult> {
    this.state = PipelineState.EXECUTING;

    let textBuffer = '';
    let totalText = '';
    let hasSentMessage = false;
    let turnCompleted = false;
    let currentMessageId: string | undefined;
    // 标记是否已收到当前 prompt 的 user_message_chunk echo
    // 在此之前的所有 agent 消息都是历史回放，应忽略
    let seenUserMessageEcho = false;

    // 独立发送队列 — 不阻塞 update 处理，按顺序并行发送
    let sendChain = Promise.resolve();
    const enqueueSend = (fn: () => void | Promise<void>) => {
      sendChain = sendChain.then(fn).catch((e) => {
        this.logger.warn('pipeline:send', 'Send failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      });
    };

    const flushText = () => {
      if (textBuffer.length > 0) {
        const chunk = textBuffer;
        textBuffer = '';
        totalText += chunk;
        if (chunk.trim().length > 0) {
          hasSentMessage = true;
          enqueueSend(() => callbacks.onText(chunk));
        }
      }
    };

    const onUpdate = (update: SessionUpdate) => {
      // 详细流式日志 — 打印完整 update 到控制台
      console.log('[pipeline:stream]', JSON.stringify(update));

      if (update.stopReason) {
        turnCompleted = true;
      }

      // 每次看到 user_message_chunk 就重置所有累积状态。
      // 回放（replay）会按历史顺序重发所有 turn：user→agent→user→agent→...→user(当前)→agent(新响应)
      // 每次重置保证只有最后一个 user_message_chunk 之后的 agent 消息被转发。
      if (update.sessionUpdate === 'user_message_chunk') {
        textBuffer = '';
        totalText = '';
        hasSentMessage = false;
        currentMessageId = undefined;
        seenUserMessageEcho = true;
        return;
      }

      // 忽略 agent_thought_chunk（思考过程不转发）
      if (update.sessionUpdate === 'agent_thought_chunk') {
        return;
      }

      // 未看到任何 user echo 前，跳过（不应该发生，但作为安全守卫）
      if (!seenUserMessageEcho) {
        return;
      }

      if (
        update.sessionUpdate === 'agent_message_chunk' &&
        update.content?.text
      ) {
        const msgId = update._meta?.id;
        const metaType = update._meta?.type;

        if (metaType === 'full') {
          // type=full: 完整替换当前消息文本（流式快照模式）
          // 不同 ID = 新逻辑消息，flush 上一条
          if (msgId && msgId !== currentMessageId) {
            flushText();
            currentMessageId = msgId;
          }
          textBuffer = update.content.text;
        } else {
          // type=partial/delta 或无 meta: 追加累积，不按 ID 拆分
          textBuffer += update.content.text;
        }

        // lastChunk 标记当前消息结束，flush 并重置
        if (update._meta?.lastChunk) {
          flushText();
          currentMessageId = undefined;
        }
      }

      // 工具调用前先 flush 文本（参考 acpx 协议的 tool_call / tool_call_update）
      const isToolEvent =
        update.sessionUpdate === 'tool_call' ||
        update.sessionUpdate === 'tool_call_update';
      if (isToolEvent || update.title) {
        this.logger.info(
          'pipeline:flush',
          `trigger=${update.sessionUpdate} title=${update.title ?? 'none'} bufferLen=${textBuffer.length}`,
        );
        flushText();
        if (update.title) {
          let toolLog = update.title;
          if (update.status) toolLog += ` (${update.status})`;
          if (update.rawInput) {
            const inputStr =
              typeof update.rawInput === 'string'
                ? update.rawInput
                : JSON.stringify(update.rawInput);
            toolLog += ` | input: ${truncate(inputStr, 200)}`;
          }
          enqueueSend(() => callbacks.onTool(toolLog));
        }
      }
    };

    try {
      await this.sessionManager.prompt(sessionKey, parts, onUpdate);
    } catch (err) {
      // Flush any accumulated text before handling the error
      flushText();
      await sendChain;

      if (turnCompleted || hasSentMessage) {
        // Stale error — the turn already produced output, log and swallow
        this.logger.warn('pipeline', 'Stale error after partial output', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      } else {
        this.state = PipelineState.COMPLETED;
        throw err;
      }
    }

    // Flush remaining text + 等待发送队列排空
    flushText();
    await sendChain;

    // Determine if reflexion is needed
    const reflexionEnabled = this.config.reflexion?.enabled === true;
    const minContentLength = this.config.reflexion?.minContentLength ?? 100;
    const needsReflexion =
      reflexionEnabled &&
      hasSentMessage &&
      totalText.length >= minContentLength;

    if (needsReflexion) {
      this.state = PipelineState.REFLECTING;

      const promptTemplate =
        this.config.reflexion?.promptTemplate ?? DEFAULT_REFLEXION_PROMPT;
      const reflexionParts = buildPrompt(promptTemplate);

      try {
        await this.sessionManager.prompt(
          sessionKey,
          reflexionParts,
          (update) => {
            // During reflexion, only log — do not call callbacks
            if (
              update.sessionUpdate === 'agent_message_chunk' &&
              update.content?.text
            ) {
              this.logger.info(
                'pipeline:reflexion',
                truncate(update.content.text, 200),
              );
            }
            if (update.title) {
              this.logger.info('pipeline:reflexion', `tool: ${update.title}`);
            }
          },
        );
      } catch (err) {
        this.logger.warn('pipeline:reflexion', 'Reflexion prompt failed', {
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.state = PipelineState.COMPLETED;
    return { hasSentMessage, turnCompleted, totalText };
  }
}
