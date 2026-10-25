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

import { runTick, reclaimStale, thresholdKey, type Decision, type TickResult } from './kernel';
import { withLock } from './lock';
import { loadToolViews, type TrustMap } from './view';
import { readRegistryAt } from './registry-file';
import { pathOf, readRunsText, currentFs, joinPath, type DockFs } from './files';
import { parseRunLines } from './parse';
import { runToolNow } from './exec';
import { clearExitPulse, exitPulseFires, readExitPulse } from './exit-pulse';
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
  skipped?: 'locked' | 'no-fs' | 'error';
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
        const views = loadToolViews(registry.tools, { trust: opts.trust, fs });

        // 先收尸，再排班 —— 顺序反了会把一条已废的待办当成还有效
        for (const view of views) {
          try {
            reclaimStale(view, now, fs);
          } catch (e) {
            opts.onError?.(e);
          }
        }

        // 「Obsidian 关闭」是一枚一次性事件，不是钟点：插件卸载时留的脉冲在这里兑现
        // （插件关着时是值守在拍，所以它天然是这条触发的执行者）
        const pulse = readExitPulse(opts.dataDir, fs);
        const exitFires = exitPulseFires(pulse);
        const events: RuleEvent[] = exitFires
          ? [...(opts.events ?? []), { kind: 'obsidian-exit' }]
          : [...(opts.events ?? [])];

        const result = await runTick({
          dataDir: opts.dataDir,
          registry,
          views,
          now,
          sessionStart: opts.sessionStart,
          events,
          liveIds: opts.liveIds ?? new Set<string>(),
          values: readThresholds(views, opts.vaultPath, fs),
          fs,
          execute: (view, rule, runId) => executeOne(view, rule, runId, opts, fs),
          remind: (view, rule) => opts.onRemind?.(view, rule),
          shouldStop: () => lock.lost(),
        });

        // 消费即删：这一拍已经把这次关闭交给判据了。留着的话下次打开会再补跑一遍。
        // 放在 `runTick` 之后 —— 它抛错时脉冲还在，下一拍再来。
        if (exitFires) clearExitPulse(opts.dataDir, fs);

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

/** 阈值文件的大小上限：超过就不读（它不是数据仓库，是个小 JSON） */
const MAX_THRESHOLD_BYTES = 2 * 1024 * 1024;

/**
 * `value-threshold` 的取值 —— 每拍读一次，读不到就不放进来。
 *
 * 判据本身住在 `rules.ts`（纯函数，只认 `ctx.value`）；读文件这件事必须留在这一层，
 * 否则面板调 `planTick` 回答「今天为什么没跑」时也会去读盘。
 *
 * **读不到 ≠ 0**：没这个键、不是数字、JSON 坏了、文件不在 —— 一律不进 map，
 * `ruleDue` 会答「判不出就不跑」。把读失败当成 0 会让 `< 5` 这类规则整夜乱跑。
 */
function readThresholds(
  views: readonly DockToolView[],
  vaultPath: string | undefined,
  fs: DockFs,
): Map<string, number> {
  const out = new Map<string, number>();
  const docs = new Map<string, unknown>();
  for (const view of views) {
    for (const rule of view.rules) {
      const t = rule.trigger;
      if (t.kind !== 'value-threshold') continue;
      const file = vaultFileOf(t.path, vaultPath);
      if (!file) continue;

      let doc: unknown;
      if (docs.has(file)) {
        doc = docs.get(file);
      } else {
        doc = undefined;
        // 阈值文件不该很大；真指到一个几百 MB 的库时不读 —— 每拍读一次会拖慢整拍
        const size = fs.size?.(file);
        const text = size !== undefined && size > MAX_THRESHOLD_BYTES ? null : fs.readText(file);
        // 没有 size 能力的 fs（移动端内存快照）：读到之后再按长度拒一次
        if (text !== null && text.length <= MAX_THRESHOLD_BYTES) {
          try {
            doc = JSON.parse(text);
          } catch {
            doc = undefined;
          }
        }
        docs.set(file, doc);
      }

      const n = pickNumber(doc, t.key);
      if (n !== undefined) out.set(thresholdKey(view.id, rule.id), n);
    }
  }
  return out;
}

/** 声明里的 `path`：绝对路径原样用，其余按 vault 相对路径拼 */
function vaultFileOf(p: string, vaultPath: string | undefined): string | null {
  const raw = String(p ?? '').trim();
  if (!raw) return null;
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('//')) return raw;
  const root = vaultPath?.replace(/\\/g, '/').replace(/\/+$/, '');
  if (raw.startsWith('/')) return root ? `${root}${raw}` : null;
  return root ? joinPath(root, raw) : null;
}

/** 按点路径取一个有限数：`a.b.c`；中间断在任何一段就答 undefined */
function pickNumber(doc: unknown, key: string): number | undefined {
  const parts = String(key ?? '')
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  let cur: unknown = doc;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : undefined;
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
