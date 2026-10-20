/**
 * 工具坞**面板数据** —— 住在三处，写者都是 bz（ADR-0239 / ADR-0248，修正 ADR-0235 §3）。
 *
 * | 数据 | 位置 | 为什么在那儿 |
 * |---|---|---|
 * | 三个全域开关 + 工具索引（id / path） | `<数据存储路径>/dock.json` | 与「域数据一律住 `storagePath`」同口径：换存储路径它跟着走，备份/迁移数据目录不会漏掉它 |
 * | **每个工具的排期状态**（规则表 / 规则记账 / 熔断台账 / 停用与总闸） | `<工具目录>/dock-state.json` | 那是**某个工具的事实**：工具搬家、复制、整目录分享时该跟着它走（ADR-0248） |
 * | **信任**（`trustedAt` / `trustedRun`） | 插件设置 `dockTrust` | 见下 |
 *
 * **这份文件为什么只剩「全局」**（2026-10-20 用户口径：脚本自己的数据自己管，`dock.json` 存全局）：
 * 原先三个全域开关、登记表、规则表、记账、台账挤在同一份里，于是「这个 vault 的开关」与
 * 「这个工具在这个 vault 的排期」混成一件事 —— 工具目录搬走，排期留在原地；反过来把
 * `dock.json` 分享出去，别人的规则表也跟着走。拆开之后每份数据各自只有一个写者。
 *
 * **信任为什么不进 vault**：`dock.json` 住在 vault 里（同步 / 进 git / 能整个分享出去），而信任是
 * 「我授权在本机执行这条命令」。若它也随 vault 走，别人给一份 vault 就同时带走了登记项与信任签名
 * —— 对上一个 `manifest.json` 里同样的命令签名即是「已信任」，调度器到点就替他跑起来，正是
 * ADR-0235 要挡的「打开别人的 vault = 在他机器上执行任意命令」。所以登记表可以随 vault 走，
 * **信任必须留在本机**（同一精神：凭据不进 vault）。
 *
 * 分家后两条硬约束：
 *  1) **文件里的信任字段一律忽略**（`data.ts` 读完就剥）—— 唯一真理源是设置里的 `dockTrust`；
 *  2) 撤销信任 = 从 `dockTrust` 里删掉一条，不需要动 `dock.json`。
 *
 * 与工具侧那几份（`manifest.json` / 参数值 `data.json` / 运行记录 `runs.json` / 展示板）的分界不变：
 * 那些住在**工具目录**（可以在 vault 外）；`dock-state.json` 也在工具目录，但**写者是 bz** ——
 * 「一个文件一个写者」这条不变量不变，只是它挪到了离工具更近的地方。
 *
 * **内存快照**：面板数据要被**同步**读（设置行的 `get`、调度器每轮判据、启动时的命令注册），而
 * vault 读写是异步的。所以维持一份模块级快照：`loadDockStore()` 读一次、写入口就地更新，读侧一律
 * 走 `dockStoreSnapshot()`。快照里是**合并视图**（索引 + 各工具的排期状态），与磁盘形态不同 ——
 * 落盘由 `diskFileOf()` 还原成「索引 + 开关」。
 *
 * **迁移**：老库的四把设置键（`dockTools` / `dockRunState` / `dockAutoRun` / `dockNotifyMissed`）
 * 由 `migrateLegacyDockSettings` 读出、从设置对象里删掉；`dock.json` 从 v1（内含排期状态）
 * 升到 v2（只剩索引 + 开关）时，逐个工具把状态写进它自己的目录，全部写成功才重写 `dock.json`
 * —— 写不进去就保持 v1 原样，下一轮再试，绝不「先删后写」把排期弄丢。
 *
 * 版本：`v` 不认识一律当没写过（缺省值），与本仓「不认识的版本拒绝、不猜」同口径。本文件是 bz
 * 自己写的，不存在跨版本共写场景，故不做段级合并写（那是给双写者文件准备的）。
 */

import { getApp } from '../core/app';
import { diskPathExists, enqueueFileTask, jsonFileStore, storageFile } from '../core/storage';
import { saveSettings, tryGetSettings } from '../core/settings-provider';
import { readToolState, writeToolState } from './declaration';
import { toolStateOf, type DockToolState } from './tool-state';

