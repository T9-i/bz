/**
 * 值守的**三层**：采集、时间、条件 —— 三层各自独立，谁也不打听对方在干什么。
 *
 * ```
 *   采集 plan()   读登记表 → 算出「最近该醒的那一刻」（每 ≤intervalMs 一次，顺带兜住配置改动）
 *   时间 nextDelay() 睡到那一刻；到点才调 tick()。**不按秒比较时间表**
 *   条件 check()  只认事件型规则（如 obsidian-exit），每 conditionMs 做一次系统调用，命中才调 tick()
 * ```
 *
 * 一句话：**唤醒的理由只有两种 —— 到点了，或者条件成立了。** 没有第三种。
 *
 * 上一版是「每 intervalMs 无条件跑一拍」，于是所有时间都晚最多一个间隔：关闭 Obsidian 要多等
 * 30 秒才同步，19:00 的任务 19:00:29 才跑。现在是「算出最近到期时刻 → 睡到那一刻」，误差是毫秒。
 * 采集那次 30 秒不是「轮询有没有活干」，是「防别人改了规则表」—— 语义不同，代价一样。
 *
 * 判据、执行、记账仍然全在 `core.tickOnce()`（`dock-core.cjs`，与插件同一份源码）。值守只是
 * **触发者**：它不判断该不该跑、不判断跑成没成、不写账本。所以这里新增的 `plan()` 只做一件事
 * —— 算「什么时候该叫醒 tick」，**算错了最多多醒几次，不会多跑一次工具**（tick 里会重判）。
 *
 * 值守**只多管两件插件管不到的事**：
 *  1. **等网**：计划任务在登录瞬间拉起本进程，网卡常常还没就绪。到点就跑会得到一个
 *     `fetch failed`，而账已经记下了 —— 这一天不会再有第二次机会。所以没网就**整拍不拍**，
 *     账不记，下一拍再来。这是「跑太早」和「跑失败」的区别。
 *  2. **本机状态**：`status.json` / 日志（面板与排障要读，而它们不属于 vault 里的账本）。
 *
 * 与插件相同的那一半，一个字都不重复实现 —— 包括 `on-launch` 规则为什么在离场时为 false
 * （内核收到的 `sessionStart` 是 undefined，判据自然不命中，不需要值守自己写一条特例）。
 * 同理，条件层只负责「什么时候把 `{kind:'obsidian-exit'}` 投进 tick 的事件表」，
 * 这条事件该不该让某条规则跑，仍是 `rules.ts` 的 `ruleDue` 说了算。
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const core = require('./dock-core.cjs');
const rt = require('./runtime');
const net = require('./net');

/** 「网刚通过」的保鲜期：通了之后 5 分钟内不再重探 */
const NET_OK_TTL_MS = 5 * 60 * 1000;
/**
 * 等网失败后的静默期：这次没网就不在这 60 秒里每拍都等满一轮
 * （`intervalMs` 才 30 秒，不设它会把日志刷成「等了 5 分钟」的循环）。
 */
const NET_RETRY_MS = 60 * 1000;

/** 单次睡多久的下限：防「算出来就在眼前」变成忙等 */
const MIN_DELAY_MS = 200;
/** 探测 Obsidian 进程的最短间隔（起一次 tasklist 约 50–100ms，别按秒来） */
const PROBE_MIN_MS = 30 * 1000;
/** status.json 的心跳上限。插件判「值守死了」的线是 90 秒，30 秒盖一次足够稳 */
const STATUS_GAP_MS = 30 * 1000;

/**
 * 造一个值守实例。`tick()` 幂等（进行中重入直接返回），所以定时器怎么调都不会叠加。
 * `opts` 是测试缝：`netProbe` 注入网络探测，`intervalMs` 覆盖拍间隔。
 */
