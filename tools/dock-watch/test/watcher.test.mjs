/**
 * 值守进程的集成测试（`node --test` 直跑，不进 vitest 那套）。
 *
 * 为什么是集成而不是单测：这个进程的价值全在**跨进程的那些约定**上 —— 租约看不看得见、
 * 记账写得对不对、工具真跑起来时环境变量给得对不对。拆成一个个纯函数去测，恰好测不到
 * 最会坏的地方。所以这里造一个**真临时 vault**（含插件 data.json / dock.json / 工具目录）
 * 和一个**真假工具**（node 脚本，自己写 runs.json），然后真的 tick 一次看结果。
 *
 * 隔离靠改 `process.env.LOCALAPPDATA` 指向临时目录 —— `runtime.js` 每次调用都现读 env，
 * 所以这招管用，且不会碰到用户真实的 `%LOCALAPPDATA%\bz-dock-watch`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../dock-core.cjs');
const rt = require('../runtime.js');
const decide = require('../decide.js');
const { createWatcher } = require('../watch.js');

// ==================== 造世界 ====================

/**
 * 搭一个临时世界：vault + 插件设置 + 面板数据 + 一个工具目录（含真能跑的假工具）。
 * 返回的对象里带 `cleanup`，每个用例结束都调。
 */
function makeWorld(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-dock-watch-'));
  const vault = path.join(root, 'vault');
  const local = path.join(root, 'local');
  fs.mkdirSync(path.join(local, 'bz-dock-watch'), { recursive: true });
  process.env.LOCALAPPDATA = local;
  // 安装脚本的产物：值守目录里的 config.json（读不到它进程就该拒绝启动）
  fs.writeFileSync(
    path.join(local, 'bz-dock-watch', 'config.json'),
    JSON.stringify({ v: 1, vault, intervalMs: 30000 }, null, 2),
  );

  // 插件数据目录：storagePath 与信任（信任的键是工具 id）
  const pluginDir = path.join(vault, '.obsidian', 'plugins', 'bz');
  fs.mkdirSync(pluginDir, { recursive: true });

  // 工具目录 + 假工具（自己写 runs.json，契约 §4.3 的最小实现）
  const toolDir = path.join(vault, 'CONFIG', 'SCRIPTS', 'DockTools', 'hello');
  fs.mkdirSync(toolDir, { recursive: true });
  const declPath = path.join(toolDir, 'manifest.json');
  fs.writeFileSync(
    declPath,
    JSON.stringify(
      {
        v: 1,
        id: 'hello',
        name: '问候',
        run: { cmd: process.execPath, args: ['main.mjs'] },
        params: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(toolDir, 'main.mjs'), FAKE_TOOL);

  const run = { cmd: process.execPath, args: ['main.mjs'], cwd: toolDir, shell: false };
  const trust = opts.trusted === false ? {} : { hello: { at: new Date().toISOString(), run: core.runSignature(run) } };
  fs.writeFileSync(path.join(pluginDir, 'data.json'), JSON.stringify({ storagePath: 'CONFIG/STORAGE', dockTrust: trust }, null, 2));

  const dataDir = path.join(vault, 'CONFIG', 'STORAGE');
  fs.mkdirSync(dataDir, { recursive: true });
  const dockFile = path.join(dataDir, 'dock.json');
  fs.writeFileSync(
    dockFile,
    JSON.stringify(
      {
        v: 1,
        tools: [
          {
            id: 'hello',
            path: declPath,
            // 缺省规则 `daily 00:00` —— 今天这个点早过了，任何时刻 tick 都该命中
            rules: [
              opts.rule || { id: 'r1', trigger: { kind: 'daily', at: '00:00' }, action: { kind: 'run' } },
            ],
          },
          ...(opts.extraTools || []),
        ],
        runState: opts.runState || {},
        autoRun: opts.autoRun !== false,
        watchdog: opts.watchdog !== false,
      },
      null,
      2,
    ),
  );

  return {
    root,
    vault,
    dataDir,
    toolDir,
    dockFile,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** 假工具：走四行协议、自己原子写运行记录（与契约 §4.3 同形） */
const FAKE_TOOL = `
import fs from 'node:fs';
import path from 'node:path';
const runsFile = process.env.BZ_DOCK_RUNS_FILE;
const startedAt = new Date().toISOString();
process.stdout.write('[bz-step] 干活\\n');
process.stdout.write('[bz-result] {"ok":true}\\n');
const record = {
  status: 'ok',
  startedAt,
  finishedAt: new Date().toISOString(),
  message: '假工具跑完了',
  trigger: process.env.BZ_DOCK_TRIGGER,
  contract: process.env.BZ_DOCK_CONTRACT,
  tool: process.env.BZ_DOCK_TOOL,
  vault: process.env.BZ_DOCK_VAULT,
  runsFileOk: typeof runsFile === 'string' && runsFile.length > 0,
};
try { fs.mkdirSync(path.dirname(runsFile), { recursive: true }); } catch {}
let prev = { v: 1, tool: process.env.BZ_DOCK_TOOL, runs: [] };
try { prev = JSON.parse(fs.readFileSync(runsFile, 'utf8')); } catch {}
prev.runs = [record, ...(prev.runs || [])].slice(0, 200);
prev.updatedAt = record.finishedAt;
const tmp = runsFile + '.' + process.pid + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(prev, null, 2));
fs.renameSync(tmp, runsFile);
process.exitCode = 0;
`;

function readDock(world) {
  return JSON.parse(fs.readFileSync(world.dockFile, 'utf8'));
}

function writeLease(world, patch = {}) {
  rt.writeJsonAtomic(rt.fileOf('lease.json'), {
    v: 1,
    owner: 'bz-plugin',
    pid: process.pid, // 本测试进程活着，等价于「插件在场」
    at: new Date().toISOString(),
    vault: world.vault,
    tickMs: 60000,
    ...patch,
  });
}

async function tickOnce(world) {
  const config = { v: 1, vault: world.vault, intervalMs: 30000, pluginDataPath: '' };
  const watcher = createWatcher(config, { coreVersion: '1.33.0' });
  await watcher.tick();
  return watcher;
}

// ==================== 用例 ====================

test('到点就照跑：命中规则、拉起工具、记账写回、进待播报队列', async () => {
  const world = makeWorld();
  try {
    const watcher = await tickOnce(world);

    // 工具自己写了记录（bz 从不代写）
    const runs = JSON.parse(fs.readFileSync(path.join(world.toolDir, 'runs.json'), 'utf8'));
    assert.equal(runs.runs.length, 1);
    assert.equal(runs.runs[0].tool, 'hello');
    // 环境变量按契约注入（trigger 恒为 auto —— 离场这一路就是自动触发）
    assert.equal(runs.runs[0].trigger, 'auto');
    assert.equal(runs.runs[0].contract, '1');
    assert.equal(runs.runs[0].vault, world.vault);
    assert.equal(runs.runs[0].runsFileOk, true);

    // 记账写在 dock.json 里（跑之前写的，所以此刻必然在）
    const dock = readDock(world);
    assert.ok(dock.tools[0].ruleState.r1.lastFiredAt, '规则记账没写回');
    assert.equal(dock.runState.hello.lastAttemptOk, true);

    // 体检快照与待播报队列
    const status = rt.readJson(rt.fileOf('status.json'));
    assert.equal(status.mode, 'watch');
    assert.equal(status.runsSinceBoot, 1);
    assert.equal(status.core, '1.33.0');
    const queue = rt.readQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].ok, true);
    assert.equal(queue[0].message, '假工具跑完了');
    assert.equal(watcher.state.lastError, undefined);
  } finally {
    world.cleanup();
  }
});

test('同一拍只跑一次：记账之后不会重复命中', async () => {
  const world = makeWorld();
  try {
    await tickOnce(world);
    await tickOnce(world); // 再来一拍：daily 今天已经跑过了，不该再跑
    const runs = JSON.parse(fs.readFileSync(path.join(world.toolDir, 'runs.json'), 'utf8'));
    assert.equal(runs.runs.length, 1, '同一条 daily 规则一天只该跑一次');
  } finally {
    world.cleanup();
  }
});

test('插件在场就让位：租约新鲜时不拍', async () => {
  const world = makeWorld();
  try {
    writeLease(world);
    const watcher = await tickOnce(world);
    assert.equal(watcher.state.runsSinceBoot, 0);
    assert.equal(fs.existsSync(path.join(world.toolDir, 'runs.json')), false, '让位时不该跑工具');
    const status = rt.readJson(rt.fileOf('status.json'));
    assert.equal(status.mode, 'defer');
  } finally {
    world.cleanup();
  }
});

test('租约是别的 vault 的就不让位（多 vault 同机的关键边界）', async () => {
  const world = makeWorld();
  try {
    writeLease(world, { vault: 'E:\\Obsidian\\另一个库' });
    const watcher = await tickOnce(world);
    assert.equal(watcher.state.runsSinceBoot, 1, '别的 vault 的插件不该挡住这个 vault 的规则');
    assert.equal(rt.readJson(rt.fileOf('status.json')).mode, 'watch');
  } finally {
    world.cleanup();
  }
});

test('租约过期就接管（插件崩了不该让值守永远等下去）', async () => {
  const world = makeWorld();
  try {
    const old = new Date(Date.now() - 30 * 60000).toISOString();
    writeLease(world, { at: old, pid: 0 });
    const watcher = await tickOnce(world);
    assert.equal(watcher.state.runsSinceBoot, 1);
  } finally {
    world.cleanup();
  }
});

test('离线值守开关关着就不拍（两个开关都开才离场跑）', async () => {
  const world = makeWorld({ watchdog: false });
  try {
    const watcher = await tickOnce(world);
    assert.equal(watcher.state.runsSinceBoot, 0);
    assert.equal(rt.readJson(rt.fileOf('status.json')).mode, 'off');
  } finally {
    world.cleanup();
  }
});

test('自动运行总闸关着也不拍（它与离线值守是两层：总闸管行为，值守只管那一半）', async () => {
  const world = makeWorld({ autoRun: false });
  try {
    const watcher = await tickOnce(world);
    assert.equal(watcher.state.runsSinceBoot, 0);
    assert.equal(rt.readJson(rt.fileOf('status.json')).mode, 'off');
  } finally {
    world.cleanup();
  }
});

test('没信任过的工具不跑（离场执行同样过信任门）', async () => {
  const world = makeWorld({ trusted: false });
  try {
    const watcher = await tickOnce(world);
    assert.equal(watcher.state.runsSinceBoot, 0);
    assert.equal(fs.existsSync(path.join(world.toolDir, 'runs.json')), false);
    assert.equal(rt.readJson(rt.fileOf('status.json')).mode, 'watch'); // 在拍，只是这条不合格
  } finally {
    world.cleanup();
  }
});

test('声明里的命令改过就作废信任（与面板同一把尺子）', async () => {
  const world = makeWorld();
  try {
    const decl = JSON.parse(fs.readFileSync(path.join(world.toolDir, 'manifest.json'), 'utf8'));
    decl.run.args = ['别的入口.mjs'];
    fs.writeFileSync(path.join(world.toolDir, 'manifest.json'), JSON.stringify(decl, null, 2));
    const watcher = await tickOnce(world);
    assert.equal(watcher.state.runsSinceBoot, 0, '命令变了还照跑就是信任边界失效');
  } finally {
    world.cleanup();
  }
});

test('熔断暂停的工具不跑（离开时的账也要认）', async () => {
  const world = makeWorld({ runState: { hello: { pausedAt: new Date().toISOString(), consecutiveFailures: 3 } } });
  try {
    const watcher = await tickOnce(world);
    assert.equal(watcher.state.runsSinceBoot, 0);
  } finally {
    world.cleanup();
  }
});

test('必填参数没填就不跑（门槛顺序与插件一致）', async () => {
  const world = makeWorld();
  try {
    const decl = JSON.parse(fs.readFileSync(path.join(world.toolDir, 'manifest.json'), 'utf8'));
    decl.params = [{ key: 'cookie', label: '凭据', type: 'secret', required: true }];
    fs.writeFileSync(path.join(world.toolDir, 'manifest.json'), JSON.stringify(decl, null, 2));
    // 参数表变了 → 命令没变（签名只绑 cmd/args/shell），信任仍然有效，卡在「必填没填」这一条
    const watcher = await tickOnce(world);
    assert.equal(watcher.state.runsSinceBoot, 0);
  } finally {
    world.cleanup();
  }
});

test('dock.json 版本不认识就不动手（不猜、不覆盖）', async () => {
  const world = makeWorld();
  try {
    const dock = readDock(world);
    dock.v = 99;
    fs.writeFileSync(world.dockFile, JSON.stringify(dock, null, 2));
    const watcher = await tickOnce(world);
    assert.equal(watcher.state.runsSinceBoot, 0);
    assert.match(String(watcher.state.lastError), /读不到面板数据/);
  } finally {
    world.cleanup();
  }
});

test('写回只改自己那一块：文件里不认识的字段原样留着', async () => {
  const world = makeWorld();
  try {
    const dock = readDock(world);
    dock.未来字段 = { 保留: true };
    dock.tools[0].某个新键 = '别删我';
    fs.writeFileSync(world.dockFile, JSON.stringify(dock, null, 2));
    await tickOnce(world);
    const after = readDock(world);
    assert.deepEqual(after.未来字段, { 保留: true });
    assert.equal(after.tools[0].某个新键, '别删我');
    assert.ok(after.tools[0].ruleState.r1.lastFiredAt);
  } finally {
    world.cleanup();
  }
});

test('面板路径按插件设置里的 storagePath 走（换过数据目录也认得）', async () => {
  const world = makeWorld();
  try {
    // 把数据目录搬到别处，并把插件设置指向它
    const moved = path.join(world.vault, '我自己的数据目录');
    fs.mkdirSync(moved, { recursive: true });
    fs.renameSync(world.dockFile, path.join(moved, 'dock.json'));
    fs.writeFileSync(
      path.join(world.vault, '.obsidian', 'plugins', 'bz', 'data.json'),
      JSON.stringify({ storagePath: '我自己的数据目录', dockTrust: readPluginTrust(world) }, null, 2),
    );
    const watcher = await tickOnce(world);
    assert.equal(watcher.state.runsSinceBoot, 1);
  } finally {
    world.cleanup();
  }
});

function readPluginTrust(world) {
  const p = path.join(world.vault, '.obsidian', 'plugins', 'bz', 'data.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')).dockTrust;
}

test('带随机延迟的规则：先记账、不当场跑（错峰），事件留给下一轮', async () => {
  const world = makeWorld({
    rule: { id: 'r1', trigger: { kind: 'daily', at: '00:00' }, action: { kind: 'run' }, jitterMin: 30 },
  });
  const realRandom = Math.random;
  Math.random = () => 0.5; // 固定掷骰：30 分钟档的一半 = 15 分钟后才跑
  try {
    const watcher = await tickOnce(world);
    const dock = readDock(world);
    // 记账已经在跑之前写好 —— 否则延迟窗口里每一拍都会再命中一次
    assert.ok(dock.tools[0].ruleState.r1.lastFiredAt, '延迟那一路也必须先记账');
    assert.equal(watcher.state.runsSinceBoot, 0, '这一刻还没跑（这正是错峰的意思）');
    assert.equal(fs.existsSync(path.join(world.toolDir, 'runs.json')), false);
  } finally {
    Math.random = realRandom;
    world.cleanup();
  }
});

test('`--once`（排障入口）不当场掷骰 —— 否则账记了、工具没跑', async () => {
  const world = makeWorld({
    rule: { id: 'r1', trigger: { kind: 'daily', at: '00:00' }, action: { kind: 'run' }, jitterMin: 30 },
  });
  const realRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const config = { v: 1, vault: world.vault, intervalMs: 30000, pluginDataPath: '' };
    const watcher = createWatcher(config, { coreVersion: '1.33.0', ignoreJitter: true });
    await watcher.tick();
    assert.equal(watcher.state.runsSinceBoot, 1, '--once 就该立刻看见结果');
    assert.equal(fs.existsSync(path.join(world.toolDir, 'runs.json')), true);
  } finally {
    Math.random = realRandom;
    world.cleanup();
  }
});

