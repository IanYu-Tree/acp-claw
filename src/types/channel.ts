import type { MessageBus } from './messages.js';

export interface IncomingMessage {
  id: string;
  channelName: string;
  type: 'text' | 'card' | 'card_event';
  content: string;
  sender: {
    id: string;
    name?: string;
  };
  chatId?: string;
  chatType?: 'p2p' | 'group';
  timestamp: number;
  raw?: unknown;
  files?: Array<{ uri?: string; bytes?: string; mimeType?: string }>;
  replyMeta?: {
    selfId: string;
    replyTo: string;
    endpoint: string;
    project: string;
  };
}

export interface Channel {
  readonly name: string;
  start(messageBus: MessageBus): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (message: IncomingMessage) => void): void;
}