function createWatcher(config, opts = {}) {
  const state = {
    startedAt: new Date().toISOString(),
    runsSinceBoot: 0,
    lastRun: undefined,
    lastError: undefined,
    coreVersion: opts.coreVersion || '',
    /** 上一拍的结果（只在变化时记日志） */
    lastOutcome: undefined,
    /** 网刚通过的时点（跨拍保留：开机那一串任务只探一次） */
    netOkAt: 0,
    /** 等网失败后的静默期截止（ms） */
    netRetryAt: 0,
    netProbe: typeof opts.netProbe === 'function' ? opts.netProbe : undefined,
    ticking: false,
    stopped: false,

    // ===== 调度三层（采集 / 时间 / 条件）=====
    /** 采集层算出的「最近一个到期时刻」；null = 没有钟点类规则在等 */
    at: null,
    /** 下一次强制重采的时刻（兜住「别人改了规则表」） */
    nextScanAt: 0,
    /** 事件型规则的种类，目前只有 obsidian-exit 有观测手段 */
    conds: new Set(),
    /** 采集时看到的 Obsidian 进程号快照（条件层只对它做 kill(pid,0)） */
    obsPids: [],
    obsProbedAt: 0,
    /** 上次写 status 的时刻 */
    lastStatusAt: 0,
  };

  const watcher = {
    state,
    /** 采集层：读 + 算，**不执行**。返回下一次该醒的时刻（null = 只按扫描间隔醒） */
    plan: () => plan(config, state),
    /** 条件层：只做系统调用，命中返回这一拍的事件表 */
    check: () => check(state, config),
    /** 执行：一拍。`events` 由条件层给，交给内核判 */
    tick: (events) => tick(config, state, watcher, events),
    /** 心跳：不跑工具，只让 `status.json` 的 `at` 保持新鲜 */
    heartbeat: () => heartbeat(config, state),
    stop: () => {
      state.stopped = true;
    },
  };
  return watcher;
}

/**
 * 睡多久 —— 纯函数，好测。
 *
 * 三条读法：
 *  - `at` 在未来 → 睡到那一刻（这是「准时」的唯一来源）；
 *  - `at` 已经过去（规则被跳过、冷却中、参数没填）→ **退到扫描间隔**，绝不在原地打转；
 *  - 有条件层在盯 → 再砍到 `conditionMs`（1 秒），因为要判的是「进程还在不在」。
 */
function nextDelay(now, o) {
  let delay = o.at !== null && o.at > now ? o.at - now : o.scanMs;
  if (o.cond) delay = Math.min(delay, o.condMs);
  const cap = Math.max(o.scanMs, MIN_DELAY_MS);
  return Math.max(MIN_DELAY_MS, Math.min(delay, cap));
}

/** 采集层：读登记表、算出最近到期时刻与要盯的条件。**零副作用**（只更新内存与 status） */
function plan(config, state) {
  const now = Date.now();
  const reset = (mode) => {
    state.at = null;
    state.conds = new Set();
    state.obsPids = [];
    return { at: null, mode };
  };

  const plugin = rt.readPluginData(config);
  if (!plugin.ok) return reset('no-plugin-data');

  const storageDir = core.normalizeStorageDir(plugin.storagePath);
  const registryPath = core.storageFileIn(storageDir, core.REGISTRY_FILENAME);
  const fs = core.currentFs();
  const { registry } = core.readRegistryAt(registryPath, fs);
  // 没有全域开关（ADR-0257）：登记表里只剩 tools。装着值守件就该拍 —— 不想后台跑就卸掉它。

  const views = core.loadToolViews(registry.tools, { trust: plugin.trust, fs });
  let at = null;
  const conds = new Set();

  for (const view of views) {
    // 跑不起来的工具不该占用唤醒 —— 省下的每一次醒来都是真的省
    if (view.intent.enabled === false || view.intent.autoRun === false) continue;
    if (!view.trusted || !view.entry || !view.runnable) continue;
    if (view.runtime.run?.pausedAt) continue; // 熔断中：等用户手动恢复，别空转

    for (const rule of view.rules) {
      if (rule.enabled === false) continue;
      // 事件类没有钟点，算不出「下次」—— 交给条件层
      if (core.isEventTrigger(rule.trigger.kind)) {
        conds.add(rule.trigger.kind);
        continue;
      }
      const st = view.runtime.rules?.[rule.id];
      // 已排队：到期时刻就是账本里那个（含抖动），不重算 —— 重算会换一个随机值
      if (st?.pending) {
        const due = Date.parse(st.pending.dueAt);
        if (Number.isFinite(due)) at = at === null ? due : Math.min(at, due);
        continue;
      }
      const lastFired = Date.parse(st?.lastFiredAt ?? '');
      const next = core.nextDueOf(rule, {
        now,
        lastFiredAt: Number.isFinite(lastFired) ? lastFired : undefined,
      });
      // on-launch 在这里恒为 null（值守没有 sessionStart）—— 那本来就不该由离场补跑
      if (next !== null) at = at === null ? next : Math.min(at, next);
    }
  }

  state.at = at;
  state.conds = conds;
  if (conds.has('obsidian-exit')) probeObsidian(state);
  else state.obsPids = [];

  return { at, mode: null };
}

