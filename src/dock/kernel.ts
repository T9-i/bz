/**
 * 调度内核 —— **一拍只做一件事：把「该跑的」变成「排上队」，再把「到期的」跑掉**。
 *
 * 与上一版最大的不同：**待办不放在内存定时器里**。到点该跑的那一刻，先把
 * `{runId, dueAt, claimedAt}` 写进 `dock.runtime.json`，然后才去跑。进程在中间崩了，
 * 下一拍读到这条 pending 就知道「欠着一次」，接着办 —— 而不是像从前那样「账记了、活没了」。
 *
 * 四个不变量：
 *  1) **单执行权**：整拍包在执行权锁里，拿不到锁就什么都不做（不是「也试试看」）；
 *  2) **不并行**：一拍内串行跑，跑完一个再跑下一个；
 *  3) **不连坐**：一个工具挂了，后面的照跑；
 *  4) **不猜**：判不出来（没授权、没参数、读不到值）就不排 —— 并且**记下原因**，让人看得见。
 *
 * 判据（`ruleDue`）是纯函数，住 `rules.ts`；这里只负责「读事实 → 问判据 → 落账 → 起进程」。
 */

import {
  BREAKER_THRESHOLD,
  FAIL_COOLDOWN_MS,
  RUN_TIMEOUT_MS,
  type DockOutcome,
  type DockRegistry,
  type DockRule,
  type DockRuleRuntime,
  type DockRunStatus,
  type DockRuntime,
  type DockToolView,
} from './types';
import { ruleDue, type RuleEvent } from './rules';
import { makeRunId } from './parse';
import { writeRuntime } from './files';
import type { DockFs } from './files';

/** 一条规则这一拍为什么跑 / 为什么不跑 */
export type SkipReason =
  | 'global-off'
  | 'disabled'
  | 'tool-auto-off'
  | 'paused'
  | 'untrusted'
  | 'no-entry'
  | 'missing-params'
  | 'running'
  | 'cooldown'
  | 'waiting'
  | 'jitter';

export interface Decision {
  toolId: string;
  ruleId: string;
  action: 'run' | 'remind';
  /** queue = 这一拍排上了；run = 现在就到期；skip = 不跑 */
  kind: 'queue' | 'run' | 'skip';
  dueAt?: string;
  reason?: SkipReason;
}

export interface PlanInput {
  views: readonly DockToolView[];
  now: number;
  sessionStart?: number;
  events?: readonly RuleEvent[];
  /** 全域「自动运行」总闸 */
  globalAutoRun: boolean;
  /** 正在跑的工具 id（在场） */
  liveIds: ReadonlySet<string>;
}

export interface PlanOutput {
  decisions: Decision[];
  /** 现在就该跑的那些（按登记顺序，串行执行） */
  ready: { view: DockToolView; rule: DockRule; runId: string }[];
}

/** 必填参数缺哪些 */
export function missingParams(view: DockToolView): string[] {
  const out: string[] = [];
  for (const p of view.params) {
    if (!p.required) continue;
    const v = view.values[p.key];
    const empty =
      v === undefined ||
      v === null ||
      (typeof v === 'string' && v.trim() === '') ||
      (Array.isArray(v) && v.length === 0);
    if (empty) out.push(p.label ?? p.key);
  }
  return out;
}

/**
 * 这一拍怎么安排 —— **纯函数**，不读盘、不写盘、不发通知。
 *
 * 面板要回答「它今天为什么没跑」也调它（传当前时刻即可），所以这里必须没有副作用。
 */