/** 面板数据文件版本（v1 = 排期状态还在里面；v2 = 只剩索引 + 开关，ADR-0248） */
export const DOCK_STORE_VERSION = 2;

/** 面板数据文件名（住数据目录，跟随 `storagePath` 设置） */
export const DOCK_STORE_FILENAME = 'dock.json';

/** 信任那份寄在插件设置里的键名（值：工具 id → 信任记录） */
export const DOCK_TRUST_SETTINGS_KEY = 'dockTrust';

/** 搬走之后不再使用的插件设置键（迁移读旧删旧；列在这里只为「一次列全」） */
export const DOCK_LEGACY_SETTINGS_KEYS = [
  'dockTools',
  'dockRunState',
  'dockAutoRun',
  'dockNotifyMissed',
] as const;

/** 一条信任记录：授权时刻 + 授权的那条启动命令签名 */
export interface DockTrustRecord {
  /** ISO 时刻 */
  at: string;
  /** 建立信任时的启动命令签名（`registry.runSignature`）；缺省 = 只记了时刻（无从比对，按过期算） */
  run?: string;
}

/** 索引里的一条：只有身份，没有任何排期状态 */
export interface DockToolIndex {
  id: string;
  path: string;
}

/**
 * `dock.json` 的**磁盘**形态（v2）：三个全域开关 + 一张工具索引。
 *
 * `tools` 刻意留成 `unknown[]`：**语义校验归 `registry.parseToolEntry`**，这里只保证文件层面的
 * 结构（数组），免得两处各写一份校验。
 */
export interface DockStoreDisk {
  v: number;
  /** 工具索引（**只有 id / path**；排期状态在各自的 `dock-state.json`） */
  tools: unknown[];
  /** 自动运行总闸（缺省开） */
  autoRun: boolean;
  /** 漏跑提醒（缺省开） */
  notifyMissed: boolean;
  /**
   * 离线值守（缺省开，ADR-0242）—— 装好 `dock-watch` 后，Obsidian 关着也按规则表跑。
   *
   * 它与 `autoRun` **并列但不同层**：`autoRun` 是「自动运行」这个行为的开关（在场离场都管，
   * 值守进程也读它），本键只管「**离场那一半**让不让值守进程接手」。两个都开才真的离场跑。
   */
  watchdog: boolean;
}

/**
 * **内存**形态（合并视图）：索引 + 各工具排期状态 + 台账。
 *
 * `runState` 是从各 `dock-state.json` 里汇起来的（`readRunStates` 一次读全，别让每个工具各读一遍）。
 */
export interface DockStoreFile extends DockStoreDisk {
  /** 工具登记表（合并视图；含排期状态，**不含信任字段**） */
  tools: unknown[];
  /** bz 侧调度台账：`工具 id → DockToolRunState`（由各工具状态文件汇总） */
  runState: Record<string, unknown>;
}

export type DockSwitchKey = 'autoRun' | 'notifyMissed' | 'watchdog';