// ==================== 条件层 ====================

/**
 * 条件层：**只做系统调用，不碰磁盘、不碰文件**。
 *
 * 现在的判据只有一条：采集时记下的 Obsidian 进程号，是不是都死了。
 *  - 快照是空的 → 无事可做（冷启动时 Obsidian 本来就没开，不该补跑一次）；
 *  - 还剩几个活着 → 多开场景，先关的那个不算「关闭」（与 ADR-0253 同一条口径）；
 *  - 最后一个也没了 → 投一次事件，并把快照清空，**只投一次**（边沿触发）。
 */
function check(state, config) {
  if (state.stopped) return [];
  if (!state.conds.has('obsidian-exit')) return [];
  if (!state.obsPids.length) return [];

  const alive = state.obsPids.filter((pid) => rt.isProcessAlive(pid));
  const step = exitTransition(state.obsPids, alive);
  state.obsPids = step.next;

  if (!step.changed) return [];
  if (!step.fire) {
    rt.log(`Obsidian 少了一个进程（还剩 ${step.next.length} 个），不算关闭`);
    return [];
  }
  rt.log(`Obsidian 已退出，条件成立`);
  void config;
  return [{ kind: 'obsidian-exit' }];
}

/**
 * 「关闭」是怎么判出来的 —— 纯函数，好测。
 *
 * 两句话：**少一个不算关闭；一个不剩才算一次。** 前者是多开场景（先关的那个只是卸了自己
 * 的插件），后者才是用户说的「我关掉 Obsidian 了」。`changed` 用来保证边沿触发：
 * 快照没变化就不该重复投事件，否则关着的那段时间会每秒跑一遍同步。
 */
function exitTransition(pids, alive) {
  const left = pids.filter((p) => alive.includes(p));
  const changed = left.length !== pids.length;
  // **没有快照就没有「关闭」可言**：`fire` 必须同时要求「变了」和「一个不剩」，
  // 否则空快照会让每一次空判都投一枚事件（每秒一次）。
  return { next: left, changed, fire: changed && left.length === 0 };
}

/** 取一次 Obsidian 进程号快照。节流到 `PROBE_MIN_MS`；探不到就保留旧判断（不知道 ≠ 没开） */
function probeObsidian(state) {
  // 手上那批全都还活着 → 不必再问系统。**这一条让值守在白天零进程创建**：
  // 只有「刚启动」「刚发现关闭」「Obsidian 还没开」这三种情况才起 tasklist。
  if (state.obsPids.length && state.obsPids.every((pid) => rt.isProcessAlive(pid))) return;

  const now = Date.now();
  if (now - state.obsProbedAt < PROBE_MIN_MS) return;
  state.obsProbedAt = now;
  const pids = listObsidianPids();
  if (pids === null) return;
  if (pids.length !== state.obsPids.length) {
    rt.log(pids.length ? `看到 Obsidian 进程 ${pids.join(',')}` : '没有 Obsidian 进程在跑');
  }
  state.obsPids = pids;
}


/** `tasklist /FI "IMAGENAME eq Obsidian.exe" /FO CSV /NH` 的输出 → 进程号数组 */
function parseObsidianPids(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    // 形如 "Obsidian.exe","1234","Console","1","123,456 K"
    const m = /^"[^"]*","(\d+)"/.exec(line.trim());
    if (m) out.push(Number(m[1]));
  }
  return out;
}

/**
 * 起一次 `tasklist` 拿快照。失败返回 null —— **探不到不等于没开**：
 * 把失败当成「已关闭」会让每次开机都白同步一遍。
 */
