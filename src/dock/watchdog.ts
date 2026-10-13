/**
 * 值守进程（dock-watch）的**插件侧接口** —— 租约、状态、待播报队列（ADR-0242）。
 *
 * 为什么有这个东西：工具坞的调度器住在插件里，Obsidian 不开就不跑。要让「每天 12:00 那个
 * 签到」在没开 Obsidian 时也照跑，就得有一个**插件进程之外**的调度者 —— 那就是 dock-watch：
 * 挂在 Windows 登录自启上的常驻 node 进程，每 30 秒一拍，判据用的还是本域那份 `ruleDue`
 * （打包成 `dock-core.cjs`，见 `src/dock/watch-core.ts`）。
 *
 * 两个调度者不许同刻都拍，票就是这里写的**租约**：
 *  - 插件在场 → 装载时与每次 tick 各写一次租约（含 pid 与时刻），卸载时删掉；
 *  - 值守进程 → 只在租约缺失或过期时才拍，否则让位（它读的就是这个文件）。
 *
 * 四份文件都住 `%LOCALAPPDATA%\bz-dock-watch\`：**本机会话态**，不进 vault、不进 git、
 * 不跟同步盘走（租约每 60 秒变一次，放进 vault 等于把 git 与 Syncthing 的状态天天搅脏）。
 *
 * | 文件 | 谁写 | 内容 |
 * |---|---|---|
 * | `lease.json` | **bz**（本模块） | 「插件在场」的声明：pid / 时刻 / 拍间隔 |
 * | `status.json` | **值守进程** | 每拍刷一次的体检快照（面板读它画卡片） |
 * | `pending.json` | **值守进程**（追加）· **bz**（补报后删自己那几条） | 离线跑过什么 |
 * | `config.json` | 安装脚本 | vault 根 / 拍间隔（值守进程自己读，bz 只借它判断装没装） |
 *
 * 读侧一律容错（坏 JSON / 版本不认识 / 结构不对 → 当没有），**绝不抛** —— 面板不能因为一个
 * 可选件写的文件坏掉就打不开（同 `declaration.ts` 的读侧口径）。
 *
 * fs 走 `declaration` 那份注入缝（`currentFs` / `setDockFs`）：测试塞假件即可，不碰真盘。
 */

import { currentFs, joinPath, type DockFs } from './declaration';

// ==================== 常量 ====================

/** 值守目录名（住 `%LOCALAPPDATA%`） */
export const WATCHDOG_DIRNAME = 'bz-dock-watch';

/** 租约文件名（bz 写、值守进程读） */
export const WATCHDOG_LEASE_FILENAME = 'lease.json';

/** 值守状态文件名（值守进程写、bz 读） */
export const WATCHDOG_STATUS_FILENAME = 'status.json';

/** 待播报队列文件名（值守进程追加、bz 补报后删） */
export const WATCHDOG_QUEUE_FILENAME = 'pending.json';

/** 值守进程自己的配置文件名（安装脚本写） */
export const WATCHDOG_CONFIG_FILENAME = 'config.json';

/**
 * 租约保鲜期。插件每 60 秒一拍刷一次，这里留两拍半余量：
 * 插件**卡死**（渲染进程假死、但 pid 还在）超过这么久，值守进程就接管 —— 宁可偶尔多跑一次，
 * 也不要因为插件僵住而整天不跑。反之 pid 已不在（正常关闭）时不必等这么久，那是**即时**接管。
 */
export const WATCHDOG_LEASE_TTL_MS = 150_000;

/** 值守进程认得的契约版本（`dock.json` 的 `v` 与它同类：不认识就不拍） */
export const WATCHDOG_CONTRACT_VERSION = 1;

// ==================== 路径 ====================

/** 环境变量面（测试注入假件；生产走 `process.env`） */
export type WatchdogEnv = Record<string, string | undefined>;

/** 桌面端进程环境；拿不到就给空对象（调用方一律有回落，不抛） */
export function processEnv(): WatchdogEnv {
  try {
    const p = (globalThis as { process?: { env?: WatchdogEnv } }).process;
    return p?.env ?? {};
  } catch {
    return {};
  }
}

