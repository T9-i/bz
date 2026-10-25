#!/usr/bin/env node
/**
 * dock-watch —— 工具坞值守进程的入口。
 *
 * 一句话：**Obsidian 没开的时候，替它按同一份规则表跑工具坞里的工具。**
 *
 * 它不实现任何调度逻辑 —— 判据、执行、记账、一拍全在 `dock-core.cjs` 里
 * （由 `scripts/build-dock-watch.mjs` 从 `src/dock/watch-core.ts` 打出，与插件同一份源码）。
 * 本进程只负责三件事：**装配**（路径与 child_process 注进去）、**什么时候调一次**、**写本机状态**。
 *
 * 什么时候调一次，见下面 `arm()` 那段：**到点即醒，不按秒比时间表**。
 *
 * 用法：
 *   node cli.js            常驻（计划任务就用这个）
 *   node cli.js --once     只拍一次就退出（排障：看看它认不认得你的规则表）
 *   node cli.js --status   打印当前状态与配置（不开 Obsidian 时也看得见它在干嘛）
 *
 * 退出码：0 正常；2 读不到配置（还没跑安装脚本）；3 已有实例在跑。
 *
 * 三件事都是**刻意**的：
 *  - **单实例**：计划任务在登录、唤醒、重试时都可能再拉一次，两个进程都拍就会重复跑工具；
 *  - **异常不退出**：常驻进程被一个工具带崩就永远不回来了 —— 记日志、继续下一拍才是它该做的；
 *  - **状态切换才写日志**：每拍都写一行会把日志刷成噪音（`BZ_DOCK_WATCH_VERBOSE=1` 可全量打到 stdout）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./dock-core.cjs');
const rt = require('./runtime');
const { makeNodeFs } = require('./node-fs');
const { createWatcher, nextDelay } = require('./watch');

const HELP = `dock-watch —— 工具坞值守进程

用法：
  node cli.js            常驻（每 intervalMs 一拍）
  node cli.js --once     只拍一次就退出
  node cli.js --status   打印状态与配置

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
  const lines = [
    `配置      ${config ? `${config.vault}（每 ${Math.round(config.intervalMs / 1000)} 秒扫一次，${Math.round(config.conditionMs / 1000)} 秒看一眼条件）` : '读不到 —— 先跑 install.ps1'}`,
    `值守件    ${readCoreVersion() || '（未知）'}`,
    `本机目录  ${rt.watchdogDir()}`,
  ];
  if (config) {
    const plugin = rt.readPluginData(config);
    const storageDir = core.normalizeStorageDir(plugin.storagePath);
    const registryPath = core.storageFileIn(storageDir, core.REGISTRY_FILENAME);
    const reg = plugin.ok ? core.readRegistryAt(registryPath, makeNodeFs(config.vault)) : null;
    lines.push(`插件数据  ${plugin.ok ? plugin.file : `读不到（${plugin.file}）`}`);
    lines.push(
      `账本      ${registryPath}（${reg ? `${reg.registry.tools.length} 个工具在册` : '读不到登记表'}）`,
    );
  }
  lines.push(
    `状态      ${status ? `mode=${status.mode}，本次开机跑了 ${status.runsSinceBoot} 次，心跳 ${status.at}` : '还没有（进程没起来过）'}`,
  );
  if (status && status.nextAt) lines.push(`下次醒    ${status.nextAt}`);
  if (status && status.lastRun) {
    lines.push(
      `上次运行  ${status.lastRun.name || status.lastRun.toolId} ${status.lastRun.status || (status.lastRun.ok ? '成功' : '失败')}（${status.lastRun.at}）`,
    );
  }
  if (status && status.lastError) lines.push(`上次错误  ${status.lastError}`);
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
    process.stderr.write(
      `读不到值守配置：${rt.fileOf('config.json')}\n先跑 tools/dock-watch/install.ps1（它会写下 vault 根并挂上开机自启）。\n`,
    );
    return 2;
  }

  const lock = rt.acquireLock();
  if (!lock) {
    // 已经有实例在跑 —— 计划任务的重复触发而已，安静退出（写日志会让噪音翻倍）
    return 3;
  }

  // 装配：这几行是值守与插件唯一的差别 —— 文件往哪找、child_process 从哪来、vault 根在哪
  core.setDockFs(makeNodeFs(config.vault));
  core.setExecDeps({ cp: require('child_process') });
  // 登记表里工具路径可能是 `vault:CONFIG/...` 形态（跟着库走、能同步到别的机器）。
  // 还原它需要知道「这个库在哪」—— 插件那边是从 adapter 问的，值守这里就是 config.vault。
  core.setDockVaultRoot(config.vault);

  const once = argv.includes('--once');
  const watcher = createWatcher(config, { coreVersion: readCoreVersion() });
  rt.log(
    `值守启动（pid ${process.pid}，vault ${config.vault}，扫描 ${Math.round(config.intervalMs / 1000)} 秒、条件 ${Math.round(config.conditionMs / 1000)} 秒，核心 bz ${readCoreVersion() || '未知'}）`,
  );

  let timer = null;
  const shutdown = (why) => {
    rt.log(`值守退出（${why}）`);
    watcher.stop();
    if (timer) clearTimeout(timer);
    rt.releaseLock(lock);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // 常驻进程被一个工具带崩就再也回不来 —— 记下来，接着跑下一拍（下一拍自然会重判）
  process.on('uncaughtException', (e) => rt.log(`未捕获异常：${e && e.stack ? e.stack : e}`));
  process.on('unhandledRejection', (e) => rt.log(`未处理的 rejection：${e && e.stack ? e.stack : e}`));

  if (once) {
    // 等这一拍真的走完（tick 内部若在跑工具，会等它结束）—— 排障时要看到完整结果。
    // `.catch` 不能省：tick 抛错时只有 unhandledRejection 记一行日志、**不会调 shutdown**，
    // `--once` 就挂在那里不退，排障的人以为它卡住了。
    void watcher
      .tick()
      .then(() => shutdown('--once'))
      .catch((e) => {
        rt.log(`这一拍出错：${e && e.stack ? e.stack : e}`);
        shutdown('--once（出错）');
      });
    return 0;
  }

  /**
   * 调度：**算出最近到期的那一刻，睡到那一刻**。不按秒比较时间表 —— 那是「每秒醒一次、
   * 走一遍列表、什么也没干」的写法，社区里公认不该这么写（最小堆 / 单定时器是标准答案）。
   *
   * 醒来的理由只有三种，`nextDelay()` 里一并算清：
   *  1. **到点**：某条规则的到期时刻（账本里的 `pending.dueAt`，含抖动）；
   *  2. **条件成立**：条件层在盯事件（关闭 Obsidian），按 `conditionMs` 看一眼；
   *  3. **兜底重采**：`intervalMs`（默认 30 秒）—— 防的是「别人改了规则表」，不是「有没有活干」。
   *
   * 递归 setTimeout，不用 setInterval：一次醒来可能被「等网」占住几分钟、被一个工具占住十分钟，
   * setInterval 会把它们排成一串（并发进 tick 虽被 `ticking` 挡住，但缓存的 tick 会在等网结束后
   * 连发，把日志和网络都搅乱）。
   */
  const arm = () => {
    if (watcher.state.stopped) return;
    const delay = nextDelay(Date.now(), {
      at: watcher.state.at,
      scanMs: config.intervalMs,
      cond: watcher.state.conds.has('obsidian-exit'),
      condMs: config.conditionMs,
    });
    // 刻意**不** unref：常驻进程得靠这个定时器活着
    timer = setTimeout(() => void fire(), delay);
  };

  const fire = async () => {
    timer = null;
    const st = watcher.state;
    if (st.stopped) return;
    /**
     * **`arm()` 必须在 finally 里。**
     *
     * 旧版这里是「tick → setTimeout」，而 tick 自己永不抛（内部 try/catch），所以掉不出循环。
     * 现在这条路上多了 `check()` 和 `plan()` 两个都会读盘的东西 —— 只要它们抛一次，
     * 定时器就再也不会被重新装上，值守从此静默地活着、一拍拍都不跑，**而且没有任何症状**
     * （`status.at` 停住，插件那边看到的是「值守半天没心跳」）。宁可多一层壳。
     */
    try {
      const now = Date.now();

      // 1) 条件层：只做系统调用。命中才有事件，没有就什么都不发生
      const events = watcher.check();

      // 2) 时间层：到点了吗 / 该重采了吗
      const due = st.at !== null && now >= st.at;
      const rescan = now >= st.nextScanAt;
      if (due || events.length || rescan) {
        if (due && events.length === 0) rt.log(`到点，拍一次（${new Date(st.at).toISOString()}）`);
        await watcher.tick(events);
        rt.touchLock(lock); // 顺手续锁：别让「pid 被复用」把值守永久挡在门外

        // 3) 采集层：跑完重算下一个到期时刻。账本刚被这一拍改过，必须重读
        watcher.plan();
        st.nextScanAt = Date.now() + config.intervalMs;

        /**
         * 到点了却什么都没跑（参数没填、冷却中、熔断、锁在插件手里）—— 这次到期已经看过，
         * 就别在原地打转：退到扫描间隔再来。**这一条是防忙等的地板，删了会变成每秒一拍。**
         */
        if (st.at !== null && st.at <= Date.now()) {
          if (st.lastStuckAt !== st.at) {
            st.lastStuckAt = st.at;
            rt.log('有规则到点了但这一拍没跑（被跳过），退到扫描间隔再看');
          }
          st.at = null;
        }
      } else {
        // 只是条件层的一次空检查 —— 不跑工具，只把心跳盖新（30 秒封顶）
        watcher.heartbeat();
      }
    } catch (e) {
      rt.log(`这一拍出错：${e && e.stack ? e.stack : e}`);
    } finally {
      arm();
    }
  };

  watcher.plan(); // 启动先采一次：第一次醒就不必盲拍
  void fire();
  return 0;
}

process.exitCode = main();
