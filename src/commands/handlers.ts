import { listAgents } from '../acp/agent-registry.js';
import { type AcpClawConfig, saveConfig } from '../config.js';
import { type SessionManager, parseSessionKey } from '../session/manager.js';
import { t, type Lang } from './i18n.js';

export interface CommandContext {
  sessionKey: string;
  userPrefix: string;
  sessionManager: SessionManager;
  config: AcpClawConfig;
  isBusy: boolean;
  workDir: string;
  language: Lang;
}

export interface CommandResult {
  text: string;
}

export async function handleCommand(
  commandName: string,
  args: string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const lang = ctx.language;
  switch (commandName) {
    case 'agent':
      return handleAgent(args, ctx);
    case 'session':
      return handleSession(args, ctx);
    case 'status':
      return handleStatus(ctx);
    case 'help':
      return handleHelp(lang);
    case 'restart':
      return handleRestart(ctx);
    case 'language':
      return handleLanguage(args, ctx);
    default:
      return { text: t('unknown_command', lang, { command: commandName }) };
  }
}

async function handleAgent(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const lang = ctx.language;
  const available = listAgents(ctx.config.agents);

  if (args.length === 0) {
    const session = ctx.sessionManager.getSession(ctx.sessionKey);
    const current = session?.record.agentName ?? ctx.config.defaultAgent;
    const marker = t('agent.current_marker', lang);
    const list = available.map((a) => (a === current ? `  * ${a} ${marker}` : `    ${a}`)).join('\n');
    return { text: t('agent.current', lang, { current, list }) };
  }

  const agentName = args[0];
  if (!available.includes(agentName)) {
    return { text: t('agent.unknown', lang, { name: agentName, available: available.join(', ') }) };
  }

  if (ctx.isBusy) {
    return { text: t('agent.busy', lang) };
  }

  await ctx.sessionManager.switchAgent(ctx.sessionKey, agentName);
  return { text: t('agent.switched', lang, { name: agentName }) };
}

async function handleSession(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const lang = ctx.language;

  if (args.length === 0) {
    const session = ctx.sessionManager.getSession(ctx.sessionKey);
    if (!session) {
      return { text: t('session.no_active', lang, { key: ctx.sessionKey }) };
    }
    const connected = session.client ? '🟢' : '🔴';
    const statusLine = session.client
      ? ''
      : '\n🔴 未连接（发送消息自动恢复）';
    return {
      text: [
        `${connected} Session: ${session.sessionKey}`,
        `Agent: ${session.record.agentName}`,
        `${t('session.info_created', lang)}: ${new Date(session.record.createdAt).toLocaleString()}`,
        `${t('session.info_last_activity', lang)}: ${new Date(session.record.lastActivityAt).toLocaleString()}`,
      ].join('\n') + statusLine,
    };
  }

  const sub = args[0];

  if (sub === 'new') {
    if (ctx.isBusy) {
      return { text: t('agent.busy', lang) };
    }
    const session = ctx.sessionManager.getSession(ctx.sessionKey);
    const agentName = session?.record.agentName ?? ctx.config.defaultAgent;
    const nextId = ctx.sessionManager.getNextSessionId(ctx.userPrefix);
    const newKey = `${ctx.userPrefix}${nextId}`;
    await ctx.sessionManager.getOrCreate(newKey, agentName);
    ctx.sessionManager.setActiveSession(ctx.userPrefix, newKey);
    return { text: `✅ 新建 session #${nextId}，已切换。` };
  }

  if (sub === 'list') {
    const sessions = ctx.sessionManager.listByUser(ctx.userPrefix);
    if (sessions.length === 0) {
      return { text: '暂无 session。' };
    }
    const activeKey = ctx.sessionKey;
    const lines = sessions.map((s) => {
      const parsed = parseSessionKey(s.sessionKey);
      const id = parsed?.sessionId ?? '?';
      const marker = s.sessionKey === activeKey ? ' *' : '';
      const busyTag = s.busy ? ' [busy]' : '';
      const status = s.client ? '🟢' : '🔴';
      return `  ${status} #${id} ${s.record.agentName}${busyTag}${marker}`;
    });
    return { text: `Sessions:\n${lines.join('\n')}` };
  }

  if (sub === 'switch') {
    const targetId = args[1];
    if (!targetId) {
      return { text: '用法: /session switch <id>' };
    }
    const targetKey = `${ctx.userPrefix}${targetId}`;
    const targetSession = ctx.sessionManager.getSession(targetKey);
    if (!targetSession) {
      return { text: `Session #${targetId} 不存在。使用 /session list 查看可用列表。` };
    }
    ctx.sessionManager.setActiveSession(ctx.userPrefix, targetKey);
    return { text: `✅ 已切换到 session #${targetId}。` };
  }

  if (sub === 'delete') {
    const targetId = args[1];
    if (!targetId) {
      return { text: '用法: /session delete <id>' };
    }
    const targetKey = `${ctx.userPrefix}${targetId}`;
    const targetSession = ctx.sessionManager.getSession(targetKey);
    if (!targetSession) {
      return { text: `Session #${targetId} 不存在。使用 /session list 查看可用列表。` };
    }
    if (targetSession.busy) {
      return { text: `Session #${targetId} 正忙，请等待完成后再删除。` };
    }
    if (targetKey === ctx.sessionKey) {
      return { text: `不能删除当前活跃的 session。请先 /session switch 到其他 session。` };
    }
    await ctx.sessionManager.close(targetKey);
    return { text: `✅ Session #${targetId} 已删除。` };
  }

  return { text: t('session.unknown_sub', lang, { sub }) };
}

function handleStatus(ctx: CommandContext): CommandResult {
  const lang = ctx.language;
  const session = ctx.sessionManager.getSession(ctx.sessionKey);
  if (!session) {
    return { text: t('status.no_session', lang, { key: ctx.sessionKey }) };
  }

  const busyText = session.busy ? t('status.busy_yes', lang) : t('status.busy_no', lang);

  return {
    text: [
      `Agent: ${session.record.agentName}`,
      `Session Key: ${session.sessionKey}`,
      `${t('status.busy_label', lang)}: ${busyText}`,
      `${t('status.last_activity', lang)}: ${new Date(session.record.lastActivityAt).toLocaleString()}`,
    ].join('\n'),
  };
}

async function handleRestart(ctx: CommandContext): Promise<CommandResult> {
  if (ctx.isBusy) {
    return { text: '当前 session 正忙，请稍后再试。' };
  }
  await ctx.sessionManager.restart(ctx.sessionKey);
  return { text: '✅ ACP client 已重启。' };
}

function handleHelp(lang: Lang): CommandResult {
  return {
    text: [
      t('help.title', lang),
      t('help.agent', lang),
      t('help.session', lang),
      '  /session new - 创建新 session',
      '  /session list - 查看 session 列表',
      '  /session switch <id> - 切换 session',
      '  /session delete <id> - 删除 session',
      t('help.status', lang),
      t('help.language', lang),
      '  /restart - 重启 ACP client',
      t('help.help', lang),
    ].join('\n'),
  };
}

function handleLanguage(args: string[], ctx: CommandContext): CommandResult {
  const lang = ctx.language;

  if (args.length === 0) {
    return { text: t('language.current', lang, { lang }) };
  }

  const newLang = args[0];
  if (newLang !== 'zh' && newLang !== 'en') {
    return { text: t('language.invalid', lang, { lang: newLang }) };
  }

  ctx.config.language = newLang;
  saveConfig(ctx.workDir, ctx.config);
  return { text: t('language.switched', newLang, { lang: newLang }) };
}
