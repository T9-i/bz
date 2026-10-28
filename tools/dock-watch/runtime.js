/**
 * 值守进程的**本机状态层** —— 只放「这台机器的这个进程」自己的东西。
 *
 * 调度状态一概不在这里：工具登记、规则、账本全在 vault 里，由 `dock-core.cjs`（同一份内核源码）
 * 读写。这一层只管三样：
 *
 * | 文件 | 谁写 | 作用 |
 * |---|---|---|
 * | `config.json` | 安装脚本 | vault 根 / 拍间隔 / 等网参数 —— 本进程的输入 |
 * | `status.json` | 本进程 | 体检快照（面板读它说「值守在不在、上次拍是什么时候」） |
 * | `watch.lock` | 本进程 | 单实例锁（计划任务可能重复拉起） |
 * | `logs/watch.log` | 本进程 | 日志（只在有事件时写，不复述每一拍） |
 * | `live/<工具id>.jsonl` | 本进程 | **实时步骤**：工具吐的 `[bz-step]`。插件面板轮询它 —— 这是「回看后台跑到第几步」的唯一通道 |
 *
 * 全部住 `%LOCALAPPDATA%\bz-dock-watch\` —— **本机会话态**：不进 vault、不进 git、不跟同步盘走。
 *
 * 上一版这里还有 `lease.json`（「插件在场」的声明，值守看见就让位）。契约 v2 起没有它了：
 * 两个宿主抢的是**同一把执行权锁**（`<数据目录>/dock.lock`），抢不到就这一拍什么都不做。
 * 让位靠自觉，互斥靠锁 —— 后者才是能验证的。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DIRNAME = 'bz-dock-watch';
const CONTRACT_VERSION = 2;
/** 日志超过这个大小就在启动时轮转一次（同名 `.1`，覆盖旧的） */
const LOG_MAX_BYTES = 512 * 1024;

// ==================== 路径 ====================

/**
 * 值守的本机目录。
 *
 * @param env 环境变量（测试传入模拟值）
 * @param vault 给了就返回到**那个库**的状态目录（`<root>/vaults/<key>`）；不给 = 根目录
 */
function watchdogDir(env = process.env, vault = '') {
  const local = String(env.LOCALAPPDATA || '').trim();
  const root = local
    ? path.join(local, DIRNAME)
    : String(env.USERPROFILE || env.HOME || '').trim()
      ? path.join(String(env.USERPROFILE || env.HOME).trim(), 'AppData', 'Local', DIRNAME)
      : DIRNAME;
  const key = vaultKeyOf(vault);
  return key ? path.join(root, 'vaults', key) : root;
}

// ==================== 多 vault 分家 ====================

/**
 * 一个进程只能服务**一个** vault（规则表、账本都在库里，服务谁就得读谁）。
 * 但一个人的机器上常常有多个库 —— 早前所有状态都写在同一层，第二个库装值守时
 * 直接覆盖第一个的 `config.json`：先装的那个库从此再没被值守过，而两边界面都说「正常」。
 *
 * 现在的形状：
 *
 * ```
 * %LOCALAPPDATA%\bz-dock-watch\
 *   active.json          ← 现在服务哪个库（唯一的「谁是当前」指针）
 *   vaults/<key>/        ← 每个库各自的 config / status / logs / live
 *   watch.lock           ← 单实例锁留在根上：一台机器只该有一个值守进程
 * ```
 *
 * `key` 是 vault 绝对路径的 FNV-1a 32 位（8 位十六进制）。用哈希而不是路径片段，
 * 是因为 Windows 路径里的 `\ : * ? " < > |` 和长度都不适合当目录名。
 * **插件侧 `src/dock/watchdog-status.ts` 与 `install.ps1` 必须算出同一个 key**，
 * 三处由 `tests/dock/watchdog-path.test.ts` 钉住。
 */
