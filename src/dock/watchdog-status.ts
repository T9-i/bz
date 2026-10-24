/**
 * 值守进程的体检 —— **只读**，供设置页回答「它到底在不在跑」。
 *
 * 值守自己的状态住在**本机会话态**里（`%LOCALAPPDATA%\bz-dock-watch\status.json`），
 * 不在 vault 里：它不是账本，换台机器就该重来。
 *
 * ⚠️ 这里的路径推导必须与 `tools/dock-watch/runtime.js` 的 `watchdogDir()` **逐字一致**，
 * 否则插件读不到值守写的文件 —— 症状是「值守明明在跑，设置页说它从没启动过」。
 * 两边无法共享代码（一边是 TS 一边是独立 JS 包），所以靠一条测试钉住（`tests/dock/watchdog-path.test.ts`）。
 */

import { currentFs } from './files';

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
}

/** 本机值守目录。口径与 `tools/dock-watch/runtime.js` 的 `watchdogDir()` 一致 */
export function watchdogDirOf(env: { LOCALAPPDATA?: string; USERPROFILE?: string; HOME?: string } = guessEnv()): string {
  const local = String(env.LOCALAPPDATA ?? '').trim();
  if (local) return `${local.replace(/[\\/]+$/, '')}/${WATCHDOG_DIRNAME}`;
  const home = String(env.USERPROFILE ?? env.HOME ?? '').trim();
  if (home) return `${home.replace(/[\\/]+$/, '')}/AppData/Local/${WATCHDOG_DIRNAME}`;
  return WATCHDOG_DIRNAME;
}

function guessEnv(): { LOCALAPPDATA?: string; USERPROFILE?: string; HOME?: string } {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };
  const env = g.process?.env ?? {};
  return { LOCALAPPDATA: env.LOCALAPPDATA, USERPROFILE: env.USERPROFILE, HOME: env.HOME };
}

/** 读一次值守体检（读不到就是没装 / 没起，不抛） */
export function watchdogStatus(fs = currentFs()): WatchdogStatus {
  const file = `${watchdogDirOf()}/status.json`;
  const text = fs ? fs.readText(file) : null;
  if (text === null) return { present: false, alive: false, file };

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

/** 模式 → 人话（与 `tools/dock-watch/watch.js` 的 `describe()` 同一套词） */
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