/**
 * 值守目录的绝对路径 —— **两侧（插件与值守进程）必须完全同口径**，否则租约谁也看不见谁。
 *
 * Windows 取 `%LOCALAPPDATA%`；取不到时按 `%USERPROFILE%\AppData\Local` 拼一个（同机同人，
 * 结果一致）；再取不到就退回相对目录名（罕见：非 Windows 的无家目录环境，功能可用但位置漂）。
 */
export function watchdogDirOf(env: WatchdogEnv = processEnv()): string {
  const local = env.LOCALAPPDATA?.trim();
  if (local) return joinPath(local, WATCHDOG_DIRNAME);
  const home = env.USERPROFILE?.trim() || env.HOME?.trim();
  if (home) return joinPath(joinPath(joinPath(home, 'AppData'), 'Local'), WATCHDOG_DIRNAME);
  return WATCHDOG_DIRNAME;
}

/** 值守目录里某个文件的绝对路径 */
export function watchdogPathOf(name: string, env: WatchdogEnv = processEnv()): string {
  return joinPath(watchdogDirOf(env), name);
}

// ==================== 注入面 ====================

/** 本模块的可注入依赖（测试塞假 env / 假 fs / 假时钟；生产全用缺省） */
export interface WatchdogDeps {
  env?: WatchdogEnv;
  fs?: DockFs | null;
  now?: number;
}

