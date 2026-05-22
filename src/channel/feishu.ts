import * as Lark from '@larksuiteoapi/node-sdk';

export interface FeishuMessage {
  id: string;
  content: string;
  senderId: string;
  chatId?: string;
  chatType?: 'p2p' | 'group';
  timestamp: number;
  raw?: unknown;
}

export type MessageHandler = (message: FeishuMessage) => void | Promise<void>;

export interface FeishuChannelConfig {
  appId: string;
  appSecret: string;
  domain?: string;
  appName?: string;
  chatId?: string;
}

const WORKING_EMOJI_TYPE = 'OnIt';

export function loadFeishuConfigFromEnv(): FeishuChannelConfig | undefined {
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) return undefined;
  return {
    appId,
    appSecret,
    domain: process.env.LARK_DOMAIN || 'https://open.feishu.cn',
    appName: process.env.LARK_APP_NAME,
    chatId: process.env.LARK_CHAT_ID,
  };
}

export class FeishuChannel {
  private wsClient: Lark.WSClient;
  private apiClient: Lark.Client;
  private config: FeishuChannelConfig;
  private handler?: MessageHandler;
  private processedMessageIds = new Set<string>();
  private reactionStore = new Map<string, string>();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(config: FeishuChannelConfig) {
    this.config = config;
    const domain = config.domain || 'https://open.feishu.cn';
    this.apiClient = new Lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      domain,
    });
    this.wsClient = new Lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain,
    });
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.startWebSocket();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async reply(messageId: string, text: string): Promise<void> {
    const content = this.wrapTextAsCard(text);
    await this.apiClient.im.v1.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: 'interactive',
        content: JSON.stringify(content),
      },
    });
    await this.clearReaction(messageId);
  }

  async send(chatId: string, text: string): Promise<void> {
    const content = this.wrapTextAsCard(text);
    await this.apiClient.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(content),
      },
    });
  }

  async clearReaction(messageId: string): Promise<void> {
    const reactionId = this.reactionStore.get(messageId);
    if (!reactionId) return;
    try {
      await this.apiClient.im.v1.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      });
      this.reactionStore.delete(messageId);
    } catch {
      // ignore reaction errors
    }
  }

  private startWebSocket(): void {
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        const rawData = data as Record<string, unknown>;
        const message = (rawData['message'] ?? {}) as Record<string, unknown>;
        const { normalizedMessage } = this.normalizeMessageMentions(message);

        const chatType =
          typeof normalizedMessage['chat_type'] === 'string'
            ? normalizedMessage['chat_type']
            : '';
        const messageId =
          typeof normalizedMessage['message_id'] === 'string'
            ? normalizedMessage['message_id']
            : '';

        // Deduplication
        if (this.processedMessageIds.has(messageId)) return;
        this.processedMessageIds.add(messageId);
        setTimeout(
          () => this.processedMessageIds.delete(messageId),
          10 * 60 * 1000,
        );

        // Group chat filtering: only process if app is mentioned
        if (chatType === 'group') {
          const normalizedAppName = this.config.appName?.trim();
          const mentions = (message['mentions'] ?? []) as Array<Record<string, unknown>>;
          const hasMention = mentions.length > 0;

          if (normalizedAppName) {
            // 有 appName 配置时，检查消息中是否包含该名称
            const stringifiedMessage = JSON.stringify(normalizedMessage);
            if (!stringifiedMessage.includes(normalizedAppName)) return;
          } else if (!hasMention) {
            // 没有 appName 配置时，退化为检查是否有任何 @mention（即有人 @ 了机器人）
            return;
          }
        }

        // Extract sender
        const sender = rawData['sender'] as Record<string, unknown> | undefined;
        const senderId = sender?.['sender_id'] as
          | Record<string, unknown>
          | undefined;
        const openId =
          typeof senderId?.['open_id'] === 'string' ? senderId['open_id'] : '';

        const msgContent =
          typeof normalizedMessage['content'] === 'string'
            ? normalizedMessage['content']
            : '';
        const chatIdValue =
          typeof normalizedMessage['chat_id'] === 'string'
            ? normalizedMessage['chat_id']
            : undefined;

        const incoming: FeishuMessage = {
          id: messageId,
          content: msgContent,
          senderId: openId,
          chatId: chatIdValue,
          chatType:
            chatType === 'p2p' || chatType === 'group' ? chatType : undefined,
          timestamp: Date.now(),
          raw: { ...rawData, message: normalizedMessage },
        };

        Promise.resolve(this.handler?.(incoming)).catch((err) => {
          console.error('[feishu] Error in message handler:', err instanceof Error ? err.message : String(err));
        });
        this.reactWorkingEmoji(messageId);
      },
    });

    this.wsClient.start({ eventDispatcher }).catch((err) => {
      if (!this.stopped) {
        console.error('[feishu] WebSocket connection failed:', err);
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(delayMs = 5000): void {
    if (this.stopped || this.reconnectTimer) return;
    console.log(`[feishu] Reconnecting WebSocket in ${delayMs / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.stopped) return;
      console.log('[feishu] Attempting WebSocket reconnect...');
      this.wsClient = new Lark.WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        domain: this.config.domain || 'https://open.feishu.cn',
      });
      this.startWebSocket();
    }, delayMs);
  }

  private wrapTextAsCard(text: string): unknown {
    const normalized = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    return {
      schema: '2.0',
      config: { update_multi: true },
      body: {
        direction: 'vertical',
        padding: '12px 12px 12px 12px',
        elements: [{ tag: 'markdown', content: normalized }],
      },
    };
  }

  private async reactWorkingEmoji(messageId: string): Promise<void> {
    if (!messageId) return;
    try {
      const response = await this.apiClient.im.v1.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: WORKING_EMOJI_TYPE } },
      });
      const reactionId = this.extractReactionId(response);
      if (reactionId) {
        this.reactionStore.set(messageId, reactionId);
      }
    } catch {
      // ignore reaction errors
    }
  }

  private extractReactionId(payload: unknown): string | undefined {
    const visited = new Set<object>();
    const visit = (value: unknown): string | undefined => {
      if (typeof value !== 'object' || value === null) return undefined;
      if (visited.has(value)) return undefined;
      visited.add(value);
      const obj = value as Record<string, unknown>;
      if (typeof obj['reaction_id'] === 'string' && obj['reaction_id'].length > 0) {
        return obj['reaction_id'];
      }
      for (const nested of Object.values(obj)) {
        const found = visit(nested);
        if (found) return found;
      }
      return undefined;
    };
    return visit(payload);
  }

  private normalizeMessageMentions(message: Record<string, unknown>): {
    normalizedMessage: Record<string, unknown>;
    replacedCount: number;
  } {
    const content = message['content'];
    if (typeof content !== 'string') {
      return { normalizedMessage: message, replacedCount: 0 };
    }
    const mentions = message['mentions'];
    if (!Array.isArray(mentions) || mentions.length === 0) {
      return { normalizedMessage: message, replacedCount: 0 };
    }

    let normalizedContent = content;
    let replacedCount = 0;

    // Build replacement rules sorted by length (longest first)
    const rules: { from: string; to: string }[] = [];
    for (let i = 0; i < mentions.length; i++) {
      const mention = mentions[i];
      if (typeof mention !== 'object' || mention === null) continue;
      const name = (mention as Record<string, unknown>)['name'];
      if (typeof name !== 'string' || name.length === 0) continue;
      rules.push({ from: `@_user_${i + 1}`, to: `@${name}` });
    }
    rules.sort((a, b) => b.from.length - a.from.length);

    for (const rule of rules) {
      if (!normalizedContent.includes(rule.from)) continue;
      const parts = normalizedContent.split(rule.from);
      replacedCount += parts.length - 1;
      normalizedContent = parts.join(rule.to);
    }

    if (replacedCount === 0) {
      return { normalizedMessage: message, replacedCount: 0 };
    }
    return {
      normalizedMessage: { ...message, content: normalizedContent },
      replacedCount,
    };
  }
}
