/**
 * 值守主循环 —— **一拍做五件事**，与插件调度器的 `tick` 逐条对齐（ADR-0242）：
 * 读租约（插件在场就让位）→ 读开关（关着就不拍）→ 刷新体检快照 → 逐条规则问 `ruleDue`
 * → 命中即**先记账再跑**（串行、不并行、不连坐）。
 *
 * 四条纪律（与 `scheduler.ts` 同一套，理由也一样）：
 *  1. **不并行**：同一时刻至多一个工具在跑（一次开 N 个 node 会把机器和网络一起噎住）；
 *  2. **不连坐**：某个工具卡住/失败，后面的照跑（超时到点就强杀，不让它堵住队列）；
 *  3. **不猜**：判不出该不该跑（没基线、读不到值、声明读不到）就不跑；
 *  4. **不诈尸**：退出时把租约式的东西收干净（本进程自己那份锁）。
 *
 * 三处**刻意的不同**（都是「离场」这个前提逼出来的，不是偷懒）：
 *  - `sessionStart` **不传**：`on-launch` 的语义是「Obsidian 启动后 N 分钟」，离场没有这个时刻，
 *    硬套成「值守进程启动后」会让同一条规则一天跑两次（开机一次、开 Obsidian 一次）。
 *    不传 `sessionStart` 时 `ruleDue` 的 `on-launch` 分支自然返回 false —— 由插件独占。
 *  - 事件触发只剩 `tool-ok` / `tool-fail`：`panel-open` / `domain-event` 需要插件进程里的面板与
 *    域总线，离场拿不到；`vault-file` 需要 fs.watch 与节流，第一版不做（没事件时 `ruleDue`
 *    返回 false，安全跳过而不是乱跑）。
 *  - `remind`（只提醒）**记账但不投递**：提醒的全部价值在于**当时**送达，隔一天补一条
 *    「昨天该手动跑一次」只是噪音。记账仍要做 —— 否则它每拍都命中。
 */
'use strict';

const core = require('./dock-core.cjs');
const rt = require('./runtime');
const decide = require('./decide');
const ledger = require('./ledger');
const launch = require('./launch');

/** 失败后的冷却（与 `scheduler.ts` 同值） */
const FAIL_COOLDOWN_MS = 15 * 60 * 1000;
/** 连续失败到几次熔断（同插件） */
const BREAKER_THRESHOLD = 3;
/** 一拍内最多补几轮扫描（`tool-ok` 联动链的长度上限，防套娃） */
const MAX_ROUNDS = 3;

/**
 * 造一个值守实例。`tick()` 是幂等的（进行中重入直接返回），所以定时器怎么调都不会叠加。
 */
function createWatcher(config, opts = {}) {
  const state = {
    startedAt: new Date().toISOString(),
    runsSinceBoot: 0,
    lastRun: undefined,
    lastError: undefined,
    coreVersion: opts.coreVersion || '',
    /** 本进程内在跑的工具（对应插件的会话锁 `inFlight`） */
    inFlight: new Set(),
    /** 本进程自己记的失败冷却（插件的冷却也是内存态，两边各记各的） */
    cooldownUntil: new Map(),
    /** 跑完投的事件，等下一轮判据消费（同一拍的联动链） */
    pendingEvents: [],
    /** 上一拍的模式（只在切换时记日志） */
    lastMode: undefined,
    ticking: false,
    stopped: false,
  };

  const watcher = {
    state,
    tick: () => tick(config, state, watcher),
    stop: () => {
      state.stopped = true;
    },
  };
  return watcher;
}