function depsOf(d: WatchdogDeps = {}): { env: WatchdogEnv; fs: DockFs | null; now: number } {
  return {
    env: d.env ?? processEnv(),
    fs: d.fs !== undefined ? d.fs : currentFs(),
    now: d.now ?? Date.now(),
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 原子写：tmp + rename（同 `writeSettings` 的口径；桩没有 rename 就直写） */
function writeAtomic(fs: DockFs, dir: string, path: string, data: string): void {
  ensureDir(fs, dir);
  if (fs.rename) {
    const tmp = `${path}.tmp`;
    fs.writeText(tmp, data);
    fs.rename(tmp, path);
    return;
  }
  fs.writeText(path, data);
}

/** 建出值守目录（幂等；桩没有 mkdir 时什么都不做，交给写入去暴露） */
function ensureDir(fs: DockFs, dir: string): void {
  fs.mkdir?.(dir);
}

// ==================== 租约（bz 写、值守进程读） ====================

/** 「插件在场」的声明 —— 值守进程看到一份新鲜租约就让位 */
export interface WatchdogLease {
  v: number;
  owner: 'bz-plugin';
  /** 写租约的插件进程 pid（渲染进程）—— 值守进程据此判「插件还在不在」 */
  pid: number;
  /** 写下的时刻（ISO） */
  at: string;
  /** 这个 vault 的绝对路径（多 vault 同机时，值守进程只服务自己配置里那个） */
  vault?: string;
  /** 插件的拍间隔（ms）—— 值守进程据此推算租约该有多新 */
  tickMs: number;
}

/** 写租约（每次 tick 与装载时各一次）。失败静默 —— 写不进去只影响「值守进程可能抢拍」，不该炸插件 */
export function writeWatchdogLease(opts: { vault?: string; tickMs?: number } & WatchdogDeps = {}): boolean {
  const { fs, now } = depsOf(opts);
  if (!fs) return false;
  const payload: WatchdogLease = {
    v: WATCHDOG_CONTRACT_VERSION,
    owner: 'bz-plugin',
    pid: processPid(),
    at: new Date(now).toISOString(),
    tickMs: opts.tickMs ?? 60_000,
  };
  const vault = opts.vault?.trim();
  if (vault) payload.vault = vault.replace(/[\\/]+$/, '');
  try {
    const dir = watchdogDirOf(opts.env);
    writeAtomic(fs, dir, joinPath(dir, WATCHDOG_LEASE_FILENAME), JSON.stringify(payload, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * 删租约（插件卸载时调）。删掉即「插件已离场」，值守进程下一拍立刻接管（不必等 TTL）。
 * 文件本来就不在 / 删不掉都当作成功 —— 幂等。
 */
export function clearWatchdogLease(opts: WatchdogDeps = {}): void {
  const { fs } = depsOf(opts);
  if (!fs?.unlink) return;
  const path = watchdogPathOf(WATCHDOG_LEASE_FILENAME, opts.env);
  try {
    const exists = fs.exists ? fs.exists(path) : fs.readText(path) !== null;
    if (exists) fs.unlink(path);
  } catch {
    /* 删不掉：租约会自然过期，无实害 */
  }
}

/** 当前进程 pid（拿不到给 0 —— 值守进程看到 0 会当作「判不出」，按 TTL 兜底） */
function processPid(): number {
  try {
    const p = (globalThis as { process?: { pid?: number } }).process;
    return typeof p?.pid === 'number' && p.pid > 0 ? p.pid : 0;
  } catch {
    return 0;
  }
}

/** 读租约（面板卡片用；坏文件 → null） */
export function readWatchdogLease(opts: WatchdogDeps = {}): WatchdogLease | null {
  const { fs } = depsOf(opts);
  if (!fs) return null;
  const raw = fs.readText(watchdogPathOf(WATCHDOG_LEASE_FILENAME, opts.env));
  if (raw === null) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(obj) || obj.v !== WATCHDOG_CONTRACT_VERSION) return null;
  if (typeof obj.pid !== 'number' || typeof obj.at !== 'string') return null;
  return {
    v: WATCHDOG_CONTRACT_VERSION,
    owner: 'bz-plugin',
    pid: obj.pid,
    at: obj.at,
    vault: typeof obj.vault === 'string' ? obj.vault : undefined,
    tickMs: typeof obj.tickMs === 'number' ? obj.tickMs : 60_000,
  };
}

// ==================== 状态（值守进程写、bz 读） ====================

/** 值守进程这一拍在做什么 */
export type WatchdogMode =
  /** 在拍（租约不在，自己在守着） */
  | 'watch'
  /** 让位中（插件在场） */
  | 'defer'
  /** 开关关着（`watchdog` 或 `autoRun` 任一为假），不拍 */
  | 'off';

/** 一次离场运行的摘要（队列里一条也是它） */
export interface WatchdogRunNote {
  toolId: string;
  /** 声明里的名字（给通知用；读不到就给 id） */
  name?: string;
  at: string;
  ok: boolean;
  /** 给人看的一句话（取工具自己写的 `message`，没有就按退出码兜一句） */
  message?: string;
  /** 失败分类（工具记录里的 `error.kind`；bz 侧推断的那份在这里不权威） */
  kind?: string;
}

/** 值守进程每拍刷新的体检快照 */
export interface WatchdogStatus {
  v: number;
  pid: number;
  /** 值守进程起来（或上次被插件让位后重新接管）的时刻 */
  startedAt: string;
  /** 最后一拍的时刻 —— 面板据此判「它还在不在」 */
  at: string;
  vault?: string;
  mode: WatchdogMode;
  /** 本次开机以来离场跑了几次 */
  runsSinceBoot: number;
  lastRun?: WatchdogRunNote;
  /** 最近一次自己家里出的错（读配置失败、spawn 失败…）—— 工具本身失败不算这里 */
  lastError?: string;
  /** 打包这份值守件时的 bz 版本 —— 插件据此提示「值守件比插件旧」 */
  core?: string;
}

function parseRunNote(raw: unknown): WatchdogRunNote | null {
  if (!isPlainObject(raw)) return null;
  const toolId = typeof raw.toolId === 'string' ? raw.toolId : '';
  const at = typeof raw.at === 'string' ? raw.at : '';
  if (!toolId || !at) return null;
  const note: WatchdogRunNote = { toolId, at, ok: raw.ok === true };
  if (typeof raw.name === 'string' && raw.name) note.name = raw.name;
  if (typeof raw.message === 'string' && raw.message) note.message = raw.message;
  if (typeof raw.kind === 'string' && raw.kind) note.kind = raw.kind;
  return note;
}

/** 读值守状态（面板卡片用；没装 / 没跑过 / 文件坏了 → null） */
export function readWatchdogStatus(opts: WatchdogDeps = {}): WatchdogStatus | null {
  const { fs } = depsOf(opts);
  if (!fs) return null;
  const raw = fs.readText(watchdogPathOf(WATCHDOG_STATUS_FILENAME, opts.env));
  if (raw === null) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(obj) || obj.v !== WATCHDOG_CONTRACT_VERSION) return null;
  if (typeof obj.at !== 'string' || typeof obj.pid !== 'number') return null;
  const mode = obj.mode === 'watch' || obj.mode === 'defer' || obj.mode === 'off' ? obj.mode : 'off';
  const out: WatchdogStatus = {
    v: WATCHDOG_CONTRACT_VERSION,
    pid: obj.pid,
    startedAt: typeof obj.startedAt === 'string' ? obj.startedAt : obj.at,
    at: obj.at,
    mode,
    runsSinceBoot: typeof obj.runsSinceBoot === 'number' && obj.runsSinceBoot >= 0 ? obj.runsSinceBoot : 0,
  };
  if (typeof obj.vault === 'string') out.vault = obj.vault;
  if (typeof obj.core === 'string') out.core = obj.core;
  if (typeof obj.lastError === 'string' && obj.lastError) out.lastError = obj.lastError;
  const last = parseRunNote(obj.lastRun);
  if (last) out.lastRun = last;
  return out;
}

/** 状态是不是新鲜（容差缺省 = 三拍）—— 面板据此区分「值守中」与「进程已不在」 */
export function isWatchdogAlive(status: WatchdogStatus, now: number = Date.now(), toleranceMs = 90_000): boolean {
  const at = Date.parse(status.at);
  return Number.isFinite(at) && now - at <= toleranceMs;
}

/** 值守件装没装（`config.json` 在 = 装过；面板据此决定要不要显示引导） */
export function isWatchdogInstalled(opts: WatchdogDeps = {}): boolean {
  const { fs } = depsOf(opts);
  if (!fs) return false;
  const path = watchdogPathOf(WATCHDOG_CONFIG_FILENAME, opts.env);
  return fs.exists ? fs.exists(path) : fs.readText(path) !== null;
}

// ==================== 待播报队列（值守进程追加、bz 补报后删自己那几条） ====================

/** 队列文件 */
export interface WatchdogQueue {
  v: number;
  items: WatchdogRunNote[];
}

/**
 * 读待播报队列。逐条校验、坏的丢（一条坏记录不该把整批补报吃掉），按时刻升序 ——
 * 补报出来的通知顺序才和实际发生顺序一致。
 */
export function readWatchdogQueue(opts: WatchdogDeps = {}): WatchdogRunNote[] {
  const { fs } = depsOf(opts);
  if (!fs) return [];
  const raw = fs.readText(watchdogPathOf(WATCHDOG_QUEUE_FILENAME, opts.env));
  if (raw === null) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isPlainObject(obj) || obj.v !== WATCHDOG_CONTRACT_VERSION || !Array.isArray(obj.items)) return [];
  const out: WatchdogRunNote[] = [];
  for (const item of obj.items) {
    const note = parseRunNote(item);
    if (note) out.push(note);
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * 补报后把已播的那几条从队列里删掉。
 *
 * **先重读再删**（不拿调用方手上那份整文件覆盖）：值守进程可能正好在补报期间追加了新条目，
 * 整文件覆写会把它们一起抹掉。匹配键是 `at + toolId`（同刻同工具重复出现的情况不存在 ——
 * 串行队列 + 记账保证同一规则不会同刻跑两次）。写失败静默（下次启动再补一遍，不是丢数据）。
 */
export function consumeWatchdogQueue(played: readonly WatchdogRunNote[], opts: WatchdogDeps = {}): void {
  const { fs } = depsOf(opts);
  if (!fs || !played.length) return;
  const path = watchdogPathOf(WATCHDOG_QUEUE_FILENAME, opts.env);
  const raw = fs.readText(path);
  if (raw === null) return;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return;
  }
  if (!isPlainObject(obj) || !Array.isArray(obj.items)) return;
  const playedKeys = new Set(played.map((n) => `${n.at}\u0000${n.toolId}`));
  const rest = obj.items.filter((item) => {
    const note = parseRunNote(item);
    return !note || !playedKeys.has(`${note.at}\u0000${note.toolId}`);
  });
  const payload: WatchdogQueue = { v: WATCHDOG_CONTRACT_VERSION, items: rest };
  try {
    writeAtomic(fs, watchdogDirOf(opts.env), path, JSON.stringify(payload, null, 2));
  } catch {
    /* 删不掉就留着：下次启动再补报一遍，比丢一条强 */
  }
}
