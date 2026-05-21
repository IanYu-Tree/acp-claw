import { listAgents } from '../acp/agent-registry.js';
import { type AcpClawConfig, saveConfig } from '../config.js';
import type { SessionManager } from '../session/manager.js';
import { t, type Lang } from './i18n.js';

export interface CommandContext {
  sessionKey: string;
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
    return {
      text: [
        `Session: ${session.sessionKey}`,
        `Agent: ${session.record.agentName}`,
        `${t('session.info_created', lang)}: ${new Date(session.record.createdAt).toLocaleString()}`,
        `${t('session.info_last_activity', lang)}: ${new Date(session.record.lastActivityAt).toLocaleString()}`,
      ].join('\n'),
    };
  }

  const sub = args[0];
  if (sub === 'new') {
    if (ctx.isBusy) {
      return { text: t('agent.busy', lang) };
    }
    const session = ctx.sessionManager.getSession(ctx.sessionKey);
    const agentName = session?.record.agentName ?? ctx.config.defaultAgent;
    ctx.sessionManager.detach(ctx.sessionKey);
    await ctx.sessionManager.getOrCreate(ctx.sessionKey, agentName);
    return { text: t('session.new_created', lang, { agent: agentName }) };
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

function handleHelp(lang: Lang): CommandResult {
  return {
    text: [
      t('help.title', lang),
      t('help.agent', lang),
      t('help.session', lang),
      t('help.status', lang),
      t('help.language', lang),
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
