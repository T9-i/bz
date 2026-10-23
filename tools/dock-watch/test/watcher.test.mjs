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
  fs.writeFileSync(path.join(toolDir, 'main.mjs'), opts.toolSource || FAKE_TOOL);

  const run = { cmd: process.execPath, args: ['main.mjs'], cwd: toolDir, shell: false };
  const trust = opts.trusted === false ? {} : { hello: { at: new Date().toISOString(), run: core.runSignature(run) } };
  fs.writeFileSync(path.join(pluginDir, 'data.json'), JSON.stringify({ storagePath: 'CONFIG/STORAGE', dockTrust: trust }, null, 2));

  const dataDir = path.join(vault, 'CONFIG', 'STORAGE');
  fs.mkdirSync(dataDir, { recursive: true });
  const dockFile = path.join(dataDir, 'dock.json');
  // v2：dock.json 只剩索引 + 开关（ADR-0248）；排期状态住在工具目录那份 dock-state.json
  fs.writeFileSync(
    dockFile,
    JSON.stringify(
      {
        v: 2,
        tools: [{ id: 'hello', path: declPath }, ...(opts.extraTools || [])],
        autoRun: opts.autoRun !== false,
        watchdog: opts.watchdog !== false,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(toolDir, 'dock-state.json'),
    JSON.stringify(
      {
        v: 1,
        tool: 'hello',
        // 缺省规则 `daily 00:00` —— 今天这个点早过了，任何时刻 tick 都该命中
        rules: [opts.rule || { id: 'r1', trigger: { kind: 'daily', at: '00:00' }, action: { kind: 'run' } }],
        // 台账：老形态 dock.json 里是 `{ <id>: {...} }`，状态文件里就是这个工具自己的那份
        runState: (opts.runState && opts.runState.hello) || {},
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
    stateFile: path.join(toolDir, 'dock-state.json'),
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

/** 读工具目录那份排期状态（规则记账 / 台账都写在这儿，ADR-0248） */
function readState(world) {
  return JSON.parse(fs.readFileSync(world.stateFile, 'utf8'));
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

/**
 * 拍一次。
 *
 * `opts.net` / `opts.netProbe` 是给网闸用例用的：缺省那份配置会让真实探测等 5 分钟，
 * 测试必须把等待压到毫秒级、并把探测换成假的（测试不该真去连公网）。
 */
async function tickOnce(world, opts = {}) {
  const config = { v: 1, vault: world.vault, intervalMs: 30000, pluginDataPath: '', net: opts.net };
  const watcher = createWatcher(config, {
    coreVersion: '1.33.0',
    // 缺省「网是通的」：现有一批用例都在测别的约定，不该被网闸拖慢、更不该真去握手
    netProbe: opts.netProbe || (async () => true),
  });
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

    // 记账写在工具目录的 dock-state.json 里（跑之前写的，所以此刻必然在）
    const state = readState(world);
    assert.ok(state.ruleState.r1.lastFiredAt, '规则记账没写回');
    assert.equal(state.runState.lastAttemptOk, true);

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

test('工具记录写成功、进程却非零退出：判决以记录为准，不报失败（issue 552）', async () => {
  // 现场来自 2026-10-17 那次离场运行：iamtxt 签到成功、记录 status=ok，
  // 但 process.exit() 在 Windows 上撞了 libuv 收尾断言，退出码非零 —— 简报因此说「失败」。
  const world = makeWorld({ toolSource: fakeToolScript('ok', 1, '签到成功') });
  try {
    await tickOnce(world);

    const state = readState(world);
    assert.equal(state.runState.lastAttemptOk, true, '记录说成功，台账就该记成功');
    assert.equal(state.runState.consecutiveFailures, 0, '误报的失败不能攒成熔断');

    const queue = rt.readQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].ok, true);
    assert.equal(queue[0].message, '签到成功', '摘要与成败自相矛盾，正是这个缺陷最刺眼的样子');
  } finally {
    world.cleanup();
  }
});

test('工具记录写失败、进程却退出 0：同样以记录为准（反向也要对账）', async () => {
  const world = makeWorld({ toolSource: fakeToolScript('failed', 0, '接口响应认不出来') });
  try {
    await tickOnce(world);

    const state = readState(world);
    assert.equal(state.runState.lastAttemptOk, false);
    assert.equal(state.runState.consecutiveFailures, 1);

    const queue = rt.readQueue();
    assert.equal(queue[0].ok, false);
    assert.equal(queue[0].message, '接口响应认不出来');
  } finally {
    world.cleanup();
  }
});

test('本次没留记录时仍按退出码兜（问不出就别猜）', async () => {
  const world = makeWorld({ toolSource: 'process.exitCode = 0;' });
  try {
    await tickOnce(world);
    const queue = rt.readQueue();
    assert.equal(queue[0].ok, true);
    assert.equal(queue[0].message, '退出码 0', '没记录就只报事实，不编原因');
  } finally {
    world.cleanup();
  }
});

/** 假工具：先落一条记录（status / message 由用例给），再按给定退出码收场 —— 造「记录与退出码打架」 */
function fakeToolScript(status, exitCode, message) {
  return `
import fs from 'node:fs';
const runsFile = process.env.BZ_DOCK_RUNS_FILE;
const startedAt = new Date().toISOString();
const record = { status: '${status}', startedAt, finishedAt: new Date().toISOString(), message: '${message}' };
const tmp = runsFile + '.' + process.pid + '.tmp';
fs.writeFileSync(tmp, JSON.stringify({ v: 1, tool: 'hello', runs: [record] }, null, 2));
fs.renameSync(tmp, runsFile);
process.exitCode = ${exitCode};
`;
}

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

test('写回只改自己那一块：dock.json 不碰，状态文件里不认识的字段原样留着', async () => {
  const world = makeWorld();
  try {
    // dock.json：加了未来字段也加了不认识的键 —— 值守现在**根本不写**它（ADR-0248）
    const dock = readDock(world);
    dock.未来字段 = { 保留: true };
    fs.writeFileSync(world.dockFile, JSON.stringify(dock, null, 2));
    const dockBefore = fs.readFileSync(world.dockFile, 'utf8');
    // dock-state.json：不认识的键必须活过这次记账（未来版本加的字段，本进程不该顺手删）
    const state = readState(world);
    state.某个新键 = '别删我';
    fs.writeFileSync(world.stateFile, JSON.stringify(state, null, 2));
    await tickOnce(world);
    assert.equal(fs.readFileSync(world.dockFile, 'utf8'), dockBefore, '值守不该写 dock.json');
    const after = readState(world);
    assert.equal(after.某个新键, '别删我');
    assert.ok(after.ruleState.r1.lastFiredAt, '该记的账还是要记');
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
    const state = readState(world);
    // 记账已经在跑之前写好 —— 否则延迟窗口里每一拍都会再命中一次
    assert.ok(state.ruleState.r1.lastFiredAt, '延迟那一路也必须先记账');
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
    const watcher = createWatcher(config, {
      coreVersion: '1.33.0',
      ignoreJitter: true,
      netProbe: async () => true, // 网闸不参与这条用例
    });
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
    const state = readState(world);
    assert.ok(state.ruleState.r1.lastFiredAt, '要记账 —— 不记的话它每拍都命中');
    assert.equal(watcher.state.runsSinceBoot, 0, '不该拉进程');
    assert.equal(fs.existsSync(path.join(world.toolDir, 'runs.json')), false);
    assert.equal(rt.readQueue().length, 0, '隔一天补一条「昨天该手动跑一次」只是噪音');
  } finally {
    world.cleanup();
  }
});

// ==================== 网闸（net.js） ====================
//
// 现场（2026-10-23 04:27）：登录两秒后值守就命中 iamtxt 签到，那时 Wi-Fi 还没就绪 ——
// `fetch failed`，而规则已经记账，这一天不会再自动重试。下面三条就是那次故障的回归。

test('网络没通：不跑、不记账，把这次留给下一拍', async () => {
  const world = makeWorld();
  try {
    const watcher = await tickOnce(world, {
      net: { waitMs: 120, probeEveryMs: 200, connectTimeoutMs: 20 },
      netProbe: async () => false,
    });

    assert.equal(watcher.state.runsSinceBoot, 0, '没网就不该拉起工具');
    assert.equal(fs.existsSync(path.join(world.toolDir, 'runs.json')), false);
    const state = readState(world);
    assert.equal(
      state.ruleState && state.ruleState.r1,
      undefined,
      '等不到网绝不能记账 —— 记账等于宣布「今天跑过了」，今天就不会再试',
    );
    assert.match(
      fs.readFileSync(path.join(rt.logsDir(), 'watch.log'), 'utf8'),
      /仍未接通.*留到下一拍/,
      '日志要说清是「留到下一拍」，不是「跑失败」',
    );
  } finally {
    world.cleanup();
  }
});

test('网络晚一点接通：等到它就照跑，落一条记在账上', async () => {
  const world = makeWorld();
  try {
    // 前两次探测没通，第三次通 —— 等价于「开机后几十秒 Wi-Fi 才连上」
    let calls = 0;
    const watcher = await tickOnce(world, {
      net: { waitMs: 2000, probeEveryMs: 200, connectTimeoutMs: 20 },
      netProbe: async () => {
        calls += 1;
        return calls >= 3;
      },
    });

    assert.equal(calls, 3, '该重试到通为止');
    assert.equal(watcher.state.runsSinceBoot, 1, '接通之后这一拍就该跑');
    assert.ok(readState(world).ruleState.r1.lastFiredAt, '跑了就要记账（不然每一拍都会再跑）');
    const runs = JSON.parse(fs.readFileSync(path.join(world.toolDir, 'runs.json'), 'utf8'));
    assert.equal(runs.runs.length, 1);
  } finally {
    world.cleanup();
  }
});

test('等网失败后的静默期：下一拍不再等满一轮（否则每 30 秒卡 5 分钟）', async () => {
  const world = makeWorld();
  try {
    let calls = 0;
    const config = {
      v: 1,
      vault: world.vault,
      intervalMs: 30000,
      pluginDataPath: '',
      net: { waitMs: 100, probeEveryMs: 200, connectTimeoutMs: 20 },
    };
    const watcher = createWatcher(config, {
      coreVersion: '1.33.0',
      netProbe: async () => {
        calls += 1;
        return false;
      },
    });

    await watcher.tick();
    const first = calls;
    assert.ok(first > 1, '第一拍该重试过若干次');

    await watcher.tick();
    assert.equal(calls, first, '静默期内直接跳过，不该再探（更不该再等 5 分钟）');
    assert.equal(watcher.state.runsSinceBoot, 0);
  } finally {
    world.cleanup();
  }
});

test('只提醒的规则不碰网络（提醒不需要联网，也不该被断网挡住）', async () => {
  const world = makeWorld({
    rule: { id: 'r1', trigger: { kind: 'daily', at: '00:00' }, action: { kind: 'remind' } },
  });
  try {
    let probed = 0;
    const watcher = await tickOnce(world, {
      net: { waitMs: 0, probeEveryMs: 200, connectTimeoutMs: 20 },
      netProbe: async () => {
        probed += 1;
        return false;
      },
    });
    assert.equal(probed, 0, 'remind 不该触发任何探测');
    assert.ok(readState(world).ruleState.r1.lastFiredAt, '提醒照常记账');
    assert.equal(watcher.state.runsSinceBoot, 0);
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
