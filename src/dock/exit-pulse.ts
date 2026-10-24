/**
 * 「Obsidian 关闭」这枚事件的传话筒。
 *
 * 为什么不是「卸载时直接跑一次」：`onunload` 里起子进程，宿主正在退出，Windows 上大概率
 * 连进程都还没 exec 就被一起收掉 —— 用户看到的是「配了却不跑」，而且没有任何日志。
 * 所以插件只留一枚**脉冲**（数据目录的 `dock.exit.json`，一行 JSON：何时、哪个进程号），
 * 真正的执行交给下一拍：插件关着的时候是值守在拍；值守也不在，就等下次打开补跑。
 *
 * 判据只有三条，都是为了不误报：
 *  1) 脉冲读不出时间 → 不跑（判不出就不跑，`rules.ts` 的同一条纪律）；
 *  2) 脉冲里的进程号**等于读它的进程** → 那只是重载/禁用插件，不是关闭；
 *  3) 那个进程号**还活着** → Obsidian 根本没关（比如多个窗口，先关的那个只卸载了自己）。
 *
 * 消费即删：一拍真的把这次关闭处理过了，脉冲就落地为历史；不删的话下次打开又会补跑一遍。
 */

import { currentFs, joinPath, writeAtomic, type DockFs } from './files';

export const EXIT_PULSE_FILENAME = 'dock.exit.json';

export interface DockExitPulse {
  at: string;
  pid: number;
}

export function exitPulsePath(dataDir: string): string {
  return joinPath(dataDir, EXIT_PULSE_FILENAME);
}

/** 当前进程号；拿不到就是 0（调用方据此判断「判不出」） */
export function selfPid(): number {
  try {
    const p = (globalThis as { process?: { pid?: number } }).process;
    const n = p?.pid;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * 这个进程号还活着吗。
 *
 * **拿不到探测手段时返回 `true`** —— 宁可漏跑一次（等下回关闭），也不要在一个
 * 不支持探测的环境里把「重载插件」误当关闭、每重载一次就同步一次仓库。
 */
export function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return true;
  const p = (globalThis as { process?: { kill?: (pid: number, sig: number | string) => boolean } }).process;
  if (typeof p?.kill !== 'function') return true;
  try {
    p.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = 进程在，只是没权限发信号（Windows 上常见于跨用户进程）
    return (e as { code?: string } | null)?.code === 'EPERM';
  }
}

export function writeExitPulse(
  dataDir: string,
  fs: DockFs | null = currentFs(),
  now: number = Date.now(),
): boolean {
  if (!fs || !dataDir) return false;
  const pulse: DockExitPulse = { at: new Date(now).toISOString(), pid: selfPid() };
  return writeAtomic(fs, exitPulsePath(dataDir), `${JSON.stringify(pulse)}\n`);
}

export function readExitPulse(dataDir: string, fs: DockFs | null = currentFs()): DockExitPulse | null {
  if (!fs || !dataDir) return null;
  const raw = fs.readText(exitPulsePath(dataDir));
  if (raw === null) return null;
  try {
    const o = JSON.parse(raw) as { at?: unknown; pid?: unknown };
    const at = typeof o?.at === 'string' ? o.at : '';
    const pid = typeof o?.pid === 'number' ? o.pid : Number(o?.pid);
    if (!at || !Number.isFinite(Date.parse(at))) return null;
    return { at, pid: Number.isFinite(pid) ? pid : 0 };
  } catch {
    return null;
  }
}

/** 这一拍处理过了，把脉冲抹掉（抹不掉也不影响本次结果） */
export function clearExitPulse(dataDir: string, fs: DockFs | null = currentFs()): void {
  if (!fs || !dataDir || !fs.unlink) return;
  try {
    fs.unlink(exitPulsePath(dataDir));
  } catch {
    /* 已经被别的进程删掉了 */
  }
}

/**
 * 这枚脉冲算不算「一次真正的关闭」。
 *
 * `self` 是**读它的**那个进程 —— 插件重载时前后是同一个进程号，于是第 2 条就把它挡了。
 */
export function exitPulseFires(pulse: DockExitPulse | null, self: number = selfPid()): boolean {
  if (!pulse) return false;
  if (!Number.isFinite(Date.parse(pulse.at))) return false;
  if (!Number.isFinite(pulse.pid) || pulse.pid <= 0) return false;
  if (self > 0 && pulse.pid === self) return false;
  return !pidAlive(pulse.pid);
}
