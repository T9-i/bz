/**
 * 拉起一个工具（离场形态）—— 与插件 `runner.ts` 走**同一份契约**（ADR-0242）。
 *
 * 三处刻意与插件逐字一致，因为「同一个工具在面板里能跑、关掉 Obsidian 就跑不起来」是这类
 * 双层实现最贵的缺陷：
 *  1. **环境变量只给那五个**（不继承宿主）—— 契约 §4.1 就是这么定的，工具被要求自己写绝对路径。
 *     多塞一个 `PATH` 会让某些工具在值守下侥幸成功、在插件下失败，反而是更难查的那种不一致。
 *  2. **参数下发走 `--key=value`**（`buildArgs`，就是插件用的那份）；`cwd` 缺省 = 工具目录。
 *  3. **超时 10 分钟强杀**（`taskkill /T /F`，Windows 上要连子进程树一起收）。
 *
 * 一处必然不同：**本进程不是 bz**，所以 `BZ_DOCK_TRIGGER` 恒为 `auto`（用户在面板上手点那一路
 * 只可能发生在插件里）。工具据它标记录里的 `trigger` —— 写 `auto` 是实话。
 *
 * 本模块**不写运行记录**：记录的唯一写者是工具自己（契约 D8/D9，「bz 不写记录」对值守同样成立）。
 * 跑完它只做一件事：回读工具目录的 `runs.json`，把工具自己留的那句话取出来给待播报队列。
 */
'use strict';

const { spawn, spawnSync } = require('child_process');
const core = require('./dock-core.cjs');

/** 单次运行超时（与 `scheduler.ts` 的 `RUN_TIMEOUT_MS` 同值） */
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
/** 失败时留下的 stderr 尾部（与插件同量级：够看见原因，不把日志撑爆） */
const STDERR_TAIL_BYTES = 2048;
/** stdout 尾部留几行（只进值守日志，供排障） */
const STDOUT_TAIL_LINES = 40;

/**
 * 子进程环境 —— 与 `runner.ts` 的 `dockEnvOf` 一致（缺 `BZ_DOCK_VAULT` 时那边也不给）。
 */
function envOf(view, config) {
  const env = {
    BZ_DOCK_CONTRACT: '1',
    BZ_DOCK_TOOL: view.id,
    BZ_DOCK_TRIGGER: 'auto',
    BZ_DOCK_RUNS_FILE: core.runsPathFor(view.declPath),
  };
  const vault = String(config.vault || '').replace(/[\\/]+$/, '');
  if (vault) env.BZ_DOCK_VAULT = vault;
  return env;
}

/** 收整棵进程树（Windows 上经 shell 起的 .cmd 会套一层壳，杀壳杀不掉真身） */
function killTree(child) {
  const pid = child.pid;
  if (process.platform === 'win32' && pid) {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      /* 杀不动就交给下面的 kill 兜 */
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* 已经退了 */
  }
}

/**
 * 跨 chunk 行缓冲：一次 `data` 事件未必正好是一行（可能半行、也可能几行连在一起）。
 * 只用于日志旁路，所以坏行不抛、CRLF 剥 `\r`（与契约 §4.2 同口径）。
 */
function splitLines(state, text) {
  const parts = (state.chunk + text).split(/\r?\n/);
  state.chunk = parts.pop();
  return parts;
}

/**
 * 跑一次。恒 resolve（不 reject）：一个工具炸了不该把值守的循环带走。
 *
 * `onStdoutLine` 只是给日志用的旁路 —— **四行协议不在这里消费**：记录由工具自己写，
 * 结论从它的 `runs.json` 里回读才是权威（契约 §4.3）。
 */
function runTool(view, config, opts = {}) {
  const launch = view.run;
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const spec = {
    cwd: launch.cwd,
    shell: !!launch.shell,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: envOf(view, config),
  };
  const args = [...launch.args, ...core.buildArgs(view.manifest || { params: [] }, view.values)];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(launch.cmd, args, spec);
    } catch (e) {
      resolve({
        ok: false,
        stopped: false,
        code: null,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
        stderrTail: '',
        error: e && e.message ? e.message : String(e),
      });
      return;
    }

    const outTail = [];
    let errTail = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, opts.timeoutMs || RUN_TIMEOUT_MS);

    const lineBuffer = { chunk: '' };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text) => {
      for (const line of splitLines(lineBuffer, text)) {
        if (opts.onStdoutLine) opts.onStdoutLine(line);
        outTail.push(line);
        if (outTail.length > STDOUT_TAIL_LINES) outTail.shift();
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => {
      errTail = (errTail + text).slice(-STDERR_TAIL_BYTES);
    });

    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const finishedAt = new Date();
      resolve({
        ok: !timedOut && code === 0,
        stopped: timedOut,
        code: typeof code === 'number' ? code : null,
        startedAt,
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedMs,
        stderrTail: errTail.trim(),
        error: error || null,
        stdoutTail: outTail,
      });
    };

    child.on('error', (e) => finish(null, e && e.message ? e.message : String(e)));
    child.on('close', (code) => finish(code, null));
  });
}

/**
 * 认「属于本次运行」的时间余量 —— **与 `runner.ts` 的 `RECORD_MATCH_GRACE_MS` 同值**。
 *
 * 这里曾经是 60 秒，理由是「工具有的系统时钟/时区处理会把 startedAt 写得略有偏差」。但那个
 * 理由换来的是一个更糟的后果：进程没起来（命令配错、spawn 失败）时，上一分钟内刚跑成的那条
 * 记录会被当成本次的结果 —— 报成功比报失败更难查。宁可认不出（回落退出码），也不冒认。
 */
const RECORD_MATCH_GRACE_MS = 2000;

/**
 * 回读工具自己写的运行记录，取**本次**那一条。
 *
 * 「本次」的判据是启动时刻 —— 工具没写记录时（比如它崩在写记录之前）不能把**上一次**那条
 * 当成这次的结论，那会让用户看到一条对不上的旧消息。判不出就返回 null，由调用方按退出码兜一句。
 *
 * 同一次起跑可能留多条（工具手滑写了两次）：**取 startedAt 最晚的那条**，不按数组下标猜 ——
 * 入库次序不该决定判决（同 `runner.ts` `reconcileWithRecord` 的口径）。
 */
function readRunNote(view, startedMs) {
  const raw = core.readRunsText(view.declPath);
  if (raw === null) return null;
  const file = core.parseRunsFileText(raw, view.id);
  if (!file || !Array.isArray(file.runs) || !file.runs.length) return null;
  let best = null;
  for (const r of file.runs) {
    if (!r || typeof r.startedAt !== 'string') continue;
    const at = Date.parse(r.startedAt);
    if (!Number.isFinite(at) || at < startedMs - RECORD_MATCH_GRACE_MS) continue;
    if (!best || at > Date.parse(best.startedAt)) best = r;
  }
  return best;
}

module.exports = { RUN_TIMEOUT_MS, envOf, runTool, readRunNote, killTree };
