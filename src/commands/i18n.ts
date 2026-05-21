export type Lang = 'zh' | 'en';

const messages: Record<string, Record<Lang, string>> = {
  'unknown_command': {
    zh: '未知命令: /{command}\n输入 /help 查看可用命令',
    en: 'Unknown command: /{command}\nType /help for available commands',
  },
  'agent.current': {
    zh: '当前 Agent: {current}\n可用 Agent:\n{list}',
    en: 'Current Agent: {current}\nAvailable Agents:\n{list}',
  },
  'agent.current_marker': {
    zh: '(当前)',
    en: '(current)',
  },
  'agent.unknown': {
    zh: '未知 Agent: {name}\n可用: {available}',
    en: 'Unknown Agent: {name}\nAvailable: {available}',
  },
  'agent.busy': {
    zh: '⏳ 当前会话正在处理中，请稍后再试',
    en: '⏳ Session is busy, please try again later',
  },
  'agent.switched': {
    zh: '已切换到 Agent: {name}',
    en: 'Switched to Agent: {name}',
  },
  'session.no_active': {
    zh: '当前无活跃 Session (key: {key})',
    en: 'No active session (key: {key})',
  },
  'session.info_created': {
    zh: '创建时间',
    en: 'Created',
  },
  'session.info_last_activity': {
    zh: '最近活动',
    en: 'Last activity',
  },
  'session.new_created': {
    zh: '已新建 Session，Agent: {agent}',
    en: 'New session created, Agent: {agent}',
  },
  'session.unknown_sub': {
    zh: '不支持的子命令: /session {sub}\n用法: /session [new]',
    en: 'Unknown subcommand: /session {sub}\nUsage: /session [new]',
  },
  'status.no_session': {
    zh: '无活跃 Session (key: {key})',
    en: 'No active session (key: {key})',
  },
  'status.busy_yes': {
    zh: '是',
    en: 'Yes',
  },
  'status.busy_no': {
    zh: '否',
    en: 'No',
  },
  'status.busy_label': {
    zh: '忙碌',
    en: 'Busy',
  },
  'status.last_activity': {
    zh: '最近活动',
    en: 'Last activity',
  },
  'help.title': {
    zh: '可用命令:',
    en: 'Available commands:',
  },
  'help.agent': {
    zh: '/agent [name] - 查看或切换 Agent',
    en: '/agent [name] - View or switch Agent',
  },
  'help.session': {
    zh: '/session [new] - 查看或新建 Session',
    en: '/session [new] - View or create new Session',
  },
  'help.status': {
    zh: '/status - 查看当前状态',
    en: '/status - View current status',
  },
  'help.language': {
    zh: '/language [zh|en] - 切换语言',
    en: '/language [zh|en] - Switch language',
  },
  'help.help': {
    zh: '/help - 显示帮助信息',
    en: '/help - Show help',
  },
  'language.current': {
    zh: '当前语言: {lang}',
    en: 'Current language: {lang}',
  },
  'language.switched': {
    zh: '语言已切换为: {lang}',
    en: 'Language switched to: {lang}',
  },
  'language.invalid': {
    zh: '无效语言: {lang}\n可选: zh, en',
    en: 'Invalid language: {lang}\nOptions: zh, en',
  },
};

export function t(key: string, lang: Lang, vars?: Record<string, string>): string {
  const entry = messages[key];
  if (!entry) return key;
  let text = entry[lang] ?? entry['zh'];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}