function normalizeVaultPath(vault) {
  return String(vault || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function vaultKeyOf(vault) {
  const text = normalizeVaultPath(vault);
  if (!text) return '';
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(text, 'utf8')) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 当前进程服务的 vault（`readConfig` 读成功后填上；空 = 老式单层目录） */
let currentVault = '';

function currentVaultOf() {
  return currentVault;
}

/** 显式指定（测试 / 插件侧不用） */
function useVault(vault) {
  currentVault = normalizeVaultPath(vault);
}

function fileOf(name, env = process.env, vault = currentVault) {
  return path.join(watchdogDir(env, vault), name);
}

function logsDir(env = process.env, vault = currentVault) {
  return path.join(watchdogDir(env, vault), 'logs');
}

/** 实时步骤目录（插件侧 `watchdog-status.ts` 必须用同一口径） */
function liveDir(env = process.env, vault = currentVault) {
  return path.join(watchdogDir(env, vault), 'live');
}

/** 「现在服务哪个库」的指针文件（根目录，不属于任何 vault） */
function activeFile(env = process.env) {
  return path.join(watchdogDir(env), 'active.json');
}

/** 读 active.json（读不到/坏 → null） */
function readActive(env = process.env) {
  const raw = readJson(activeFile(env));
  if (!isPlainObject(raw)) return null;
  const vault = normalizeVaultPath(raw.vault);
  if (!vault) return null;
  return { vault, key: vaultKeyOf(vault), at: typeof raw.at === 'string' ? raw.at : '' };
}

/** 单个工具保留的步骤行数。面板只看最近几十条，留 200 够翻一轮了 */
const LIVE_KEEP = 200;

// ==================== 原子读写 ====================

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null; // 不存在 / 坏 JSON —— 一律当没有
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

/** 锁多久没续期就当持有者死了。每拍续一次，10 分钟足够宽（一拍最长可能被等网占 5 分钟） */
const LOCK_STALE_MS = 10 * 60 * 1000;

/**
 * 拿单实例锁。**已有活实例 → 返回 null，调用方直接退出**（计划任务在登录/唤醒时可能拉起两次）。
 *
 * 判据是「锁里的 pid 还活着**并且一直在续期**」，两条缺一不可：
 *  - 只看文件在不在 → 进程崩了不会自己删文件，值守被永久卡死；
 *  - 只看 pid 活不活 → **pid 会被复用**，那台机器上的值守从此起不来，且完全没有症状。
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
 * 读配置。**必须能判出 vault 根**：判不出就不该拍（不知道给哪个工具、往哪读账本），
 * 所以这里返回 null 由调用方明确报错退出 —— 不猜、不回落当前目录。
 *
 * 两个间隔的含义变了（见 `watch.js` 顶部）：
 *  - `intervalMs` = **扫描**间隔：重新读一遍规则表、算出下次到期时刻。定点任务是「到点即醒」，
 *    精度跟它无关；它只决定「别人改了规则表之后多久被看见」。下限 5 秒，防的是配成 0 变成忙等。
 *  - `conditionMs` = **条件**间隔：事件型规则（关闭 Obsidian）看一眼的成本。下限 200 毫秒。
 */
function readConfig(env = process.env) {
  // 两个位置都要认：
  //  1. `active.json` 指向的库 → `vaults/<key>/config.json`（2026-10-28 起的形态，多库互不覆盖）；
  //  2. 根上的 `config.json`（老形态）。**老形态下把 currentVault 留空**，于是 status/logs/live
  //     仍然读写根目录 —— 老安装原地继续工作，不需要「迁移到一半」这种半死状态。
  const active = readActive(env);
  if (active) {
    const perVault = readJson(fileOf('config.json', env, active.vault));
    const raw = perVault ?? readJson(fileOf('config.json', env));
    if (!isPlainObject(raw)) return null;
    const vault = normalizeVaultPath(raw.vault);
    if (!vault) return null;
    // active.json 说 A、config 里写的是 B —— 两个真相互相矛盾，宁可判「读不到」让人重装
    if (vault !== active.vault) return null;
    currentVault = vault;
    return normalizeConfig(raw);
  }

  const raw = readJson(fileOf('config.json', env, ''));
  if (!isPlainObject(raw)) return null;
  const vault = normalizeVaultPath(raw.vault);
  if (!vault) return null;
  currentVault = ''; // 老形态：状态文件仍在根目录
  return normalizeConfig(raw);
}

/** 配置归一（两处入口共用，别再各写一份默认值） */
function normalizeConfig(raw) {
  const intervalMs = Number.isFinite(raw.intervalMs) && raw.intervalMs >= 5000 ? raw.intervalMs : 30000;
  const conditionMs = Number.isFinite(raw.conditionMs) && raw.conditionMs >= 200 ? raw.conditionMs : 1000;
  return {
    v: Number.isFinite(raw.v) ? raw.v : CONTRACT_VERSION,
    vault: normalizeVaultPath(raw.vault),
    intervalMs,
    conditionMs,
    /** 覆盖「插件数据目录」的推导（自定义 Obsidian 配置目录时才用得上） */
    pluginDataPath: typeof raw.pluginDataPath === 'string' ? raw.pluginDataPath.trim() : '',
    /** 可选：等网参数（`net.js` 的 `optionsOf` 读它） */
    net: isPlainObject(raw.net) ? raw.net : undefined,
    /** 本进程的状态目录（诊断 / `--status` 打印；空串 = 老形态的根目录） */
    stateDir: currentVault ? watchdogDir(process.env, currentVault) : watchdogDir(),
  };
}

/** 插件数据目录：`<vault>/.obsidian/plugins/bz/data.json` */
function pluginDataFile(config, pluginId = 'bz') {
  if (config.pluginDataPath) return config.pluginDataPath;
  return path.join(config.vault, '.obsidian', 'plugins', pluginId, 'data.json');
}

/**
 * 读插件设置里值守需要的那几项。
 *
 * 为什么读它而不是复制一份到本机：`storagePath` 与 `dockTrust` 的**唯一真理源**在插件设置里。
 * 抄一份过来就多了一个会过期的副本 —— 用户改了数据目录，值守还在看老地方。
 */
function readPluginData(config) {
  const file = pluginDataFile(config);
  const raw = readJson(file);
  const s = isPlainObject(raw) ? raw : {};
  const trust = isPlainObject(s.dockTrust) ? s.dockTrust : {};
  return {
    file,
    ok: isPlainObject(raw),
    /** 数据目录（相对 vault 根；归一交给 `core.normalizeStorageDir`） */
    storagePath: typeof s.storagePath === 'string' ? s.storagePath : '',
    trust,
  };
}

// ==================== 状态（本进程写、插件读） ====================

/**
 * 合并写状态快照。
 *
 * 两条容易踩的：
 *  1. **`v` 放最后**，否则上一版遗留的 `v: 1` 会一直盖住新契约版本号；
 *  2. **`patch` 里显式的 `undefined` = 这一项现在没有**（比如错误已经恢复）。
 *     不删掉的话旧值会永远挂在面板上 —— 用户会看到一个几小时前的错误，
 *     以为现在还是坏的。这正是「状态文件只增不减」的典型坑。
 */
function writeStatus(patch, env = process.env) {
  const file = fileOf('status.json', env);
  const prev = readJson(file);
  const base = isPlainObject(prev) ? prev : {};
  const next = { ...base, ...patch, v: CONTRACT_VERSION };
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) delete next[key];
  }
  try {
    writeJsonAtomic(file, next);
  } catch (e) {
    log(`status 写失败：${e.message}`);
  }
  return next;
}

