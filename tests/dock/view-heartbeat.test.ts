// @vitest-environment node
/**
 * 「这个工具现在还在跑吗」—— 心跳与账本的对账。
 *
 * 契约里 `heartbeat.json` 只表示「刚才还活着」，**工具跑完不会删它**。所以光看心跳新鲜度，
 * 一个已经跑完的工具在接下来 60 秒里还会被当成「正在跑」：详情页的运行按钮锁在
 * 「后台正在跑」、卡片上挂着绿点，用户得干等或者重开面板才恢复（2026-10-24 实测撞上）。
 *
 * 收口的判据是工单号：心跳里的 `runId` 在账本里已经有终态记录 = 这次早就结束了。
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { loadToolView, heartbeatOf, runningHeartbeatOf } from '../../src/dock/view';
import { setDockVaultRoot, pathOf } from '../../src/dock/files';
import { HEARTBEAT_STALE_MS } from '../../src/dock/types';
import { fakeFs } from './_fake-fs';

const ROOT = 'E:/vault';
const DECL = `${ROOT}/CONFIG/SCRIPTS/demo/manifest.json`;
const DIR = `${ROOT}/CONFIG/SCRIPTS/demo`;

beforeEach(() => {
  setDockVaultRoot(ROOT);
});

/** 一个最小可装载的工具目录 */
function seed(extra: Record<string, string> = {}): ReturnType<typeof fakeFs> {
  return fakeFs({
    [pathOf.manifest(DECL)]: JSON.stringify({
      v: 2,
      id: 'demo',
      name: '演示',
      entry: { cmd: 'node', args: ['main.mjs'] },
      params: [],
    }),
    ...extra,
  });
}

function heartbeatFile(runId: string, at: number): string {
  return JSON.stringify({ runId, at: new Date(at).toISOString(), step: '签到' });
}

function runLine(runId: string, status: string, at: number): string {
  return (
    JSON.stringify({
      runId,
      tool: 'demo',
      trigger: 'manual',
      status,
      startedAt: new Date(at).toISOString(),
      finishedAt: new Date(at + 1000).toISOString(),
      durationMs: 1000,
    }) + '\n'
  );
}

const entry = { id: 'demo', path: `${ROOT}/CONFIG/SCRIPTS/demo/manifest.json` };

describe('视图装载：心跳要对一眼账本', () => {
  it('心跳新鲜但账本里已经有这一单的终态 → 不算在跑', () => {
    const now = Date.now();
    const fs = seed({
      [pathOf.heartbeat(DECL)]: heartbeatFile('r-1', now),
      [pathOf.runs(DECL)]: runLine('r-1', 'ok', now - 5000),
    });
    expect(heartbeatOf(DECL, fs)).not.toBeNull(); // 文件本身在
    expect(loadToolView(entry, { fs }).heartbeat).toBeUndefined(); // 视图里不算在跑
  });

  it('心跳新鲜、账本里没有这一单 → 正在跑', () => {
    const now = Date.now();
    const fs = seed({
      [pathOf.heartbeat(DECL)]: heartbeatFile('r-2', now),
      [pathOf.runs(DECL)]: runLine('r-1', 'ok', now - 60_000),
    });
    expect(loadToolView(entry, { fs }).heartbeat?.runId).toBe('r-2');
  });
});

describe('runningHeartbeatOf：新鲜度 + 对账，两条都要', () => {
  it('刚跑完（账本已有终态）→ null', () => {
    const now = Date.now();
    const fs = seed({
      [pathOf.heartbeat(DECL)]: heartbeatFile('r-3', now),
      [pathOf.runs(DECL)]: runLine('r-3', 'ok', now - 5000),
    });
    expect(runningHeartbeatOf(DECL, fs, now)).toBeNull();
  });

  it('真在跑（账本里还没这一单）→ 有值', () => {
    const now = Date.now();
    const fs = seed({ [pathOf.heartbeat(DECL)]: heartbeatFile('r-4', now) });
    expect(runningHeartbeatOf(DECL, fs, now)?.runId).toBe('r-4');
  });

  it('心跳过期（工具崩了没删）→ null', () => {
    const now = Date.now();
    const fs = seed({ [pathOf.heartbeat(DECL)]: heartbeatFile('r-5', now - HEARTBEAT_STALE_MS - 1000) });
    expect(runningHeartbeatOf(DECL, fs, now)).toBeNull();
  });

  it('没有心跳文件 → null', () => {
    expect(runningHeartbeatOf(DECL, seed(), Date.now())).toBeNull();
  });
});
