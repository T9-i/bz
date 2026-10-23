/**
 * 值守进程的本机状态层 —— 路径、原子写、单实例锁、五份状态文件（ADR-0242）。
 *
 * 全部住 `%LOCALAPPDATA%\bz-dock-watch\`（**本机会话态**：不进 vault、不进 git、不跟同步盘走）。
 *
 * | 文件 | 谁写 | 作用 |
 * |---|---|---|
 * | `config.json` | 安装脚本 | vault 根 / 拍间隔 —— 本进程的输入 |
 * | `lease.json` | **bz 插件** | 「插件在场」的声明；本进程读它决定让位 |
 * | `status.json` | 本进程 | 每拍刷新的体检快照（插件面板读它画卡片） |
 * | `pending.json` | 本进程追加 | 离线跑过什么；插件首次打开面板时弹一次简报，读完即删 |
 * | `watch.lock` | 本进程 | 单实例锁（计划任务有可能重复拉起） |
 * | `logs/watch.log` | 本进程 | 值守日志（只在有事件时写，不复述每一拍） |
 *
 * **路径推导必须与插件侧逐字同口径**（`src/dock/watchdog.ts` 的 `watchdogDirOf`）：
 * 两边对不上，租约谁也看不见谁 —— 那正是「两个调度者同时拍、记录翻倍」的现场。
 * 所以这里用 `LOCALAPPDATA`，取不到按 `USERPROFILE\AppData\Local` 拼，与那边一字不差。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DIRNAME = 'bz-dock-watch';
const CONTRACT_VERSION = 1;
/** 队列上限：留得下「很久没开机」的账，也不至于让一个文件无限长 */
const QUEUE_LIMIT = 200;
/** 日志超过这个大小就在启动时轮转一次（同名 `.1`，覆盖旧的） */
const LOG_MAX_BYTES = 512 * 1024;
/**
 * 锁的保鲜期 —— **必须配合「每拍续期」用**（`touchLock`）。见 `acquireLock` 里为什么光看 pid 不够。
 */
const LOCK_STALE_MS = 5 * 60 * 1000;

// ==================== 路径 ====================

function watchdogDir(env = process.env) {
  const local = String(env.LOCALAPPDATA || '').trim();
  if (local) return path.join(local, DIRNAME);
  const home = String(env.USERPROFILE || env.HOME || '').trim();
  if (home) return path.join(home, 'AppData', 'Local', DIRNAME);
  // 最后一级回落（非 Windows 的无家目录环境）：两侧都落到**各自的 cwd**，租约对不上 ——
  // 也就是失去互斥。这里仍然不抛，是因为它同时是「读 config.json」的路径来源：
  // 真到这一步会先在 readConfig 那里报「读不到配置」，比抛一个路径异常更好懂。
  return DIRNAME;
}

function fileOf(name, env = process.env) {
  return path.join(watchdogDir(env), name);
}

function logsDir(env = process.env) {
  return path.join(watchdogDir(env), 'logs');
}

/**
 * 路径归一 —— **只用于比较**（Windows 大小写不敏感、两种分隔符混用）。
 * 插件那边给的 vault 路径与安装脚本写下的未必同形，直接 `===` 会误判成「不是同一个 vault」。
 */
function normalizePath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

// ==================== 原子读写 ====================

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null; // 不存在 / 坏 JSON —— 一律当没有（同插件侧读侧口径）
  }
}

/** tmp + rename：任何时候被打断，读到的都是「旧的完整版」而不是半截 JSON */
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// ==================== 日志 ====================

let logCount = 0;

function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    const file = path.join(logsDir(), 'watch.log');
    // 每 200 条看一次大小（够及时，也不必每拍都 stat）
    if (logCount++ % 200 === 0) rollLog(file);
    fs.appendFileSync(file, text);
  } catch {
    /* 日志写不进去不该让值守停摆 */
  }
  if (process.env.BZ_DOCK_WATCH_VERBOSE) process.stdout.write(text);
}

function rollLog(file) {
  try {
    if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    /* 文件不在 / 改不动 —— 都无所谓 */
  }
}

// ==================== 单实例锁 ====================

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = 进程在但不许我发信号（Windows 常见）；ESRCH = 真没了
    return e && e.code === 'EPERM';
  }
}

/**
 * 拿单实例锁。**已有活实例 → 返回 null，调用方直接退出**（计划任务在登录/唤醒时可能拉起两次，
 * 两个都拍就会重复跑）。
 *
 * 判据是「锁里的 pid 还活着**并且一直在续期**」，两条缺一不可：
 *  - 只看文件在不在 → 进程崩了不会自己删文件，值守被永久卡死；
 *  - 只看 pid 活不活 → **pid 会被复用**（旧实例崩了，pid 被系统发给别的进程），
 *    那台机器上的值守从此起不来，且完全没有症状。
 * 所以真实例每拍 `touchLock` 续一次，陈旧的 `at` 就等于「那个 pid 已经不是我们的同类」。
 */
function acquireLock() {
  const file = fileOf('watch.lock');
  const prev = readJson(file);
  if (isPlainObject(prev) && isProcessAlive(prev.pid)) {
    const at = Date.parse(prev.at);
    if (Number.isFinite(at) && Date.now() - at <= LOCK_STALE_MS) return null;
  }
  writeJsonAtomic(file, { pid: process.pid, at: new Date().toISOString() });
  return file;
}

/** 续期（每拍调一次）—— 别人据此分辨「这个 pid 还是那个值守」还是「pid 被别人拿去了」 */
function touchLock(file) {
  if (!file) return;
  const cur = readJson(file);
  if (isPlainObject(cur) && cur.pid !== process.pid) return; // 已被接管，别抢回来
  try {
    writeJsonAtomic(file, { pid: process.pid, at: new Date().toISOString() });
  } catch {
    /* 写不进去不碍这一拍 */
  }
}

