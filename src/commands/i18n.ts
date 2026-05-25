export type Lang = 'zh' | 'en';

const messages: Record<string, Record<Lang, string>> = {
  unknown_command: {
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
  'session.status_reconnecting': {
    zh: '\n🟡 待重连（发送消息自动恢复）',
    en: '\n🟡 Pending reconnect (auto-reconnects on next message)',
  },
  'session.new_created': {
    zh: '✅ 新建 session #{id}，已切换。',
    en: '✅ New session #{id} created and switched.',
  },
  'session.list_empty': {
    zh: '暂无 session。',
    en: 'No sessions.',
  },
  'session.list_title': {
    zh: 'Sessions:',
    en: 'Sessions:',
  },
  'session.switch_usage': {
    zh: '用法: /session switch <id>',
    en: 'Usage: /session switch <id>',
  },
  'session.switch_not_found': {
    zh: 'Session #{id} 不存在。使用 /session list 查看可用列表。',
    en: 'Session #{id} not found. Use /session list to see available sessions.',
  },
  'session.switch_success': {
    zh: '✅ 已切换到 session #{id}。',
    en: '✅ Switched to session #{id}.',
  },
  'session.delete_usage': {
    zh: '用法: /session delete <id>',
    en: 'Usage: /session delete <id>',
  },
  'session.delete_not_found': {
    zh: 'Session #{id} 不存在。使用 /session list 查看可用列表。',
    en: 'Session #{id} not found. Use /session list to see available sessions.',
  },
  'session.delete_busy': {
    zh: 'Session #{id} 正忙，请等待完成后再删除。',
    en: 'Session #{id} is busy. Please wait for it to finish before deleting.',
  },
  'session.delete_active': {
    zh: '不能删除当前活跃的 session。请先 /session switch 到其他 session。',
    en: 'Cannot delete the active session. Please /session switch to another session first.',
  },
  'session.delete_success': {
    zh: '✅ Session #{id} 已删除。',
    en: '✅ Session #{id} deleted.',
  },
  'session.unknown_sub': {
    zh: '不支持的子命令: /session {sub}\n用法: /session [new|list|switch|delete]',
    en: 'Unknown subcommand: /session {sub}\nUsage: /session [new|list|switch|delete]',
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
  'restart.busy': {
    zh: '当前 session 正忙，请稍后再试。',
    en: 'Session is busy, please try again later.',
  },
  'restart.success': {
    zh: '✅ ACP client 已重启。',
    en: '✅ ACP client restarted.',
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
    zh: '/session - 查看当前 Session 状态',
    en: '/session - View current session status',
  },
  'help.session_new': {
    zh: '  /session new - 创建新 session',
    en: '  /session new - Create new session',
  },
  'help.session_list': {
    zh: '  /session list - 查看 session 列表',
    en: '  /session list - List sessions',
  },
  'help.session_switch': {
    zh: '  /session switch <id> - 切换 session',
    en: '  /session switch <id> - Switch session',
  },
  'help.session_delete': {
    zh: '  /session delete <id> - 删除 session',
    en: '  /session delete <id> - Delete session',
  },
  'help.status': {
    zh: '/status - 查看当前状态',
    en: '/status - View current status',
  },
  'help.language': {
    zh: '/language [zh|en] - 切换语言',
    en: '/language [zh|en] - Switch language',
  },
  'help.restart': {
    zh: '/restart - 重启 ACP client',
    en: '/restart - Restart ACP client',
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

export function t(
  key: string,
  lang: Lang,
  vars?: Record<string, string>,
): string {
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
