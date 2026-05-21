import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentConfig {
  command: string;
  args?: string[];
}

export interface FeishuChannelConfig {
  appId: string;
  appSecret: string;
  domain?: string;
  appName?: string;
  chatId?: string;
}

export interface AcpClawConfig {
  defaultAgent: string;
  agents: Record<string, AgentConfig>;
  feishu?: FeishuChannelConfig;
  sessionIdleTimeoutMs?: number;
  stateSaveIntervalMs?: number;
  forwardToolMessages?: boolean;
  language?: 'zh' | 'en';
}

const FALLBACK_AGENTS: Record<string, AgentConfig> = {
  codex: { command: 'npx', args: ['@zed-industries/codex-acp@^0.12.0'] },
  claude: { command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@^0.31.0'] },
};

const DEFAULT_CONFIG: AcpClawConfig = {
  defaultAgent: '',
  agents: {},
  sessionIdleTimeoutMs: 30 * 60_000,
  stateSaveIntervalMs: 30_000,
  language: 'zh' as const,
};

export function resolveWorkDir(workDir?: string): string {
  return workDir || join(process.cwd(), '.acp-claw');
}

export function getConfigPath(workDir: string): string {
  return join(workDir, 'config.json');
}

export function loadConfig(workDir: string): AcpClawConfig {
  const configPath = getConfigPath(workDir);
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG, defaultAgent: 'codex', agents: { ...FALLBACK_AGENTS } };
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AcpClawConfig>;
    const userAgents = parsed.agents ?? {};
    // 如果用户没有配置任何 agent，使用内置 fallback
    const agents = Object.keys(userAgents).length > 0 ? userAgents : { ...FALLBACK_AGENTS, ...userAgents };
    // defaultAgent 优先用户配置，其次取 agents 中第一个
    const defaultAgent = parsed.defaultAgent || Object.keys(agents)[0] || 'codex';
    return {
      defaultAgent,
      agents,
      feishu: parsed.feishu ?? loadFeishuFromEnv(),
      sessionIdleTimeoutMs: parsed.sessionIdleTimeoutMs ?? DEFAULT_CONFIG.sessionIdleTimeoutMs,
      stateSaveIntervalMs: parsed.stateSaveIntervalMs ?? DEFAULT_CONFIG.stateSaveIntervalMs,
      language: parsed.language ?? 'zh',
    };
  } catch {
    return { ...DEFAULT_CONFIG, defaultAgent: 'codex', agents: { ...FALLBACK_AGENTS } };
  }
}

export function saveConfig(workDir: string, config: AcpClawConfig): void {
  const configPath = getConfigPath(workDir);
  if (!existsSync(workDir)) {
    mkdirSync(workDir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function initWorkDir(workDir: string): AcpClawConfig {
  const dirs = [
    workDir,
    join(workDir, 'memory'),
    join(workDir, 'knowledge'),
    join(workDir, 'sessions'),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // 生成包含自定义 agent 示例的配置模板
  const templateConfig: AcpClawConfig = {
    defaultAgent: 'codex',
    agents: {
      codex: { command: 'npx', args: ['@zed-industries/codex-acp@^0.12.0'] },
    },
    feishu: loadFeishuFromEnv() ?? {
      appId: '<your-lark-app-id>',
      appSecret: '<your-lark-app-secret>',
      appName: '<your-bot-name>',
    },
    sessionIdleTimeoutMs: DEFAULT_CONFIG.sessionIdleTimeoutMs,
    stateSaveIntervalMs: DEFAULT_CONFIG.stateSaveIntervalMs,
  };

  // 如果已有配置文件，合并而非覆盖
  const existingConfig = loadConfig(workDir);
  const finalConfig: AcpClawConfig = existsSync(getConfigPath(workDir))
    ? existingConfig
    : templateConfig;

  saveConfig(workDir, finalConfig);

  // 初始化默认记忆文件
  const memoryFiles: Record<string, string> = {
    'IDENTITY.md': '# IDENTITY\n\n(描述你的 agent 身份和角色)\n',
    'USER.md': '# USER\n\n(描述用户信息和偏好)\n',
    'SOUL.md': '# SOUL\n\n(描述 agent 的性格和行为准则)\n',
    'AGENTS.md': '# AGENTS\n\n(描述可协作的其他 agent)\n',
    'TOOLS.md': '# TOOLS\n\n(描述可用的工具和能力)\n',
  };
  for (const [name, content] of Object.entries(memoryFiles)) {
    const filePath = join(workDir, 'memory', name);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content);
    }
  }

  // 初始化默认知识文件
  const knowledgePath = join(workDir, 'knowledge', 'core.md');
  if (!existsSync(knowledgePath)) {
    writeFileSync(knowledgePath, '# Core Knowledge\n\n(Add your knowledge here)\n');
  }

  return finalConfig;
}

export function isTemplateOnly(content: string): boolean {
  if (!content || content.trim() === '') return true;
  // Check if it only contains template headers and placeholder text in parentheses
  const stripped = content.replace(/^#.*$/gm, '').replace(/\(.*?\)/g, '').trim();
  return stripped === '';
}

export function readMemoryFile(workDir: string, filename: string): string | null {
  const filePath = join(workDir, 'memory', filename);
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return null;
    return content;
  } catch {
    return null;
  }
}

function loadFeishuFromEnv(): FeishuChannelConfig | undefined {
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
