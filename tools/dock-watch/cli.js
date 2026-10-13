#!/usr/bin/env node
/**
 * dock-watch —— 工具坞值守进程的入口（ADR-0242）。
 *
 * 干的活一句话说完：**Obsidian 没开的时候，替它按同一份规则表跑工具坞里的工具。**
 * 它不实现任何调度逻辑 —— 判据是 `src/dock/rules.ts` 那份 `ruleDue`（打包进 `dock-core.cjs`），
 * 本进程只负责「什么时候问、问完怎么跑、跑完怎么记账」。
 *
 * 用法：
 *   node cli.js            常驻（计划任务就用这个；每 `intervalMs` 一拍）
 *   node cli.js --once     只拍一次就退出（排障：看看它认不认得你的规则表）
 *   node cli.js --status   打印当前状态与租约（不开 Obsidian 时也看得见它在干嘛）
 *
 * 退出码：0 正常；2 读不到配置（还没跑安装脚本）；3 已有实例在跑。
 *
 * 三件事都是**刻意**的：
 *  - **单实例**：计划任务在登录、唤醒、重试时都可能再拉一次，两个进程都拍就会重复跑工具；
 *  - **异常不退出**：常驻进程被一个工具带崩就永远不回来了 —— 记日志、继续下一拍才是它该做的；
 *  - **模式切换才写日志**：每 30 秒写一行会把日志刷成噪音（`BZ_DOCK_WATCH_VERBOSE=1` 可全量打到 stdout）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const rt = require('./runtime');
const { createWatcher } = require('./watch');

const HELP = `dock-watch —— 工具坞值守进程

用法：
  node cli.js            常驻（每 intervalMs 一拍）
  node cli.js --once     只拍一次就退出
  node cli.js --status   打印状态、租约与配置

配置：${rt.fileOf('config.json')}（由 install.ps1 生成）
日志：${path.join(rt.logsDir(), 'watch.log')}`;

/** 打包这份值守件时的 bz 版本（面板据此提示「值守件比插件旧」） */
function readCoreVersion() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'core-version.json'), 'utf8'));
    return typeof raw.bzVersion === 'string' ? raw.bzVersion : '';
  } catch {
    return '';
  }
}

function printStatus() {
  const config = rt.readConfig();
  const status = rt.readJson(rt.fileOf('status.json'));
  const lease = rt.readLease();
  const queue = rt.readQueue();
  const lines = [
    `配置      ${config ? `${config.vault}（每 ${Math.round(config.intervalMs / 1000)} 秒一拍）` : '读不到 —— 先跑 install.ps1'}`,
    `值守件    ${readCoreVersion() || '（未知）'}`,
    `本机目录  ${rt.watchdogDir()}`,
    `租约      ${lease ? `bz 插件在场（pid ${lease.pid}，${lease.at}）` : '无 —— 现在轮到我拍'}`,
    `状态      ${status ? `mode=${status.mode}，本次开机跑了 ${status.runsSinceBoot} 次，心跳 ${status.at}` : '还没有（进程没起来过）'}`,
    `待补报    ${queue.length} 条`,
  ];
  if (status && status.lastRun) {
    lines.push(`上次运行  ${status.lastRun.name || status.lastRun.toolId} ${status.lastRun.ok ? '成功' : '失败'}（${status.lastRun.at}）`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (argv.includes('--status')) return printStatus();

  const config = rt.readConfig();
  if (!config) {
    process.stderr.write(`读不到值守配置：${rt.fileOf('config.json')}\n先跑 tools/dock-watch/install.ps1（它会写下 vault 根并挂上开机自启）。\n`);
    return 2;
  }

  const lock = rt.acquireLock();
  if (!lock) {
    // 已经有实例在跑 —— 计划任务的重复触发而已，安静退出（写日志会让噪音翻倍）
    return 3;
  }

  const watcher = createWatcher(config, { coreVersion: readCoreVersion() });
  rt.log(`值守启动（pid ${process.pid}，vault ${config.vault}，每 ${Math.round(config.intervalMs / 1000)} 秒一拍）`);

  const shutdown = (why) => {
    rt.log(`值守退出（${why}）`);
    watcher.stop();
    if (timer) clearInterval(timer);
    rt.releaseLock(lock);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // 常驻进程被一个工具带崩就再也回不来 —— 记下来，接着跑下一拍（下一拍自然会重判）
  process.on('uncaughtException', (e) => rt.log(`未捕获异常：${e && e.stack ? e.stack : e}`));
  process.on('unhandledRejection', (e) => rt.log(`未处理的 rejection：${e && e.stack ? e.stack : e}`));

  const once = argv.includes('--once');
  let timer = null;
  if (once) {
    // 等这一拍真的走完（tick 内部若在跑工具，会等它结束）—— 排障时要看到完整结果
    void watcher.tick().then(() => shutdown('--once'));
  } else {
    void watcher.tick();
    timer = setInterval(() => void watcher.tick(), config.intervalMs);
  }
  return 0;
}

process.exitCode = main();