function defaults(): DockStoreFile {
  return {
    v: DOCK_STORE_VERSION,
    tools: [],
    runState: {},
    autoRun: true,
    notifyMissed: true,
    watchdog: true,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 文件 → 形状归一（永不抛；坏字段逐个丢，版本不认识当没写过）。
 *
 * 认 v1 与 v2 两种：v1 的排期状态还内嵌在 `tools[]` / `runState` 里（`loadDockStore` 会把它拆走），
 * v2 只有索引。归一本身**不碰磁盘**，纯函数。
 */
export function normalizeDockStore(raw: unknown): DockStoreFile {
  if (!isPlainObject(raw)) return defaults();
  // v1 = 老形态（含排期状态），v2 = 当前形态；其它版本一律当没写过
  if (raw.v !== 1 && raw.v !== DOCK_STORE_VERSION) return defaults();
  return {
    v: DOCK_STORE_VERSION,
    tools: Array.isArray(raw.tools) ? raw.tools : [],
    runState: isPlainObject(raw.runState) ? raw.runState : {},
    // 三个开关缺省都是「开」：键缺失/形态不对一律视为开，与旧口径（`!== false` 即开）一致
    autoRun: raw.autoRun !== false,
    notifyMissed: raw.notifyMissed !== false,
    watchdog: raw.watchdog !== false,
  };
}

/** 内存形态 → 磁盘形态（剥掉排期状态与台账，只留索引 + 开关） */
export function diskFileOf(snapshot: DockStoreFile): DockStoreDisk {
  const tools: DockToolIndex[] = [];
  for (const raw of snapshot.tools) {
    if (!isPlainObject(raw)) continue;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const path = typeof raw.path === 'string' ? raw.path : '';
    if (!id || !path) continue;
    tools.push({ id, path });
  }
  return {
    v: DOCK_STORE_VERSION,
    tools,
    autoRun: snapshot.autoRun,
    notifyMissed: snapshot.notifyMissed,
    watchdog: snapshot.watchdog,
  };
}

/** 面板数据文件路径（`storagePath` 未设/空时回退 `CONFIG/STORAGE`） */
export function dockStorePath(): string {
  return storageFile(DOCK_STORE_FILENAME);
}

// ==================== 信任（住插件设置） ====================

/** 从设置原始值里规整出信任表（脏条目丢弃，永不抛） */
export function readTrustMap(): Record<string, DockTrustRecord> {
  const raw = (tryGetSettings() as Record<string, unknown> | undefined)?.[DOCK_TRUST_SETTINGS_KEY];
  if (!isPlainObject(raw)) return {};
  const out: Record<string, DockTrustRecord> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!isPlainObject(v)) continue;
    const at = v.at;
    if (typeof at !== 'string' || at === '') continue;
    const run = typeof v.run === 'string' && v.run !== '' ? v.run : undefined;
    out[id] = run !== undefined ? { at, run } : { at };
  }
  return out;
}

/**
 * 写信任表（写内存 + `saveSettings` 落盘）。内容与现有值一致时**不写、不落盘** ——
 * 改个节奏、停用个工具都会整表重写，没必要每次都惊动 `data.json`。
 * 返回是否真的写了。
 */
export async function writeTrustMap(map: Record<string, DockTrustRecord>): Promise<boolean> {
  const before = JSON.stringify(readTrustMap());
  const after = JSON.stringify(map);
  if (before === after) return false;
  const s = tryGetSettings() as Record<string, unknown>;
  // 设置提供者没注入（纯数据层 / 测试）时只改不到任何东西 —— 与 saveSettings 的静默降级同调
  s[DOCK_TRUST_SETTINGS_KEY] = map;
  await saveSettings();
  return true;
}

// ==================== 内存快照 ====================

let snapshot: DockStoreFile | null = null;

/** 当前快照（未装载时给缺省值 —— 开关缺省开、登记表空，绝不抛） */
export function dockStoreSnapshot(): DockStoreFile {
  return snapshot ?? defaults();
}

/** 是否已装载（自检 / 测试用；正常启动路径不必问） */
export function isDockStoreLoaded(): boolean {
  return snapshot !== null;
}

/** 测试用：清空快照（跨用例隔离） */
export function __resetDockStoreForTests(): void {
  snapshot = null;
}

function store() {
  return jsonFileStore<DockStoreDisk>(dockStorePath(), {
    defaultValue: () => diskFileOf(defaults()),
    // 写前比对：面板开关反复点、台账无变化时不刷 mtime（Syncthing 止血）
    writeIfChanged: true,
  });
}

/**
 * 把各工具的排期状态写回工具目录（谁的状态变了就写谁；内容没变不落盘）。
 *
 * 传 `ids` 只写这几家（调度器记账只动一个工具，没必要把全表重写一遍）。
 * 写失败不抛：内存快照已经更新，进程内照常判据；只是下次装载会退回盘上那份旧状态。
 */
export async function persistToolStates(ids?: readonly string[]): Promise<void> {
  const snap = dockStoreSnapshot();
  const want = ids ? new Set(ids) : null;
  for (const raw of snap.tools) {
    if (!isPlainObject(raw)) continue;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const path = typeof raw.path === 'string' ? raw.path : '';
    if (!id || !path) continue;
    if (want && !want.has(id)) continue;
    const merged = { ...(raw as Record<string, unknown>) };
    const runState = snap.runState[id];
    writeToolState(path, id, toolStateOf({
      ...(merged as DockToolState),
      runState: isPlainObject(runState) ? (runState as DockToolState['runState']) : undefined,
    }));
  }
}

