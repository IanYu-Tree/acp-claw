#!/usr/bin/env node

import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import { initWorkDir, loadConfig, resolveWorkDir } from './config.js';

const program = new Command();

program
  .name('acp-claw')
  .description('ACP protocol based Claw client with Feishu channel')
  .version('1.0.0')
  .option('--work-dir <path>', '工作目录路径');

program
  .command('init')
  .description('初始化配置文件和记忆目录')
  .action(() => {
    const workDir = resolveWorkDir(program.opts().workDir);
    const config = initWorkDir(workDir);
    console.log(`✅ 已初始化工作目录: ${workDir}`);
    console.log(`   默认 Agent: ${config.defaultAgent}`);
    console.log(`   可用 Agents: ${Object.keys(config.agents).join(', ')}`);
    if (config.feishu) {
      console.log(`   飞书 Channel: 已配置`);
    } else {
      console.log(`   飞书 Channel: 未配置 (设置 LARK_APP_ID 和 LARK_APP_SECRET 环境变量或编辑 config.json)`);
    }
  });

program
  .command('run', { isDefault: true })
  .description('启动 ACP Claw 服务')
  .action(async () => {
    const workDir = resolveWorkDir(program.opts().workDir);
    const config = loadConfig(workDir);

    const { Controller } = await import('./controller.js');
    const controller = new Controller(config, workDir);
    await controller.start();
  });

program
  .command('update')
  .description('更新 acp-claw 到最新版本')
  .action(() => {
    const needsSudo = (() => {
      try {
        const prefixResult = spawnSync('npm', ['config', 'get', 'prefix'], {
          encoding: 'utf-8',
        });
        const globalPrefix = prefixResult.stdout?.trim();
        if (!globalPrefix) return true;
        const globalLibDir = join(globalPrefix, 'lib');
        const dirToCheck = existsSync(globalLibDir) ? globalLibDir : globalPrefix;
        accessSync(dirToCheck, fsConstants.W_OK);
        return false;
      } catch {
        return true;
      }
    })();

    const runCommand = (cmd: string, args: string[]) => {
      if (needsSudo) {
        return spawnSync('sudo', [cmd, ...args], { stdio: 'inherit' });
      }
      return spawnSync(cmd, args, { stdio: 'inherit' });
    };

    console.log(
      needsSudo
        ? '🔐 全局 npm 目录需要提权，使用 sudo...'
        : '✅ 全局 npm 目录可写，无需 sudo。',
    );

    console.log('🧹 清理 npm 缓存...');
    const cleanResult = runCommand('npm', ['cache', 'clean', '--force']);
    if (cleanResult.status !== 0) {
      console.error('❌ 清理 npm 缓存失败');
      process.exit(1);
    }

    console.log('📦 安装最新版 acp-claw...');
    const installResult = runCommand('npm', [
      'install',
      '-g',
      'acp-claw',
    ]);
    if (installResult.status !== 0) {
      console.error('❌ 安装最新版本失败');
      process.exit(1);
    }

    console.log('✅ 更新完成！');
  });

program.parse();
