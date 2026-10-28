/**
 * 值守进程的体检 —— **只读**，供设置页回答「它到底在不在跑」。
 *
 * 值守自己的状态住在**本机会话态**里（`%LOCALAPPDATA%\bz-dock-watch\vaults\<key>\status.json`），
 * 不在 vault 里：它不是账本，换台机器就该重来。按库分目录的理由见 `core/vault-key.ts`
 * （一台机器多个库时，一个进程只服务一个，别的库不能读到这份状态）。
 *
 * ⚠️ 这里的路径推导必须与 `tools/dock-watch/runtime.js` 的 `watchdogDir()` **逐字一致**，
 * 否则插件读不到值守写的文件 —— 症状是「值守明明在跑，设置页说它从没启动过」。
 * 两边无法共享代码（一边是 TS 一边是独立 JS 包），所以靠一条测试钉住（`tests/dock/watchdog-path.test.ts`）。
 */

import { currentFs } from './files';
import { vaultKeyOf } from '../core/vault-key';

export const WATCHDOG_DIRNAME = 'bz-dock-watch';
/** 心跳超过这么久没更新，就当那个进程已经不在了（值守一拍 30 秒，给两拍余量） */
export const WATCHDOG_STALE_MS = 90_000;

export interface WatchdogStatus {
  /** status.json 在不在（在过才算装过并跑过） */
  present: boolean;
  /** 心跳新鲜 → 此刻还活着 */
  alive: boolean;
  at?: string;
  mode?: string;
  pid?: number;
  coreVersion?: string;
  runsSinceBoot?: number;
  lastRun?: { toolId?: string; name?: string; at?: string; ok?: boolean; status?: string; message?: string };
  lastError?: string;
  /** 读 status.json 用的路径（诊断用，显示给用户便于截图求助） */
  file: string;
  /** 值守正服务着**另一个**库（本库的 status 不会更新）：值是那个库的路径 */
  otherVault?: string;
}

/** 本机值守目录。口径与 `tools/dock-watch/runtime.js` 的 `watchdogDir()` 一致 */
export function watchdogDirOf(env: { LOCALAPPDATA?: string; USERPROFILE?: string; HOME?: string } = guessEnv()): string {
  const local = String(env.LOCALAPPDATA ?? '').trim();
  if (local) return `${local.replace(/[\\/]+$/, '')}/${WATCHDOG_DIRNAME}`;
  const home = String(env.USERPROFILE ?? env.HOME ?? '').trim();
  if (home) return `${home.replace(/[\\/]+$/, '')}/AppData/Local/${WATCHDOG_DIRNAME}`;
  return WATCHDOG_DIRNAME;
}

/**
 * vault 绝对路径 → 稳定目录键（FNV-1a 32 位，8 位十六进制）。
 *
 * 一台机器上可以有多个库，而一个值守进程只能服务一个（规则表与账本都在库里）。早前所有
 * 状态都写在同一层：第二个库装值守时把第一个的配置盖掉，先装的那个库从此静默地不再被值守。
 * 现在每个库各有一份状态目录（`<root>/vaults/<key>/`），根上留一个 `active.json` 说明
 * 「当前服务谁」。
 *
 * 实现住在 `core/vault-key.ts`（`core/tool-setup.ts` 也要用同一份，不能各写一遍）；
 * 这里转发，保持既有导入路径。算法一致性由 `tests/dock/watchdog-path.test.ts` 钉住。
 */
export { vaultKeyOf } from '../core/vault-key';
/** 某个库的值守状态目录（`<root>/vaults/<key>`）；空 vault → 根目录（老形态） */
export function watchdogVaultDirOf(
  vault: string,
  env: { LOCALAPPDATA?: string; USERPROFILE?: string; HOME?: string } = guessEnv(),
): string {
  const key = vaultKeyOf(vault);
  const root = watchdogDirOf(env);
  return key ? `${root}/vaults/${key}` : root;
}

/** 当前插件的 vault 绝对路径（拿不到 → 空串：早期调用 / 单测 / 非桌面端） */
export function currentVaultPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getApp } = require('../core/app') as typeof import('../core/app');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { vaultBasePathOf } = require('../core/plugin-path') as typeof import('../core/plugin-path');
    return vaultBasePathOf(getApp());
  } catch {
    return '';
  }
}

/** `active.json` 的内容（「现在服务哪个库」）；读不到 → null */
export function activeWatchdogVault(fs = currentFs()): { vault: string; key: string } | null {
  const text = fs ? fs.readText(`${watchdogDirOf()}/active.json`) : null;
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as { vault?: unknown };
    const vault = String(raw?.vault || '').trim().replace(/[\\/]+$/, '');
    return vault ? { vault, key: vaultKeyOf(vault) } : null;
  } catch {
    return null;
  }
}

function guessEnv(): { LOCALAPPDATA?: string; USERPROFILE?: string; HOME?: string } {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };
  const env = g.process?.env ?? {};
  return { LOCALAPPDATA: env.LOCALAPPDATA, USERPROFILE: env.USERPROFILE, HOME: env.HOME };
}

/** 读一次值守体检（读不到就是没装 / 没起，不抛） */
export function watchdogStatus(fs = currentFs(), vault = currentVaultPath()): WatchdogStatus {
  const active = activeWatchdogVault(fs);
  // 值守服务的是别的库：这个库的 status 永远不会更新，直接说清楚，
  // 别让人对着「已启用」的开关猜为什么没有心跳。
  if (active && vault && active.vault !== vault) {
    return {
      present: false,
      alive: false,
      otherVault: active.vault,
      file: `${watchdogVaultDirOf(vault)}/status.json`,
    };
  }
  const dir = vault ? watchdogVaultDirOf(vault) : watchdogDirOf();
  const file = `${dir}/status.json`;
  let text = fs ? fs.readText(file) : null;
  // 老安装（还没有 active.json）状态写在根上：认它，别让升级后的第一次打开变成「值守没了」
  if (text === null && !active) {
    text = fs ? fs.readText(`${watchdogDirOf()}/status.json`) : null;
    if (text !== null) return parseStatus(text, `${watchdogDirOf()}/status.json`);
  }
  if (text === null) return { present: false, alive: false, file };
  return parseStatus(text, file);
}

