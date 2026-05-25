# ACP Claw 使用教程

ACP Claw 是一个基于 [ACP 协议](https://github.com/nicholasgasior/acp) 的智能体客户端，通过飞书 Channel 与 AI Agent 交互。它支持多 Agent 切换、Session 管理、记忆系统和流式消息转发。

## 安装

```bash
npm install -g @byted-iaas/acp-claw --registry https://bnpm.byted.org
```

验证安装：

```bash
acp-claw --version
```

## 快速开始

### 1. 初始化工作目录

```bash
acp-claw init
```

这会在当前目录下创建 `.acp-claw/` 工作目录，包含：

```
.acp-claw/
├── config.json       # 配置文件
├── memory/           # Agent 记忆文件
│   ├── IDENTITY.md   # Agent 身份描述
│   ├── USER.md       # 用户信息
│   ├── SOUL.md       # 行为准则
│   ├── AGENTS.md     # 协作 Agent
│   └── TOOLS.md      # 可用工具
├── knowledge/        # 知识库
│   └── core.md
└── sessions/         # Session 持久化
```

### 2. 配置

编辑 `.acp-claw/config.json`：

```json
{
  "defaultAgent": "coco",
  "agents": {
    "coco": { "command": "coco", "args": ["acp", "serve"] },
    "codex": { "command": "npx", "args": ["@zed-industries/codex-acp@^0.12.0"] },
    "claude": { "command": "npx", "args": ["-y", "@agentclientprotocol/claude-agent-acp@^0.31.0"] }
  },
  "feishu": {
    "appId": "<your-lark-app-id>",
    "appSecret": "<your-lark-app-secret>"
  },
  "sessionIdleTimeoutMs": 1800000,
  "stateSaveIntervalMs": 30000
}
```

**Agent 配置说明：**

| 字段 | 说明 |
|------|------|
| `command` | Agent 可执行文件路径或命令 |
| `args` | 启动参数 |

**飞书配置：** 也可通过环境变量设置：

```bash
export LARK_APP_ID="your-app-id"
export LARK_APP_SECRET="your-app-secret"
export LARK_DOMAIN="https://open.feishu.cn"  # 可选
export LARK_APP_NAME="MyBot"                  # 可选
export LARK_CHAT_ID="oc_xxxxx"               # 可选，指定群聊
```

### 3. 启动服务

```bash
acp-claw run
```

或直接运行（`run` 是默认命令）：

```bash
acp-claw
```

指定工作目录：

```bash
acp-claw --work-dir /path/to/.acp-claw run
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `acp-claw init` | 初始化配置和记忆目录 |
| `acp-claw run` | 启动服务（默认命令） |
| `acp-claw update` | 更新到最新版本 |
| `acp-claw --version` | 查看版本 |
| `acp-claw --help` | 查看帮助 |

## Slash 命令

在飞书中与 Bot 对话时，可使用以下 Slash 命令：

| 命令 | 说明 | 示例 |
|------|------|------|
| `/help` | 显示所有可用命令 | `/help` |
| `/agent` | 查看当前 Agent 和可用列表 | `/agent` |
| `/agent <name>` | 切换到指定 Agent | `/agent codex` |
| `/session` | 查看当前 Session 信息 | `/session` |
| `/session new` | 新建 Session（重置对话） | `/session new` |
| `/status` | 查看当前状态（Agent、忙碌状态等） | `/status` |

> 注意：在会话处理中（忙碌状态）时，`/agent` 和 `/session new` 会返回等待提示。

## 记忆系统

记忆文件位于 `.acp-claw/memory/` 目录。这些文件会在新 Session 创建时作为系统提示注入 Agent：

| 文件 | 用途 |
|------|------|
| `IDENTITY.md` | Agent 的身份、角色、核心能力 |
| `USER.md` | 用户信息和偏好 |
| `SOUL.md` | Agent 性格和行为准则 |
| `AGENTS.md` | 可协作的其他 Agent |
| `TOOLS.md` | 可用的工具和技能 |

Agent 可以通过文件操作自主更新记忆文件，实现自我学习。

## 知识库

将参考文档放入 `.acp-claw/knowledge/` 目录。所有 `.md` 文件内容会在新 Session 启动时注入。

## 配置选项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `defaultAgent` | `"codex"` | 默认使用的 Agent |
| `sessionIdleTimeoutMs` | `1800000` (30分钟) | Session 空闲超时时间 |
| `stateSaveIntervalMs` | `30000` (30秒) | 状态持久化间隔 |
| `forwardToolMessages` | `false` | 是否将工具调用消息转发到飞书 |

## 更新

```bash
acp-claw update
```

或手动更新：

```bash
npm install -g @byted-iaas/acp-claw --registry https://bnpm.byted.org
```

## 常见问题

**Q: Agent 无法执行编辑/命令？**

确保 Agent 支持 ACP 协议的 `fs/*` 和 `terminal/*` 方法。acp-claw 会自动批准所有权限请求（approve-all 模式）。

**Q: 飞书消息收不到？**

检查飞书应用配置：需要开启事件订阅（WebSocket 模式），并订阅 `im.message.receive_v1` 事件。

**Q: 如何在群聊中使用？**

在群聊中 @Bot 即可触发，消息会自动去除 @前缀。设置 `LARK_CHAT_ID` 环境变量可限定群聊。
