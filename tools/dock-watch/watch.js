/**
 * 值守主循环 —— **一拍只做一件事：调一次 `core.tickOnce()`**。
 *
 * 上一版这里有一整套自己的判据与记账（`decide.js` + `ledger.js` + 一份靠注释对齐的 `resolveOk`），
 * 与插件那份是两套实现。契约 v2 起这些全在 `src/dock/` 里，值守只是一个**触发者**：
 * 它不判断该不该跑、不判断跑成没成、不写账本 —— 那些由同一份源码（`dock-core.cjs`）做，
 * 插件在场时跑的是同一段代码，所以「两边行为不一致」这件事从结构上没了。
 *
 * 值守**只多管三件插件管不到的事**：
 *  1. **等网**：计划任务在登录瞬间拉起本进程，网卡常常还没就绪。到点就跑会得到一个
 *     `fetch failed`，而账已经记下了 —— 这一天不会再有第二次机会。所以没网就**整拍不拍**，
 *     账不记，下一拍再来。这是「跑太早」和「跑失败」的区别。
 *  2. **离场开关**：`watchdog` 关着就不拍（`tickOnce` 的 `respectWatchdog`）。插件在场时不看它。
 *  3. **本机状态**：`status.json` / 日志（面板与排障要读，而它们不属于 vault 里的账本）。
 *
 * 与插件相同的那一半，一个字都不重复实现 —— 包括 `on-launch` 规则为什么在离场时为 false
 * （内核收到的 `sessionStart` 是 undefined，判据自然不命中，不需要值守自己写一条特例）。
 */
'use strict';

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

/** 一拍里刷 status 的间隔。插件判「值守死了」的线是 90 秒，25 秒盖一次足够稳 */
const STATUS_BEAT_MS = 25_000;

async function tick(config, state, watcher) {
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
      vaultPath: config.vault,
      owner: 'watchdog',
      respectWatchdog: true,
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
    case 'auto-run-off':
      return 'auto-off'; // 用户关了全域自动运行
    case 'watchdog-off':
      return 'off'; // 用户关了离场调度
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
  const patch = {
    pid: process.pid,
    startedAt: state.startedAt,
    at: new Date().toISOString(),
    vault: config.vault,
    mode,
    runsSinceBoot: state.runsSinceBoot,
  };
  if (state.lastRun) patch.lastRun = state.lastRun;
  // 错误恢复后要能清掉：显式传 undefined，由 writeStatus 删键（否则旧错误永远挂在面板上）
  patch.lastError = state.lastError;
  if (state.coreVersion) patch.core = state.coreVersion;
  rt.writeStatus(patch);
}

module.exports = { createWatcher };