// ==================== 装载与迁移 ====================

/** 迁移产物：`dock.json` 的种子 + 该搬进设置的那份信任 */
export interface DockMigration {
  seed: DockStoreFile;
  trust: Record<string, DockTrustRecord>;
}

/** 从一条老登记项里摘出信任记录（没有则 undefined） */
function trustOfLegacyEntry(raw: unknown): DockTrustRecord | undefined {
  if (!isPlainObject(raw)) return undefined;
  const at = raw.trustedAt;
  if (typeof at !== 'string' || at === '') return undefined;
  const run = typeof raw.trustedRun === 'string' && raw.trustedRun !== '' ? raw.trustedRun : undefined;
  return run !== undefined ? { at, run } : { at };
}

/** 老登记项 → 写进 `dock.json` 的形态（**剥掉信任字段**） */
function stripTrust(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  const copy: Record<string, unknown> = { ...raw };
  delete copy.trustedAt;
  delete copy.trustedRun;
  return copy;
}

/**
 * 从插件设置里摘出老的四把键（**读旧写新删旧**；无一把在就返回 null）。
 *
 * 只改传进来的那个对象（main.ts 的 `loaded`），不落盘 —— 落盘由 main.ts 既有的
 * 「有迁移即 saveSettings」分支统一负责，本函数不抢那把笔。
 */
export function migrateLegacyDockSettings(raw: unknown): DockMigration | null {
  // `loadData()` 在全新 vault（还没有 data.json）上返回 null —— 与其余迁移函数同口径先挡一道
  if (!raw || typeof raw !== 'object') return null;
  const loaded = raw as Record<string, unknown>;
  if (!DOCK_LEGACY_SETTINGS_KEYS.some((k) => k in loaded)) return null;

  const legacyTools = Array.isArray(loaded.dockTools) ? loaded.dockTools : [];
  const trust: Record<string, DockTrustRecord> = {};
  for (const raw of legacyTools) {
    if (!isPlainObject(raw)) continue;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const t = trustOfLegacyEntry(raw);
    if (id && t) trust[id] = t;
  }

  const seed = normalizeDockStore({
    v: DOCK_STORE_VERSION,
    tools: legacyTools.map(stripTrust),
    runState: loaded.dockRunState,
    autoRun: loaded.dockAutoRun,
    notifyMissed: loaded.dockNotifyMissed,
  });

  for (const k of DOCK_LEGACY_SETTINGS_KEYS) delete loaded[k];
  // 信任落设置在 `loaded` 上（main.ts 随后 Object.assign 进 this.settings）—— 与「读旧写新删旧」同一步。
  // 设置里已有 dockTrust 时不整体覆盖（上次迁移的落盘失败后重迁 / 用户恢复了带旧键的备份）：
  // 拿旧登记项的信任盖现有授权，可能复活已撤销的信任、冲掉新授的
  if (Object.keys(trust).length && !(DOCK_TRUST_SETTINGS_KEY in loaded)) loaded[DOCK_TRUST_SETTINGS_KEY] = trust;
  return { seed, trust };
}

/**
 * 索引 + 各工具的 `dock-state.json` → 合并视图。
 *
 * 状态读不到（文件没写过 / 版本不认识 / 工具目录不在）就当这个工具没有排期状态：
 * 缺省即「启用、总闸开、按声明节奏」。不猜、不建。
 */
function hydrate(indexFile: DockStoreFile): DockStoreFile {
  const tools: unknown[] = [];
  // 起点是文件里自带的那份（v1 老文件把台账内嵌在这儿；v2 永远是空的），
  // 再让各工具的 `dock-state.json` 覆盖 —— 早于迁移的那一轮，台账只能从文件里捞出来
  const runState: Record<string, unknown> = { ...indexFile.runState };
  for (const raw of indexFile.tools) {
    if (!isPlainObject(raw)) {
      tools.push(raw);
      continue;
    }
    const id = typeof raw.id === 'string' ? raw.id : '';
    const path = typeof raw.path === 'string' ? raw.path : '';
    if (!id || !path) {
      tools.push(raw);
      continue;
    }
    const state = readToolState(path, id);
    if (state.runState && Object.keys(state.runState).length) runState[id] = state.runState;
    const merged: Record<string, unknown> = { ...raw, ...state };
    delete merged.runState;
    tools.push(merged);
  }
  return { ...indexFile, tools, runState };
}

