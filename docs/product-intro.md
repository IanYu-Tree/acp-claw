<callout emoji="🦞" background-color="light-blue">
ACP Claw — 一个永不停歇的 AI 编程助手。它在飞书里长驻运行，通过 ACP 协议接入任何 AI Agent（Codex、Claude Code、Gemini...），让你随时随地用飞书消息驱动 AI 写代码、执行命令、读写文件。
</callout>

## 一句话理解 Claw

> **飞书消息 → Long-Live Looping 服务 → ACP 协议 → 任意 Agent**

你的 AI 助手不再是一次性的命令行工具，而是一个**永远在线**的私人编程伙伴。

---

## 为什么需要 Claw？

<grid cols="2">
<column>

### 传统 AI 编程工具的痛点

- 每次使用都要打开终端、启动工具
- 不同 Agent 有不同的 API、鉴权、消息格式
- 会话状态丢失，无法跨设备延续
- 切换 Agent 意味着换一套工具链

</column>
<column>

### Claw 的解决方案

- 飞书里发消息即可，随时随地
- ACP 协议统一接口，一行配置换 Agent
- 会话持久化，重启不丢失
- Long-Live Looping，7×24 待命

</column>
</grid>

---

## 核心特性

<grid cols="3">
<column>

### 🔄 Long-Live Looping

进程永不退出，WebSocket 长连接持续监听飞书消息。不是一次性脚本，而是一个**守护服务**。

</column>
<column>

### 🔌 ACP 万能适配

通过 Agent Client Protocol 标准协议，一套代码接入所有 Agent。想换 Agent？改一行配置即可。

</column>
<column>

### 💾 会话持久化

Session 状态实时落盘，进程重启自动恢复。崩溃不怕，重启即续。

</column>
</grid>

---

## 整体架构

<whiteboard type="blank"></whiteboard>

---

## 核心流程：从消息到回复

<whiteboard type="blank"></whiteboard>

**流程解析**：

| 阶段 | 动作 | 说明 |
|------|------|------|
| ① 接收 | 飞书 WebSocket → FeishuChannel | 消息去重 + @mention 标准化 |
| ② 路由 | Controller → parseSlashCommand | 命令走命令处理，普通消息走 Agent |
| ③ 会话 | SessionManager.getOrCreate() | 每用户一个隔离 Session |
| ④ 调用 | AcpClient → spawn Agent → session/prompt | JSON-RPC 2.0 over stdio |
| ⑤ 执行 | Agent 自主工作（读写文件、执行命令） | 权限自动批准，无需人工干预 |
| ⑥ 回复 | session/update → debounce 500ms → 飞书卡片 | Markdown 渲染，避免消息碎片 |

---

## ACP 协议：Agent 生态的 USB 接口

<whiteboard type="blank"></whiteboard>

### 为什么选择 ACP？

ACP（Agent Client Protocol）是 Agent 通信的标准协议，类似于 LSP 之于编辑器：

```
LSP  = Language Server Protocol  → 让任何编辑器对接任何语言服务
ACP  = Agent Client Protocol     → 让任何客户端对接任何 AI Agent
Claw = ACP Client                → 专为飞书场景打造的 ACP 客户端
```

### 已支持 Agent

| Agent | 命令 | 特点 |
|-------|------|------|
| **Codex** | `npx @zed-industries/codex-acp` | OpenAI 出品，强推理能力 |
| **Claude Code** | `npx @agentclientprotocol/claude-agent-acp` | Anthropic 出品，长上下文 |
| **Gemini** | `gemini --acp` | Google 出品，多模态 |
| **任何 ACP Agent** | 自定义 command + args | 一行配置即可接入 |

### 接入新 Agent 只需一步

```json
{
  "agents": {
    "my-agent": {
      "command": "my-agent-binary",
      "args": ["--acp", "--model", "gpt-5"]
    }
  }
}
```

然后飞书发送 `/agent my-agent` 即可切换！

