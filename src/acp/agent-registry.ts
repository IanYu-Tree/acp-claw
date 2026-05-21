import type { AgentConfig } from '../config.js';

const BUILT_IN_AGENTS: Record<string, AgentConfig> = {
  codex: { command: 'npx', args: ['@zed-industries/codex-acp@^0.12.0'] },
  claude: { command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@^0.31.0'] },
  gemini: { command: 'gemini', args: ['--acp'] },
};

export function resolveAgent(
  name: string,
  customAgents?: Record<string, AgentConfig>,
): AgentConfig | undefined {
  return customAgents?.[name] ?? BUILT_IN_AGENTS[name];
}

export function listAgents(customAgents?: Record<string, AgentConfig>): string[] {
  const names = new Set<string>(Object.keys(BUILT_IN_AGENTS));
  if (customAgents) {
    for (const name of Object.keys(customAgents)) {
      names.add(name);
    }
  }
  return [...names];
}