test('只提醒类规则：离场记账但不投递（提醒的价值在「当时」）', async () => {
  const world = makeWorld({
    rule: { id: 'r1', trigger: { kind: 'daily', at: '00:00' }, action: { kind: 'remind' } },
  });
  try {
    const watcher = await tickOnce(world);
    const dock = readDock(world);
    assert.ok(dock.tools[0].ruleState.r1.lastFiredAt, '要记账 —— 不记的话它每拍都命中');
    assert.equal(watcher.state.runsSinceBoot, 0, '不该拉进程');
    assert.equal(fs.existsSync(path.join(world.toolDir, 'runs.json')), false);
    assert.equal(rt.readQueue().length, 0, '隔一天补一条「昨天该手动跑一次」只是噪音');
  } finally {
    world.cleanup();
  }
});

test('单实例锁：pid 被复用（活着但不是值守）时不该把值守永久挡在门外', () => {
  const world = makeWorld();
  try {
    // 造一个「锁里那个 pid 活着、但 at 很旧」的现场 —— 等价于旧实例崩了、pid 被别的进程拿去
    rt.writeJsonAtomic(rt.fileOf('watch.lock'), {
      pid: process.pid, // 本测试进程活着
      at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const got = rt.acquireLock();
    assert.ok(got, '陈旧锁该能被夺取（不然值守每天登录都起不来，且没有任何症状）');
    rt.releaseLock(got);

    // 反之：新鲜的心跳锁是真·在跑的另一实例，必须让位
    rt.writeJsonAtomic(rt.fileOf('watch.lock'), { pid: process.pid, at: new Date().toISOString() });
    assert.equal(rt.acquireLock(), null);
  } finally {
    world.cleanup();
  }
});

test('单实例锁：已有活实例就不再拿一次', () => {
  const world = makeWorld();
  try {
    const first = rt.acquireLock();
    assert.ok(first, '第一次该拿到');
    assert.equal(rt.acquireLock(), null, '第二次该被拒（计划任务重复拉起的情形）');
    rt.releaseLock(first);
    assert.ok(rt.acquireLock(), '释放后可以再拿');
  } finally {
    world.cleanup();
  }
});

test('--status 能读出不认识的状态（坏文件当没有，不抛）', () => {
  const world = makeWorld();
  try {
    fs.mkdirSync(rt.watchdogDir(), { recursive: true });
    fs.writeFileSync(rt.fileOf('status.json'), '{ 这不是 JSON');
    assert.equal(rt.readJson(rt.fileOf('status.json')), null);
    const config = rt.readConfig();
    assert.equal(rt.normalizePath(config.vault), rt.normalizePath(world.vault));
  } finally {
    world.cleanup();
  }
});

test('参数值（data.json）按 key 逐字下发', async () => {
  const world = makeWorld();
  try {
    const decl = JSON.parse(fs.readFileSync(path.join(world.toolDir, 'manifest.json'), 'utf8'));
    decl.params = [{ key: 'user_id', label: '账号', type: 'text' }];
    fs.writeFileSync(path.join(world.toolDir, 'manifest.json'), JSON.stringify(decl, null, 2));
    fs.writeFileSync(
      path.join(world.toolDir, 'data.json'),
      JSON.stringify({ v: 1, tool: 'hello', values: { user_id: 'abc' } }, null, 2),
    );
    // 假工具把 argv 回显进记录，用它断言「key 逐字、不换写法」
    fs.writeFileSync(path.join(world.toolDir, 'main.mjs'), FAKE_TOOL_ARGV);
    await tickOnce(world);
    const runs = JSON.parse(fs.readFileSync(path.join(world.toolDir, 'runs.json'), 'utf8'));
    assert.deepEqual(runs.runs[0].argv, ['--user_id=abc']);
  } finally {
    world.cleanup();
  }
});

const FAKE_TOOL_ARGV = `
import fs from 'node:fs';
const runsFile = process.env.BZ_DOCK_RUNS_FILE;
const startedAt = new Date().toISOString();
const record = {
  status: 'ok',
  startedAt,
  finishedAt: new Date().toISOString(),
  message: 'argv 回显',
  argv: process.argv.slice(2),
};
const tmp = runsFile + '.' + process.pid + '.tmp';
fs.writeFileSync(tmp, JSON.stringify({ v: 1, tool: 'hello', runs: [record] }, null, 2));
fs.renameSync(tmp, runsFile);
process.exitCode = 0;
`;