async function tick(config, state, watcher) {
  if (state.ticking || state.stopped) return;
  state.ticking = true;
  try {
    const settings = decide.readPluginSettings(config);
    const panel = decide.readPanel(config, settings);

    // 让位判据要现读租约：插件可能刚启动（写票）或刚关闭（撤票）
    const lease = rt.readLease();
    const heldByPlugin = rt.leaseHeldByPlugin(lease, config, config.intervalMs);
    const off = !panel.watchdog || !panel.autoRun;
    const mode = heldByPlugin ? 'defer' : off ? 'off' : 'watch';
    // 模式切换才记一笔（让位/接管的时刻是排障最想知道的事），每拍都记会把日志刷成噪音
    if (mode !== state.lastMode) {
      rt.log(`值守模式：${state.lastMode ?? '（启动）'} → ${mode}`);
      state.lastMode = mode;
    }
    writeStatus(config, state, mode);

    if (mode !== 'watch') return;
    if (!panel.ok) {
      state.lastError = `读不到面板数据（${panel.file}）`;
      rt.log(`跳过这一拍：${state.lastError}`);
      return;
    }

    const views = decide.loadTools(config, settings, panel);
    // 一拍内可能扫多轮：某一轮跑出来的 `tool-ok` 要让后面那些「某工具成功后」的规则当场命中。
    // **先扫一轮再看有没有事件**（事件是扫出来的，不是进门就有的）
    let events = state.pendingEvents;
    state.pendingEvents = [];
    for (let round = 0; round < MAX_ROUNDS; round++) {
      events = await scanOnce(config, settings, state, watcher, views, panel, events);
      if (!events.length) break;
    }
  } catch (e) {
    state.lastError = e && e.message ? e.message : String(e);
    rt.log(`这一拍出错：${state.lastError}`);
  } finally {
    state.ticking = false;
  }
}

/**
 * 扫一遍全部规则。返回**这一轮新产生**的事件（没跑东西就是空数组）。
 * 与插件 `tick` 的内层循环同序：时间类看时钟、事件类看本轮事件，两者都可能命中（同轮只跑一次）。
 */
async function scanOnce(config, settings, state, watcher, views, panel, events) {
  const produced = [];
  const now = Date.now();
  for (const view of views) {
    if (!view.rules.length) continue;
    for (const rule of view.rules) {
      if (rule.enabled === false) continue;

      const base = { now, lastFiredAt: view.ruleFiredAt[rule.id] };
      // 刻意不传 sessionStart —— `on-launch` 归插件独占（见文件头）
      let ctx = base;
      if (rule.trigger.kind === 'data-threshold') {
        const value = decide.readJsonNumber(config, rule.trigger.path, rule.trigger.key);
        if (value === undefined) continue; // 读不到值 → 判不出就不跑
        ctx = { ...base, value };
      }

      const hit =
        core.ruleDue(rule, ctx) ||
        events.some((e) => {
          // 自触发防环：「本工具跑完 → 再跑本工具」会无限套娃（事件触发不看记账）
          if ((e.kind === 'tool-ok' || e.kind === 'tool-fail') && e.toolId === view.id) return false;
          return core.ruleDue(rule, { ...ctx, event: e });
        });
      if (!hit) continue;

      const isRemind = rule.action.kind === 'remind';
      const gate = isRemind
        ? view.entry.enabled === false
          ? 'disabled'
          : null
        : decide.runGate(view, {
            now,
            inFlight: state.inFlight.has(view.id),
            cooldownUntil: state.cooldownUntil.get(view.id),
          });
      if (gate) {
        if (gate === 'params') rt.log(`跳过 ${view.name}：必填参数还没填`);
        continue;
      }

      // 先记账再执行：一拍 30 秒，不记账下一轮/下一拍会再命中同一条规则
      if (!ledger.markRuleFired(config, settings, view.id, rule.id, now)) {
        rt.log(`记账写不进去，本拍跳过 ${view.name}（宁可少跑一次，不可重复跑）`);
        continue;
      }
      view.ruleFiredAt[rule.id] = now; // 同拍多轮时别再命中同一条

      if (isRemind) {
        rt.log(`提醒规则命中但离场不投递：${view.name} / ${rule.name || rule.id}`);
        continue;
      }
      const ev = await scheduleRun(config, settings, state, watcher, view, rule);
      if (ev) produced.push(ev);
    }
  }
  return produced;
}

/**
 * 排一次运行。**随机延迟在这里掷骰**（判据保持纯函数，与插件同口径）：
 * 到点后再等 `0~jitterMin` 分钟用来错峰 —— 开机时一串整点任务同时起，风控和机器都不喜欢。
 *
 * 无延迟时**就地 await**（本轮就能拿到它的事件，联动链当场生效）；有延迟时交给定时器，
 * 跑完把事件投进 `pendingEvents` 再 kick 一轮（链条慢一点点，但不会丢）。
 */
