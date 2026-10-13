/**
 * 记账写回 —— 值守进程改 `dock.json` 的那两笔（ADR-0242）。
 *
 * 只有两笔，都是**插件也在写的**同一份文件：
 *  1. 规则命中时刻（`tools[i].ruleState[ruleId].lastFiredAt`）—— **跑之前**写，
 *     不然下一拍会再命中同一条规则（判据靠它收口）；
 *  2. 调度台账（`runState[工具 id]`）—— 失败计数与熔断，离场跑失败也必须入账，
 *     否则会一直重试到天亮。
 *
 * **每次写都先重读文件**（不拿主循环手上那份快照改）：插件可能刚写过。值守只在插件没在拍时
 * 才走到这里（互斥保证了这一点），所以真实的并发窗口只剩「插件恰好启动/退出的那一瞬」——
 * 把窗口缩到「读与写之间」这一段同步代码，是能做的全部。
 *
 * 写回时**保留文件里的其余字段**（`{...panel.raw, ...}`）：`dock.json` 里可能已经有新版本
 * 加的字段，本进程不认识它们，但也绝不该顺手删掉。
 */
'use strict';

const rt = require('./runtime');
const decide = require('./decide');

/** 改一条登记项（重读 → 改那一条 → 整表写回） */
function patchEntry(config, settings, toolId, mutate) {
  const panel = decide.readPanel(config, settings);
  if (!panel.ok) return false; // dock.json 不存在 / 版本不认识 —— 不猜、不建
  const tools = Array.isArray(panel.raw.tools) ? panel.raw.tools.slice() : [];
  const i = tools.findIndex((t) => rt.isPlainObject(t) && t.id === toolId);
  if (i < 0) return false;
  const next = { ...tools[i] };
  mutate(next);
  tools[i] = next;
  decide.writePanel(panel, { ...panel.raw, tools });
  return true;
}

/**
 * 记一条规则「这次命中了」—— 必须在真跑**之前**调。
 * 位置与时机与 `data.ts` 的 `patchRuleFired` 一致（那边也是「先记账再执行」）。
 */
function markRuleFired(config, settings, toolId, ruleId, atMs) {
  try {
    return patchEntry(config, settings, toolId, (entry) => {
      const state = rt.isPlainObject(entry.ruleState) ? { ...entry.ruleState } : {};
      state[ruleId] = { lastFiredAt: new Date(atMs).toISOString() };
      entry.ruleState = state;
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
    const panel = decide.readPanel(config, settings);
    if (!panel.ok) return false;
    const all = rt.isPlainObject(panel.raw.runState) ? { ...panel.raw.runState } : {};
    const cur = rt.isPlainObject(all[toolId]) ? { ...all[toolId] } : {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) delete cur[k];
      else cur[k] = v;
    }
    if (Object.keys(cur).length) all[toolId] = cur;
    else delete all[toolId];
    decide.writePanel(panel, { ...panel.raw, runState: all });
    return true;
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

module.exports = { patchEntry, markRuleFired, patchRunState, recordRunSuccess, recordRunFailure };