/** status.json → 结构（分开只是为了上面那两处读盘共用一份解析） */
function parseStatus(text: string, file: string): WatchdogStatus {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { present: false, alive: false, file };
  }
  if (!raw || typeof raw !== 'object') return { present: false, alive: false, file };

  const at = typeof raw.at === 'string' ? raw.at : undefined;
  const parsed = at ? Date.parse(at) : NaN;
  const alive = Number.isFinite(parsed) && Date.now() - parsed <= WATCHDOG_STALE_MS;

  const out: WatchdogStatus = { present: true, alive, file };
  if (at) out.at = at;
  if (typeof raw.mode === 'string') out.mode = raw.mode;
  if (typeof raw.pid === 'number') out.pid = raw.pid;
  if (typeof raw.core === 'string') out.coreVersion = raw.core;
  if (typeof raw.runsSinceBoot === 'number') out.runsSinceBoot = raw.runsSinceBoot;
  if (typeof raw.lastError === 'string') out.lastError = raw.lastError;
  if (raw.lastRun && typeof raw.lastRun === 'object') {
    const r = raw.lastRun as Record<string, unknown>;
    out.lastRun = {
      toolId: typeof r.toolId === 'string' ? r.toolId : undefined,
      name: typeof r.name === 'string' ? r.name : undefined,
      at: typeof r.at === 'string' ? r.at : undefined,
      ok: typeof r.ok === 'boolean' ? r.ok : undefined,
      status: typeof r.status === 'string' ? r.status : undefined,
      message: typeof r.message === 'string' ? r.message : undefined,
    };
  }
  return out;
}

// ==================== 后台运行的实时步骤 ====================
//
// 值守跑工具的时候，工具的 `[bz-step]` 落在本机的一个只追加文件里
// （`live/<工具id>.jsonl`，由值守写）。这是**回传通道**的全部：
// 不用端口、不用 IPC，一个能被两边同时看见的文件就够了。
//
// ⚠️ 文件名规则必须与 `tools/dock-watch/runtime.js` 的 `liveFileOf()` 一致 ——
// 不一致的症状是「值守在跑，面板永远显示没有实时输出」。两边无法共享代码，
// 所以靠 `tests/dock/watchdog-path.test.ts` 钉住。

/** 工具 id → 实时步骤文件（与值守侧 `liveFileOf` 同一口径；按库分目录） */
export function liveLogFileOf(toolId: string, vault = currentVaultPath()): string {
  const safe = String(toolId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
  return `${watchdogVaultDirOf(vault)}/live/${safe}.jsonl`;
}

export interface LiveStep {
  runId?: string;
  at?: string;
  text: string;
}

/**
 * 解析实时步骤文本（JSON Lines）。坏行跳过 —— 追加式文件在崩掉时最后一行可能是半截，
 * 一行坏掉不该让整块日志消失。
 */
export function parseLiveLog(text: string | null, limit = 40): LiveStep[] {
  if (!text) return [];
  const out: LiveStep[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      if (!raw || typeof raw !== 'object') continue;
      const t = typeof raw.text === 'string' ? raw.text : '';
      if (!t) continue;
      const step: LiveStep = { text: t };
      if (typeof raw.runId === 'string') step.runId = raw.runId;
      if (typeof raw.at === 'string') step.at = raw.at;
      out.push(step);
    } catch {
      /* 半截行 / 坏行 —— 跳过，不连累整块 */
    }
  }
  return out.slice(-limit);
}

/** 读一个工具最近的后台步骤 */
export function liveLogOf(toolId: string, limit = 40, fs = currentFs(), vault = currentVaultPath()): LiveStep[] {
  if (!fs) return [];
  const file = liveLogFileOf(toolId, vault);
  const text = fs.readTail ? fs.readTail(file, 64 * 1024) : fs.readText(file);
  // 老安装的步骤写在根上：本库读到空、且没有 active.json 时才回落（否则会串库）
  if (text === null && !activeWatchdogVault(fs)) {
    const legacy = `${watchdogDirOf()}/live/${String(toolId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`;
    const old = fs.readTail ? fs.readTail(legacy, 64 * 1024) : fs.readText(legacy);
    return parseLiveLog(old, limit);
  }
  return parseLiveLog(text, limit);
}

/**
 * 模式 → 人话（与 `tools/dock-watch/watch.js` 的 `describe()` 同一套词）。
 *
 * `off` / `auto-off` 两条是**旧状态文件的兼容**：那两个全域开关已在 ADR-0257 删掉，
 * 值守不再产出这两种 mode，但 `status.json` 里可能还留着上一版写的值。
 */
export function watchdogModeText(mode?: string): string {
  switch (mode) {
    case 'watch':
      return '正在值守';
    case 'busy':
      return '让给插件（锁在插件手里）';
    case 'off':
      return '离场调度关着';
    case 'auto-off':
      return '自动运行关着';
    case 'wait-net':
      return '在等网络';
    case 'no-plugin-data':
      return '读不到插件数据';
    case 'error':
      return '上一拍出错';
    default:
      return mode ? mode : '未知';
  }
}