/** 工具 id → 实时步骤文件名（id 里可能有 `/` 或 `:`，一律拍平成安全的字符） */
function liveFileOf(toolId, env = process.env) {
  const safe = String(toolId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(liveDir(env), `${safe}.jsonl`);
}

/**
 * 追加一步。
 *
 * 三条约定：
 *  - **换了一轮就重写整个文件**（第一行的 runId 不是这次的，说明上一次的残留）；
 *  - 只追加，不读改写 —— 崩在写一半最多坏最后一行；
 *  - 超过 `LIVE_KEEP` 行就裁尾。裁剪放在追加之后做，裁剪失败不影响这次记录。
 */
function appendLive(toolId, runId, text, env = process.env) {
  const file = liveFileOf(toolId, env);
  const line = JSON.stringify({ runId, at: new Date().toISOString(), text: String(text ?? '') });
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let same = false;
    try {
      const head = fs.readFileSync(file, 'utf8').split('\n')[0];
      same = !!head && JSON.parse(head).runId === runId;
    } catch {
      same = false;
    }
    if (!same) {
      fs.writeFileSync(file, line + '\n');
      return;
    }
    fs.appendFileSync(file, line + '\n');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > LIVE_KEEP) {
      fs.writeFileSync(file, lines.slice(-LIVE_KEEP).join('\n') + '\n');
    }
  } catch {
    /* 实时步骤写不进去不该影响跑工具 —— 它只是「让人看得见」 */
  }
}

module.exports = {
  CONTRACT_VERSION,
  watchdogDir,
  vaultKeyOf,
  normalizeVaultPath,
  currentVaultOf,
  useVault,
  activeFile,
  readActive,
  liveDir,
  liveFileOf,
  appendLive,
  fileOf,
  logsDir,
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
  readPluginData,
  writeStatus,
};
