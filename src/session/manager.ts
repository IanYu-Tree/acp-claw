import { resolveAgent } from '../acp/agent-registry.js';
import { AcpClient, type SessionUpdate } from '../acp/client.js';
import type { ContentBlock } from '../acp/prompt-builder.js';
import type { AcpClawConfig } from '../config.js';
import { getSessionKey } from './router.js';
import { SessionStore, type SessionRecord } from './store.js';

export { getSessionKey };

export interface ActiveSession {
  sessionKey: string;
  record: SessionRecord;
  client: AcpClient;
  busy: boolean;
  isNew: boolean;
}

export class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private config: AcpClawConfig;
  private store: SessionStore;
  private cwd: string;

  constructor(config: AcpClawConfig, workDir: string) {
    this.config = config;
    this.cwd = workDir;
    this.store = new SessionStore(`${workDir}/sessions`);
  }

  async getOrCreate(sessionKey: string, agentName?: string): Promise<ActiveSession> {
    const existing = this.sessions.get(sessionKey);
    // 如果 session 存在且 client 有效，直接返回
    if (existing && existing.client) return existing;

    // 如果 session 存在但 client 为 null（从 restore 恢复），保留其 agentName 后清除旧记录
    let restoredAgentName: string | undefined;
    if (existing && !existing.client) {
      restoredAgentName = existing.record.agentName;
      this.sessions.delete(sessionKey);
    }

    const agent = agentName ?? restoredAgentName ?? this.config.defaultAgent;
    const agentConfig = resolveAgent(agent, this.config.agents);
    if (!agentConfig) {
      throw new Error(`Unknown agent: ${agent}`);
    }

    const client = new AcpClient(agentConfig.command, agentConfig.args ?? []);
    await client.start();
    const acpSessionId = await client.createSession(this.cwd);

    const now = Date.now();
    const record: SessionRecord = {
      sessionKey,
      acpSessionId,
      agentName: agent,
      cwd: this.cwd,
      createdAt: now,
      lastActivityAt: now,
    };

    this.store.save(record);

    const session: ActiveSession = { sessionKey, record, client, busy: false, isNew: true };

    client.on('session-update', (sessionId: string, update: SessionUpdate) => {
      if (sessionId === acpSessionId) {
        this.emit(session, update);
      }
    });

    client.on('error', () => {
      // errors are handled per-prompt via callbacks
    });

    client.on('stderr', (text: string) => {
      console.warn(`[agent stderr] ${text}`);
    });

    client.on('close', () => {
      this.sessions.delete(sessionKey);
    });

    this.sessions.set(sessionKey, session);
    return session;
  }

  async prompt(
    sessionKey: string,
    parts: ContentBlock[],
    onUpdate: (update: SessionUpdate) => void,
  ): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      throw new Error(`No active session for key: ${sessionKey}`);
    }
    if (!session.record.acpSessionId) {
      throw new Error(`Session ${sessionKey} has no ACP session ID`);
    }

    session.busy = true;
    session.record.lastActivityAt = Date.now();

    const listener = (sessionId: string, update: SessionUpdate) => {
      if (sessionId === session.record.acpSessionId) {
        onUpdate(update);
      }
    };

    session.client.on('session-update', listener);

    try {
      await session.client.prompt(session.record.acpSessionId, parts);
    } finally {
      session.client.removeListener('session-update', listener);
      session.busy = false;
      session.record.lastActivityAt = Date.now();
      this.store.save(session.record);
    }
  }

  async switchAgent(sessionKey: string, newAgent: string): Promise<ActiveSession> {
    this.detach(sessionKey);
    return this.getOrCreate(sessionKey, newAgent);
  }

  async close(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    // Remove from map immediately to prevent race with client 'close' event
    this.sessions.delete(sessionKey);
    this.store.delete(sessionKey);

    try {
      if (session.client && session.record.acpSessionId) {
        session.client.closeSession(session.record.acpSessionId);
      }
    } catch {
      // Best effort: agent may not support session/close
    }

    try {
      if (session.client) {
        await session.client.shutdown();
      }
    } catch {
      // Best effort: agent may have already exited
    }
  }

  /**
   * Detach session immediately without waiting for agent shutdown.
   * The old agent process is cleaned up in the background.
   */
  detach(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    this.sessions.delete(sessionKey);
    this.store.delete(sessionKey);

    // Fire-and-forget: clean up old agent in background
    if (session.client) {
      const client = session.client;
      const acpSessionId = session.record.acpSessionId;
      setImmediate(async () => {
        try {
          if (acpSessionId) client.closeSession(acpSessionId);
        } catch { /* ignore */ }
        try {
          await client.shutdown();
        } catch { /* ignore */ }
      });
    }
  }

  async closeAll(): Promise<void> {
    const keys = [...this.sessions.keys()];
    await Promise.all(keys.map((key) => this.close(key)));
  }

  getSession(sessionKey: string): ActiveSession | undefined {
    return this.sessions.get(sessionKey);
  }

  listActive(): ActiveSession[] {
    return [...this.sessions.values()];
  }

  async restore(): Promise<void> {
    const records = this.store.list();
    for (const record of records) {
      // Store records in memory but do NOT reconnect.
      // Sessions will be recreated on next message via getOrCreate.
      this.sessions.set(record.sessionKey, {
        sessionKey: record.sessionKey,
        record,
        client: null as unknown as AcpClient,
        busy: false,
        isNew: false,
      });
    }
  }

  saveAll(): void {
    for (const session of this.sessions.values()) {
      if (session.record.acpSessionId) {
        this.store.save(session.record);
      }
    }

    const controllerState = {
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      activeSessions: [...this.sessions.keys()],
    };
    this.store.saveControllerState(controllerState);
  }

  private emit(_session: ActiveSession, _update: SessionUpdate): void {
    // Internal event routing - updates are delivered via prompt() callback
  }
}