export function planTick(input: PlanInput): PlanOutput {
  const decisions: Decision[] = [];
  const ready: PlanOutput['ready'] = [];

  for (const view of input.views) {
    for (const rule of view.rules) {
      const ruleState: DockRuleRuntime = view.runtime.rules?.[rule.id] ?? {};
      const action = rule.action.kind === 'remind' ? 'remind' : 'run';
      const push = (kind: Decision['kind'], reason?: SkipReason, dueAt?: string): void => {
        decisions.push({ toolId: view.id, ruleId: rule.id, action, kind, reason, dueAt });
      };

      // 已经排上队：到点就跑，没到就等 —— 这条优先于一切判据（排队时已经过过门槛）
      const pending = ruleState.pending;
      if (pending) {
        const due = Date.parse(pending.dueAt);
        if (Number.isFinite(due) && due <= input.now) {
          // 领了号却一直没心跳：进程根本没起来（或上次死在半路）→ 这一拍接着办
          ready.push({ view, rule, runId: pending.runId });
          push('run');
        } else {
          push('skip', 'waiting', pending.dueAt);
        }
        continue;
      }

      if (rule.enabled === false) {
        push('skip', 'disabled');
        continue;
      }
      if (!input.globalAutoRun) {
        push('skip', 'global-off');
        continue;
      }
      if (view.intent.enabled === false) {
        push('skip', 'disabled');
        continue;
      }
      if (view.intent.autoRun === false) {
        push('skip', 'tool-auto-off');
        continue;
      }
      if (view.runtime.run?.pausedAt) {
        push('skip', 'paused');
        continue;
      }
      if (!view.trusted) {
        push('skip', view.trustStale ? 'untrusted' : 'untrusted');
        continue;
      }
      if (!view.entry || !view.runnable) {
        push('skip', 'no-entry');
        continue;
      }
      if (action === 'run' && missingParams(view).length > 0) {
        push('skip', 'missing-params');
        continue;
      }
      if (action === 'run' && input.liveIds.has(view.id)) {
        push('skip', 'running');
        continue;
      }
      // 冷却按「上次尝试时刻」算，不靠内存里的 Map —— 重启之后依然成立
      const lastAttempt = Date.parse(view.runtime.run?.lastAttemptAt ?? '');
      if (
        action === 'run' &&
        view.runtime.run?.lastAttemptOk === false &&
        Number.isFinite(lastAttempt) &&
        input.now - lastAttempt < FAIL_COOLDOWN_MS
      ) {
        push('skip', 'cooldown');
        continue;
      }

      // 判据：时间类看时钟，事件类看本拍的事件；同一拍里只排一次
      const ctx = {
        now: input.now,
        lastFiredAt: Number.isFinite(Date.parse(ruleState.lastFiredAt ?? ''))
          ? Date.parse(ruleState.lastFiredAt as string)
          : undefined,
        sessionStart: input.sessionStart,
      };
      const hit =
        ruleDue(rule, ctx) ||
        (input.events ?? []).some((e) => {
          // 自触发防环：本工具跑完不该再把自己拉起来
          if ((e.kind === 'tool-ok' || e.kind === 'tool-fail') && e.toolId === view.id) return false;
          return ruleDue(rule, { ...ctx, event: e });
        });
      if (!hit) continue;

      // 到点 + 抖动：**把到期时刻算出来写进账本**，不是挂一个内存定时器
      const jitterMin = rule.jitterMin ?? 0;
      const delayMs = jitterMin > 0 ? Math.floor(Math.random() * jitterMin * 60_000) : 0;
      const dueAt = new Date(input.now + delayMs).toISOString();
      push('queue', delayMs > 0 ? 'jitter' : undefined, dueAt);
    }
  }

  return { decisions, ready };
}

// ==================== 副作用：落账 ====================

export interface TickDeps {
  /** 数据目录（放执行权锁与登记表） */
  dataDir: string;
  registry: DockRegistry;
  views: readonly DockToolView[];
  now: number;
  sessionStart?: number;
  events?: readonly RuleEvent[];
  liveIds: ReadonlySet<string>;
  fs?: DockFs | null;
  /**
   * 连续失败是否自动熔断（设置页「连续失败就暂停」）。缺省 = 熔断。
   * 关掉只是不停手：失败次数照记（面板要看），冷却照走 —— 不冷却就成了死循环。
   */
  breaker?: boolean;
  /** 真跑一次；由宿主实现（插件起子进程 / 值守起子进程） */
  execute(view: DockToolView, rule: DockRule, runId: string): Promise<DockOutcome>;
  /** 只提醒：发一条通知（不拉进程） */
  remind?(view: DockToolView, rule: DockRule): void;
  /**
   * 该不该继续跑下一个。**执行权丢了就返回 true**。
   *
   * 为什么要有这个：锁丢了之后，另一个宿主随时会进来写同一本账；
   * 此时继续跑、继续 `settle`，就是两个写者的现场。**宁可这次不跑**。
   */
  shouldStop?(): boolean;
}

export interface TickResult {
  decisions: Decision[];
  ran: { toolId: string; ruleId: string; runId: string; status: DockRunStatus }[];
  /** 这一拍跑了几次（含重试） */
  executed: number;
}

/** 一拍最多串行跑几次（防一条链子把一拍拖成十分钟） */
const MAX_RUNS_PER_TICK = 8;

/**
 * 跑一拍。**调用方必须已经持有执行权锁**（`lock.ts` 的 `withLock` 包住它）——
 * 不在这里加锁，是为了让「拿锁」与「读登记表」之间的顺序由宿主决定。
 */
