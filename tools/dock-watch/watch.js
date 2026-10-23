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
 *
 * 还有一处只属于离场：**跑之前先等网络接通**（`net.js`）。计划任务在登录瞬间就拉起本进程，
 * 那时网卡常常还没就绪；到点就跑会得到一个 `fetch failed`，而记账已经写下了 ——
 * 这一天不会再有第二次机会。等网失败时**不记账**，留给下一拍，这是「跑太早」与「跑失败」的区别。
 */
'use strict';

const core = require('./dock-core.cjs');
const rt = require('./runtime');
const decide = require('./decide');
const ledger = require('./ledger');
const launch = require('./launch');
const net = require('./net');

/** 失败后的冷却（与 `scheduler.ts` 同值） */
const FAIL_COOLDOWN_MS = 15 * 60 * 1000;
/** 连续失败到几次熔断（同插件） */
const BREAKER_THRESHOLD = 3;
/** 一拍内最多补几轮扫描（`tool-ok` 联动链的长度上限，防套娃） */
const MAX_ROUNDS = 3;
/**
 * 「网刚通过」的保鲜期：通了之后 5 分钟内再跑别的工具不再重探。
 * 一串开机任务（小黑盒 → 签到 → 雷达）会在一两分钟内连着跑，每个都探一次纯属浪费。
 */
const NET_OK_TTL_MS = 5 * 60 * 1000;
/**
 * 等网失败后的静默期：这次没网就不在这 60 秒里每拍都等满一轮（`intervalMs` 才 30 秒，
 * 不设它会把日志刷成「等了 5 分钟」的循环）。到点自会再试，账没记，跑得掉。
 */
const NET_RETRY_MS = 60 * 1000;

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
    /**
     * 不当场掷骰错峰（`--once` 排障入口用）。
     *
     * 为什么要有这个开关：随机延迟那一路是「先记账、定时器到点才跑」，而 `--once` 是
     * 「跑一拍就退出」—— 两者一撞，结果是**账记了、工具没跑**，还会让真正的那一拍
     * （误以为今天已经跑过）跳过它。排障入口的意义就是立刻看见结果，所以它在 `--once` 下不抖。
     */
    ignoreJitter: opts.ignoreJitter === true,
    /** 测试缝：注入网络探测（缺省走 `net.js` 的真 TCP 探测，测试里不该真去连网） */
    netProbe: typeof opts.netProbe === 'function' ? opts.netProbe : undefined,
    /** 网刚通过的时点（跨拍保留：开机那一串任务只探一次） */
    netOkAt: 0,
    /** 等网失败后的静默期截止（ms） */
    netRetryAt: 0,
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
        if (gate === 'running') rt.log(`跳过 ${view.name}：上一轮还没跑完`);
        continue;
      }

      // 触网前先等网络（`net.js`）：remind 不碰网络；run 类等不到就**不记账**，留给下一拍。
      // 这一句必须在 `markRuleFired` 之前 —— 记账等于宣布「今天跑过了」。
      if (!isRemind && !(await netGate(config, state, view))) continue;

      // 先记账再执行：一拍 30 秒，不记账下一轮/下一拍会再命中同一条规则。
      // 记「现在」而不是进门时的 `now`：等网可能已经等了几分钟，账要写真实起跑时刻。
      const firedAt = Date.now();
      if (!ledger.markRuleFired(config, settings, view.id, rule.id, firedAt)) {
        rt.log(`记账写不进去，本拍跳过 ${view.name}（宁可少跑一次，不可重复跑）`);
        continue;
      }
      view.ruleFiredAt[rule.id] = firedAt; // 同拍多轮时别再命中同一条

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
 * 网闸：跑之前确认网络通了。
 *
 * 三条读法：
 *  - **通了就缓存**（5 分钟）：开机那一串任务只探一次，不必每个工具都握一次手；
 *  - **没通就等**（默认最多 5 分钟，`config.net.waitMs` 可调），等到即跑 —— 这正是本函数存在的理由；
 *  - **等不到就静默 60 秒**：返回 false 让调用方**不记账**，下一拍（或静默期后）再判。
 *
 * 日志只在「真的没网」时开口：首次探测就通是常态，不该每跑一个工具都留一行。
 */
