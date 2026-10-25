// @vitest-environment node
/**
 * 调度内核测试 —— 只验三件用户会疼的事：
 *
 *  1) **不丢**：崩在「记了账、还没跑」之间，下一拍还能接着办；
 *  2) **不重**：同一拍里同一条规则只排一次；待办没到期不跑；
 *  3) **说得清**：没跑的时候有明确原因（没授权 / 关着 / 缺参数 / 冷却）。
 */

import { describe, expect, it } from 'vitest';
import { planTick, runTick, settle, missingParams, reclaimStale, thresholdKey, MAX_ATTEMPTS, type TickDeps } from '../../src/dock/kernel';
import { fakeFs } from './_fake-fs';
import { emptyIntent, emptyRuntime } from '../../src/dock/parse';
import { pathOf } from '../../src/dock/files';
import { emptyRegistry } from '../../src/dock/parse';
import type { DockRule, DockToolView, DockRunRecord, DockOutcome } from '../../src/dock/types';

function viewOf(over: Partial<DockToolView> = {}): DockToolView {
  const base: DockToolView = {
    id: 'demo',
    path: '/tools/demo/manifest.json',
    declaredPath: '/tools/demo/manifest.json',
    dir: '/tools/demo',
    manifest: {
      v: 2,
      id: 'demo',
      name: '演示',
      entry: { cmd: 'node', args: ['main.mjs'] },
      params: [],
    },
    entry: { cmd: 'node', args: ['main.mjs'] },
    params: [],
    values: {},
    intent: emptyIntent('demo'),
    runtime: emptyRuntime('demo'),
    rules: [],
    trusted: true,
    trustStale: false,
    runnable: true,
  };
  return { ...base, ...over };
}

const daily: DockRule = { id: 'r1', trigger: { kind: 'daily', at: '09:00' }, action: { kind: 'run' } };

function at(hour: number, minute = 0): number {
  const d = new Date(2026, 0, 5, hour, minute, 0, 0);
  return d.getTime();
}

function plan(over: Partial<Parameters<typeof planTick>[0]> = {}) {
  return planTick({
    views: [viewOf({ rules: [daily] })],
    now: at(10),
    liveIds: new Set<string>(),
    ...over,
  });
}

describe('判据排程', () => {
  it('到点且今天还没跑 → 排上', () => {
    const out = plan();
    expect(out.decisions[0].kind).toBe('queue');
  });

  it('没到点 → 什么都不做', () => {
    const out = plan({ now: at(8) });
    expect(out.decisions).toHaveLength(0);
  });

  it('今天已经跑过 → 不再排', () => {
    const v = viewOf({
      rules: [daily],
      runtime: { ...emptyRuntime('demo'), rules: { r1: { lastFiredAt: new Date(at(9, 30)).toISOString() } } },
    });
    expect(plan({ views: [v] }).decisions).toHaveLength(0);
  });

  it('没授权 → untrusted', () => {
    const out = plan({ views: [viewOf({ rules: [daily], trusted: false })] });
    expect(out.decisions[0]).toMatchObject({ kind: 'skip', reason: 'untrusted' });
  });

  it('缺必填参数 → missing-params，并且说清缺哪个', () => {
    const v = viewOf({
      rules: [daily],
      params: [{ key: 'cookie', type: 'secret', required: true }],
    });
    expect(missingParams(v)).toEqual(['cookie']);
    expect(plan({ views: [v] }).decisions[0]).toMatchObject({ reason: 'missing-params' });
  });

  it('上一轮还没跑完 → running（不叠加第二个进程）', () => {
    const out = plan({ liveIds: new Set(['demo']) });
    expect(out.decisions[0]).toMatchObject({ reason: 'running' });
  });

  it('失败冷却期内 → cooldown', () => {
    const v = viewOf({
      rules: [daily],
      runtime: {
        ...emptyRuntime('demo'),
        run: { lastAttemptAt: new Date(at(9, 50)).toISOString(), lastAttemptOk: false },
      },
    });
    expect(plan({ views: [v] }).decisions[0]).toMatchObject({ reason: 'cooldown' });
  });

  it('抖动：到期时刻被算出来写进账本，而不是挂个内存定时器', () => {
    const rule: DockRule = { ...daily, jitterMin: 10 };
    const out = plan({ views: [viewOf({ rules: [rule] })] });
    const d = out.decisions[0];
    expect(d.kind).toBe('queue');
    expect(Date.parse(d.dueAt ?? '')).toBeGreaterThan(at(10));
    expect(Date.parse(d.dueAt ?? '')).toBeLessThanOrEqual(at(10) + 10 * 60_000);
  });

  it('已经排上队但没到期 → waiting，不重复排', () => {
    const v = viewOf({
      rules: [daily],
      runtime: {
        ...emptyRuntime('demo'),
        rules: {
          r1: { pending: { runId: 'r-x', dueAt: new Date(at(11)).toISOString(), claimedAt: new Date(at(10)).toISOString() } },
        },
      },
    });
    const out = plan({ views: [v] });
    expect(out.decisions[0]).toMatchObject({ kind: 'skip', reason: 'waiting' });
    expect(out.ready).toHaveLength(0);
  });

  it('排上队且已到期 → 这一拍就跑（崩溃后靠它续上）', () => {
    const v = viewOf({
      rules: [daily],
      runtime: {
        ...emptyRuntime('demo'),
        rules: {
          r1: { pending: { runId: 'r-x', dueAt: new Date(at(9)).toISOString(), claimedAt: new Date(at(9)).toISOString() } },
        },
      },
    });
    const out = plan({ views: [v] });
    expect(out.ready).toHaveLength(1);
    expect(out.ready[0].runId).toBe('r-x');
  });
});