/**
 * v1 → v2：把内嵌在 `dock.json` 里的排期状态写进各工具目录（返回是否全部写成功）。
 *
 * 顺序有讲究：**先把状态写出去，全部成功才重写 `dock.json`**。反过来的话，一次写入失败
 * 就等于「排期被删了但新文件没生成」—— 用户的规则表和熔断台账凭空消失，且没有副本。
 * 失败时保持 v1 原样，下一次装载再试；已写好的状态文件是幂等的，重写一遍没坏处。
 */
async function splitLegacyState(file: DockStoreFile): Promise<boolean> {
  let allOk = true;
  for (const raw of file.tools) {
    if (!isPlainObject(raw)) continue;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const path = typeof raw.path === 'string' ? raw.path : '';
    if (!id || !path) continue;
    const runState = file.runState[id];
    const state = toolStateOf({
      ...(raw as DockToolState),
      runState: isPlainObject(runState) ? (runState as DockToolState['runState']) : undefined,
    });
    // 空状态也写一份：写成功本身就是「搬家完成」的证据
    if (!writeToolState(path, id, state)) allOk = false;
  }
  return allOk;
}

/**
 * 装载面板数据（插件 onload、每次打开面板与每轮调度 tick 各一次）。
 *
 * `seed` 是迁移种子（老库搬家的那一次）：**只在文件此前不存在**时落盘 ——
 * 文件已存在说明搬过（或用户已经用过面板），任何情况下都不用旧设置覆盖它。
 */
export async function loadDockStore(seed?: DockStoreFile | null): Promise<DockStoreFile> {
  const path = dockStorePath();
  const app = getApp();
  // existed 盘上也算数：onload 跑在 Obsidian 启动扫描完成之前，索引查不到盘上已有的
  // dock.json，只问索引会把「盘上有真数据」误判成「没搬过家」，种子经下面的 write 把真数据整个盖掉
  const existed = !!app.vault.getAbstractFileByPath(path) || (await diskPathExists(app, path));
  const raw = await store().read(); // 文件不存在时由 store 建缺省文件
  const seeded = !existed && !!seed;
  const file = seeded ? (seed as DockStoreFile) : normalizeDockStore(raw);

  // v1 的老文件：内嵌的排期状态拆到各工具目录（ADR-0248），拆成功才重写索引
  const isV1 = !seeded && isPlainObject(raw) && raw.v === 1;
  const next = hydrate(file);
  snapshot = next;
  if (isV1) {
    if (await splitLegacyState(next)) await persistDockStore();
  } else if (seeded) {
    // 种子同样内嵌着排期状态（来自插件设置那四把旧键）：先落状态，再落索引
    await persistToolStates();
    await persistDockStore();
  }
  return next;
}

// ==================== 写入口（唯一） ====================

/**
 * 就地改快照（**同步**）—— 供设置行的三函数绑定用：`set` 改内存、`save` 落盘。
 * 面板数据是「改完立刻可见」的开关，不引入草稿态。
 */
export function setDockStoreMemory(patch: Partial<DockStoreFile>): void {
  snapshot = { ...dockStoreSnapshot(), ...patch, v: DOCK_STORE_VERSION };
}

/** 落盘当前快照的**索引那份**（排期状态走 `persistToolStates`，两者互不代劳） */
export async function persistDockStore(): Promise<void> {
  await enqueueFileTask(dockStorePath(), async () => {
    await store().write(diskFileOf(dockStoreSnapshot()));
  });
}

/** 改并落盘（异步写入口的常规形态） */
export async function mutateDockStore(patch: Partial<DockStoreFile>): Promise<void> {
  setDockStoreMemory(patch);
  await persistDockStore();
}