export async function runTick(deps: TickDeps): Promise<TickResult> {
  const plan = planTick({
    views: deps.views,
    now: deps.now,
    sessionStart: deps.sessionStart,
    events: deps.events,
    globalAutoRun: deps.registry.autoRun,
    liveIds: deps.liveIds,
  });

  const ran: TickResult['ran'] = [];
  let executed = 0;

  /** 本拍真要跑的（已有 pending 的到期项 + 刚排上且抖动为 0 的） */
  const jobs: { toolId: string; ruleId: string; runId: string }[] = plan.ready.map((r) => ({
    toolId: r.view.id,
    ruleId: r.rule.id,
    runId: r.runId,
  }));

  // 1) 先落账：把「该跑的」写成 pending（带正式工单号 + 到期时刻）
  for (const d of plan.decisions) {
    if (d.kind !== 'queue' || !d.dueAt) continue;
    const view = deps.views.find((v) => v.id === d.toolId);
    if (!view) continue;
    const rule = view.rules.find((r) => r.id === d.ruleId);
    if (!rule) continue;

    if (d.action === 'remind') {
      // 提醒不排队：当场发、当场记账（提醒的价值在「当时」）
      deps.remind?.(view, rule);
      patchRule(view, rule.id, { lastFiredAt: new Date(deps.now).toISOString(), lastStatus: 'ok' }, deps.fs);
      continue;
    }

    const runId = makeRunId(deps.now);
    patchRule(
      view,
      rule.id,
      { pending: { runId, dueAt: d.dueAt, claimedAt: new Date(deps.now).toISOString() } },
      deps.fs,
    );
    // 抖动为 0 的，当场就跑，不必等下一拍
    if (Date.parse(d.dueAt) <= deps.now) jobs.push({ toolId: view.id, ruleId: rule.id, runId });
  }

  // 2) 串行跑（一次一个；跑完看下一个）
  while (jobs.length && executed < MAX_RUNS_PER_TICK) {
    // 每跑一个之前看一眼：锁没了就收手，一条账都不再写
    if (deps.shouldStop?.()) break;
    const job = jobs.shift()!;
    const view = deps.views.find((v) => v.id === job.toolId);
    if (!view) continue;
    const rule = view.rules.find((r) => r.id === job.ruleId);
    if (!rule) continue;

    // 起跑前盖章：之后谁都能看出「这个待办已经起过跑」以及起过几次
    markStarted(view, rule.id, job.runId, deps.now, deps.fs);

    executed += 1;
    const startedAt = new Date().toISOString();
    let outcome: DockOutcome;
    try {
      outcome = await deps.execute(view, rule, job.runId);
    } catch (e) {
      outcome = {
        ok: false,
        status: 'failed',
        runId: job.runId,
        code: null,
        stderr: '',
        error: e instanceof Error ? e : new Error(String(e)),
        kind: 'config',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        recordMissing: 'bz 自己出错，没跑起来',
      };
    }

    settle(view, job.ruleId, job.runId, outcome, deps.fs, { breaker: deps.breaker });
    ran.push({ toolId: view.id, ruleId: job.ruleId, runId: job.runId, status: outcome.status });
  }

  return { decisions: plan.decisions, ran, executed };
}

// ==================== 记账 ====================

function patchRule(view: DockToolView, ruleId: string, patch: Partial<DockRuleRuntime>, fs: DockFs | null | undefined): void {
  const runtime = view.runtime;
  const rules: Record<string, DockRuleRuntime> = { ...(runtime.rules ?? {}) };
  rules[ruleId] = { ...(rules[ruleId] ?? {}), ...patch };
  view.runtime = { ...runtime, rules };
  writeRuntime(view.path, view.runtime, fs ?? null);
}

/**
 * 收尾：把这一次的结果写进账本。
 *
 * 三件事一起做，**一次写盘**：
 *  - 清掉 pending（不然后面每一拍都以为还欠着）；
 *  - 记下这条规则的上次时刻与结果；
 *  - 更新失败计数 / 熔断。
 */