describe('跑一拍', () => {
  function deps(over: Partial<TickDeps> = {}): TickDeps {
    const recs: DockRunRecord[] = [];
    return {
      dataDir: '/data',
      registry: emptyRegistry(),
      views: [viewOf({ rules: [daily] })],
      now: at(10),
      liveIds: new Set<string>(),
      execute: async (_v, _r, runId) => {
        const o: DockOutcome = {
          ok: true,
          status: 'ok',
          runId,
          code: 0,
          stderr: '',
          error: null,
          kind: 'unknown',
          startedAt: new Date(at(10)).toISOString(),
          finishedAt: new Date(at(10, 1)).toISOString(),
          durationMs: 60_000,
          record: { runId, tool: 'demo', trigger: 'auto', status: 'ok', startedAt: new Date(at(10)).toISOString() },
        };
        recs.push(o.record as DockRunRecord);
        return o;
      },
      ...over,
    };
  }

  it('跑完：pending 清掉、lastFiredAt 落账、同一拍不会再跑第二遍', async () => {
    const fs = fakeFs();
    const d = deps();
    d.fs = fs;
    const out = await runTick(d);
    expect(out.executed).toBe(1);
    const saved = JSON.parse(fs.files.get(pathOf.runtime(d.views[0].path)) ?? '{}');
    expect(saved.rules.r1.pending).toBeUndefined();
    expect(saved.rules.r1.lastStatus).toBe('ok');
    expect(saved.run.lastAttemptOk).toBe(true);

    // 再拍一次：不应该再跑（今天已经跑过）
    const again = await runTick({ ...d, now: at(10, 1) });
    expect(again.executed).toBe(0);
  });

  it('失败会记账，连续三次就熔断', async () => {
    const fs = fakeFs();
    const fail = deps({
      fs,
      now: at(10),
      execute: async (_v, _r, runId): Promise<DockOutcome> => ({
        ok: false,
        status: 'failed',
        runId,
        code: 1,
        stderr: '',
        error: null,
        kind: 'unknown',
        startedAt: new Date(at(10)).toISOString(),
        finishedAt: new Date(at(10)).toISOString(),
        durationMs: 0,
      }),
    });
    await runTick(fail);
    const saved = JSON.parse(fs.files.get(pathOf.runtime(fail.views[0].path)) ?? '{}');
    expect(saved.run.consecutiveFailures).toBe(1);
    expect(saved.run.pausedAt).toBeUndefined();
  });

  it('熔断开着的同一个工具连挂三次 → 自动暂停', () => {
    const fs = fakeFs();
    const v = viewOf({ rules: [daily] });
    const fail = (runId: string): DockOutcome => ({
      ok: false,
      status: 'failed',
      runId,
      code: 1,
      stderr: '',
      error: null,
      kind: 'unknown',
      startedAt: new Date(at(10)).toISOString(),
      finishedAt: new Date(at(10)).toISOString(),
      durationMs: 0,
    });
    for (let i = 0; i < 3; i += 1) settle(v, 'r1', `run-${i}`, fail(`run-${i}`), fs);
    const saved = JSON.parse(fs.files.get(pathOf.runtime(v.path)) ?? '{}');
    expect(saved.run.pausedAt).toBeTruthy();
  });

  it('执行抛错不会把这一拍带走', async () => {
    const fs = fakeFs();
    const d = deps({
      fs,
      execute: async () => {
        throw new Error('boom');
      },
    });
    const out = await runTick(d);
    expect(out.executed).toBe(1);
    const saved = JSON.parse(fs.files.get(pathOf.runtime(d.views[0].path)) ?? '{}');
    expect(saved.rules.r1.lastStatus).toBe('failed');
  });
});

