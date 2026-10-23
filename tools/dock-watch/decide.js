/**
 * 判据装配（离场版）—— 把「该不该跑」要的事实从**文件**里读出来，交给同一份 `ruleDue`（ADR-0242）。
 *
 * 插件侧的对应物是 `data.ts` 的 `loadToolView`：同一批纯函数、同一套口径，只是数据源不同 ——
 * 那边走内存快照（`dock.json` + 各工具的 `dock-state.json`），这边是**直读文件**（没人给它注入 App）。
 * 所以本文件是「装配」，不是「实现」：所有判断规矩（声明怎么读、启动命令怎么解析、信任怎么比对、
 * 规则表怎么生效）全在 `dock-core.cjs` 里，就是插件用的那一份。**这里只许写「取哪些字段、按什么
 * 顺序拼」**，一旦在这里重写某条规则（比如自己判 trustStale），判据就有了第二份实现。
 *
 * 四份事实的来源：
 *   1. `<vault>/.obsidian/plugins/bz/data.json` → `storagePath`（数据目录在哪）与 `dockTrust`（信任）
 *   2. `<vault>/<storagePath>/dock.json`        → **工具索引**（id / path）+ 全域开关（v2，ADR-0248）
 *   3. 各工具目录 `dock-state.json`             → 规则表 / 规则记账 / 熔断台账（bz 写，ADR-0248）
 *   4. 各工具目录 `manifest.json` / `data.json` → 怎么跑 / 参数值
 *
 * **信任在这条路上不打折**：`runSignature` 比对不过（命令改过）或压根没信任过，就不跑 ——
 * 离场执行同样是「在他机器上执行命令」，门槛与面板内一致（ADR-0235 的边界不因没人看着而放宽）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./dock-core.cjs');
const rt = require('./runtime');

/** 数据目录缺省值（与 `src/core/storage.ts` 的 `DEFAULT_STORAGE_DIR` 同口径） */
const DEFAULT_STORAGE_DIR = 'CONFIG/STORAGE';

// ==================== fs 缝：把 node 的 fs 交给 dock-core ====================

core.setDockFs({
  readText(p) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  },
  writeText(p, d) {
    fs.writeFileSync(p, d);
  },
  rename(a, b) {
    fs.renameSync(a, b);
  },
  exists(p) {
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
  unlink(p) {
    fs.unlinkSync(p);
  },
  mkdir(p) {
    try {
      fs.mkdirSync(p, { recursive: true });
    } catch {
      /* 已存在 */
    }
  },
});

// ==================== 插件设置（storagePath / 信任） ====================

function readPluginSettings(config) {
  const raw = rt.readJson(rt.pluginDataFile(config));
  const out = { storagePath: DEFAULT_STORAGE_DIR, trust: {}, existed: rt.isPlainObject(raw) };
  if (!rt.isPlainObject(raw)) return out;
  if (typeof raw.storagePath === 'string' && raw.storagePath.trim()) {
    out.storagePath = raw.storagePath.trim();
  }
  if (rt.isPlainObject(raw.dockTrust)) out.trust = raw.dockTrust;
  out.storagePath = normalizeStorageDir(out.storagePath);
  return out;
}

/** 与 `normalizeStorageDir` 同口径：剥尾斜杠、空则回退缺省 */
function normalizeStorageDir(value) {
  const dir = String(value || DEFAULT_STORAGE_DIR).trim().replace(/\/+$/, '');
  return dir || DEFAULT_STORAGE_DIR;
}

/** `dock.json` 的磁盘路径（vault 内，`storagePath` 相对 vault 根） */
function panelFilePath(config, settings) {
  return path.join(config.vault, settings.storagePath.replace(/[\\/]+$/, ''), 'dock.json');
}

/**
 * `dock.json` 的形状校验 —— 与 `store.ts` 同口径：版本不认识一律当没写过（不猜）。
 *
 * **只认 v2**（ADR-0248：索引 + 开关）。v1 的排期状态还内嵌在文件里，那种文件由插件启动时
 * 迁移成 v2 并把状态拆进各工具目录 —— 值守这边不猜、不迁、不写，宁可这一拍不拍。
 * （插件与值守是同一版装在一起的；只有降级安装才会碰上 v1。）
 *
 * `raw` 一并带出来给写侧用：写回是 `{...raw, ...}` 这种**只改自己那一块**的形式，
 * 文件里本进程不认识的字段（未来版本加的）必须原样留着，不能借着「重整一遍」把它们删掉。
 */
function readPanel(config, settings) {
  const file = panelFilePath(config, settings);
  const raw = rt.readJson(file);
  if (!rt.isPlainObject(raw) || raw.v !== 2) {
    return { file, ok: false, raw: null, autoRun: true, watchdog: true, tools: [] };
  }
  return {
    file,
    ok: true,
    raw,
    // 两个开关缺省都是「开」（键缺失/形态不对即开），与插件侧一字不差
    autoRun: raw.autoRun !== false,
    watchdog: raw.watchdog !== false,
    tools: Array.isArray(raw.tools) ? raw.tools : [],
  };
}

/** 写回索引（只改自己那一块）—— 调用方保证此刻插件没在拍 */
function writePanel(panel, next) {
  if (!panel.ok) throw new Error(`dock.json 不可用（${panel.file}），拒绝写回`);
  rt.writeJsonAtomic(panel.file, next);
}

// ==================== 工具视图（loadToolView 的离场版） ====================

