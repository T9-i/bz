import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runGate } from '../decide.js';
import * as core from '../dock-core.cjs';

/**
 * 「上一轮还没跑完就不起新一轮」（ADR-0251，值守侧）。
 *
 * 值守自己的 `inFlight` 只认得本进程拉起的那几个 —— 插件点的那一轮、被硬杀的残骸，
 * 都只能从 `runs.json` 里看出来。判活口径与插件同一份（`core.offlineRunningOf`）。
 */

function toolDir(runs, { updatedMsAgo = 5_000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-gate-'));
  const declPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(declPath, JSON.stringify({ id: 'demo', name: '示例' }));
  const updatedAt = new Date(Date.now() - updatedMsAgo).toISOString();
  fs.writeFileSync(path.join(dir, 'runs.json'), JSON.stringify({ v: 1, tool: 'demo', updatedAt, runs }));
  return declPath;
}

function view(declPath) {
  return {
    id: 'demo',
    declPath,
    entry: { id: 'demo', enabled: true, path: declPath },
    trusted: true,
    trustStale: false,
    run: { cmd: 'node', args: [], cwd: path.dirname(declPath) },
    runState: {},
    manifest: { params: [] },
    values: {},
  };
}

const run = (status, startedMsAgo = 60_000) => ({
  runId: 'r1',
  tool: 'demo',
  trigger: 'auto',
  status,
  startedAt: new Date(Date.now() - startedMsAgo).toISOString(),
});

test('记录里挂着 running 且心跳新鲜 → 到点也不起（running）', () => {
  const v = view(toolDir([run('running')]));
  assert.equal(runGate(v, { now: Date.now() }), 'running');
});

test('心跳停了（进程没了）→ 不拦，照常判下一道门槛', () => {
  const v = view(toolDir([run('running')], { updatedMsAgo: core.OFFLINE_STALE_MS + 5_000 }));
  assert.equal(runGate(v, { now: Date.now() }), null);
});

test('记录里没有 running → 不拦', () => {
  const v = view(toolDir([run('ok')]));
  assert.equal(runGate(v, { now: Date.now() }), null);
});

test('本进程 inFlight 仍然优先（不必去读盘）', () => {
  const v = view(toolDir([run('ok')]));
  assert.equal(runGate(v, { now: Date.now(), inFlight: true }), 'running');
});
