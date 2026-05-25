## 完整功能清单

### 核心功能

| 功能 | 说明 | 状态 |
|------|------|------|
| **Long-Live Looping** | 进程常驻，永不退出，WebSocket 长连接持续监听 | ✅ |
| **ACP 多 Agent 切换** | 通过统一 ACP 协议接入 Coco/Codex/Claude/Gemini 等 | ✅ |
| **飞书 WebSocket Channel** | 通过飞书消息收发，支持私聊和群聊（@Bot 触发） | ✅ |
| **会话持久化** | Session 状态实时落盘，进程重启自动恢复 | ✅ |
| **定时任务（Cron）** | 支持 cron 表达式定时触发 Agent 执行任务 | ✅ |
| **多语言支持（i18n）** | 系统消息支持中英文切换 | ✅ |
| **记忆系统** | 可自定义的 memory 文件，Agent 可自主更新 | ✅ |
| **知识库注入** | knowledge/ 下的 .md 文件自动注入新会话 | ✅ |
| **Skills 系统** | skills/*/SKILL.md 自动加载为 Agent 能力声明 | ✅ |
| **流式消息转发** | Agent 输出实时 flush 到飞书（debounce 优化） | ✅ |
| **消息打断** | 新消息到达时自动 cancel 进行中的 prompt | ✅ |

---

### 定时任务（CronService）

<callout emoji="⏰" background-color="light-green">
定时任务让 Claw 具备主动能力：不仅可以被动响应消息，还能按计划主动执行任务并推送结果到飞书。
</callout>

**核心特性**：
- 支持标准 5 字段 cron 表达式
- 任务创建后立即生效，无需重启
- 支持 oneShot 模式（执行一次后自动删除）
- 触发时自动创建独立 cron session 执行
- 可指定 chatId 将结果推送到指定群聊
- 配置文件热重载（fs.watch 监听 + 防抖 + 自触发保护）
- 原子写入保证（.tmp → rename）
- 优雅关闭（等待所有运行中任务完成）

**CLI 命令**：

```bash
# 添加定时任务
acp-claw cron add --name "daily-standup" \
  --schedule "0 9 * * 1-5" \
  --prompt "帮我整理今天的待办事项并发送到群里" \
  --chat-id "oc_xxxxx"

# 添加一次性任务
acp-claw cron add --name "remind-meeting" \
  --schedule "30 14 * * *" \
  --prompt "提醒我 15:00 有评审会议" \
  --one-shot

# 列出所有任务
acp-claw cron list

# 启用/禁用任务
acp-claw cron toggle --name "daily-standup" --enabled false

# 删除任务
acp-claw cron delete --name "remind-meeting"
```

**Cron 表达式示例**：

| 表达式 | 含义 |
|--------|------|
| `*/5 * * * *` | 每 5 分钟 |
| `0 * * * *` | 每小时整点 |
| `0 9 * * *` | 每天 9:00 |
| `0 9 * * 1-5` | 工作日 9:00 |
| `30 18 * * 5` | 每周五 18:30 |
| `0 9,18 * * *` | 每天 9:00 和 18:00 |
| `0 0 1 * *` | 每月 1 号 0:00 |

**数据持久化**：

```
.acp-claw/
└── scheduler/
    └── tasks.json    # 所有定时任务配置
```

---

### Slash 命令系统

| 命令 | 功能 | 示例 |
|------|------|------|
| `/help` | 显示所有可用命令 | `/help` |
| `/agent` | 查看当前 Agent 和可用列表 | `/agent` |
| `/agent <name>` | 切换到指定 Agent | `/agent codex` |
| `/session` | 查看当前 Session 信息 | `/session` |
| `/session new` | 新建 Session（重置对话） | `/session new` |
| `/status` | 查看当前状态（Agent、忙碌状态） | `/status` |
| `/language [zh\|en]` | 切换系统消息语言 | `/language en` |

---

### Agent 生态支持

| Agent | 接入方式 | 说明 |
|-------|----------|------|
| **Coco** | `coco acp serve` | 字节内部 Agent，深度工具链集成 |
| **Codex** | `npx @zed-industries/codex-acp` | OpenAI 出品，强推理 + 代码生成 |
| **Claude Code** | `npx @agentclientprotocol/claude-agent-acp` | Anthropic 出品，长上下文理解 |
| **Gemini** | `gemini --acp` | Google 出品，多模态能力 |
| **自定义** | 任何实现 ACP 协议的 Agent | 一行 config 即可接入 |

---

### ACP 协议能力

Claw 作为 ACP Client 实现了完整的文件系统和终端能力：

| 能力 | 方法 | 说明 |
|------|------|------|
| 文件读取 | `fs/read_text_file` | Agent 读取项目文件 |
| 文件写入 | `fs/write_text_file` | Agent 修改/创建文件 |
| 终端创建 | `terminal/create` | Agent 执行 shell 命令 |
| 终端输出 | `terminal/output` | 获取命令执行结果 |
| 终端等待 | `terminal/wait_for_exit` | 等待命令完成 |
| 终端终止 | `terminal/kill` | 中止运行中的命令 |
| 权限批准 | `session/request_permission` | 自动批准（无人值守模式） |

---

### 飞书 Channel 能力

| 功能 | 说明 |
|------|------|
| WebSocket 长连接 | 基于 @larksuiteoapi/node-sdk WSClient |
| 自动重连 | 断连后 5 秒自动重试 |
| 消息去重 | 10 分钟内 messageId 去重 |
| 群聊过滤 | 仅处理 @Bot 的消息 |
| @mention 标准化 | 将 `@_user_1` 转为真实姓名 |
| 工作状态 emoji | 处理中显示 "OnIt" 状态 |
| 卡片回复 | 使用飞书卡片 Schema 2.0 + Markdown 渲染 |
| 工具消息转发 | 可选将 Agent 工具调用转发到飞书 |

---

### 容灾与可靠性

| 机制 | 实现 |
|------|------|
| 进程重启恢复 | sessions/*.json 持久化 |
| 飞书断连重连 | 5 秒自动重试 |
| Agent 崩溃恢复 | 下次消息自动重新 spawn |
| 配置文件损坏 | 自动备份 .corrupted 文件 |
| 原子写入 | .tmp → rename 防止半写 |
| 定时任务热重载 | fs.watch + 防抖 + reconcile |
| 优雅关闭 | SIGINT/SIGTERM → 保存状态 → 关闭连接 |
| 子进程清理 | SIGTERM → 超时 → SIGKILL |

---

### Skills 系统

将 `.acp-claw/skills/*/SKILL.md` 自动注入为 Agent 上下文：

```
.acp-claw/
└── skills/
    └── cron/
        └── SKILL.md   # 定时任务能力声明
```

Agent 读取 SKILL.md 后即可了解并使用对应功能，实现能力自发现。