function releaseLock(file) {
  if (!file) return;
  const cur = readJson(file);
  if (isPlainObject(cur) && cur.pid !== process.pid) return; // 已被别人接管，别乱删
  try {
    fs.unlinkSync(file);
  } catch {
    /* 已经不在就算了 */
  }
}

// ==================== 配置（安装脚本写） ====================

/**
 * 读配置。**必须能判出 vault 根**：判不出就不该拍（不知道给哪个工具、往哪写记录），
 * 所以这里返回 null 由调用方明确报错退出 —— 不猜、不回落当前目录。
 */
function readConfig(env = process.env) {
  const raw = readJson(fileOf('config.json', env));
  if (!isPlainObject(raw)) return null;
  const vault = String(raw.vault || '').trim();
  if (!vault) return null;
  const intervalMs = Number.isFinite(raw.intervalMs) && raw.intervalMs >= 5000 ? raw.intervalMs : 30000;
  return {
    v: Number.isFinite(raw.v) ? raw.v : CONTRACT_VERSION,
    vault,
    intervalMs,
    /** 覆盖「插件数据目录」的推导（自定义 Obsidian 配置目录时才用得上） */
    pluginDataPath: typeof raw.pluginDataPath === 'string' ? raw.pluginDataPath.trim() : '',
    /**
     * 可选：等网参数（`net.js` 的 `optionsOf` 读它）。缺省整块不写，全用那边的 DEFAULTS ——
     * 老安装的 `config.json` 里没有这一段，不该因此要求用户重装。
     */
    net: isPlainObject(raw.net) ? raw.net : undefined,
  };
}

/** 插件数据目录：`<vault>/.obsidian/plugins/bz/data.json` 所在的那一层 */
function pluginDataFile(config, pluginId = 'bz') {
  if (config.pluginDataPath) return config.pluginDataPath;
  return path.join(config.vault, '.obsidian', 'plugins', pluginId, 'data.json');
}

// ==================== 租约（bz 插件写、本进程读） ====================

function readLease(env = process.env) {
  const raw = readJson(fileOf('lease.json', env));
  if (!isPlainObject(raw) || raw.v !== CONTRACT_VERSION) return null;
  if (typeof raw.at !== 'string') return null;
  return raw;
}

/**
 * 插件此刻是不是**在这个 vault 上**值守。
 *
 * 三个条件缺一不可：
 *  1. `owner` 是 `bz-plugin`（不认别人的租约）；
 *  2. 写入的那个 pid 还活着（进程在 = 插件的调度器在拍，它是权威）；
 *  3. 租约里的 vault 与本进程服务的 vault **是同一个** —— 否则会出这种事：用户在 vault A
 *     开着 Obsidian，值守进程配的是 vault B，B 的规则被 A 的插件「让位」掉，整天不跑。
 *
 * pid 判不出来（0 / 字段缺失）时退回时间戳：TTL 取三拍，容一次拍慢。
 */
function leaseHeldByPlugin(lease, config, intervalMs, env = process.env) {
  if (!isPlainObject(lease)) return false;
  if (lease.owner !== 'bz-plugin') return false;
  const leaseVault = normalizePath(lease.vault);
  if (leaseVault && leaseVault !== normalizePath(config.vault)) return false;
  const at = Date.parse(lease.at);
  if (!Number.isFinite(at)) return false;
  const tick = Number.isFinite(lease.tickMs) && lease.tickMs > 0 ? lease.tickMs : 60000;
  const fresh = Date.now() - at <= Math.min(Math.max(tick * 3, intervalMs * 3), 5 * 60000);
  if (!fresh) return false;
  // pid 判得出就用它（更硬：插件正常关闭时 pid 立刻消失，不必等 TTL）
  if (Number.isInteger(lease.pid) && lease.pid > 0) return isProcessAlive(lease.pid);
  return true;
}

// ==================== 状态（本进程写、插件读） ====================

function writeStatus(patch, env = process.env) {
  const file = fileOf('status.json', env);
  const prev = readJson(file);
  const base = isPlainObject(prev) ? prev : {};
  const next = { v: CONTRACT_VERSION, ...base, ...patch };
  try {
    writeJsonAtomic(file, next);
  } catch (e) {
    log(`status 写失败：${e.message}`);
  }
  return next;
}

// ==================== 待播报队列（本进程追加、插件读它弹简报后删） ====================

function readQueue(env = process.env) {
  const raw = readJson(fileOf('pending.json', env));
  if (!isPlainObject(raw) || !Array.isArray(raw.items)) return [];
  return raw.items;
}

/** 追加一条。超上限丢**最旧**的（新账比旧账有用）。读-改-写全程同步，单实例下无并发。 */
function appendQueue(note, env = process.env) {
  const file = fileOf('pending.json', env);
  const items = readQueue(env);
  items.push(note);
  const trimmed = items.slice(-QUEUE_LIMIT);
  try {
    writeJsonAtomic(file, { v: CONTRACT_VERSION, items: trimmed });
  } catch (e) {
    log(`pending 写失败：${e.message}`);
  }
}

module.exports = {
  CONTRACT_VERSION,
  watchdogDir,
  fileOf,
  logsDir,
  normalizePath,
  readJson,
  writeJsonAtomic,
  isPlainObject,
  log,
  isProcessAlive,
  acquireLock,
  touchLock,
  releaseLock,
  readConfig,
  pluginDataFile,
  readLease,
  leaseHeldByPlugin,
  writeStatus,
  readQueue,
  appendQueue,
};
