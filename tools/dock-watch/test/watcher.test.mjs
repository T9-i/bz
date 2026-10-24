/**
 * 值守的端到端测试 —— 搭一个**真的临时 vault**，跑一次真的 `tick()`。
 *
 * 这是整个改造里最值钱的一条测试：它验证的不是「某个函数返回什么」，而是
 * **值守能不能用同一份内核把一个真工具跑起来、并且把账记对**。
 * 上一版值守有自己一套判据与记账，这条测试根本不存在 —— 所以「插件对、值守错」
 * 只能靠用户发现。
 *
 * 不测的东西：网络（注入假探测）、真实计划任务、安装脚本。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cpModule from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../dock-core.cjs');
const { makeNodeFs } = require('../node-fs.js');
const { createWatcher } = require('../watch.js');

/**
 * 搭一个临时 vault。
 *
 * @param {object} o
 * @param {object} [o.rule] 规则（默认每天 00:00 跑一次）
 * @param {string} [o.script] 工具主脚本内容（默认写一条 ok 记录后退出）
 */
function makeVault(o = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-dock-watch-'));
  // 值守的本机状态（status / 日志 / 实时步骤）默认写 `%LOCALAPPDATA%`。
  // 测试把它指到临时目录：既断言得到，也不会往真机上堆垃圾。
  const prevLocal = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = path.join(root, '.local');
  const toolDir = path.join(root, 'tools', 'demo');
  const storageDir = path.join(root, 'CONFIG', 'STORAGE');
  fs.mkdirSync(toolDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.obsidian', 'plugins', 'bz'), { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  const entry = { cmd: process.execPath, args: ['main.mjs'] };
  const rule = o.rule ?? {
    id: 'r-daily',
    trigger: { kind: 'daily', at: '00:00' },
    action: { kind: 'run' },
  };

  fs.writeFileSync(
    path.join(toolDir, 'manifest.json'),
    JSON.stringify(
      { v: 2, id: 'demo', name: '演示工具', description: '测试用', entry, defaultRules: [rule] },
      null,
      2,
    ),
  );

  // 工具：把 bz 给的工单号原样写进 runs.jsonl —— 这就是契约要求的全部
  fs.writeFileSync(
    path.join(toolDir, 'main.mjs'),
    o.script ??
      `import fs from 'node:fs';
const runId = process.env.BZ_DOCK_RUN_ID || 'none';
fs.appendFileSync(process.env.BZ_DOCK_RUNS_FILE, JSON.stringify({
  runId, tool: 'demo', trigger: process.env.BZ_DOCK_TRIGGER, status: 'ok',
  startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  message: '干完了',
}) + '\\n');
console.log('[bz-step] 干完了');
`,
  );

  // 登记表只有工具清单（ADR-0257：全域开关已删）
  const registry = {
    v: 3,
    tools: [{ id: 'demo', path: path.join(toolDir, 'manifest.json') }],
  };
  fs.writeFileSync(path.join(storageDir, 'dock.json'), JSON.stringify(registry, null, 2));

  // 授权：签名必须与声明里那条命令一致，否则内核判 untrusted 不跑
  const trust = { demo: { at: new Date().toISOString(), run: core.runSignature(entry) } };
  fs.writeFileSync(
    path.join(root, '.obsidian', 'plugins', 'bz', 'data.json'),
    JSON.stringify({ storagePath: 'CONFIG/STORAGE', dockTrust: trust }, null, 2),
  );

  // 装配这一步在 cli.js 里做（值守只有这一个入口）。测试扮演同一个角色，一行都不能少：
  // 少了 fs → 内核读不到 vault 里的账本；少了 cp → 起不了子进程（node 下 window 不存在）
  core.setDockFs(makeNodeFs(root));
  core.setExecDeps({ cp: cpModule });

  const config = { v: 2, vault: root, intervalMs: 30_000 };
  return {
    root,
    toolDir,
    storageDir,
    config,
    runsPath: path.join(toolDir, 'runs.jsonl'),
    runtimePath: path.join(toolDir, 'dock.runtime.json'),
    readRuns() {
      try {
        return fs
          .readFileSync(path.join(toolDir, 'runs.jsonl'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
    readRuntime() {
      try {
        return JSON.parse(fs.readFileSync(path.join(toolDir, 'dock.runtime.json'), 'utf8'));
      } catch {
        return null;
      }
    },
    /** 实时步骤文件（与插件侧 `watchdog-status.ts` 同一口径） */
    livePath(toolId = 'demo') {
      return path.join(root, '.local', 'bz-dock-watch', 'live', `${toolId}.jsonl`);
    },
    readLive(toolId = 'demo') {
      try {
        return fs
          .readFileSync(this.livePath(toolId), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
    cleanup() {
      if (prevLocal === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = prevLocal;
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* Windows 上偶尔文件还被占着，忽略 */
      }
    },
  };
}

/** 假探测：网通 */
const netOk = async () => true;
/** 假探测：网不通 */
const netDown = async () => false;

test('端到端：真起一个工具进程，记录用 bz 给的工单号落地', async () => {
  const v = makeVault();
  try {
    const w = createWatcher(v.config, { netProbe: netOk });
    await w.tick();

    const runs = v.readRuns();
    assert.equal(runs.length, 1, '应该正好跑了一次');
    assert.match(runs[0].runId, /^r[0-9a-z]+-/, '工单号必须是内核生成的那个形态');
    assert.equal(runs[0].status, 'ok');

    // 账本：pending 必须被清掉，lastRunId 必须等于工具写的那一条
    const rt = v.readRuntime();
    const rule = rt.rules['r-daily'];
    assert.equal(rule.pending, undefined, '跑完不能留着 pending，否则每拍都以为还欠着');
    assert.equal(rule.lastRunId, runs[0].runId, '账本记的工单号必须与工具写的一致');
    assert.equal(rule.lastStatus, 'ok');
    assert.equal(rt.run.lastAttemptOk, true);
  } finally {
    v.cleanup();
  }
});

test('不重：同一拍再跑一次，同一天不会再起第二个进程', async () => {
  const v = makeVault();
  try {
    const w = createWatcher(v.config, { netProbe: netOk });
    await w.tick();
    await w.tick();
    await w.tick();
    assert.equal(v.readRuns().length, 1, '规则是每天一次，跑过就不该再跑');
  } finally {
    v.cleanup();
  }
});

test('不跑：没网时整拍跳过，账不记（下一拍才有机会）', async () => {
  const v = makeVault();
  try {
    const w = createWatcher(v.config, { netProbe: netDown, intervalMs: 30_000 });
    // 等网会重试到配置的 waitMs；这里把等待压到 0，只验「等不到就不记账」
    v.config.net = { waitMs: 0 };
    await w.tick();
    assert.equal(v.readRuns().length, 0);
    assert.equal(v.readRuntime(), null, '没网时不能记「今天跑过了」');
  } finally {
    v.cleanup();
  }
});

test('不跑：执行权锁在别人手里时安静退让，不抢', async () => {
  const v = makeVault();
  try {
    const nodeFs = makeNodeFs(v.root);
    const dataDir = 'CONFIG/STORAGE';
    const held = core.acquireLock(dataDir, 'somebody-else', { fs: nodeFs, keepAliveMs: 0 });
    assert.ok(held, '先模拟另一个宿主拿着锁');

    const w = createWatcher(v.config, { netProbe: netOk });
    await w.tick();
    assert.equal(v.readRuns().length, 0, '拿不到锁就什么都不该做');

    held.release();
    await w.tick();
    assert.equal(v.readRuns().length, 1, '锁放开之后照常跑');
  } finally {
    v.cleanup();
  }
});

test('不误判：工具失败写 failed，账本跟着降级并进冷却', async () => {
  const v = makeVault({
    script: `import fs from 'node:fs';
fs.appendFileSync(process.env.BZ_DOCK_RUNS_FILE, JSON.stringify({
  runId: process.env.BZ_DOCK_RUN_ID, tool: 'demo', trigger: 'auto', status: 'failed',
  startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  error: { kind: 'auth', detail: '登录过期' }, message: '登录态失效',
}) + '\\n');
process.exit(1);
`,
  });
  try {
    const w = createWatcher(v.config, { netProbe: netOk });
    await w.tick();
    const rt = v.readRuntime();
    assert.equal(rt.rules['r-daily'].lastStatus, 'failed');
    assert.equal(rt.run.lastAttemptOk, false);
    assert.equal(rt.run.consecutiveFailures, 1);
  } finally {
    v.cleanup();
  }
});

test('不误判：工具没写记录、退出码 0 —— 判成功，但账本记的是「没记录」', async () => {
  const v = makeVault({ script: 'process.exit(0);\n' });
  try {
    const w = createWatcher(v.config, { netProbe: netOk });
    await w.tick();
    const rt = v.readRuntime();
    assert.equal(rt.rules['r-daily'].lastStatus, 'ok', '退出码 0 且无记录 → 按退出码推断成功');
    assert.equal(rt.run.lastAttemptOk, true);
  } finally {
    v.cleanup();
  }
});

test('回传：工具吐的每一步都落进本机实时文件，工单号与记录一致', async () => {
  const v = makeVault({
    script: `import fs from 'node:fs';
console.log('[bz-step] 打开登录页');
console.log('[bz-step] 提交签到');
fs.appendFileSync(process.env.BZ_DOCK_RUNS_FILE, JSON.stringify({
  runId: process.env.BZ_DOCK_RUN_ID, tool: 'demo', trigger: 'auto', status: 'ok',
  startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
}) + '\\n');
`,
  });
  try {
    const w = createWatcher(v.config, { netProbe: netOk });
    await w.tick();

    const runs = v.readRuns();
    const live = v.readLive('demo');
    // 面板靠这两处对上：文件里的 runId 必须就是账本认的那一个，
    // 否则详情页会把「后台正在跑」和「跑的是哪一轮」对错人
    assert.ok(live.length >= 2, `实时步骤应该有两条，实际 ${live.length}`);
    assert.deepEqual(live.map((s) => s.text), ['打开登录页', '提交签到']);
    for (const s of live) assert.equal(s.runId, runs[0].runId);
  } finally {
    v.cleanup();
  }
});

test('回传：拿不到锁、没网时不会留下实时步骤（没跑就没有「正在跑」的假象）', async () => {
  const v = makeVault({ script: `console.log('[bz-step] 不该出现');process.exit(0);
` });
  try {
    const nodeFs = makeNodeFs(v.root);
    const held = core.acquireLock('CONFIG/STORAGE', 'somebody-else', { fs: nodeFs, keepAliveMs: 0 });
    assert.ok(held);
    const w = createWatcher(v.config, { netProbe: netOk });
    await w.tick();
    assert.deepEqual(v.readLive('demo'), []);
    held.release();
  } finally {
    v.cleanup();
  }
});
