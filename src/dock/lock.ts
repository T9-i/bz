/**
 * 执行权锁 —— **同一时刻只有一个东西在调度、在跑工具**。
 *
 * 上一版靠「租约 + 互相瞟一眼」：插件写张票说我在，值守看见就让位。那是**礼貌**，不是互斥：
 * 两边同时判、同时写、同时跑，靠的是「窗口只有毫秒级」这种运气。
 *
 * 这一版换成**一把真锁**：谁拿到文件谁说了算，拿不到就这一拍什么都不做。
 *
 * 为什么锁在数据目录而不是工具目录：管的是**整台机器上的调度权**，不是某个工具的状态。
 * 一个工具一把锁会让「同时跑两个工具」变成合法行为 —— 那是上一版刻意要避免的（会一起噎住网络）。
 *
 * 三条保命规则：
 *  1) **排他创建**（`wx`）拿锁 —— 内核保证只有一个成功；
 *  2) **过期可抢**：持有者崩了不会把调度永久锁死。抢的时候先把旧锁**改名搬走**
 *     （`rename` 只有一个能成功），再排他创建 —— 不做「读-判断-覆盖」那种会被两边同时穿过的动作；
 *  3) **持有者每拍续期**。续期只写自己的 token，token 对不上说明锁已经被抢，立刻松手。
 */

import { LOCK_FILENAME, LOCK_STALE_MS } from './types';
import { currentFs, joinPath, type DockFs } from './files';

export interface LockInfo {
  owner: string;
  pid: number;
  /** 进程启动标识 —— Windows 的 pid 会被复用，光看 pid 会把新进程当成老持有者 */
  bootId: string;
  at: string;
  token: string;
}

export interface LockHandle {
  token: string;
  /** 续期（每拍调一次）。返回 false = 锁已经不是我的了 */
  renew(): boolean;
  /**
   * 已经丢了。**续期失败过一次就算丢** —— 从那一刻起，另一个宿主随时可能在我没写好的
   * 时候进来写同一本账，所以「丢了还在跑」比「不跑」危险得多。
   * 调度循环每跑一个之前先看它（`TickDeps.shouldStop`）。
   */
  lost(): boolean;
  /** 主动释放 */
  release(): void;
}

/** pid 还活着吗（拿不到 process 的环境一律答「活着」，宁可让位也不误抢） */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const proc = (globalThis as { process?: { kill?: (p: number, s: number) => boolean } }).process;
  if (!proc?.kill) return true;
  try {
    proc.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = 进程在但不归我管 → 活着；ESRCH = 没了
    return (e as { code?: string })?.code === 'EPERM';
  }
}

function newToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 本机这一次开机的标识：`机器名:开机时刻(取整到分钟)`。拿不到就返回空串 ——
 * 空值的锁继续按老判据走。
 *
 * 为什么是开机时刻而不是 pid：Windows 重启后 pid 会被复用，`pidAlive` 对上一轮开机
 * 留下的那把锁会答「活着」，于是死锁要硬等 90 秒超时。开机时刻对不上就说明这锁是
 * 上一轮的，可以直接抢，不必等。
 *
 * 为什么带机器名：vault 可能被两台机器共享，`bootId` 只回答「是不是同一次开机」，
 * 不回答「是不是同一台机器」。不带机器名的话，两台机器永远互判「你的锁过期了」，
 * 比改之前更糟。机器名不同就**不参与**这条判据，退回 pid / 时间。
 *
 * 取整到分钟是必须的：`os.uptime()` 秒级抖动会让同一台机器两次算出来差 1，误判成换机。
 */
function currentBootId(): string {
  try {
    // Obsidian 的 renderer 里 require 挂在 window 上；值守进程（CJS）里挂在 globalThis 上
    const g = globalThis as {
      require?: (id: string) => unknown;
      window?: { require?: (id: string) => unknown };
    };
    const req = g.window?.require ?? g.require;
    const os = req?.('os') as { uptime?: () => number; hostname?: () => string } | undefined;
    const sec = os?.uptime?.();
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return '';
    const host = os?.hostname?.();
    if (!host) return ''; // 没有机器名就不掺和这条判据
    return `${host}:${Math.round((Date.now() - sec * 1000) / 60_000)}`;
  } catch {
    return '';
  }
}

/** 两个 bootId 是不是同一台机器写下的（格式 `机器名:开机分钟`） */
function sameHostOf(a: string, b: string): boolean {
  const cut = (v: string): string => v.slice(0, v.lastIndexOf(':'));
  const ha = cut(a);
  return ha !== '' && ha === cut(b);
}

function readLock(fs: DockFs, path: string): LockInfo | null {
  const text = fs.readText(path);
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<LockInfo>;
    if (typeof v.owner !== 'string' || typeof v.token !== 'string' || typeof v.at !== 'string') return null;
    return {
      owner: v.owner,
      pid: typeof v.pid === 'number' ? v.pid : 0,
      bootId: typeof v.bootId === 'string' ? v.bootId : '',
      at: v.at,
      token: v.token,
    };
  } catch {
    return null;
  }
}

export function lockPathOf(dataDir: string): string {
  return joinPath(dataDir, LOCK_FILENAME);
}

/**
 * 试着拿锁。拿不到返回 null —— **这一拍就什么都不做**，等下一拍。
 *
 * 过期判据（任一）：
 *  - `at` 超过 `LOCK_STALE_MS`；
 *  - 持有者是本机进程且 pid 已经没了；
 *  - pid 还活着，但开机标识不是这一次的（重启后 pid 被复用）；
 *  - 锁文件读不出来（写坏了）。
 */