---

## Long-Live Looping 设计

<callout emoji="🔄" background-color="light-green">
Claw 不是"用完即走"的 CLI 工具，而是一个长驻守护服务。它的生命周期与服务器同步，而非与终端会话绑定。
</callout>

### 为什么要 Long-Live？

```
传统模式:
  用户 → 打开终端 → 启动工具 → 对话 → 关闭终端 → 状态丢失 ❌

Claw 模式:
  acp-claw run → 永远在线 → 飞书消息随时触发 → 状态持久化 ✅
```

### 实现机制

```typescript
// 核心：keepAlive 循环
private keepAlive(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (this.stopped) { resolve(); return; }
      setTimeout(check, 5000);  // 每 5 秒心跳
    };
    check();
  });
}

// 启动流程
async start() {
  await this.restoreSessions();       // 恢复之前的 Session
  await this.feishuChannel.start();   // 启动 WebSocket
  this.startAutoSave();               // 定期持久化
  this.registerSignalHandlers();      // 优雅关闭
  await this.keepAlive();             // 阻塞，永不退出
}
```

### 容灾设计

| 场景 | 应对策略 |
|------|----------|
| 进程重启 | 从 sessions/*.json 恢复会话状态 |
| 飞书断连 | 5 秒后自动重连 |
| Agent 崩溃 | 下次消息时自动重新 spawn |
| SIGINT/SIGTERM | 优雅关闭：保存状态 → 关闭 Channel → 关闭子进程 |

---

## 会话管理

### 用户隔离

每个飞书用户拥有独立 Session，互不干扰：

```
用户 A (ou_xxx1) → feishu_user_ou_xxx1 → Session A → Agent A
用户 B (ou_xxx2) → feishu_user_ou_xxx2 → Session B → Agent B
```

### Slash 命令

| 命令 | 功能 |
|------|------|
| `/agent` | 查看当前使用的 Agent |
| `/agent codex` | 切换到 Codex Agent |
| `/session new` | 开启全新对话 |
| `/status` | 查看 Session 状态 |
| `/help` | 显示帮助 |

---

## 记忆系统

Claw 支持可定制的记忆系统，让 Agent 了解你的偏好和项目背景：

```
.acp-claw/
├── memory/
│   ├── IDENTITY.md   # 你是谁？AI 助手的角色定义
│   ├── USER.md       # 用户偏好（编程习惯、技术栈）
│   ├── SOUL.md       # 交互风格（简洁/详细、语言偏好）
│   ├── AGENTS.md     # Agent 能力边界说明
│   └── TOOLS.md      # 可用工具文档
├── knowledge/
│   └── core.md       # 项目知识库（架构、约定）
└── sessions/
    └── *.json        # 会话状态持久化
```

<callout emoji="💡" background-color="light-yellow">
首次使用时，Claw 会自动引导 Agent 与你对话完成个性化设置，无需手动编辑配置文件。
</callout>

---

## 快速开始

```bash
# 1. 全局安装
npm install -g acp-claw

# 2. 初始化工作目录
acp-claw init

# 3. 编辑配置（填入飞书 App 凭证）
vim .acp-claw/config.json

# 4. 启动（Long-Live 模式）
acp-claw run
```

然后在飞书里给你的 Bot 发消息，就能开始编程了！

---

## 总结

<grid cols="3">
<column>

### 对开发者

飞书里发消息就能编程，通勤、会议间隙都能用。

</column>
<column>

### 对团队

统一的 Agent 接入方式，一套基础设施支持所有 Agent。

</column>
<column>

### 对生态

ACP 协议开放标准，任何人都可以开发 Agent 接入 Claw。

</column>
</grid>

<callout emoji="🦞" background-color="light-blue">
Claw = Long-Live Looping + ACP Protocol + 飞书 Channel。三位一体，让 AI Agent 真正成为你随时在线的编程伙伴。
</callout>
