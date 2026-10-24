/**
 * 契约解析 —— **全部是纯函数，永不抛**。
 *
 * 纪律：**脏的那一条丢掉，不连累其余**。工具目录、`dock.json` 都是人能手改的文本，
 * 写坏了必须让面板照常打开，只在那一处显示「这条读不出来」。
 *
 * 另一条：**不认识就不猜**。版本号不对、字段形状不对，一律当没有 —— 不回落默认值凑合。
 * 凑合出来的东西会比缺失更难查（上一版「照着旧缓存渲染出早就删掉的参数」就是这个味道）。
 */

import {
  CONTRACT_VERSION,
  INTENT_VERSION,
  REGISTRY_VERSION,
  RUNTIME_VERSION,
  SETTINGS_VERSION,
  TOOL_ID_MAX_LEN,
  TOOL_ID_RE,
  type DockAction,
  type DockEntry,
  type DockErrorKind,
  type DockIntent,
  type DockManifest,
  type DockParam,
  type DockParamType,
  type DockRegistry,
  type DockRegistryEntry,
  type DockRule,
  type DockRuleRuntime,
  type DockRunFacts,
  type DockRunRecord,
  type DockRunStep,
  type DockRuntime,
  type DockTrigger,
} from './types';

// ==================== 基础 ====================

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s === '' ? undefined : s;
}