function listObsidianPids() {
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');
  try {
    const out = execFileSync(exe, ['/FI', 'IMAGENAME eq Obsidian.exe', '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    return parseObsidianPids(out);
  } catch {
    try {
      return parseObsidianPids(
        execFileSync('tasklist', ['/FI', 'IMAGENAME eq Obsidian.exe', '/FO', 'CSV', '/NH'], {
          encoding: 'utf8',
          timeout: 5000,
          windowsHide: true,
        }),
      );
    } catch {
      return null;
    }
  }
}


/** 一拍里刷 status 的间隔。插件判「值守死了」的线是 90 秒，25 秒盖一次足够稳 */
const STATUS_BEAT_MS = 25_000;

/**
 * 一拍。`events` 由条件层给（现在只有 `obsidian-exit`），内核照旧自己判该不该跑。
 *
 * 参数默认值写成 `[]` 而不是 undefined：`tickOnce` 会把它和脉冲事件并起来，
 * 传 undefined 语义一样，但显式一个空数组更能说明「这一拍没有任何外部事件」。
 */
async function tick(config, state, watcher, events = []) {
  if (state.ticking || state.stopped) return;
  state.ticking = true;
  /**
   * 这一拍里也要持续刷新 `status.at`。
   *
   * 为什么：一拍可能被「等网」占 5 分钟、被一个工具占 10 分钟，而插件超过 90 秒没见心跳
   * 就会在设置页说「没在跑」。只在 tick 收尾刷一次，等于在最长的那段时间里自己装死。
   */
  const beat = setInterval(() => writeStatus(config, state, state.lastOutcome || 'watch'), STATUS_BEAT_MS);
  try {
    // 本机侧：插件设置里的 storagePath 与 dockTrust —— 唯一真理源在插件那份 data.json 里，
    // 不抄副本（抄了就有一份会过期的）
    const plugin = rt.readPluginData(config);
    if (!plugin.ok) {
      state.lastError = `读不到插件数据（${plugin.file}）`;
      rt.log(`跳过这一拍：${state.lastError}`);
      writeStatus(config, state, 'no-plugin-data');
      return;
    }

    const storageDir = core.normalizeStorageDir(plugin.storagePath);
    const registryPath = core.storageFileIn(storageDir, core.REGISTRY_FILENAME);
    const dataDir = core.dirOf(registryPath);

    // 等网 —— 没通就整拍不拍（账不记，下一拍再来）
    if (!(await netGate(config, state))) {
      writeStatus(config, state, 'wait-net');
      return;
    }

    state.lastError = undefined;
    const res = await core.tickOnce({
      dataDir,
      registryPath,
      trust: plugin.trust,
      events,
      vaultPath: config.vault,
      owner: 'watchdog',
      keepAliveMs: core.KEEP_ALIVE_MS,
      onOutcome: (view, outcome) => {
        state.runsSinceBoot += 1;
        state.lastRun = {
          toolId: view.id,
          name: view.manifest ? view.manifest.name : view.id,
          at: outcome.finishedAt,
          ok: outcome.ok,
          status: outcome.status,
          message: outcome.recordMissing || core.hintOf(outcome.kind, outcome.recordMissing),
        };
        rt.log(
          `跑完 ${state.lastRun.name}：${core.statusText(outcome.status)}` +
            (outcome.ok ? '' : `（${state.lastRun.message}）`),
        );
      },
      // 工具吐的每一步 → 本机实时日志（插件面板轮询它）。插件在场时这一步走的是面板直连，
      // 但值守跑的时候面板在另一个进程，只能靠这条文件回传。
      onStep: (view, text, runId) => rt.appendLive(view.id, runId, text),
      onRemind: (view, rule) => {
        // 离场没有人在场，提醒投递不出去。内核仍会记账（否则每拍都命中），
        // 这里只留一句日志 —— 让「为什么面板上没弹」有据可查。
        rt.log(`提醒规则命中但离场不投递：${view.id} / ${rule.name || rule.id}`);
      },
      onPlan: (decisions, result) => {
        if (result.ran.length) {
          rt.log(`这一拍跑了 ${result.ran.map((r) => `${r.toolId}=${r.status}`).join('，')}`);
        }
        const waits = decisions.filter((d) => d.reason === 'waiting').length;
        if (waits) rt.log(`有 ${waits} 条规则在等抖动到期（已记账，到点会跑）`);
      },
      onError: (e) => {
        state.lastError = e && e.message ? e.message : String(e);
        rt.log(`这一拍出错：${state.lastError}`);
      },
    });

    // 模式只在变化时记一笔（接管/让位/关掉是排障最想知道的事）
    const mode = describe(res);
    if (mode !== state.lastOutcome) {
      rt.log(`值守状态：${state.lastOutcome || '（启动）'} → ${mode}`);
      state.lastOutcome = mode;
    }
    writeStatus(config, state, mode);
  } catch (e) {
    state.lastError = e && e.message ? e.message : String(e);
    rt.log(`这一拍出错：${state.lastError}`);
    writeStatus(config, state, 'error');
  } finally {
    clearInterval(beat);
    state.ticking = false;
  }
}

/** 一拍的结果 → 一句人话（写进 status 与日志） */
function describe(res) {
  if (!res) return 'error';
  switch (res.skipped) {
    case 'locked':
      return 'busy'; // 锁在插件（或手动运行）手里 —— 这一拍什么都不做，正常
    case 'no-fs':
      return 'no-fs';
    default:
      return 'watch';
  }
}

/**
 * 网闸：不通就等（默认最多 5 分钟），等不到就静默 60 秒再来。
 *
 * 三条读法：
 *  - **通了就缓存**（5 分钟）：开机那一串任务只探一次；
 *  - **没通就等**：等到即跑 —— 这正是本函数存在的理由；
 *  - **等不到就静默**：返回 false，这一拍什么都不做，账不记。
 */
async function netGate(config, state) {
  const now = Date.now();
  if (state.netOkAt && now - state.netOkAt < NET_OK_TTL_MS) return true;
  if (state.netRetryAt && now < state.netRetryAt) return false;

  const o = net.optionsOf(config);
  const res = await net.waitForNet(config, {
    probe: state.netProbe,
    onWait: () =>
      rt.log(
        o.waitMs > 0
          ? `网络还没通，等它接通再跑（最多 ${Math.round(o.waitMs / 60000)} 分钟）`
          : `网络还没通，这一拍跳过（配置里 waitMs=0，不等）`,
      ),
  });

  if (res.ok) {
    if (res.attempts > 1) rt.log(`等网 ${Math.round(res.waitedMs / 1000)} 秒后接通`);
    state.netOkAt = Date.now();
    state.netRetryAt = 0;
    return true;
  }

  state.netOkAt = 0;
  state.netRetryAt = Date.now() + NET_RETRY_MS;
  rt.log(`等网 ${Math.round(res.waitedMs / 1000)} 秒仍未接通，这一拍跳过（不记账，留给下一拍）`);
  return false;
}

/** 刷体检快照（`status.json`）—— 插件设置页读它说「值守在不在」 */
function writeStatus(config, state, mode) {
  state.lastStatusAt = Date.now();
  const patch = {
    pid: process.pid,
    startedAt: state.startedAt,
    at: new Date().toISOString(),
    vault: config.vault,
    mode,
    runsSinceBoot: state.runsSinceBoot,
    /** 下一次准备醒的时刻 —— 面板据此说「它在等什么」，也是排障时第一眼看的东西 */
    nextAt: state.at === null ? null : new Date(state.at).toISOString(),
  };
  if (state.lastRun) patch.lastRun = state.lastRun;
  // 错误恢复后要能清掉：显式传 undefined，由 writeStatus 删键（否则旧错误永远挂在面板上）
  patch.lastError = state.lastError;
  if (state.coreVersion) patch.core = state.coreVersion;
  rt.writeStatus(patch);
}

/**
 * 心跳：不跑工具，只让 `status.at` 保持新鲜。
 *
 * 为什么单独有它：调度改成「睡到下一个到期」之后，可能几个小时才拍一次，
 * 而插件超过 90 秒没见 `status.at` 就会在设置页说「值守没在跑」—— 那是误报。
 * 所以每次醒来都盖一次章，但 30 秒封顶（条件层一秒醒一次，不能一秒写一次盘）。
 */
function heartbeat(config, state) {
  if (Date.now() - state.lastStatusAt < STATUS_GAP_MS) return;
  writeStatus(config, state, state.lastOutcome || 'watch');
}

module.exports = { createWatcher, exitTransition, nextDelay, parseObsidianPids };

