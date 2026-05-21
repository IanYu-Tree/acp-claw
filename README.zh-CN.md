# ACP Claw

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)
![ACP](https://img.shields.io/badge/protocol-ACP-purple.svg)

**永不下线的 AI 编程助手 —— 通过飞书消息驱动任意 AI Agent 写代码。**

[English](./README.md) | 简体中文

---

## 为什么需要 ACP Claw？

传统的 AI 编程助手有个共同的痛点：你得开着终端、手动启动会话，一旦关掉窗口就丢失了所有上下文。

**如果你的 AI 编程助手能像后台服务一样，7×24 小时待命，随时从聊天窗口接收指令呢？**

ACP Claw 就是为此而生的。它作为一个常驻守护进程运行：

- 实时监听飞书/Lark 消息，随时响应你的编程需求
- 通过 ACP 协议连接任意 AI Agent（Codex、Claude Code、Gemini 等）
- 跨会话保持记忆和上下文，重启也不丢失
- 直接帮你写代码、执行命令、读写文件 —— 你只管在聊天里说需求

不用再切换窗口，不用再管终端状态。发条消息，剩下的交给 Agent。

---

## 核心特性

- **长生命周期守护进程** — 后台常驻，永不休眠，随时待命
- **ACP 万能适配器** — 兼容任何实现了 [Agent Client Protocol](https://github.com/anthropics/agent-client-protocol) 的 AI Agent
- **会话持久化** — 即使重启服务，也能无缝衔接之前的对话
- **记忆系统** — Agent 会记住你的项目背景、技术决策和偏好
- **斜杠命令** — 通过 `/` 命令快速控制 Agent 行为
- **多 Agent 切换** — 在不同的 AI Agent 之间自由切换

---

## 支持的 Agent

| Agent | 启动命令 | 说明 |
|-------|----------|------|
| Codex | `npx @zed-industries/codex-acp` | Zed 出品的 Codex Agent |
| Claude Code | `npx @agentclientprotocol/claude-agent-acp` | Anthropic 的 Claude Code Agent |
| Gemini | `gemini --acp` | Google 的 Gemini Agent |
| 自定义 | 任何支持 `--acp` 参数的可执行文件 | 接入你自己的 ACP Agent |

---

## 快速开始

### 1. 安装

```bash
npm install -g acp-claw
```

### 2. 初始化项目

```bash
acp-claw init
```

这会在你的项目目录下创建 `.acp-claw/` 配置目录，包含默认配置文件。

### 3. 配置

编辑 `.acp-claw/config.yaml`，填入飞书应用凭证并选择 Agent：

```yaml
feishu:
  app_id: "your-app-id"
  app_secret: "your-app-secret"

agent:
  command: "npx @agentclientprotocol/claude-agent-acp"
  working_dir: "/path/to/your/project"

session:
  persistence: true
  memory: true
```

### 4. 启动

```bash
acp-claw run
```

守护进程已启动！现在去飞书给你的 Bot 发条消息试试吧。

### 更新

```bash
acp-claw update
```

---

## 架构

```mermaid
graph LR
    A[飞书消息] -->|WebSocket| B[Controller]
    B --> C[SessionManager]
    C --> D[AcpClient]
    D --> E[Codex]
    D --> F[Claude Code]
    D --> G[Gemini]
    D --> H[自定义 Agent]

    style A fill:#4e8cff,color:#fff
    style B fill:#36cfc9,color:#fff
    style C fill:#ffc53d,color:#fff
    style D fill:#9254de,color:#fff
```

**数据流向：**

```
飞书消息 → WebSocket → Controller → SessionManager → AcpClient → Agent
  ↑                                                                  ↓
  └──────────────────── 响应返回 ←───────────────────────────────────┘
```

---

## 斜杠命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示可用命令列表 |
| `/status` | 查看守护进程和 Agent 状态 |
| `/agent <name>` | 切换到指定 Agent |
| `/memory` | 查看当前会话记忆 |
| `/clear` | 清空当前会话上下文 |
| `/restart` | 重启 Agent 进程 |

---

## 配置说明

ACP Claw 使用 YAML 格式的配置文件，位于 `.acp-claw/config.yaml`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `feishu.app_id` | string | 飞书应用 App ID |
| `feishu.app_secret` | string | 飞书应用 App Secret |
| `agent.command` | string | ACP Agent 的启动命令 |
| `agent.working_dir` | string | Agent 的工作目录 |
| `session.persistence` | boolean | 是否启用会话持久化 |
| `session.memory` | boolean | 是否启用记忆系统 |
| `session.max_history` | number | 会话中保留的最大消息数 |

---

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/IanYu-Tree/acp-claw.git
cd acp-claw

# 安装依赖
npm install

# 构建
npm run build

# 开发模式运行
npm run dev

# 运行测试
npm test
```

---

## 开源协议

[MIT](./LICENSE) © IanYu