async function netGate(config, state, view) {
  const now = Date.now();
  if (state.netOkAt && now - state.netOkAt < NET_OK_TTL_MS) return true;
  if (state.netRetryAt && now < state.netRetryAt) return false;

  const o = net.optionsOf(config);
  const res = await net.waitForNet(config, {
    probe: state.netProbe,
    onWait: () =>
      rt.log(
        o.waitMs > 0
          ? `网络还没通，等它接通再跑 ${view.name}（最多 ${Math.round(o.waitMs / 60000)} 分钟）`
          : `网络还没通，${view.name} 留到下一拍（配置里 waitMs=0，不等）`,
      ),
  });

  if (res.ok) {
    if (res.attempts > 1) {
      rt.log(`等网 ${Math.round(res.waitedMs / 1000)} 秒后接通，继续跑 ${view.name}`);
    }
    state.netOkAt = Date.now();
    state.netRetryAt = 0;
    return true;
  }

  state.netOkAt = 0;
  state.netRetryAt = Date.now() + NET_RETRY_MS;
  rt.log(
    `等网 ${Math.round(res.waitedMs / 1000)} 秒仍未接通，${view.name} 留到下一拍（这次不记账）`,
  );
  return false;
}

/**
 * 排一次运行。**随机延迟在这里掷骰**（判据保持纯函数，与插件同口径）：
 * 到点后再等 `0~jitterMin` 分钟用来错峰 —— 开机时一串整点任务同时起，风控和机器都不喜欢。
 *
 * 无延迟时**就地 await**（本轮就能拿到它的事件，联动链当场生效）；有延迟时交给定时器，
 * 跑完把事件投进 `pendingEvents` 再 kick 一轮（链条慢一点点，但不会丢）。
 */
function scheduleRun(config, settings, state, watcher, view, rule) {
  const min = state.ignoreJitter ? 0 : Number.isFinite(rule.jitterMin) ? rule.jitterMin : 0;
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
  const ok = resolveOk(outcome, note);
  const kind = !ok && note && note.error && typeof note.error.kind === 'string' ? note.error.kind : undefined;

  if (ok) {
    await ledger.recordRunSuccess(config, settings, view.id, outcome.finishedAt);
    state.cooldownUntil.delete(view.id);
    if (view.runState) {
      view.runState.consecutiveFailures = 0;
      delete view.runState.pausedAt;
    }
    rt.log(`跑完 ${view.name}：成功（${Math.round(outcome.durationMs / 1000)} 秒）`);
    // 记录说成功、退出码却不干净：少见但真会发生（工具硬退时崩在 libuv 收尾上）。
    // 判决以记录为准，但把这条线索留在日志里 —— 否则「工具其实崩了」永远没人看见。
    if (outcome.ok !== true) rt.log(`  退出码 ${outcome.code === null ? '未知' : outcome.code}，但工具记录写的是成功 —— 以记录为准`);
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

/**
 * 这次跑算不算成功 —— 退出码只是**推断**，工具自己那条记录才是判决。
 *
 * 口径与 `runner.ts` 的 `reconcileWithRecord` 逐条对齐（那是 issue 544 在插件侧补的那道对账）：
 *  - 有本次记录 → 看它的 `status`（`ok` 才算成功）；
 *  - 没记录 / `status` 不是字符串 → 回落退出码（问不出就别猜）；
 *  - `stopped`（超时强杀）不参与对账 —— 是 bz 掐的，工具写了什么都不改变这个事实。
 *
 * 为什么值守这一侧也必须对账：工具用 `process.exit()` 硬退时，Windows 上偶发 libuv 收尾断言
 * （`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`），记录明明写着「签到成功」，
 * 进程却以非零码收场。只看退出码就会把成功报成失败 —— 而「在面板里成功、关掉 Obsidian
 * 就失败」正是 ADR-0242 最贵的那种缺陷（issue 552）。
 */
function resolveOk(outcome, note) {
  if (outcome.stopped) return false;
  if (!note || typeof note.status !== 'string') return outcome.ok === true;
  return note.status === 'ok';
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