function scheduleRun(config, settings, state, watcher, view, rule) {
  const min = Number.isFinite(rule.jitterMin) ? rule.jitterMin : 0;
  const delayMs = min > 0 ? Math.floor(Math.random() * min * 60000) : 0;
  if (delayMs === 0) return runOne(config, settings, state, watcher, view);

  const timer = setTimeout(() => {
    void runOne(config, settings, state, watcher, view).then((ev) => {
      if (!ev) return;
      state.pendingEvents.push(ev);
      // 立刻再判一轮（插件的 `notifyDockEvent` 也是这个做法：事件到场就 kick）
      void watcher.tick();
    });
  }, delayMs);
  timer.unref?.(); // 别让一个待跑的工具把进程「钉」住不退（退出时不再守着它）
  return null;
}

/**
 * 跑一个工具并记台账。返回它产生的事件（`tool-ok` / `tool-fail`）。
 * 全程不抛：一个工具炸了不该把值守带走（同插件的「不连坐」）。
 */
async function runOne(config, settings, state, watcher, view) {
  const startedMs = Date.now();
  state.inFlight.add(view.id);
  rt.log(`开跑 ${view.name}（${view.id}）`);

  let outcome;
  try {
    outcome = await launch.runTool(view, config);
  } catch (e) {
    outcome = {
      ok: false,
      stopped: false,
      code: null,
      startedAt: new Date(startedMs).toISOString(),
      finishedAt: new Date().toISOString(),
      stderrTail: '',
      error: e && e.message ? e.message : String(e),
    };
  } finally {
    state.inFlight.delete(view.id);
  }

  const note = launch.readRunNote(view, startedMs);
  const message = (note && typeof note.message === 'string' && note.message) || fallbackMessage(outcome);
  const kind = note && note.error && typeof note.error.kind === 'string' ? note.error.kind : undefined;
  const ok = outcome.ok === true;

  if (ok) {
    await ledger.recordRunSuccess(config, settings, view.id, outcome.finishedAt);
    state.cooldownUntil.delete(view.id);
    if (view.runState) {
      view.runState.consecutiveFailures = 0;
      delete view.runState.pausedAt;
    }
    rt.log(`跑完 ${view.name}：成功（${Math.round(outcome.durationMs / 1000)} 秒）`);
  } else {
    const failures = ((view.runState && view.runState.consecutiveFailures) || 0) + 1;
    const trip = failures >= BREAKER_THRESHOLD;
    await ledger.recordRunFailure(config, settings, view.id, outcome.finishedAt, failures, trip);
    state.cooldownUntil.set(view.id, Date.now() + FAIL_COOLDOWN_MS);
    if (view.runState) {
      view.runState.consecutiveFailures = failures;
      if (trip) view.runState.pausedAt = outcome.finishedAt;
    }
    rt.log(
      `跑完 ${view.name}：失败（${message}）${trip ? ` —— 连续 ${failures} 次，已熔断暂停自动运行` : ''}`,
    );
    if (outcome.stderrTail) rt.log(`  stderr 尾部：${outcome.stderrTail.split('\n').slice(-3).join(' / ')}`);
  }

  state.runsSinceBoot += 1;
  state.lastRun = { toolId: view.id, name: view.name, at: outcome.finishedAt, ok, message, kind };
  rt.appendQueue(state.lastRun);
  writeStatus(config, state, 'watch');
  return { kind: ok ? 'tool-ok' : 'tool-fail', toolId: view.id };
}

/** 工具没写记录（崩在写之前）时按退出码兜一句话 —— 只兜事实，不猜原因 */
function fallbackMessage(o) {
  if (o.stopped) return '执行超时（超过 10 分钟，已强杀）';
  if (o.error) return `起不来：${o.error}`;
  if (o.code === null) return '进程没能启动（命令或工作目录配错了）';
  const tail = o.stderrTail ? o.stderrTail.split('\n').filter(Boolean).pop() : '';
  return tail ? `退出码 ${o.code}：${tail}` : `退出码 ${o.code}`;
}

/** 刷体检快照（`status.json`）—— 插件面板那张卡片读的就是它 */
function writeStatus(config, state, mode) {
  const patch = {
    pid: process.pid,
    startedAt: state.startedAt,
    at: new Date().toISOString(),
    vault: config.vault,
    mode,
    runsSinceBoot: state.runsSinceBoot,
  };
  if (state.lastRun) patch.lastRun = state.lastRun;
  if (state.lastError) patch.lastError = state.lastError;
  if (state.coreVersion) patch.core = state.coreVersion;
  rt.writeStatus(patch);
}

module.exports = { createWatcher, FAIL_COOLDOWN_MS, BREAKER_THRESHOLD };
