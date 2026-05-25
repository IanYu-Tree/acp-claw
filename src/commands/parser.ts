export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

export function parseSlashCommand(
  messageContent: string,
): ParsedCommand | undefined {
  let text = messageContent;
  try {
    const parsed = JSON.parse(messageContent);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.text === 'string'
    ) {
      text = parsed.text;
    }
  } catch {
    // not JSON, use raw content
  }

  text = text.trim();
  // Strip leading @mention prefix (for group chat messages like "@BotName /help")
  text = text.replace(/^@\S+\s*/, '');
  if (!text.startsWith('/')) return undefined;

  const parts = text.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase() || '';
  const args = parts.slice(1);

  return { name, args, raw: text };
}
