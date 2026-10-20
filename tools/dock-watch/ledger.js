/**
 * 记账写回 —— 值守进程改**各工具目录 `dock-state.json`** 的那两笔（ADR-0242 / ADR-0248）。
 *
 * 只有两笔，都是**插件也在写的**同一份文件（按工具各一份）：
 *  1. 规则命中时刻（`ruleState[ruleId].lastFiredAt`）—— **跑之前**写，
 *     不然下一拍会再命中同一条规则（判据靠它收口）；
 *  2. 调度台账（`runState`）—— 失败计数与熔断，离场跑失败也必须入账，
 *     否则会一直重试到天亮。
 *
 * 为什么不再写 `dock.json`：那份只剩「有哪些工具 + 三个全域开关」，排期状态跟着工具走
 * （ADR-0248）。值守改的是某个工具的事实，就该落在那个工具的目录里 —— 一次写只影响一家，
 * 也不再和插件抢同一个文件。
 *
 * **每次写都先重读文件**（不拿主循环手上那份快照改）：插件可能刚写过。值守只在插件没在拍时
 * 才走到这里（互斥保证了这一点），所以真实的并发窗口只剩「插件恰好启动/退出的那一瞬」——
 * 把窗口缩到「读与写之间」这一段同步代码，是能做的全部。
 *
 * 写回保留文件里的其余字段（`{...state, ...}`）：`dock-state.json` 里可能已经有新版本加的字段，
 * 本进程不认识它们，但也绝不该顺手删掉。
 */
'use strict';

const rt = require('./runtime');
const decide = require('./decide');
const core = require('./dock-core.cjs');

/**
 * 改一个工具的排期状态（重读那份 → 改 → 写回）。
 *
 * 找不到这条登记 / 文件读不起来 → false，调用方据此**放弃这一拍**（记账没成的规则不许跑，
 * 否则同一拍会重复命中）。`writeToolState` 在「内容没变」时也返回 false —— 那对记账来说
 * 不会发生（写入的总是新的时刻）。
 */
function patchState(config, settings, toolId, mutate) {
  const panel = decide.readPanel(config, settings);
  if (!panel.ok) return false; // dock.json 不存在 / 版本不认识 —— 不猜、不建
  const index = panel.tools.find((t) => rt.isPlainObject(t) && t.id === toolId);
  if (!index || typeof index.path !== 'string' || !index.path) return false;
  const state = core.readToolState(index.path, toolId) || {};
  mutate(state);
  return core.writeToolState(index.path, toolId, state);
}

/**
 * 记一条规则「这次命中了」—— 必须在真跑**之前**调。
 * 位置与时机与 `data.ts` 的 `patchRuleFired` 一致（那边也是「先记账再执行」）。
 */
function markRuleFired(config, settings, toolId, ruleId, atMs) {
  try {
    return patchState(config, settings, toolId, (state) => {
      const prev = rt.isPlainObject(state.ruleState) ? state.ruleState : {};
      state.ruleState = { ...prev, [ruleId]: { lastFiredAt: new Date(atMs).toISOString() } };
    });
  } catch (e) {
    rt.log(`记账失败 ${toolId}/${ruleId}：${e.message}`);
    return false;
  }
}

/**
 * 改一条台账（合并 patch；值为 `undefined` / `null` 的键 = 清除该键）。
 * 与 `data.ts` 的 `patchRunState` 同口径：空的台账整体删掉，不留 `{}`。
 */
function patchRunState(config, settings, toolId, patch) {
  try {
    return patchState(config, settings, toolId, (state) => {
      const cur = rt.isPlainObject(state.runState) ? { ...state.runState } : {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null) delete cur[k];
        else cur[k] = v;
      }
      if (Object.keys(cur).length) state.runState = cur;
      else delete state.runState;
    });
  } catch (e) {
    rt.log(`台账写失败 ${toolId}：${e.message}`);
    return false;
  }
}

/** 一次成功收尾的入账（记尝试、清零连续失败、解除熔断）—— 同 `recordRunSuccess` */
function recordRunSuccess(config, settings, toolId, finishedAt) {
  return patchRunState(config, settings, toolId, {
    lastAttemptAt: finishedAt,
    lastAttemptOk: true,
    consecutiveFailures: 0,
    pausedAt: undefined,
  });
}

/** 一次失败收尾的入账（累计连续失败，到阈值就熔断） */
function recordRunFailure(config, settings, toolId, finishedAt, failures, trip) {
  return patchRunState(config, settings, toolId, {
    lastAttemptAt: finishedAt,
    lastAttemptOk: false,
    consecutiveFailures: failures,
    ...(trip ? { pausedAt: finishedAt } : {}),
  });
}

module.exports = { patchState, markRuleFired, patchRunState, recordRunSuccess, recordRunFailure };
