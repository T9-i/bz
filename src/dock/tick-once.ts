/**
 * 「跑一拍」—— 插件与值守**共用的唯一调度入口**。
 *
 * 上一版这套流程写了两遍（`scheduler.ts` 一遍、`tools/dock-watch` 一遍），四条纪律
 * 逐字对齐，靠注释提醒彼此「别忘了改那边」。这一版只有这一处：插件每 30 秒调它一次，
 * 值守每 30 秒也调它一次，谁的锁谁执行，另一个拿到 `skipped: 'locked'` 走人。
 *
 * 顺序是硬约束，别调换：
 *  1) **先拿执行权锁** —— 拿不到就什么都不做（不是「也试试」）；
 *  2) **锁内重读登记表** —— 外面读到的可能是几分钟前的旧账；
 *  3) **回收上次没收拾干净的**（`reclaimStale`）—— 在 `planTick` 之前，否则这一拍会
 *     把一条已经废掉的待办当成还有效；
 *  4) **跑**（串行，一次一个）；
 *  5) 放锁。
 */

import { runTick, reclaimStale, type Decision, type TickResult } from './kernel';
import { withLock } from './lock';
import { loadToolViews, type TrustMap } from './view';
import { readRegistryAt } from './registry-file';
import { pathOf, readRunsText, currentFs, type DockFs } from './files';
import { parseRunLines } from './parse';
import { runToolNow } from './exec';
import {
  RUNS_TAIL_BYTES,
  type DockOutcome,
  type DockRegistry,
  type DockRule,
  type DockToolView,
} from './types';
import type { RuleEvent } from './rules';

/** 长任务续期：锁的存活线是 90 秒，20 秒续一次足够稳 */
export const KEEP_ALIVE_MS = 20_000;

export interface TickOnceOpts {
  /** 数据目录（锁住在这里） */
  dataDir: string;
  /** 登记表路径 */
  registryPath: string;
  /** 授权表（插件从设置读；值守从插件 data.json 读） */
  trust: TrustMap;
  now?: number;
  sessionStart?: number;
  events?: readonly RuleEvent[];
  /** 注入给工具的 `BZ_DOCK_VAULT` */
  vaultPath?: string;
  /** 锁的持有者标识：`plugin` / `watchdog`。只用于诊断，不参与判据 */
  owner: string;
  /**
   * 是否尊重「离场调度」开关。
   * 插件在场就该跑，不看它；值守必须看 —— 用户关掉的意思就是「别在后台悄悄跑」。
   */
  respectWatchdog?: boolean;
  /** 正在跑的工具（进程内的活） */
  liveIds?: ReadonlySet<string>;
  fs?: DockFs | null;
  keepAliveMs?: number;
  /** 一个工具跑完了（插件发通知，值守写日志） */
  onOutcome?(view: DockToolView, outcome: DockOutcome): void;
  /**
   * 工具吐了一步（`[bz-step]`）。
   *
   * 插件在场时面板直接看得到；**值守跑的时候面板看不到** —— 那是另一个进程的 stdout。
   * 所以值守把这一步落到本机的一个小日志（`live/<工具>.jsonl`），面板轮询它。
   * 这是「回传通道」唯一需要的东西：不用端口、不用 IPC，一个只追加的文件就够。
   */
  onStep?(view: DockToolView, text: string, runId: string): void;
  /** 到点该提醒 */
  onRemind?(view: DockToolView, rule: DockRule): void;
  /** 这一拍的判据结果（诊断用；值守据此写「今天为什么没跑」） */
  onPlan?(decisions: readonly Decision[], result: TickResult): void;
  /** 这一拍出了意外（不该影响下一拍） */
  onError?(e: unknown): void;
}

export interface TickOnceResult {
  /** 没拍。`error` = 这一拍自己炸了（调用方**不要**因此清掉待消费的事件） */
  skipped?: 'locked' | 'auto-run-off' | 'watchdog-off' | 'no-fs' | 'error';
  registry?: DockRegistry;
  views?: DockToolView[];
  result?: TickResult;
}

/** 跑一拍。**永不抛** —— 一拍出错不该把宿主带走 */
export async function tickOnce(opts: TickOnceOpts): Promise<TickOnceResult> {
  const fs = opts.fs === undefined ? currentFs() : opts.fs;
  if (!fs) return { skipped: 'no-fs' };
  const now = opts.now ?? Date.now();

  /** 锁内做的事；用对象包一层，好让 `null` 只表示「没拿到锁」 */
  type Inner = { skip?: TickOnceResult['skipped']; registry: DockRegistry; views: DockToolView[]; result?: TickResult };

  let inner: Inner | null;
  try {
    inner = await withLock(
      opts.dataDir,
      opts.owner,
      async (lock): Promise<Inner> => {
        // 锁内重读：外面读到的可能是旧账
        const { registry } = readRegistryAt(opts.registryPath, fs);
        if (!registry.autoRun) return { skip: 'auto-run-off', registry, views: [] };
        if (opts.respectWatchdog && !registry.watchdog) return { skip: 'watchdog-off', registry, views: [] };

        const views = loadToolViews(registry.tools, { trust: opts.trust, fs });

        // 先收尸，再排班 —— 顺序反了会把一条已废的待办当成还有效
        for (const view of views) {
          try {
            reclaimStale(view, now, fs);
          } catch (e) {
            opts.onError?.(e);
          }
        }

        const result = await runTick({
          dataDir: opts.dataDir,
          registry,
          views,
          now,
          sessionStart: opts.sessionStart,
          events: opts.events ?? [],
          liveIds: opts.liveIds ?? new Set<string>(),
          fs,
          execute: (view, rule, runId) => executeOne(view, rule, runId, opts, fs),
          remind: (view, rule) => opts.onRemind?.(view, rule),
          shouldStop: () => lock.lost(),
        });

        opts.onPlan?.(result.decisions, result);
        return { registry, views, result };
      },
      { fs, now, keepAliveMs: opts.keepAliveMs ?? KEEP_ALIVE_MS },
    );
  } catch (e) {
    opts.onError?.(e);
    return { skipped: 'error' };
  }

  if (inner === null) return { skipped: 'locked' };
  return { skipped: inner.skip, registry: inner.registry, views: inner.views, result: inner.result };
}

/** 真去起一次进程。失败也返回 outcome，不抛 */
async function executeOne(
  view: DockToolView,
  rule: DockRule,
  runId: string,
  opts: TickOnceOpts,
  fs: DockFs,
): Promise<DockOutcome> {
  const at = new Date().toISOString();
  if (!view.entry) {
    return {
      ok: false,
      status: 'failed',
      runId,
      code: null,
      stderr: '',
      error: new Error('没有可执行的启动命令'),
      kind: 'config',
      startedAt: at,
      finishedAt: at,
      durationMs: 0,
      recordMissing: '声明里没有 entry，跑不起来',
    };
  }

  const live = runToolNow({
    toolId: view.id,
    declPath: view.path,
    entry: view.entry,
    manifest: view.manifest,
    values: view.values,
    vaultPath: opts.vaultPath,
    trigger: 'auto',
    // 工单号由内核定（pending 里已经记下），这里必须原样传
    runId,
    records: () => parseRunLines(readRunsText(pathOf.runs(view.path), fs, RUNS_TAIL_BYTES), view.id),
    cb: {
      onStep: (text) => opts.onStep?.(view, text, runId),
      // 没人可问 = 立即按取消回（`exec` 的既有约定），这里不需要额外处理
    },
  });
  void rule;
  const outcome = await live.done;
  opts.onOutcome?.(view, outcome);
  return outcome;
}