export function acquireLock(
  dataDir: string,
  owner: string,
  opts: { fs?: DockFs | null; staleMs?: number; now?: number; bootId?: string } = {},
): LockHandle | null {
  const fs = opts.fs ?? currentFs();
  if (!fs) return null;
  const path = lockPathOf(dataDir);
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  const now = opts.now ?? Date.now();
  const token = newToken();
  const info: LockInfo = {
    owner,
    pid: (globalThis as { process?: { pid?: number } }).process?.pid ?? 0,
    bootId: opts.bootId ?? currentBootId(),
    at: new Date(now).toISOString(),
    token,
  };
  const text = JSON.stringify(info);

  if (fs.mkdir) fs.mkdir(dataDir);

  const take = (): LockHandle | null => {
    const ok = fs.createExclusive ? fs.createExclusive(path, text) : false;
    if (ok) return handleOf(fs, path, token);
    // 没有排他创建能力的桩：退回「读不到就写」（只给测试用，插件与值守都走真身）
    if (!fs.createExclusive && fs.readText(path) === null) {
      fs.writeText(path, text);
      return handleOf(fs, path, token);
    }
    return null;
  };

  const first = take();
  if (first) return first;

  // 有人持有 —— 看是不是死的
  const held = readLock(fs, path);
  const expiredByTime = !held || now - Date.parse(held.at) > staleMs || !Number.isFinite(Date.parse(held?.at ?? ''));
  const expiredByPid = !!held && held.pid > 0 && !pidAlive(held.pid);
  // pid 还「活着」但开机标识不是这一次的：Windows 重启后 pid 被复用，那具尸体
  // 只是碰巧撞上了别人的号。三个前提缺一不可：
  //  - 两边的 bootId 都非空（老锁 / 拿不到 os 就退回 pid + 时间判据）；
  //  - 机器名相同 —— 不同机器的锁本来就不该互相判过期；
  //  - 开机时刻不同。
  const expiredByBoot =
    !!held && held.bootId !== '' && info.bootId !== '' && sameHostOf(held.bootId, info.bootId) && held.bootId !== info.bootId;
  if (!expiredByTime && !expiredByPid && !expiredByBoot) return null;

  // 抢：先把旧锁改名搬走（rename 只有一个能成功），再排他创建。
  //
  // 搬走的目标用**固定名**而不是带 token 的名字：带 token 的话，只要有一次没删成功
  // （Windows 上被同步客户端/杀毒短暂占住就会 EPERM），目录里就多一个垃圾文件，
  // 而每 90 秒一次抢占意味着一天能攒出近千个。固定名让「没删掉」最多只留一个，
  // 下次抢占先把它覆盖掉。
  const saved = `${path}.stale`;
  if (fs.rename) {
    if (fs.unlink) {
      try {
        fs.unlink(saved); // 上一轮没删掉的那个，先清掉，否则 rename 可能失败
      } catch {
        /* 本来就没有 */
      }
    }
    try {
      fs.rename(path, saved);
    } catch {
      return null; // 别人先抢走了
    }
    if (fs.unlink) {
      try {
        fs.unlink(saved);
      } catch {
        /* 删不掉就留着，不影响那把新锁 */
      }
    }
  } else if (fs.unlink) {
    try {
      fs.unlink(path);
    } catch {
      return null;
    }
  } else {
    return null;
  }
  return take();
}

function handleOf(fs: DockFs, path: string, token: string): LockHandle {
  let lost = false;
  return {
    token,
    lost(): boolean {
      return lost;
    },
    renew(): boolean {
      const held = readLock(fs, path);
      if (!held || held.token !== token) {
        lost = true;
        return false;
      }
      const next = JSON.stringify({ ...held, at: new Date().toISOString() });
      // 续期走原子写：读到的 token 还是我的才写，写完再确认一次
      if (fs.rename) {
        const tmp = `${path}.${token}.tmp`;
        try {
          fs.writeText(tmp, next);
          fs.rename(tmp, path);
        } catch {
          return false;
        }
      } else {
        fs.writeText(path, next);
      }
      const after = readLock(fs, path);
      const mine = !!after && after.token === token;
      if (!mine) lost = true;
      return mine;
    },
    release(): void {
      const held = readLock(fs, path);
      if (!held || held.token !== token || !fs.unlink) return;
      // 删两次：Windows 上刚被别的进程打开过的那一瞬间会 EPERM，隔一拍的第二次通常就过了。
      // 删不掉也不会把调度锁死（90 秒后照样能被抢），但会让下一拍白等一个周期。
      for (let i = 0; i < 2; i += 1) {
        try {
          fs.unlink(path);
          return;
        } catch {
          /* 再试一次 */
        }
      }
    },
  };
}

/** 拿到锁跑一段，跑完必放（抛错也放）。`keepAliveMs` > 0 时自动续期 —— 长任务靠它不失锁 */
export async function withLock<T>(
  dataDir: string,
  owner: string,
  fn: (lock: LockHandle) => Promise<T> | T,
  opts: { fs?: DockFs | null; staleMs?: number; now?: number; bootId?: string; keepAliveMs?: number } = {},
): Promise<T | null> {
  const lock = acquireLock(dataDir, owner, opts);
  if (!lock) return null;
  const hb = opts.keepAliveMs && opts.keepAliveMs > 0
    ? setInterval(() => {
        lock.renew(); // 失败时句柄自己会把 lost() 置真，调用方据此停手
      }, opts.keepAliveMs)
    : null;
  try {
    return await fn(lock);
  } finally {
    if (hb) clearInterval(hb);
    lock.release();
  }
}

/** 只读查看锁归谁（面板诊断用） */
export function inspectLock(dataDir: string, fs: DockFs | null = currentFs()): LockInfo | null {
  if (!fs) return null;
  return readLock(fs, lockPathOf(dataDir));
}