export function settle(
  view: DockToolView,
  ruleId: string,
  runId: string,
  outcome: DockOutcome,
  fs: DockFs | null | undefined,
  opts: { breaker?: boolean } = {},
): void {
  const now = outcome.finishedAt || new Date().toISOString();
  const runtime: DockRuntime = { ...view.runtime, rules: { ...(view.runtime.rules ?? {}) } };
  const rules = runtime.rules as Record<string, DockRuleRuntime>;
  rules[ruleId] = { lastFiredAt: now, lastRunId: runId, lastStatus: outcome.status };

  const facts = { ...(runtime.run ?? {}) };
  facts.lastAttemptAt = now;
  facts.lastAttemptOk = outcome.ok;
  if (outcome.ok) {
    delete facts.consecutiveFailures;
    delete facts.pausedAt;
  } else if (outcome.status !== 'stopped') {
    const fails = (facts.consecutiveFailures ?? 0) + 1;
    facts.consecutiveFailures = fails;
    // 关掉熔断只代表「别自己停手」，失败次数照记 —— 面板上那个数字是用户判断的唯一依据
    if (fails >= BREAKER_THRESHOLD && opts.breaker !== false) facts.pausedAt = now;
  }
  runtime.run = facts;

  view.runtime = runtime;
  writeRuntime(view.path, runtime, fs ?? null);
}

/** 有人手动恢复了熔断 */
export function clearBreaker(view: DockToolView, fs?: DockFs | null): void {
  const runtime: DockRuntime = { ...view.runtime };
  if (runtime.run) {
    const facts = { ...runtime.run };
    delete facts.pausedAt;
    delete facts.consecutiveFailures;
    runtime.run = facts;
  }
  view.runtime = runtime;
  writeRuntime(view.path, runtime, fs ?? null);
}

/** 同一个待办最多起几次进程。崩了重跑是好事，无限重跑不是 */
export const MAX_ATTEMPTS = 3;

/**
 * 起跑前盖一个章：`startedAt` + `attempts`。
 *
 * 为什么必须有它：`claimedAt` 是**排队时刻**，抖动可能把它推到 12 小时后 —— 拿它判
 * 「卡住了没有」会把还在排队的待办当成尸体。只有真正起过跑的，才谈得上「没收尾」。
 */
function markStarted(view: DockToolView, ruleId: string, runId: string, now: number, fs: DockFs | null | undefined): void {
  const pending = view.runtime.rules?.[ruleId]?.pending;
  const at = new Date(now).toISOString();
  patchRule(
    view,
    ruleId,
    {
      pending: {
        runId,
        dueAt: pending?.dueAt ?? at,
        claimedAt: pending?.claimedAt ?? at,
        startedAt: at,
        attempts: (pending?.attempts ?? 0) + 1,
      },
    },
    fs,
  );
}

/**
 * 回收「起跑了但没收尾」的待办 —— 三段式的第三段（claim → running → settle）里，
 * settle 没来成的那一次。
 *
 * 两种情况分开处理：
 *  - **还在等抖动**（没有 `startedAt`）→ 不碰。它没卡住，只是没到点。
 *  - **起跑超过 `RUN_TIMEOUT_MS` + 1 分钟仍挂着** → 这次已经废了：
 *    `attempts < MAX_ATTEMPTS` 就清掉 `startedAt`，让下一拍重跑（崩了重跑是好事）；
 *    到了上限就清掉 pending、记一条 `abandoned`，并算一次失败 —— 无限重跑不是好事。
 */
export function reclaimStale(
  view: DockToolView,
  now: number,
  fs?: DockFs | null,
  opts: { breaker?: boolean } = {},
): 'requeue' | 'abandon' | null {
  const rules = { ...(view.runtime.rules ?? {}) };
  let verdict: 'requeue' | 'abandon' | null = null;

  for (const [id, st] of Object.entries(rules)) {
    const pending = st.pending;
    if (!pending?.startedAt) continue;
    const started = Date.parse(pending.startedAt);
    if (!Number.isFinite(started) || now - started <= RUN_TIMEOUT_MS + 60_000) continue;

    if ((pending.attempts ?? 1) < MAX_ATTEMPTS) {
      rules[id] = { ...st, pending: { ...pending, startedAt: undefined } };
      verdict = 'requeue';
    } else {
      const facts = { ...(view.runtime.run ?? {}) };
      facts.lastAttemptAt = new Date(now).toISOString();
      facts.lastAttemptOk = false;
      facts.consecutiveFailures = (facts.consecutiveFailures ?? 0) + 1;
      if (facts.consecutiveFailures >= BREAKER_THRESHOLD && opts.breaker !== false) {
        facts.pausedAt = new Date(now).toISOString();
      }
      rules[id] = { ...st, lastFiredAt: new Date(now).toISOString(), lastStatus: 'abandoned' };
      delete rules[id].pending;
      view.runtime = { ...view.runtime, run: facts };
      verdict = 'abandon';
    }
  }

  if (verdict) {
    view.runtime = { ...view.runtime, rules };
    writeRuntime(view.path, view.runtime, fs ?? null);
  }
  return verdict;
}