function num(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const n = Math.floor(v);
  return n < min || n > max ? undefined : n;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/** 合法 JSON 对象 → 对象；否则 null */
export function parseJsonObjectText(text: string | null | undefined): Record<string, unknown> | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    const v = JSON.parse(text) as unknown;
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** 合法 JSON 数组 → 数组；否则 null */
export function parseJsonArrayText(text: string | null | undefined): unknown[] | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** 工具 id 是否合法 */
export function isToolId(v: unknown): v is string {
  return typeof v === 'string' && v.length <= TOOL_ID_MAX_LEN && TOOL_ID_RE.test(v);
}

// ==================== 参数表 ====================

const PARAM_TYPES: readonly DockParamType[] = [
  'text',
  'number',
  'bool',
  'choice',
  'path',
  'secret',
  'multiline',
  'multichoice',
];

function parseParam(raw: unknown): DockParam | null {
  if (!isObj(raw)) return null;
  const key = str(raw.key);
  if (!key || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return null;
  const type = PARAM_TYPES.includes(raw.type as DockParamType) ? (raw.type as DockParamType) : 'text';
  const out: DockParam = { key, type };
  const label = str(raw.label);
  if (label) out.label = label;
  const hint = str(raw.hint);
  if (hint) out.hint = hint;
  const req = bool(raw.required);
  if (req !== undefined) out.required = req;
  if (raw.default !== undefined && (typeof raw.default === 'string' || typeof raw.default === 'number' || typeof raw.default === 'boolean' || Array.isArray(raw.default))) {
    out.default = raw.default as DockParam['default'];
  }
  if (Array.isArray(raw.options)) {
    const opts = raw.options.filter((o): o is string => typeof o === 'string');
    if (opts.length) out.options = opts;
  }
  // choice / multichoice 没有候选就没法选 —— 整条丢，别渲染一个空下拉
  if ((type === 'choice' || type === 'multichoice') && !out.options) return null;
  return out;
}

export function parseParams(raw: unknown): DockParam[] {
  if (!Array.isArray(raw)) return [];
  const out: DockParam[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const p = parseParam(item);
    if (!p || seen.has(p.key)) continue;
    seen.add(p.key);
    out.push(p);
  }
  return out;
}

// ==================== 启动方式 ====================

export function parseEntry(raw: unknown): DockEntry | null {
  if (!isObj(raw)) return null;
  const cmd = str(raw.cmd);
  if (!cmd) return null;
  const out: DockEntry = { cmd };
  if (Array.isArray(raw.args)) {
    const args = raw.args.filter((a): a is string => typeof a === 'string');
    if (args.length) out.args = args;
  }
  const cwd = str(raw.cwd);
  if (cwd) out.cwd = cwd;
  const shell = bool(raw.shell);
  if (shell !== undefined) out.shell = shell;
  return out;
}

// ==================== 声明 ====================

export function parseManifest(raw: unknown): DockManifest | null {
  if (!isObj(raw)) return null;
  if (raw.v !== CONTRACT_VERSION) return null;
  if (!isToolId(raw.id)) return null;
  const name = str(raw.name);
  if (!name) return null;
  const out: DockManifest = { v: CONTRACT_VERSION, id: raw.id, name };
  const desc = str(raw.description);
  if (desc) out.description = desc;
  const icon = str(raw.icon);
  if (icon) out.icon = icon;
  const entry = parseEntry(raw.entry);
  if (entry) out.entry = entry;
  const params = parseParams(raw.params);
  if (params.length) out.params = params;
  const rules = parseRules(raw.defaultRules);
  if (rules.length) out.defaultRules = rules;
  return out;
}

// ==================== 规则 ====================

/** "HH:MM" → 当天第几秒；解析不出 undefined */
export function atSecondsOf(at: string | undefined): number | undefined {
  if (!at) return undefined;
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(at.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return undefined;
  return h * 3600 + mi * 60;
}

function parseTrigger(raw: unknown): DockTrigger | null {
  if (!isObj(raw)) return null;
  switch (raw.kind) {
    case 'daily': {
      const at = str(raw.at);
      const sec = atSecondsOf(at);
      if (sec === undefined) return null;
      const h = String(Math.floor(sec / 3600)).padStart(2, '0');
      const mi = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      return { kind: 'daily', at: `${h}:${mi}` };
    }
    case 'interval': {
      const m = num(raw.everyMin, 1, 43200);
      return m === undefined ? null : { kind: 'interval', everyMin: m };
    }
    case 'on-launch': {
      const m = num(raw.delayMin, 0, 1440);
      return m === undefined ? null : { kind: 'on-launch', delayMin: m };
    }
    case 'panel-open':
      return { kind: 'panel-open' };
    case 'tool-ok': {
      const id = str(raw.toolId);
      return id ? { kind: 'tool-ok', toolId: id } : null;
    }
    case 'tool-fail': {
      const id = str(raw.toolId);
      return id ? { kind: 'tool-fail', toolId: id } : null;
    }
    case 'domain-event': {
      const ch = str(raw.channel);
      return ch ? { kind: 'domain-event', channel: ch } : null;
    }
    case 'file-change': {
      const t = str(raw.target);
      return t ? { kind: 'file-change', target: t.replace(/\/+$/, '') } : null;
    }
    case 'value-threshold': {
      const op = raw.op;
      if (op !== '>' && op !== '<' && op !== '=') return null;
      const value = raw.value;
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      const path = str(raw.path);
      const key = str(raw.key);
      if (!path || !key) return null;
      return { kind: 'value-threshold', path, key, op, value };
    }
    default:
      return null;
  }
}

function parseAction(raw: unknown): DockAction {
  if (!isObj(raw)) return { kind: 'run' };
  return raw.kind === 'remind' ? { kind: 'remind' } : { kind: 'run' };
}

export function parseRule(raw: unknown): DockRule | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const trigger = parseTrigger(raw.trigger);
  if (!trigger) return null;
  const out: DockRule = { id, trigger, action: parseAction(raw.action) };
  const name = str(raw.name);
  if (name) out.name = name;
  const enabled = bool(raw.enabled);
  if (enabled !== undefined) out.enabled = enabled;
  const jitter = num(raw.jitterMin, 0, 720);
  if (jitter !== undefined) out.jitterMin = jitter;
  return out;
}

export function parseRules(raw: unknown): DockRule[] {
  if (!Array.isArray(raw)) return [];
  const out: DockRule[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const r = parseRule(item);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** 新规则 id（本机唯一即可；带时间前缀便于排序） */
export function newRuleId(now: number = Date.now()): string {
  return `r${now.toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
}

/**
 * 一次运行的工单号 —— **bz 生成、注入给工具、写进记录**，对账全靠它。
 * 格式 `r<毫秒36>-<随机>`：同一毫秒内撞不上，字典序大致就是时间序。
 */
export function makeRunId(now: number = Date.now()): string {
  return `r${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ==================== 意图 / 事实 ====================

export function emptyIntent(tool: string): DockIntent {
  return { v: INTENT_VERSION, tool };
}

export function parseIntent(raw: unknown, toolId: string): DockIntent {
  if (!isObj(raw) || raw.v !== INTENT_VERSION || raw.tool !== toolId) return emptyIntent(toolId);
  const out = emptyIntent(toolId);
  const enabled = bool(raw.enabled);
  if (enabled !== undefined) out.enabled = enabled;
  const auto = bool(raw.autoRun);
  if (auto !== undefined) out.autoRun = auto;
  const rules = parseRules(raw.rules);
  if (rules.length) out.rules = rules;
  return out;
}

function parseRuleRuntime(raw: unknown): DockRuleRuntime | null {
  if (!isObj(raw)) return null;
  const out: DockRuleRuntime = {};
  const lastFired = str(raw.lastFiredAt);
  if (lastFired) out.lastFiredAt = lastFired;
  const lastRunId = str(raw.lastRunId);
  if (lastRunId) out.lastRunId = lastRunId;
  const lastStatus = str(raw.lastStatus);
  if (lastStatus) out.lastStatus = lastStatus as DockRuleRuntime['lastStatus'];
  if (isObj(raw.pending)) {
    const runId = str(raw.pending.runId);
    const dueAt = str(raw.pending.dueAt);
    const claimedAt = str(raw.pending.claimedAt);
    if (runId && dueAt && claimedAt) {
      const pending: NonNullable<DockRuleRuntime['pending']> = { runId, dueAt, claimedAt };
      const startedAt = str(raw.pending.startedAt);
      if (startedAt) pending.startedAt = startedAt;
      const attempts = num(raw.pending.attempts, 0, 1000);
      if (attempts) pending.attempts = attempts;
      out.pending = pending;
    }
  }
  return Object.keys(out).length ? out : null;
}

function parseRunFacts(raw: unknown): DockRunFacts | null {
  if (!isObj(raw)) return null;
  const out: DockRunFacts = {};
  const at = str(raw.lastAttemptAt);
  if (at) out.lastAttemptAt = at;
  const ok = bool(raw.lastAttemptOk);
  if (ok !== undefined) out.lastAttemptOk = ok;
  const fails = num(raw.consecutiveFailures, 0, 1000);
  if (fails) out.consecutiveFailures = fails;
  const paused = str(raw.pausedAt);
  if (paused) out.pausedAt = paused;
  return Object.keys(out).length ? out : null;
}

export function emptyRuntime(tool: string): DockRuntime {
  return { v: RUNTIME_VERSION, tool };
}

export function parseRuntime(raw: unknown, toolId: string): DockRuntime {
  if (!isObj(raw) || raw.v !== RUNTIME_VERSION || raw.tool !== toolId) return emptyRuntime(toolId);
  const out = emptyRuntime(toolId);
  const updatedAt = str(raw.updatedAt);
  if (updatedAt) out.updatedAt = updatedAt;
  if (isObj(raw.rules)) {
    const rules: Record<string, DockRuleRuntime> = {};
    for (const [id, v] of Object.entries(raw.rules)) {
      const r = parseRuleRuntime(v);
      if (r) rules[id] = r;
    }
    if (Object.keys(rules).length) out.rules = rules;
  }
  const run = parseRunFacts(raw.run);
  if (run) out.run = run;
  return out;
}

// ==================== 登记表 ====================

function parseRegistryEntry(raw: unknown): DockRegistryEntry | null {
  if (!isObj(raw)) return null;
  if (!isToolId(raw.id)) return null;
  const path = str(raw.path);
  if (!path) return null;
  return { id: raw.id, path };
}

export function emptyRegistry(): DockRegistry {
  // watchdog 缺省 false：本版不提供离场调度，默认别谎称「开着」
  return { v: REGISTRY_VERSION, tools: [], autoRun: true, watchdog: false, notifyMissed: true };
}

export function parseRegistry(raw: unknown): { registry: DockRegistry; errors: string[] } {
  const errors: string[] = [];
  const base = emptyRegistry();
  if (!isObj(raw)) {
    if (raw !== null && raw !== undefined) errors.push('登记表不是 JSON 对象，已按空处理');
    return { registry: base, errors };
  }
  if (raw.v !== REGISTRY_VERSION) {
    errors.push(`登记表版本是 ${String(raw.v)}，本版认 ${REGISTRY_VERSION} —— 已按空处理`);
    return { registry: base, errors };
  }
  const tools: DockRegistryEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.tools)) {
    for (const item of raw.tools) {
      const e = parseRegistryEntry(item);
      if (!e) continue;
      if (seen.has(e.id)) {
        errors.push(`登记表里有重复的 id：${e.id}（只留第一条）`);
        continue;
      }
      seen.add(e.id);
      tools.push(e);
    }
  }
  const autoRun = bool(raw.autoRun);
  const watchdog = bool(raw.watchdog);
  const notifyMissed = bool(raw.notifyMissed);
  return {
    registry: {
      v: REGISTRY_VERSION,
      tools,
      autoRun: autoRun ?? true,
      watchdog: watchdog ?? false,
      notifyMissed: notifyMissed ?? true,
    },
    errors,
  };
}

// ==================== 运行记录 ====================

function parseStep(raw: unknown): DockRunStep | null {
  if (!isObj(raw)) return null;
  const text = str(raw.text);
  if (!text) return null;
  const at = str(raw.at) ?? new Date(0).toISOString();
  const status = raw.status === 'failed' ? 'failed' : 'ok';
  return { text, at, status };
}

/**
 * 一行文本 → 一条记录。缺 `runId` 或 `status` 就丢 —— 这两项是判定与对账的全部依据，
 * 缺了这条记录对 bz 而言没有任何用处。
 */
export function parseRunRecord(raw: unknown, expectTool?: string): DockRunRecord | null {
  if (!isObj(raw)) return null;
  const runId = str(raw.runId);
  const status = str(raw.status);
  if (!runId || !status) return null;
  if (expectTool && raw.tool !== undefined && raw.tool !== expectTool) return null;
  const STATUSES = ['ok', 'failed', 'timeout', 'stopped', 'abandoned', 'running'];
  if (!STATUSES.includes(status)) return null;
  const startedAt = str(raw.startedAt) ?? new Date(0).toISOString();
  const out: DockRunRecord = {
    runId,
    tool: str(raw.tool) ?? expectTool ?? '',
    trigger: raw.trigger === 'auto' ? 'auto' : 'manual',
    status: status as DockRunRecord['status'],
    startedAt,
  };
  const finishedAt = str(raw.finishedAt);
  if (finishedAt) out.finishedAt = finishedAt;
  if (typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)) out.durationMs = raw.durationMs;
  if (typeof raw.exitCode === 'number' || raw.exitCode === null) out.exitCode = raw.exitCode as number | null;
  const message = str(raw.message);
  if (message) out.message = message;
  if (isObj(raw.error)) {
    const kind = str(raw.error.kind);
    const KINDS: readonly DockErrorKind[] = ['auth', 'network', 'config', 'timeout', 'aborted', 'unknown'];
    const picked: DockErrorKind = kind && (KINDS as readonly string[]).includes(kind) ? (kind as DockErrorKind) : 'unknown';
    out.error = { kind: picked, detail: str(raw.error.detail), stderr: str(raw.error.stderr) };
  }
  if (Array.isArray(raw.steps)) {
    const steps = raw.steps.map(parseStep).filter((s): s is DockRunStep => s !== null);
    if (steps.length) out.steps = steps;
  }
  if (Array.isArray(raw.info)) out.info = raw.info;
  if (raw.result !== undefined) out.result = raw.result;
  if (isObj(raw.metrics)) {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.metrics)) {
      if (typeof v === 'number' && Number.isFinite(v)) m[k] = v;
    }
    if (Object.keys(m).length) out.metrics = m;
  }
  if (Array.isArray(raw.artifacts)) {
    const a = raw.artifacts
      .filter((x): x is Record<string, unknown> => isObj(x) && typeof x.path === 'string')
      .map((x) => ({ path: String(x.path), label: typeof x.label === 'string' ? x.label : undefined }));
    if (a.length) out.artifacts = a;
  }
  return out;
}

/** 一段 JSON Lines → 记录数组（坏行跳过，不抛） */
export function parseRunLines(text: string | null | undefined, expectTool?: string): DockRunRecord[] {
  if (!text) return [];
  const out: DockRunRecord[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = parseRunRecord(JSON.parse(t) as unknown, expectTool);
      if (rec) out.push(rec);
    } catch {
      /* 坏行跳过 */
    }
  }
  return out;
}

