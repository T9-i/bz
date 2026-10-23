// @vitest-environment jsdom
/**
 * 离场运行的判据（ADR-0250）
 *
 * 值守进程拉起的那一轮 bz 不是父进程，没有 `onProgress` —— 唯一能证明「它还活着」的是
 * 工具自己每 8–10 秒重写一遍 `runs.json`。这里钉四件事：
 *
 * ① 挂着 `running` + 记录刚被写过 → 认它活着；
 * ② 心跳停了（超过 `OFFLINE_STALE_MS`）→ 不认（被杀 / 崩溃的残骸不能被当成在跑）；
 * ③ 没有 `running` 记录 → 什么都不显示；
 * ④ 老记录没有文件级 `updatedAt` 时退到 `startedAt`，刚开跑的也要认出来。
 */
import { describe, expect, it } from 'vitest';
import { OFFLINE_STALE_MS, offlineRunOf } from '../../src/dock/ui';
import type { DockToolView } from '../../src/dock/data';
import type { DockRunRecord } from '../../src/dock/schema';

const NOW = Date.parse('2026-10-23T04:40:00.000Z');
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

function run(status: DockRunRecord['status'], startedAgo = 60_000): DockRunRecord {
  return {
    runId: 'r1',
    tool: 'steam-cheap-radar',
    trigger: 'auto',
    status,
    startedAt: iso(startedAgo),
    message: '正在跑…第 24 步：核对 60 / 105 款（已 240 秒）',
    steps: [{ text: '核对 60 / 105 款', at: iso(10_000) }],
  };
}

/** 只喂 offlineRunOf 用得到的那几格：它不看界面上别的东西 */
function view(over: { runs: DockRunRecord[]; runsAt?: string }): DockToolView {
  return {
    entry: { id: 'steam-cheap-radar', path: 'x/manifest.json' },
    runs: over.runs,
    runsAt: over.runsAt,
  } as unknown as DockToolView;
}

describe('离场运行的判据', () => {
  it('挂着 running 且记录刚被写过 → 认它活着', () => {
    const r = offlineRunOf(view({ runs: [run('running')], runsAt: iso(6_000) }), NOW);
    expect(r?.runId).toBe('r1');
  });

  it('心跳停了 → 不认（残骸不能当「正在跑」）', () => {
    expect(offlineRunOf(view({ runs: [run('running')], runsAt: iso(OFFLINE_STALE_MS + 5_000) }), NOW)).toBeNull();
  });

  it('没有 running 记录 → 不显示', () => {
    expect(offlineRunOf(view({ runs: [run('ok')], runsAt: iso(1_000) }), NOW)).toBeNull();
    expect(offlineRunOf(view({ runs: [], runsAt: iso(1_000) }), NOW)).toBeNull();
  });

  it('老记录没有文件级 updatedAt 时退到 startedAt', () => {
    expect(offlineRunOf(view({ runs: [run('running', 30_000)] }), NOW)?.runId).toBe('r1');
    expect(offlineRunOf(view({ runs: [run('running', OFFLINE_STALE_MS + 10_000)] }), NOW)).toBeNull();
  });
});