describe('收尸：起跑了但没收尾的那一次', () => {
  /** 造一个「已经起过跑」的视图 */
  function started(over: { startedAt: string; attempts?: number }, now: number): DockToolView {
    const v = viewOf({ rules: [daily], runtime: emptyRuntime('demo') });
    v.runtime.rules = {
      r1: {
        pending: {
          runId: 'r1-run',
          dueAt: new Date(now - 3600_000).toISOString(),
          claimedAt: new Date(now - 3600_000).toISOString(),
          startedAt: over.startedAt,
          attempts: over.attempts,
        },
      },
    };
    return v;
  }

  it('还在等抖动（没有 startedAt）—— 不碰它', () => {
    const now = at(12);
    const v = viewOf({ rules: [daily], runtime: emptyRuntime('demo') });
    v.runtime.rules = {
      r1: {
        pending: {
          runId: 'r1-run',
          // 抖动可能把 dueAt 推到 12 小时后，但 claimedAt 是「刚排上队」，不能拿它判决
          dueAt: new Date(now + 6 * 3600_000).toISOString(),
          claimedAt: new Date(now - 10 * 60_000).toISOString(),
        },
      },
    };
    const fs = fakeFs();
    expect(reclaimStale(v, now, fs)).toBeNull();
    expect(v.runtime.rules?.r1.pending).toBeDefined();
  });

  it('起跑超时、还没到次数上限 —— 清掉 startedAt 让下一拍重跑', () => {
    const now = at(12);
    const v = started({ startedAt: new Date(now - 20 * 60_000).toISOString(), attempts: 1 }, now);
    const fs = fakeFs();
    expect(reclaimStale(v, now, fs)).toBe('requeue');
    const p = v.runtime.rules?.r1.pending;
    expect(p).toBeDefined();
    expect(p?.startedAt).toBeUndefined();
    expect(v.runtime.rules?.r1.lastStatus).toBeUndefined();
  });

  it('到了次数上限 —— 判废、清 pending、算一次失败', () => {
    const now = at(12);
    const v = started({ startedAt: new Date(now - 20 * 60_000).toISOString(), attempts: MAX_ATTEMPTS }, now);
    const fs = fakeFs();
    expect(reclaimStale(v, now, fs)).toBe('abandon');
    expect(v.runtime.rules?.r1.pending).toBeUndefined();
    expect(v.runtime.rules?.r1.lastStatus).toBe('abandoned');
    expect(v.runtime.run?.consecutiveFailures).toBe(1);
    expect(v.runtime.run?.lastAttemptOk).toBe(false);
  });

  it('刚起跑一分钟 —— 还不到超时线，不碰', () => {
    const now = at(12);
    const v = started({ startedAt: new Date(now - 60_000).toISOString(), attempts: 1 }, now);
    const fs = fakeFs();
    expect(reclaimStale(v, now, fs)).toBeNull();
  });
});

// ==================== 2026-10-25 修的四条 ====================

