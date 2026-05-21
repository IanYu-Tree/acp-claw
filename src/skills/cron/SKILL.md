---
name: cron
description: 定时任务管理，支持 cron 表达式定时触发，通过 CLI 命令管理定时任务
trigger: 当用户需要设置定时提醒、定期执行任务、周期性操作时
---

# Cron 定时任务

## Purpose

使用 `acp-claw cron` CLI 命令管理定时任务。任务创建后会持久化存储并立即生效，到达指定时间时自动创建 session 执行。

## When to Use

- 用户要求定时提醒（如每天早上 9 点提醒站会）
- 用户需要周期性执行某个操作（如每小时检查服务状态）
- 用户要求定期发送消息到某个聊天群

## CLI Commands

### 添加定时任务

```bash
acp-claw cron add --name <task-name> --schedule "<cron-expression>" --prompt "<prompt-text>" [--chat-id <chat-id>] [--one-shot]
```

参数说明：
- `--name`: 任务名称（唯一标识符）
- `--schedule`: Cron 表达式（5 字段格式）
- `--prompt`: 触发时发送给 AI 的提示词
- `--chat-id`: （可选）指定回复消息的聊天 ID
- `--one-shot`: （可选）执行一次后自动删除

### 删除定时任务

```bash
acp-claw cron delete --name <task-name>
```

### 列出所有定时任务

```bash
acp-claw cron list
```

### 启用/禁用定时任务

```bash
acp-claw cron toggle --name <task-name> --enabled true
acp-claw cron toggle --name <task-name> --enabled false
```

## Cron Expression Format

5 字段格式: `minute hour day month weekday`

### Examples

- `*/5 * * * *` — 每 5 分钟
- `0 * * * *` — 每小时整点
- `0 9 * * *` — 每天 9:00
- `0 9 * * 1-5` — 工作日 9:00
- `0 0 1 * *` — 每月 1 号 0:00
- `30 18 * * 5` — 每周五 18:30
- `0 9,18 * * *` — 每天 9:00 和 18:00

## Behavior

- 任务创建后立刻生效，无需重启服务
- 触发时会创建独立的 cron session 执行 prompt
- oneShot 任务执行一次后自动删除
- 任务数据持久化在 `scheduler/tasks.json`