/** 按 runId 精确找一条（**唯一权威的对账方式**） */
export function findByRunId(records: readonly DockRunRecord[], runId: string): DockRunRecord | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].runId === runId) return records[i];
  }
  return undefined;
}

/** 最近一条（按 startedAt，不看文件顺序） */
export function latestRun(records: readonly DockRunRecord[]): DockRunRecord | undefined {
  let best: DockRunRecord | undefined;
  let bestAt = -Infinity;
  for (const r of records) {
    const t = Date.parse(r.startedAt);
    if (!Number.isFinite(t)) continue;
    if (t >= bestAt) {
      bestAt = t;
      best = r;
    }
  }
  return best;
}

// ==================== 参数值 ====================

/**
 * 参数值文件。`null` = 文件不存在（**唯一**表示「还没填过」）；
 * `{}` = 文件在但无效（坏 JSON / 版本不对 / tool 串台）—— 两种情况在 UI 上说法不同。
 */
export function parseSettingsText(text: string | null | undefined, toolId: string): Record<string, unknown> | null {
  if (text === null || text === undefined) return null;
  const raw = parseJsonObjectText(text);
  if (!raw) return {};
  if (raw.v !== SETTINGS_VERSION || raw.tool !== toolId) return {};
  return isObj(raw.values) ? { ...raw.values } : {};
}