describe('阈值触发 / 手动在跑 / 锁丢失', () => {
  const threshold: DockRule = {
    id: 'th',
    trigger: { kind: 'value-threshold', path: 'CONFIG/STORAGE/n.json', key: 'n', op: '>', value: 3 },
    action: { kind: 'run' },
  };

  function tickDeps(over: Partial<TickDeps> = {}): TickDeps {
    return {
      dataDir: '/data',
      registry: emptyRegistry(),
      views: [viewOf({ rules: [daily] })],
      now: at(10),
      liveIds: new Set<string>(),
      execute: async (_v, _r, runId): Promise<DockOutcome> => ({
        ok: true,
        status: 'ok',
        runId,
        code: 0,
        stderr: '',
        error: null,
        kind: 'unknown',
        startedAt: new Date(at(10)).toISOString(),
        finishedAt: new Date(at(10, 1)).toISOString(),
        durationMs: 60_000,
      }),
      ...over,
    };
  }

  it('value-threshold：拿到值才判据，拿不到一律不跑', () => {
    const v = viewOf({ rules: [threshold] });
    const yes = planTick({
      views: [v],
      now: at(10),
      liveIds: new Set<string>(),
      values: new Map([[thresholdKey('demo', 'th'), 5]]),
    });
    expect(yes.decisions[0]?.kind).toBe('queue');

    const no = planTick({ views: [v], now: at(10), liveIds: new Set<string>() });
    expect(no.decisions).toHaveLength(0);

    // 值是 1、条件要 > 3 —— 判出来是「不够」，也不能跑
    const low = planTick({
      views: [v],
      now: at(10),
      liveIds: new Set<string>(),
      values: new Map([[thresholdKey('demo', 'th'), 1]]),
    });
    expect(low.decisions).toHaveLength(0);
  });

  it('账本上有新鲜的手动起跑标记 → 这一拍跳过同一个工具（别的宿主看不见它的进程）', () => {
    const v = viewOf({
      rules: [daily],
      runtime: { ...emptyRuntime('demo'), run: { runningAt: new Date(at(10, 1)).toISOString() } },
    });
    const out = planTick({ views: [v], now: at(10, 2), liveIds: new Set<string>() });
    expect(out.decisions[0]?.reason).toBe('running');
  });

  it('标记过期（超过运行超时 + 1 分钟）→ 不再挡，跑崩溃留下的残影自己失效', () => {
    const v = viewOf({
      rules: [daily],
      runtime: { ...emptyRuntime('demo'), run: { runningAt: new Date(at(9)).toISOString() } },
    });
    const out = planTick({ views: [v], now: at(11), liveIds: new Set<string>() });
    expect(out.decisions[0]?.kind).toBe('queue');
  });

  it('锁在跑的过程中被抢走 → 这一次结果不落账，且下一拍不会再排一遍', async () => {
    const fs = fakeFs();
    let calls = 0;
    const d = tickDeps({
      fs,
      // 循环顶那次检查时锁还在（calls=0），执行完之后才「丢」
      shouldStop: () => calls > 0,
      execute: async (_v, _r, runId): Promise<DockOutcome> => {
        calls += 1;
        return {
          ok: true,
          status: 'ok',
          runId,
          code: 0,
          stderr: '',
          error: null,
          kind: 'unknown',
          startedAt: new Date(at(10)).toISOString(),
          finishedAt: new Date(at(10, 1)).toISOString(),
          durationMs: 60_000,
        };
      },
    });
    const out = await runTick(d);
    expect(calls).toBe(1);
    expect(out.ran).toHaveLength(0); // 没记账
    const saved = JSON.parse(fs.files.get(pathOf.runtime('/tools/demo/manifest.json')) ?? '{}');
    expect(saved.rules.r1.lastStatus).toBeUndefined();
    // pending 还留着，**并且带着 startedAt**
    expect(saved.rules.r1.pending.startedAt).toBeTruthy();
    expect(saved.run?.lastAttemptOk).toBeUndefined();

    // 下一拍：这一单还在「跑过但没结算」的状态里，不能再排一遍
    const next = planTick({ views: [d.views[0]], now: at(10, 2), liveIds: new Set<string>() });
    expect(next.decisions[0]?.kind).toBe('skip');
    expect(next.decisions[0]?.reason).toBe('waiting');
    expect(next.ready).toHaveLength(0);
  });

  it('起跑超过超时线 → 这一单视为已死，可以重来；reclaimStale 顺手清掉 startedAt', () => {
    const fs = fakeFs();
    const now = at(12);
    const withPending = (startedAt: string): DockToolView =>
      viewOf({
        rules: [daily],
        runtime: {
          ...emptyRuntime('demo'),
          rules: {
            r1: {
              pending: {
                runId: 'run-1',
                dueAt: new Date(at(10)).toISOString(),
                claimedAt: new Date(at(10)).toISOString(),
                startedAt,
                attempts: 1,
              },
            },
          },
        },
      });

    // 刚起跑一分钟：还在跑，这一拍不许再排
    const young = withPending(new Date(now - 60_000).toISOString());
    expect(planTick({ views: [young], now, liveIds: new Set<string>() }).ready).toHaveLength(0);

    // 已经挂了 20 分钟：超过「运行超时 + 1 分钟」，按尸体处理，允许重来
    const dead = withPending(new Date(now - 20 * 60_000).toISOString());
    expect(planTick({ views: [dead], now, liveIds: new Set<string>() }).ready).toHaveLength(1);
    expect(reclaimStale(dead, now, fs)).toBe('requeue');
    expect(planTick({ views: [dead], now, liveIds: new Set<string>() }).ready).toHaveLength(1);
  });

  it('跑崩溃留下的过期标记，会在这一拍结算时一起摘掉', async () => {
    const fs = fakeFs();
    const v = viewOf({
      rules: [daily],
      runtime: { ...emptyRuntime('demo'), run: { runningAt: new Date(at(9)).toISOString(), runningRunId: 'r-old' } },
    });
    const out = await runTick(tickDeps({ fs, views: [v], now: at(11), shouldStop: () => false }));
    expect(out.executed).toBe(1); // 标记已过期 → 照常跑
    const saved = JSON.parse(fs.files.get(pathOf.runtime(v.path)) ?? '{}');
    expect(saved.run.runningAt).toBeUndefined();
    expect(saved.run.runningRunId).toBeUndefined();
    expect(saved.run.lastAttemptOk).toBe(true);
  });
});
