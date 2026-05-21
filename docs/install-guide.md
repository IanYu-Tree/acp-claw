## 安装教程

### 环境要求

- Node.js >= 18
- npm >= 8

### 安装步骤

```bash
# 1. 清理 npm 缓存（避免旧包残留问题）
sudo npm cache clean --force

# 2. 全局安装 acp-claw
sudo npm install -g acp-claw

# 3. 验证安装
acp-claw --version
```

### 初始化

```bash
# 在你的项目目录下初始化
acp-claw init
```

初始化后会创建 `.acp-claw/` 工作目录：

```
.acp-claw/
├── config.json       # 核心配置（Agent、飞书凭证）
├── memory/           # Agent 记忆文件
│   ├── IDENTITY.md   # Agent 身份描述
│   ├── USER.md       # 用户信息和偏好
│   ├── SOUL.md       # 行为准则和性格
│   ├── AGENTS.md     # 可协作的 Agent
│   └── TOOLS.md      # 可用工具说明
├── knowledge/        # 知识库
│   └── core.md       # 项目核心知识
└── sessions/         # Session 持久化存储
```

### 配置

编辑 `.acp-claw/config.json`：

```json
{
  "defaultAgent": "codex",
  "agents": {
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

也可通过环境变量配置飞书凭证：

```bash
export LARK_APP_ID="your-app-id"
export LARK_APP_SECRET="your-app-secret"
export LARK_DOMAIN="https://open.feishu.cn"  # 可选
export LARK_APP_NAME="MyBot"                  # 可选
export LARK_CHAT_ID="oc_xxxxx"               # 可选，限定群聊
```

### 启动服务

```bash
# 启动（Long-Live 模式，进程常驻）
acp-claw run

# 或直接运行（run 是默认命令）
acp-claw

# 指定工作目录
acp-claw --work-dir /path/to/.acp-claw run
```

### 更新

```bash
# 使用内置更新命令
acp-claw update

# 或手动更新
sudo npm cache clean --force
sudo npm install -g acp-claw
```

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| Agent 无法执行编辑/命令 | 确保 Agent 支持 ACP 协议的 `fs/*` 和 `terminal/*` 方法 |
| 飞书消息收不到 | 检查应用是否开启事件订阅（WebSocket 模式）并订阅 `im.message.receive_v1` |
| 群聊中如何使用 | @Bot 即可触发，设置 `LARK_CHAT_ID` 可限定群聊 |
| 安装权限不足 | 使用 `sudo` 安装，或配置 npm prefix 到用户目录 |