// ==================== 参数下发 ====================

/**
 * 参数值 → 命令行。
 *
 * `secret` 类型**不在这里下发**（走 `secretEnvOf` 的独立通道）—— 命令行在任务管理器里
 * 一眼可见，凭据不该躺在那儿。
 */
export function buildArgs(manifest: Pick<DockManifest, 'params'>, values: Record<string, unknown>): string[] {
  const args: string[] = [];
  for (const p of manifest.params ?? []) {
    if (p.type === 'secret') continue;
    const v = values[p.key];
    if (v === undefined || v === null) continue;
    if (p.type === 'bool') {
      if (v === true) args.push(`--${p.key}`);
      continue;
    }
    if (p.type === 'multichoice') {
      const list = Array.isArray(v) ? v : [v];
      for (const item of list) {
        const s = String(item);
        if (s !== '') args.push(`--${p.key}=${s}`);
      }
      continue;
    }
    const s = String(v);
    if (s === '' && !p.required) continue;
    args.push(`--${p.key}=${s}`);
  }
  return args;
}

/**
 * 凭据类参数 → 环境变量：`<KEY>` 原样保留，值走 `BZ_DOCK_SECRET_<KEY 大写、非字母数字换 _>`。
 *
 * 为什么是环境变量而不是 stdin：环境变量在 Linux/macOS 上只有同用户可读（`/proc/<pid>/environ`
 * 权限 0400），Windows 上要同用户 + 提权才能读；**命令行是所有人都能看见的**。
 * 工具读 `process.env` 即可，不需要为了拿凭据去改 stdin 协议。
 */
export function secretEnvOf(manifest: Pick<DockManifest, 'params'>, values: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const p of manifest.params ?? []) {
    if (p.type !== 'secret') continue;
    const v = values[p.key];
    if (v === undefined || v === null || String(v) === '') continue;
    const name = `BZ_DOCK_SECRET_${p.key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    env[name] = String(v);
  }
  return env;
}

// ==================== 信任签名 ====================

/**
 * 启动命令的签名 —— 授权绑的就是它。
 * 声明改了 `entry`（cmd / args / shell / cwd），签名就对不上，需要重新授权。
 */
export function runSignature(entry: DockEntry | null): string {
  if (!entry) return '';
  return [entry.cmd, entry.shell === true ? 'shell' : 'raw', entry.cwd ?? '', ...(entry.args ?? [])].join('\u0000');
}