/**
 * 一次把全部工具读出来。返回的每个 view 是插件 `DockToolView` 的**子集**，字段名保持一致 ——
 * 名字一致才能在脑子里对照两处，也能在写测试时直接照抄插件那边的期望值。
 *
 * 排期状态（规则表 / 记账 / 台账 / 停用与总闸）在**各工具目录的 `dock-state.json`** 里
 * （ADR-0248）：这里逐工具读一遍再并到 entry 上，与插件 `hydrate()` 做的事一样。
 */
function loadTools(config, settings, panel) {
  const entries = core.parseToolEntries(panel.tools);
  return entries.map((index) => {
    const entry = { ...index, ...core.readToolState(index.path, index.id) };
    const decl = core.readDeclaration(entry.path);
    const manifest = decl.manifest || null;
    const declPath = decl.path || entry.path;
    const run = core.resolveRun(manifest, declPath, decl.conventionalRun);

    // 信任：与 `loadToolView` 同一段逻辑。没记过签名（`trustedRun` 缺）按过期算 ——
    // 那是 ADR-0239 之前的老记录，无从比对就不该替用户认下这条命令
    const t = rt.isPlainObject(settings.trust[entry.id]) ? settings.trust[entry.id] : null;
    const trustedAt = t && typeof t.at === 'string' ? t.at : '';
    const trustedRun = t && typeof t.run === 'string' ? t.run : undefined;
    const trustStale = !!trustedAt && (run ? core.runSignature(run) : undefined) !== trustedRun;

    const declared = manifest ? manifest.schedule : undefined;
    const override = entry.scheduleOverride ? core.parseSchedule(entry.scheduleOverride) : undefined;
    const rules = core.effectiveRules(entry.rules, override, declared);

    return {
      id: entry.id,
      name: (manifest && manifest.name) || entry.id,
      entry,
      manifest,
      declPath,
      run,
      trusted: !!trustedAt,
      trustStale,
      values: core.readSettings(declPath, entry.id),
      rules,
      ruleFiredAt: firedAtMs(entry.ruleState),
      runState: rt.isPlainObject(entry.runState) ? entry.runState : undefined,
    };
  });
}

/** 规则记账（ISO 串 → ms）；解析不出的条目丢掉，不让它污染判据（同插件 `firedAtMapOf`） */
function firedAtMs(ruleState) {
  const out = {};
  const parsed = core.parseRuleState(ruleState) || {};
  for (const [ruleId, v] of Object.entries(parsed)) {
    const t = v && v.lastFiredAt ? Date.parse(v.lastFiredAt) : NaN;
    if (Number.isFinite(t)) out[ruleId] = t;
  }
  return out;
}

/**
 * 记录里还有一轮挂着 `running` 且心跳没停吗（与插件 ADR-0250 / 0251 同一口径）。
 *
 * 值守自己的 `inFlight` 只认得**本进程**拉起的那些 —— 插件点的那一轮它看不见，
 * 被硬杀的上一条残骸也看不见。记录是两边都能读的事实，所以问它。
 */
function hasFreshRunning(view, now) {
  const raw = core.readRunsText(view.declPath);
  if (raw === null) return false;
  const file = core.parseRunsFileText(raw, view.id);
  if (!file || !Array.isArray(file.runs)) return false;
  return core.offlineRunningOf(file.runs, file.updatedAt, now) !== null;
}

// ==================== 门槛（与调度器 runGate 同顺序、同原因） ====================

/**
 * 「跑」这条动作的硬门槛。**顺序即原因优先级**，与 `scheduler.ts` 的 `runGate` 逐条对齐 ——
 * 两处不一致会表现为「同一个工具在面板里能自动跑、关掉 Obsidian 却不跑」，最难查的那种。
 *
 * 与插件版的差异只有两处，都是值守自己的运行时事实：
 *  - `inFlight`：本进程内正在跑（插件那边是它自己的会话锁）；
 *  - `cooldownUntil`：本进程自己记的失败冷却（插件的冷却也是内存态，两边各记各的）。
 */
function runGate(view, flags) {
  if (view.entry.enabled === false) return 'disabled';
  if (!view.trusted) return 'untrusted';
  if (view.trustStale) return 'trust-stale';
  if (!view.run) return 'no-run';
  if (view.runState && view.runState.pausedAt) return 'paused';
  if (flags.inFlight) return 'running';
  // 另一个进程（插件 / 上一拍）拉起的那一轮还在跑：记录里挂着 running，且 90 秒内还在动
  if (hasFreshRunning(view, flags.now)) return 'running';
  if (flags.cooldownUntil && flags.cooldownUntil > flags.now) return 'cooldown';
  if (core.missingRequiredParams(view.manifest ? view.manifest.params : undefined, view.values).length > 0) {
    return 'params';
  }
  return null;
}

// ==================== data-threshold 的读值 ====================

/**
 * 从 vault 里一个 json 文件读某个键的数值（支持 `a.b.c` 点路径）。读不到就 undefined ——
 * 判不出就不跑（同调度器 `readJsonNumber` 的口径与理由）。
 */
function readJsonNumber(config, vaultPath, key) {
  try {
    const raw = fs.readFileSync(path.join(config.vault, vaultPath), 'utf8');
    const v = String(key)
      .split('.')
      .reduce((o, k) => (rt.isPlainObject(o) ? o[k] : undefined), JSON.parse(raw));
    return typeof v === 'number' ? v : undefined;
  } catch {
    return undefined;
  }
}

module.exports = {
  DEFAULT_STORAGE_DIR,
  readPluginSettings,
  panelFilePath,
  readPanel,
  writePanel,
  loadTools,
  runGate,
  readJsonNumber,
};
