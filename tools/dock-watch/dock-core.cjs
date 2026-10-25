/* 生成物 —— 由 scripts/build-dock-watch.mjs 从 src/dock 打出（判据的唯一真理源在 src/dock/rules.ts）。勿手改。 */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/dock/watch-core.ts
var watch_core_exports = {};
__export(watch_core_exports, {
  BREAKER_THRESHOLD: () => BREAKER_THRESHOLD,
  CONTRACT_VERSION: () => CONTRACT_VERSION,
  DECLARATION_FILENAME: () => DECLARATION_FILENAME,
  DEFAULT_STORAGE_DIR: () => DEFAULT_STORAGE_DIR,
  FAIL_COOLDOWN_MS: () => FAIL_COOLDOWN_MS,
  HEARTBEAT_FILENAME: () => HEARTBEAT_FILENAME,
  HEARTBEAT_STALE_MS: () => HEARTBEAT_STALE_MS,
  INTENT_FILENAME: () => INTENT_FILENAME,
  INTENT_VERSION: () => INTENT_VERSION,
  KEEP_ALIVE_MS: () => KEEP_ALIVE_MS,
  LOCK_FILENAME: () => LOCK_FILENAME,
  LOCK_STALE_MS: () => LOCK_STALE_MS,
  MAX_ATTEMPTS: () => MAX_ATTEMPTS,
  PANEL_FILENAME: () => PANEL_FILENAME,
  REGISTRY_FILENAME: () => REGISTRY_FILENAME,
  REGISTRY_VERSION: () => REGISTRY_VERSION,
  RUNS_FILENAME: () => RUNS_FILENAME,
  RUNS_KEEP: () => RUNS_KEEP,
  RUNS_TAIL_BYTES: () => RUNS_TAIL_BYTES,
  RUNTIME_FILENAME: () => RUNTIME_FILENAME,
  RUNTIME_VERSION: () => RUNTIME_VERSION,
  RUN_TIMEOUT_MS: () => RUN_TIMEOUT_MS,
  SETTINGS_FILENAME: () => SETTINGS_FILENAME,
  SETTINGS_VERSION: () => SETTINGS_VERSION,
  TOOL_ID_MAX_LEN: () => TOOL_ID_MAX_LEN,
  TOOL_ID_RE: () => TOOL_ID_RE,
  TRIGGER_KINDS: () => TRIGGER_KINDS,
  TRIGGER_LABEL: () => TRIGGER_LABEL,
  VAULT_PATH_PREFIX: () => VAULT_PATH_PREFIX,
  acquireLock: () => acquireLock,
  actionText: () => actionText,
  buildArgs: () => buildArgs,
  clearBreaker: () => clearBreaker,
  currentFs: () => currentFs,
  dirOf: () => dirOf,
  displayNameOf: () => displayNameOf,
  dockVaultRootNow: () => dockVaultRootNow,
  findByRunId: () => findByRunId,
  hintOf: () => hintOf,
  inspectLock: () => inspectLock,
  isEventTrigger: () => isEventTrigger,
  isPortablePath: () => isPortablePath,
  joinPath: () => joinPath,
  judgeRun: () => judgeRun,
  latestRun: () => latestRun,
  liveAll: () => liveAll,
  liveOf: () => liveOf,
  loadToolView: () => loadToolView,
  loadToolViews: () => loadToolViews,
  makeRunId: () => makeRunId,
  missingParams: () => missingParams,
  nextDueOf: () => nextDueOf,
  normalizeStorageDir: () => normalizeStorageDir,
  parseIntent: () => parseIntent,
  parseManifest: () => parseManifest,
  parseRegistry: () => parseRegistry,
  parseRunLines: () => parseRunLines,
  parseRuntime: () => parseRuntime,
  parseSettingsText: () => parseSettingsText,
  pathOf: () => pathOf,
  planTick: () => planTick,
  portableToolPath: () => portableToolPath,
  readRegistryAt: () => readRegistryAt,
  readTextOf: () => readTextOf,
  reclaimStale: () => reclaimStale,
  removeToolAt: () => removeToolAt,
  resolveToolPath: () => resolveToolPath,
  ruleDue: () => ruleDue,
  ruleName: () => ruleName,
  runSignature: () => runSignature,
  runTick: () => runTick,
  runToolNow: () => runToolNow,
  secretEnvOf: () => secretEnvOf,
  setDockFs: () => setDockFs,
  setDockVaultRoot: () => setDockVaultRoot,
  setExecDeps: () => setExecDeps,
  settle: () => settle,
  statusText: () => statusText,
  storageFileIn: () => storageFileIn,
  tickOnce: () => tickOnce,
  triggerText: () => triggerText,
  upsertToolAt: () => upsertToolAt,
  withLock: () => withLock,
  writeAtomic: () => writeAtomic,
  writeRegistryAt: () => writeRegistryAt
});
module.exports = __toCommonJS(watch_core_exports);

// src/dock/types.ts
var CONTRACT_VERSION = 2;
var DECLARATION_FILENAME = "manifest.json";
var SETTINGS_FILENAME = "data.json";
var RUNS_FILENAME = "runs.jsonl";
var HEARTBEAT_FILENAME = "heartbeat.json";
var PANEL_FILENAME = "panel.html";
var INTENT_FILENAME = "dock.intent.json";
var RUNTIME_FILENAME = "dock.runtime.json";
var LOCK_FILENAME = "dock.lock";
var REGISTRY_FILENAME = "dock.json";
var REGISTRY_VERSION = 3;
var VAULT_PATH_PREFIX = "vault:";
var SETTINGS_VERSION = 2;
var INTENT_VERSION = 1;
var RUNTIME_VERSION = 1;
var RUNS_KEEP = 200;
var RUNS_TAIL_BYTES = 256 * 1024;
var HEARTBEAT_STALE_MS = 6e4;
var RUN_TIMEOUT_MS = 10 * 6e4;
var LOCK_STALE_MS = 9e4;
var FAIL_COOLDOWN_MS = 15 * 6e4;
var BREAKER_THRESHOLD = 3;
var TOOL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
var TOOL_ID_MAX_LEN = 64;
var TRIGGER_KINDS = [
  "daily",
  "interval",
  "on-launch",
  "panel-open",
  "obsidian-exit",
  "tool-ok",
  "tool-fail",
  "domain-event",
  "file-change",
  "value-threshold"
];
var TRIGGER_LABEL = {
  daily: "每天某时",
  interval: "每隔一段时间",
  "on-launch": "启动 Obsidian 后",
  "panel-open": "打开工具坞时",
  "obsidian-exit": "关闭 Obsidian 时",
  "tool-ok": "某个工具成功后",
  "tool-fail": "某个工具失败后",
  "domain-event": "某个事件发生时",
  "file-change": "某个目录有变动",
  "value-threshold": "某个数值达到条件"
};

// src/dock/parse.ts
function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v) {
  if (typeof v !== "string") return void 0;
  const s = v.trim();
  return s === "" ? void 0 : s;
}
function num(v, min, max) {
  if (typeof v !== "number" || !Number.isFinite(v)) return void 0;
  const n = Math.floor(v);
  return n < min || n > max ? void 0 : n;
}
function bool(v) {
  return typeof v === "boolean" ? v : void 0;
}
function parseJsonObjectText(text) {
  if (typeof text !== "string" || text.trim() === "") return null;
  try {
    const v = JSON.parse(text);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}
function isToolId(v) {
  return typeof v === "string" && v.length <= TOOL_ID_MAX_LEN && TOOL_ID_RE.test(v);
}
var PARAM_TYPES = [
  "text",
  "number",
  "bool",
  "choice",
  "path",
  "secret",
  "multiline",
  "multichoice"
];
function parseParam(raw) {
  if (!isObj(raw)) return null;
  const key = str(raw.key);
  if (!key || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return null;
  const type = PARAM_TYPES.includes(raw.type) ? raw.type : "text";
  const out = { key, type };
  const label = str(raw.label);
  if (label) out.label = label;
  const hint = str(raw.hint);
  if (hint) out.hint = hint;
  const req = bool(raw.required);
  if (req !== void 0) out.required = req;
  if (raw.default !== void 0 && (typeof raw.default === "string" || typeof raw.default === "number" || typeof raw.default === "boolean" || Array.isArray(raw.default))) {
    out.default = raw.default;
  }
  if (Array.isArray(raw.options)) {
    const opts = raw.options.filter((o) => typeof o === "string");
    if (opts.length) out.options = opts;
  }
  if ((type === "choice" || type === "multichoice") && !out.options) return null;
  return out;
}
function parseParams(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of raw) {
    const p = parseParam(item);
    if (!p || seen.has(p.key)) continue;
    seen.add(p.key);
    out.push(p);
  }
  return out;
}
function parseEntry(raw) {
  if (!isObj(raw)) return null;
  const cmd = str(raw.cmd);
  if (!cmd) return null;
  const out = { cmd };
  if (Array.isArray(raw.args)) {
    const args = raw.args.filter((a) => typeof a === "string");
    if (args.length) out.args = args;
  }
  const cwd = str(raw.cwd);
  if (cwd) out.cwd = cwd;
  const shell = bool(raw.shell);
  if (shell !== void 0) out.shell = shell;
  return out;
}
function parseManifest(raw) {
  if (!isObj(raw)) return null;
  if (raw.v !== CONTRACT_VERSION) return null;
  if (!isToolId(raw.id)) return null;
  const name = str(raw.name);
  if (!name) return null;
  const out = { v: CONTRACT_VERSION, id: raw.id, name };
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
function atSecondsOf(at) {
  if (!at) return void 0;
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(at.trim());
  if (!m) return void 0;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return void 0;
  return h * 3600 + mi * 60;
}
function parseTrigger(raw) {
  if (!isObj(raw)) return null;
  switch (raw.kind) {
    case "daily": {
      const at = str(raw.at);
      const sec = atSecondsOf(at);
      if (sec === void 0) return null;
      const h = String(Math.floor(sec / 3600)).padStart(2, "0");
      const mi = String(Math.floor(sec % 3600 / 60)).padStart(2, "0");
      return { kind: "daily", at: `${h}:${mi}` };
    }
    case "interval": {
      const m = num(raw.everyMin, 1, 43200);
      return m === void 0 ? null : { kind: "interval", everyMin: m };
    }
    case "on-launch": {
      const m = num(raw.delayMin, 0, 1440);
      return m === void 0 ? null : { kind: "on-launch", delayMin: m };
    }
    case "panel-open":
      return { kind: "panel-open" };
    case "obsidian-exit":
      return { kind: "obsidian-exit" };
    case "tool-ok": {
      const id = str(raw.toolId);
      return id ? { kind: "tool-ok", toolId: id } : null;
    }
    case "tool-fail": {
      const id = str(raw.toolId);
      return id ? { kind: "tool-fail", toolId: id } : null;
    }
    case "domain-event": {
      const ch = str(raw.channel);
      return ch ? { kind: "domain-event", channel: ch } : null;
    }
    case "file-change": {
      const t = str(raw.target);
      return t ? { kind: "file-change", target: t.replace(/\/+$/, "") } : null;
    }
    case "value-threshold": {
      const op = raw.op;
      if (op !== ">" && op !== "<" && op !== "=") return null;
      const value = raw.value;
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      const path = str(raw.path);
      const key = str(raw.key);
      if (!path || !key) return null;
      return { kind: "value-threshold", path, key, op, value };
    }
    default:
      return null;
  }
}
function parseAction(raw) {
  if (!isObj(raw)) return { kind: "run" };
  return raw.kind === "remind" ? { kind: "remind" } : { kind: "run" };
}
function parseRule(raw) {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const trigger = parseTrigger(raw.trigger);
  if (!trigger) return null;
  const out = { id, trigger, action: parseAction(raw.action) };
  const name = str(raw.name);
  if (name) out.name = name;
  const enabled = bool(raw.enabled);
  if (enabled !== void 0) out.enabled = enabled;
  const jitter = num(raw.jitterMin, 0, 720);
  if (jitter !== void 0) out.jitterMin = jitter;
  return out;
}
function parseRules(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of raw) {
    const r = parseRule(item);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
function makeRunId(now = Date.now()) {
  return `r${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function emptyIntent(tool) {
  return { v: INTENT_VERSION, tool };
}
function parseIntent(raw, toolId) {
  if (!isObj(raw) || raw.v !== INTENT_VERSION || raw.tool !== toolId) return emptyIntent(toolId);
  const out = emptyIntent(toolId);
  const enabled = bool(raw.enabled);
  if (enabled !== void 0) out.enabled = enabled;
  const auto = bool(raw.autoRun);
  if (auto !== void 0) out.autoRun = auto;
  const rules = parseRules(raw.rules);
  if (rules.length) out.rules = rules;
  return out;
}
function parseRuleRuntime(raw) {
  if (!isObj(raw)) return null;
  const out = {};
  const lastFired = str(raw.lastFiredAt);
  if (lastFired) out.lastFiredAt = lastFired;
  const lastRunId = str(raw.lastRunId);
  if (lastRunId) out.lastRunId = lastRunId;
  const lastStatus = str(raw.lastStatus);
  if (lastStatus) out.lastStatus = lastStatus;
  if (isObj(raw.pending)) {
    const runId = str(raw.pending.runId);
    const dueAt = str(raw.pending.dueAt);
    const claimedAt = str(raw.pending.claimedAt);
    if (runId && dueAt && claimedAt) {
      const pending = { runId, dueAt, claimedAt };
      const startedAt = str(raw.pending.startedAt);
      if (startedAt) pending.startedAt = startedAt;
      const attempts = num(raw.pending.attempts, 0, 1e3);
      if (attempts) pending.attempts = attempts;
      out.pending = pending;
    }
  }
  return Object.keys(out).length ? out : null;
}
function parseRunFacts(raw) {
  if (!isObj(raw)) return null;
  const out = {};
  const at = str(raw.lastAttemptAt);
  if (at) out.lastAttemptAt = at;
  const ok = bool(raw.lastAttemptOk);
  if (ok !== void 0) out.lastAttemptOk = ok;
  const fails = num(raw.consecutiveFailures, 0, 1e3);
  if (fails) out.consecutiveFailures = fails;
  const paused = str(raw.pausedAt);
  if (paused) out.pausedAt = paused;
  const runningAt = str(raw.runningAt);
  if (runningAt) out.runningAt = runningAt;
  const runningRunId = str(raw.runningRunId);
  if (runningRunId) out.runningRunId = runningRunId;
  return Object.keys(out).length ? out : null;
}
function emptyRuntime(tool) {
  return { v: RUNTIME_VERSION, tool };
}
function parseRuntime(raw, toolId) {
  if (!isObj(raw) || raw.v !== RUNTIME_VERSION || raw.tool !== toolId) return emptyRuntime(toolId);
  const out = emptyRuntime(toolId);
  const updatedAt = str(raw.updatedAt);
  if (updatedAt) out.updatedAt = updatedAt;
  if (isObj(raw.rules)) {
    const rules = {};
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
function parseRegistryEntry(raw) {
  if (!isObj(raw)) return null;
  if (!isToolId(raw.id)) return null;
  const path = str(raw.path);
  if (!path) return null;
  return { id: raw.id, path };
}
function emptyRegistry() {
  return { v: REGISTRY_VERSION, tools: [] };
}
function parseRegistry(raw) {
  const errors = [];
  const base = emptyRegistry();
  if (!isObj(raw)) {
    if (raw !== null && raw !== void 0) errors.push("登记表不是 JSON 对象，已按空处理");
    return { registry: base, errors };
  }
  if (raw.v !== REGISTRY_VERSION) {
    errors.push(`登记表版本是 ${String(raw.v)}，本版认 ${REGISTRY_VERSION} —— 已按空处理`);
    return { registry: base, errors };
  }
  const tools = [];
  const seen = /* @__PURE__ */ new Set();
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
  return { registry: { v: REGISTRY_VERSION, tools }, errors };
}
function parseStep(raw) {
  if (!isObj(raw)) return null;
  const text = str(raw.text);
  if (!text) return null;
  const at = str(raw.at) ?? (/* @__PURE__ */ new Date(0)).toISOString();
  const status = raw.status === "failed" ? "failed" : "ok";
  return { text, at, status };
}
function parseRunRecord(raw, expectTool) {
  if (!isObj(raw)) return null;
  const runId = str(raw.runId);
  const status = str(raw.status);
  if (!runId || !status) return null;
  if (expectTool && raw.tool !== void 0 && raw.tool !== expectTool) return null;
  const STATUSES = ["ok", "failed", "timeout", "stopped", "abandoned", "running"];
  if (!STATUSES.includes(status)) return null;
  const startedAt = str(raw.startedAt) ?? (/* @__PURE__ */ new Date(0)).toISOString();
  const out = {
    runId,
    tool: str(raw.tool) ?? expectTool ?? "",
    trigger: raw.trigger === "auto" ? "auto" : "manual",
    status,
    startedAt
  };
  const finishedAt = str(raw.finishedAt);
  if (finishedAt) out.finishedAt = finishedAt;
  if (typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs)) out.durationMs = raw.durationMs;
  if (typeof raw.exitCode === "number" || raw.exitCode === null) out.exitCode = raw.exitCode;
  const message = str(raw.message);
  if (message) out.message = message;
  if (isObj(raw.error)) {
    const kind = str(raw.error.kind);
    const KINDS = ["auth", "network", "config", "timeout", "aborted", "unknown"];
    const picked = kind && KINDS.includes(kind) ? kind : "unknown";
    out.error = { kind: picked, detail: str(raw.error.detail), stderr: str(raw.error.stderr) };
  }
  if (Array.isArray(raw.steps)) {
    const steps = raw.steps.map(parseStep).filter((s) => s !== null);
    if (steps.length) out.steps = steps;
  }
  if (Array.isArray(raw.info)) out.info = raw.info;
  if (raw.result !== void 0) out.result = raw.result;
  if (isObj(raw.metrics)) {
    const m = {};
    for (const [k, v] of Object.entries(raw.metrics)) {
      if (typeof v === "number" && Number.isFinite(v)) m[k] = v;
    }
    if (Object.keys(m).length) out.metrics = m;
  }
  if (Array.isArray(raw.artifacts)) {
    const a = raw.artifacts.filter((x) => isObj(x) && typeof x.path === "string").map((x) => ({ path: String(x.path), label: typeof x.label === "string" ? x.label : void 0 }));
    if (a.length) out.artifacts = a;
  }
  return out;
}
function parseRunLines(text, expectTool) {
  if (!text) return [];
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = parseRunRecord(JSON.parse(t), expectTool);
      if (rec) out.push(rec);
    } catch {
    }
  }
  return out;
}
function parseHeartbeat(raw) {
  if (!isObj(raw)) return null;
  const at = str(raw.at);
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  const out = { at };
  const runId = str(raw.runId);
  if (runId) out.runId = runId;
  const step = str(raw.step);
  if (step) out.step = step;
  return out;
}
function findByRunId(records, runId) {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].runId === runId) return records[i];
  }
  return void 0;
}
function latestRun(records) {
  let best;
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
function parseSettingsText(text, toolId) {
  if (text === null || text === void 0) return null;
  const raw = parseJsonObjectText(text);
  if (!raw) return {};
  if (raw.v !== SETTINGS_VERSION || raw.tool !== toolId) return {};
  return isObj(raw.values) ? { ...raw.values } : {};
}
function buildArgs(manifest, values) {
  const args = [];
  for (const p of manifest.params ?? []) {
    if (p.type === "secret") continue;
    const v = values[p.key];
    if (v === void 0 || v === null) continue;
    if (p.type === "bool") {
      if (v === true) args.push(`--${p.key}`);
      continue;
    }
    if (p.type === "multichoice") {
      const list = Array.isArray(v) ? v : [v];
      for (const item of list) {
        const s2 = String(item);
        if (s2 !== "") args.push(`--${p.key}=${s2}`);
      }
      continue;
    }
    const s = String(v);
    if (s === "" && !p.required) continue;
    args.push(`--${p.key}=${s}`);
  }
  return args;
}
function secretEnvOf(manifest, values) {
  const env = {};
  for (const p of manifest.params ?? []) {
    if (p.type !== "secret") continue;
    const v = values[p.key];
    if (v === void 0 || v === null || String(v) === "") continue;
    const name = `BZ_DOCK_SECRET_${p.key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    env[name] = String(v);
  }
  return env;
}
function runSignature(entry) {
  if (!entry) return "";
  return [entry.cmd, entry.shell === true ? "shell" : "raw", entry.cwd ?? "", ...entry.args ?? []].join("\0");
}

// src/dock/rules.ts
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function todayAt(trigger, now) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(trigger.at);
  if (!m) return void 0;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return void 0;
  return startOfDay(now) + (h * 3600 + mi * 60) * 1e3;
}
function ruleDue(rule, ctx) {
  const t = rule.trigger;
  switch (t.kind) {
    case "daily": {
      const at = todayAt(t, ctx.now);
      if (at === void 0) return false;
      if (ctx.now < at) return false;
      return (ctx.lastFiredAt ?? 0) < at;
    }
    case "interval": {
      if (!(t.everyMin > 0)) return false;
      if (ctx.lastFiredAt === void 0) return true;
      return ctx.now - ctx.lastFiredAt >= t.everyMin * 6e4;
    }
    case "on-launch": {
      if (ctx.sessionStart === void 0) return false;
      if (ctx.now < ctx.sessionStart + t.delayMin * 6e4) return false;
      return (ctx.lastFiredAt ?? 0) < ctx.sessionStart;
    }
    case "panel-open":
      return ctx.event?.kind === "panel-open";
    case "obsidian-exit":
      return ctx.event?.kind === "obsidian-exit";
    case "tool-ok":
      return ctx.event?.kind === "tool-ok" && ctx.event.toolId === t.toolId;
    case "tool-fail":
      return ctx.event?.kind === "tool-fail" && ctx.event.toolId === t.toolId;
    case "domain-event":
      return ctx.event?.kind === "domain-event" && ctx.event.channel === t.channel;
    case "file-change": {
      if (ctx.event?.kind !== "file-change") return false;
      const p = ctx.event.path ?? "";
      if (!p) return false;
      return p === t.target || p.startsWith(`${t.target}/`);
    }
    case "value-threshold": {
      if (ctx.value === void 0) return false;
      if (t.op === ">") return ctx.value > t.value;
      if (t.op === "<") return ctx.value < t.value;
      return ctx.value === t.value;
    }
  }
}
function isEventTrigger(kind) {
  return kind !== "daily" && kind !== "interval" && kind !== "on-launch";
}
function nextDueOf(rule, ctx) {
  const t = rule.trigger;
  switch (t.kind) {
    case "daily": {
      const today = todayAt(t, ctx.now);
      if (today === void 0) return null;
      if ((ctx.lastFiredAt ?? 0) < today) return today;
      return today + 864e5;
    }
    case "interval": {
      if (!(t.everyMin > 0)) return null;
      if (ctx.lastFiredAt === void 0) return ctx.now;
      return ctx.lastFiredAt + t.everyMin * 6e4;
    }
    case "on-launch": {
      if (ctx.sessionStart === void 0) return null;
      const at = ctx.sessionStart + t.delayMin * 6e4;
      return (ctx.lastFiredAt ?? 0) < ctx.sessionStart ? at : null;
    }
    default:
      return null;
  }
}
var pad2 = (n) => String(n).padStart(2, "0");
function clockText(at) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(at);
  if (!m) return at;
  return `${pad2(Number(m[1]))}:${pad2(Number(m[2]))}`;
}
function durationText(min) {
  if (min >= 60 && min % 60 === 0) return `${min / 60} 小时`;
  return `${min} 分钟`;
}
function triggerText(t, nameOf) {
  const name = (id) => nameOf ? nameOf(id) : id;
  switch (t.kind) {
    case "daily":
      return `每天 ${clockText(t.at)}`;
    case "interval":
      return `每 ${durationText(t.everyMin)}`;
    case "on-launch":
      return `启动后 ${durationText(t.delayMin)}`;
    case "panel-open":
      return "打开工具坞时";
    case "obsidian-exit":
      return "关闭 Obsidian 后";
    case "tool-ok":
      return `${name(t.toolId)} 成功后`;
    case "tool-fail":
      return `${name(t.toolId)} 失败后`;
    case "domain-event":
      return `事件 ${t.channel}`;
    case "file-change":
      return `${t.target} 有变动`;
    case "value-threshold":
      return `${t.path} 的 ${t.key} ${t.op} ${t.value}`;
  }
}
function actionText(a) {
  return a.kind === "remind" ? "只提醒" : "运行";
}
function ruleName(rule, index) {
  return rule.name?.trim() || `规则 ${index + 1}`;
}

// src/dock/files.ts
var injected;
function setDockFs(fs) {
  injected = fs;
}
function defaultFs() {
  if (typeof window === "undefined") return null;
  const w = window;
  if (!w.require) return null;
  try {
    const fs = w.require("fs");
    return {
      readText: (p) => {
        try {
          return fs.readFileSync(p, "utf8");
        } catch {
          return null;
        }
      },
      writeText: (p, d) => fs.writeFileSync(p, d),
      rename: typeof fs.renameSync === "function" ? (a, b) => fs.renameSync(a, b) : void 0,
      createExclusive: typeof fs.openSync === "function" ? (p, d) => {
        try {
          const fd = fs.openSync(p, "wx");
          if (typeof fs.writeSync === "function") fs.writeSync(fd, d);
          if (typeof fs.closeSync === "function") fs.closeSync(fd);
          return true;
        } catch {
          return false;
        }
      } : void 0,
      unlink: typeof fs.unlinkSync === "function" ? (p) => fs.unlinkSync(p) : void 0,
      exists: (() => {
        const existsSync = fs.existsSync;
        if (typeof existsSync !== "function") return void 0;
        return (p) => {
          try {
            if (!existsSync(p)) return false;
            return fs.statSync ? fs.statSync(p).isFile() : true;
          } catch {
            return false;
          }
        };
      })(),
      mkdir: typeof fs.mkdirSync === "function" ? (p) => {
        try {
          fs.mkdirSync(p, { recursive: true });
        } catch {
        }
      } : void 0,
      readTail: (p, bytes) => {
        try {
          const size = fs.statSync(p).size;
          const start = Math.max(0, size - bytes);
          const readSync = fs.readSync;
          if (typeof readSync !== "function" || typeof Buffer === "undefined") return fs.readFileSync(p, "utf8");
          const fd = fs.openSync(p, "r");
          try {
            const buf = Buffer.alloc(size - start);
            readSync(fd, buf, 0, buf.length, start);
            return buf.toString("utf8");
          } finally {
            fs.closeSync(fd);
          }
        } catch {
          return null;
        }
      },
      size: (p) => {
        try {
          return fs.statSync(p).size;
        } catch {
          return void 0;
        }
      }
    };
  } catch {
    return null;
  }
}
function currentFs() {
  return injected !== void 0 ? injected : defaultFs();
}
function dirOf(p) {
  const s = p.replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  if (i < 0) return "";
  if (i === 0) return "/";
  if (s[i - 1] === ":") return s.slice(0, i + 1);
  return s.slice(0, i);
}
function joinPath(dir, name) {
  const d = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  return d === "" ? name : `${d}/${name}`;
}
var dockVaultRoot = "";
function setDockVaultRoot(root) {
  dockVaultRoot = String(root ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
}
function dockVaultRootNow() {
  return dockVaultRoot;
}
function isPortablePath(p) {
  return p.startsWith(VAULT_PATH_PREFIX);
}
function resolveToolPath(p) {
  if (!isPortablePath(p)) return p;
  const rel = p.slice(VAULT_PATH_PREFIX.length).replace(/^\/+/, "");
  return dockVaultRoot ? `${dockVaultRoot}/${rel}` : rel;
}
function portableToolPath(abs, root = dockVaultRoot) {
  const p = String(abs ?? "").replace(/\\/g, "/");
  const base = String(root ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base) return p;
  if (p === base) return `${VAULT_PATH_PREFIX}.`;
  if (!p.startsWith(`${base}/`)) return p;
  return `${VAULT_PATH_PREFIX}${p.slice(base.length + 1)}`;
}
var pathOf = {
  manifest: (declPath) => declPath,
  settings: (declPath) => joinPath(dirOf(declPath), SETTINGS_FILENAME),
  runs: (declPath) => joinPath(dirOf(declPath), RUNS_FILENAME),
  heartbeat: (declPath) => joinPath(dirOf(declPath), HEARTBEAT_FILENAME),
  panel: (declPath) => joinPath(dirOf(declPath), PANEL_FILENAME),
  intent: (declPath) => joinPath(dirOf(declPath), INTENT_FILENAME),
  runtime: (declPath) => joinPath(dirOf(declPath), RUNTIME_FILENAME)
};
var writeSeq = 0;
function pidText() {
  try {
    return String(globalThis.process?.pid ?? 0);
  } catch {
    return "0";
  }
}
function writeAtomic(fs, target, text) {
  try {
    if (fs.rename) {
      const tmp = `${target}.${pidText()}.${writeSeq++}.tmp`;
      fs.writeText(tmp, text);
      fs.rename(tmp, target);
    } else {
      fs.writeText(target, text);
    }
    return true;
  } catch {
    return false;
  }
}
function readTextOf(path, fs = currentFs()) {
  return fs ? fs.readText(path) : null;
}
function readRunsText(path, fs = currentFs(), tailBytes = 0) {
  if (!fs) return null;
  if (tailBytes > 0 && fs.readTail) return fs.readTail(path, tailBytes);
  return fs.readText(path);
}
function writeRuntime(declPath, runtime, fs = currentFs()) {
  if (!fs) return false;
  const target = pathOf.runtime(declPath);
  const payload = { ...runtime, v: RUNTIME_VERSION, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  const next = JSON.stringify(payload, null, 2);
  const prev = fs.readText(target);
  if (prev !== null && stripUpdatedAt(prev) === stripUpdatedAt(next)) return false;
  return writeAtomic(fs, target, next);
}
function stripUpdatedAt(json) {
  return json.replace(/^\s*"updatedAt":\s*"[^"]*",?\s*$/m, "");
}

// src/dock/view.ts
function readManifestFile(path, fs) {
  const text = readTextOf(path, fs);
  if (text === null) return { manifest: null, error: "读不到 manifest.json" };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { manifest: null, error: "manifest.json 不是合法 JSON" };
  }
  const manifest = parseManifest(raw);
  if (!manifest) {
    return { manifest: null, error: "manifest.json 校验不过（需要 v:2、合法 id、非空 name）" };
  }
  return { manifest };
}
function loadToolView(entry, opts = {}) {
  const fs = opts.fs === void 0 ? currentFs() : opts.fs;
  const declPath = resolveToolPath(entry.path);
  const { manifest, error } = readManifestFile(declPath, fs ?? null);
  const intentRaw = fs ? readTextOf(pathOf.intent(declPath), fs) : null;
  const intent = parseIntent(safeJson(intentRaw), entry.id);
  const runtimeRaw = fs ? readTextOf(pathOf.runtime(declPath), fs) : null;
  const runtime = parseRuntime(safeJson(runtimeRaw), entry.id);
  const settingsRaw = fs ? readTextOf(pathOf.settings(declPath), fs) : null;
  const parsedValues = parseSettingsText(settingsRaw, entry.id);
  const values = parsedValues ?? {};
  const records = fs ? parseRunLines(readRunsText(pathOf.runs(declPath), fs, RUNS_TAIL_BYTES), entry.id) : [];
  const beat = heartbeatOf(declPath, fs);
  const heartbeat = beat && !records.some((r) => r.runId === beat.runId) ? beat : null;
  const trust = opts.trust?.[entry.id];
  const signature = runSignature(manifest?.entry ?? null);
  const trusted = !!trust && !!signature && trust.run === signature;
  const rules = intent.rules?.length ? intent.rules : manifest?.defaultRules ?? [];
  return {
    id: entry.id,
    path: declPath,
    declaredPath: entry.path,
    dir: dirOf(declPath),
    manifest,
    error: error ?? (manifest && manifest.id !== entry.id ? `声明的 id 是 ${manifest.id}，登记的是 ${entry.id}` : void 0),
    entry: manifest?.entry ?? null,
    params: manifest?.params ?? [],
    values,
    intent,
    runtime,
    rules,
    trusted,
    trustStale: !!trust && !!signature && trust.run !== signature,
    lastRun: latestRun(records),
    heartbeat: heartbeat ?? void 0,
    runnable: (opts.canRun ?? true) && !!manifest?.entry
  };
}
function loadToolViews(entries, opts = {}) {
  return entries.map((e) => loadToolView(e, opts));
}
function heartbeatOf(declPath, fs = currentFs()) {
  if (!fs) return null;
  return parseHeartbeat(safeJson(readTextOf(pathOf.heartbeat(resolveToolPath(declPath)), fs)));
}
function safeJson(text) {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function displayNameOf(view) {
  return view.manifest?.name?.trim() || view.id;
}

// src/dock/kernel.ts
function thresholdKey(toolId, ruleId) {
  return `${toolId}\0${ruleId}`;
}
function missingParams(view) {
  const out = [];
  for (const p of view.params) {
    if (!p.required) continue;
    const v = view.values[p.key];
    const empty = v === void 0 || v === null || typeof v === "string" && v.trim() === "" || Array.isArray(v) && v.length === 0;
    if (empty) out.push(p.label ?? p.key);
  }
  return out;
}
function runningElsewhere(view, now) {
  const at = Date.parse(view.runtime.run?.runningAt ?? "");
  if (!Number.isFinite(at)) return false;
  return now - at < RUN_TIMEOUT_MS + 6e4;
}
function planTick(input) {
  const decisions = [];
  const ready = [];
  for (const view of input.views) {
    for (const rule of view.rules) {
      const ruleState = view.runtime.rules?.[rule.id] ?? {};
      const action = rule.action.kind === "remind" ? "remind" : "run";
      const push = (kind, reason, dueAt2) => {
        decisions.push({ toolId: view.id, ruleId: rule.id, action, kind, reason, dueAt: dueAt2 });
      };
      const pending = ruleState.pending;
      if (pending) {
        const due = Date.parse(pending.dueAt);
        if (Number.isFinite(due) && due <= input.now) {
          ready.push({ view, rule, runId: pending.runId });
          push("run");
        } else {
          push("skip", "waiting", pending.dueAt);
        }
        continue;
      }
      if (rule.enabled === false) {
        push("skip", "disabled");
        continue;
      }
      if (view.intent.enabled === false) {
        push("skip", "disabled");
        continue;
      }
      if (view.intent.autoRun === false) {
        push("skip", "tool-auto-off");
        continue;
      }
      if (view.runtime.run?.pausedAt) {
        push("skip", "paused");
        continue;
      }
      if (!view.trusted) {
        push("skip", view.trustStale ? "untrusted" : "untrusted");
        continue;
      }
      if (!view.entry || !view.runnable) {
        push("skip", "no-entry");
        continue;
      }
      if (action === "run" && missingParams(view).length > 0) {
        push("skip", "missing-params");
        continue;
      }
      if (action === "run" && input.liveIds.has(view.id)) {
        push("skip", "running");
        continue;
      }
      if (action === "run" && runningElsewhere(view, input.now)) {
        push("skip", "running");
        continue;
      }
      const lastAttempt = Date.parse(view.runtime.run?.lastAttemptAt ?? "");
      if (action === "run" && view.runtime.run?.lastAttemptOk === false && Number.isFinite(lastAttempt) && input.now - lastAttempt < FAIL_COOLDOWN_MS) {
        push("skip", "cooldown");
        continue;
      }
      const ctx = {
        now: input.now,
        lastFiredAt: Number.isFinite(Date.parse(ruleState.lastFiredAt ?? "")) ? Date.parse(ruleState.lastFiredAt) : void 0,
        sessionStart: input.sessionStart,
        value: input.values?.get(thresholdKey(view.id, rule.id))
      };
      const hit = ruleDue(rule, ctx) || (input.events ?? []).some((e) => {
        if ((e.kind === "tool-ok" || e.kind === "tool-fail") && e.toolId === view.id) return false;
        return ruleDue(rule, { ...ctx, event: e });
      });
      if (!hit) continue;
      const jitterMin = rule.jitterMin ?? 0;
      const delayMs = jitterMin > 0 ? Math.floor(Math.random() * jitterMin * 6e4) : 0;
      const dueAt = new Date(input.now + delayMs).toISOString();
      push("queue", delayMs > 0 ? "jitter" : void 0, dueAt);
    }
  }
  return { decisions, ready };
}
var MAX_RUNS_PER_TICK = 8;
async function runTick(deps2) {
  const plan = planTick({
    views: deps2.views,
    now: deps2.now,
    sessionStart: deps2.sessionStart,
    events: deps2.events,
    liveIds: deps2.liveIds,
    values: deps2.values
  });
  const ran = [];
  let executed = 0;
  const jobs = plan.ready.map((r) => ({
    toolId: r.view.id,
    ruleId: r.rule.id,
    runId: r.runId
  }));
  for (const d of plan.decisions) {
    if (d.kind !== "queue" || !d.dueAt) continue;
    const view = deps2.views.find((v) => v.id === d.toolId);
    if (!view) continue;
    const rule = view.rules.find((r) => r.id === d.ruleId);
    if (!rule) continue;
    if (d.action === "remind") {
      deps2.remind?.(view, rule);
      patchRule(view, rule.id, { lastFiredAt: new Date(deps2.now).toISOString(), lastStatus: "ok" }, deps2.fs);
      continue;
    }
    const runId = makeRunId(deps2.now);
    patchRule(
      view,
      rule.id,
      { pending: { runId, dueAt: d.dueAt, claimedAt: new Date(deps2.now).toISOString() } },
      deps2.fs
    );
    if (Date.parse(d.dueAt) <= deps2.now) jobs.push({ toolId: view.id, ruleId: rule.id, runId });
  }
  while (jobs.length && executed < MAX_RUNS_PER_TICK) {
    if (deps2.shouldStop?.()) break;
    const job = jobs.shift();
    const view = deps2.views.find((v) => v.id === job.toolId);
    if (!view) continue;
    const rule = view.rules.find((r) => r.id === job.ruleId);
    if (!rule) continue;
    markStarted(view, rule.id, job.runId, deps2.now, deps2.fs);
    executed += 1;
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    let outcome;
    try {
      outcome = await deps2.execute(view, rule, job.runId);
    } catch (e) {
      outcome = {
        ok: false,
        status: "failed",
        runId: job.runId,
        code: null,
        stderr: "",
        error: e instanceof Error ? e : new Error(String(e)),
        kind: "config",
        startedAt,
        finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
        durationMs: 0,
        recordMissing: "bz 自己出错，没跑起来"
      };
    }
    if (deps2.shouldStop?.()) break;
    settle(view, job.ruleId, job.runId, outcome, deps2.fs);
    ran.push({ toolId: view.id, ruleId: job.ruleId, runId: job.runId, status: outcome.status });
  }
  return { decisions: plan.decisions, ran, executed };
}
function patchRule(view, ruleId, patch, fs) {
  const runtime = view.runtime;
  const rules = { ...runtime.rules ?? {} };
  rules[ruleId] = { ...rules[ruleId] ?? {}, ...patch };
  view.runtime = { ...runtime, rules };
  writeRuntime(view.path, view.runtime, fs ?? null);
}
function settle(view, ruleId, runId, outcome, fs) {
  const now = outcome.finishedAt || (/* @__PURE__ */ new Date()).toISOString();
  const runtime = { ...view.runtime, rules: { ...view.runtime.rules ?? {} } };
  const rules = runtime.rules;
  rules[ruleId] = { lastFiredAt: now, lastRunId: runId, lastStatus: outcome.status };
  const facts = { ...runtime.run ?? {} };
  facts.lastAttemptAt = now;
  facts.lastAttemptOk = outcome.ok;
  delete facts.runningAt;
  delete facts.runningRunId;
  if (outcome.ok) {
    delete facts.consecutiveFailures;
    delete facts.pausedAt;
  } else if (outcome.status !== "stopped") {
    const fails = (facts.consecutiveFailures ?? 0) + 1;
    facts.consecutiveFailures = fails;
    if (fails >= BREAKER_THRESHOLD) facts.pausedAt = now;
  }
  runtime.run = facts;
  view.runtime = runtime;
  writeRuntime(view.path, runtime, fs ?? null);
}
function clearBreaker(view, fs) {
  const runtime = { ...view.runtime };
  if (runtime.run) {
    const facts = { ...runtime.run };
    delete facts.pausedAt;
    delete facts.consecutiveFailures;
    runtime.run = facts;
  }
  view.runtime = runtime;
  writeRuntime(view.path, runtime, fs ?? null);
}
var MAX_ATTEMPTS = 3;
function markStarted(view, ruleId, runId, now, fs) {
  const pending = view.runtime.rules?.[ruleId]?.pending;
  const at = new Date(now).toISOString();
  patchRule(
    view,
    ruleId,
    {
      pending: {
        runId,
        dueAt: pending?.dueAt ?? at,
        claimedAt: pending?.claimedAt ?? at,
        startedAt: at,
        attempts: (pending?.attempts ?? 0) + 1
      }
    },
    fs
  );
}
function reclaimStale(view, now, fs) {
  const rules = { ...view.runtime.rules ?? {} };
  let verdict = null;
  for (const [id, st] of Object.entries(rules)) {
    const pending = st.pending;
    if (!pending?.startedAt) continue;
    const started = Date.parse(pending.startedAt);
    if (!Number.isFinite(started) || now - started <= RUN_TIMEOUT_MS + 6e4) continue;
    if ((pending.attempts ?? 1) < MAX_ATTEMPTS) {
      rules[id] = { ...st, pending: { ...pending, startedAt: void 0 } };
      verdict = "requeue";
    } else {
      const facts = { ...view.runtime.run ?? {} };
      facts.lastAttemptAt = new Date(now).toISOString();
      facts.lastAttemptOk = false;
      facts.consecutiveFailures = (facts.consecutiveFailures ?? 0) + 1;
      if (facts.consecutiveFailures >= BREAKER_THRESHOLD) {
        facts.pausedAt = new Date(now).toISOString();
      }
      rules[id] = { ...st, lastFiredAt: new Date(now).toISOString(), lastStatus: "abandoned" };
      delete rules[id].pending;
      view.runtime = { ...view.runtime, run: facts };
      verdict = "abandon";
    }
  }
  if (verdict) {
    view.runtime = { ...view.runtime, rules };
    writeRuntime(view.path, view.runtime, fs ?? null);
  }
  return verdict;
}

// src/dock/lock.ts
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const proc = globalThis.process;
  if (!proc?.kill) return true;
  try {
    proc.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}
function newToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function currentBootId() {
  try {
    const g = globalThis;
    const req = g.window?.require ?? g.require;
    const os = req?.("os");
    const sec = os?.uptime?.();
    if (typeof sec !== "number" || !Number.isFinite(sec)) return "";
    return String(Math.round((Date.now() - sec * 1e3) / 6e4));
  } catch {
    return "";
  }
}
function readLock(fs, path) {
  const text = fs.readText(path);
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    if (typeof v.owner !== "string" || typeof v.token !== "string" || typeof v.at !== "string") return null;
    return {
      owner: v.owner,
      pid: typeof v.pid === "number" ? v.pid : 0,
      bootId: typeof v.bootId === "string" ? v.bootId : "",
      at: v.at,
      token: v.token
    };
  } catch {
    return null;
  }
}
function lockPathOf(dataDir) {
  return joinPath(dataDir, LOCK_FILENAME);
}
function acquireLock(dataDir, owner, opts = {}) {
  const fs = opts.fs ?? currentFs();
  if (!fs) return null;
  const path = lockPathOf(dataDir);
  const staleMs = opts.staleMs ?? LOCK_STALE_MS;
  const now = opts.now ?? Date.now();
  const token = newToken();
  const info = {
    owner,
    pid: globalThis.process?.pid ?? 0,
    bootId: opts.bootId ?? currentBootId(),
    at: new Date(now).toISOString(),
    token
  };
  const text = JSON.stringify(info);
  if (fs.mkdir) fs.mkdir(dataDir);
  const take = () => {
    const ok = fs.createExclusive ? fs.createExclusive(path, text) : false;
    if (ok) return handleOf(fs, path, token);
    if (!fs.createExclusive && fs.readText(path) === null) {
      fs.writeText(path, text);
      return handleOf(fs, path, token);
    }
    return null;
  };
  const first = take();
  if (first) return first;
  const held = readLock(fs, path);
  const expiredByTime = !held || now - Date.parse(held.at) > staleMs || !Number.isFinite(Date.parse(held?.at ?? ""));
  const expiredByPid = !!held && held.pid > 0 && !pidAlive(held.pid);
  const expiredByBoot = !!held && held.bootId !== "" && info.bootId !== "" && held.bootId !== info.bootId;
  if (!expiredByTime && !expiredByPid && !expiredByBoot) return null;
  const saved = `${path}.stale`;
  if (fs.rename) {
    if (fs.unlink) {
      try {
        fs.unlink(saved);
      } catch {
      }
    }
    try {
      fs.rename(path, saved);
    } catch {
      return null;
    }
    if (fs.unlink) {
      try {
        fs.unlink(saved);
      } catch {
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
function handleOf(fs, path, token) {
  let lost = false;
  return {
    token,
    lost() {
      return lost;
    },
    renew() {
      const held = readLock(fs, path);
      if (!held || held.token !== token) {
        lost = true;
        return false;
      }
      const next = JSON.stringify({ ...held, at: (/* @__PURE__ */ new Date()).toISOString() });
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
    release() {
      const held = readLock(fs, path);
      if (!held || held.token !== token || !fs.unlink) return;
      for (let i = 0; i < 2; i += 1) {
        try {
          fs.unlink(path);
          return;
        } catch {
        }
      }
    }
  };
}
async function withLock(dataDir, owner, fn, opts = {}) {
  const lock = acquireLock(dataDir, owner, opts);
  if (!lock) return null;
  const hb = opts.keepAliveMs && opts.keepAliveMs > 0 ? setInterval(() => {
    lock.renew();
  }, opts.keepAliveMs) : null;
  try {
    return await fn(lock);
  } finally {
    if (hb) clearInterval(hb);
    lock.release();
  }
}
function inspectLock(dataDir, fs = currentFs()) {
  if (!fs) return null;
  return readLock(fs, lockPathOf(dataDir));
}

// src/dock/registry-file.ts
function readRegistryAt(path, fs) {
  const text = readTextOf(path, fs);
  if (text === null) return { registry: emptyRegistry() };
  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch {
    return { registry: emptyRegistry(), error: "登记表不是合法 JSON，已按空处理" };
  }
  const parsed = parseRegistry(raw);
  return { registry: parsed.registry, error: parsed.errors[0] };
}
function writeRegistryAt(path, reg, fs) {
  if (!fs) return false;
  return writeAtomic(fs, path, JSON.stringify(reg, null, 2));
}
function upsertToolAt(path, entry, fs) {
  const { registry } = readRegistryAt(path, fs);
  const i = registry.tools.findIndex((t) => t.id === entry.id);
  const tools = registry.tools.slice();
  if (i >= 0) tools[i] = entry;
  else tools.push(entry);
  const next = { ...registry, tools };
  writeRegistryAt(path, next, fs);
  return next;
}
function removeToolAt(path, id, fs) {
  const { registry } = readRegistryAt(path, fs);
  const next = { ...registry, tools: registry.tools.filter((t) => t.id !== id) };
  writeRegistryAt(path, next, fs);
  return next;
}

// src/core/external-tool.ts
var ASK_TIMEOUT_DEFAULT_SEC = 300;
var ASK_TIMEOUT_MIN_SEC = 10;
var ASK_TIMEOUT_MAX_SEC = 600;
var BZ_LINE_PREFIX_RE = /^\[bz-(step|p|info|result|ask)\]/;
function parseAskBody(body) {
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return null;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return null;
  const raw = typeof body.body === "string" ? body.body : "";
  const html = typeof body.bodyHtml === "string" ? body.bodyHtml.trim() : "";
  const sec = Number(body.timeoutSec);
  const timeoutSec = Number.isFinite(sec) ? Math.min(ASK_TIMEOUT_MAX_SEC, Math.max(ASK_TIMEOUT_MIN_SEC, Math.floor(sec))) : ASK_TIMEOUT_DEFAULT_SEC;
  return {
    id,
    title,
    body: raw,
    bodyHtml: html,
    confirmText: typeof body.confirmText === "string" && body.confirmText.trim() ? body.confirmText.trim() : "确认",
    cancelText: typeof body.cancelText === "string" && body.cancelText.trim() ? body.cancelText.trim() : "取消",
    timeoutSec
  };
}
function parseBzLine(line) {
  const text = line.endsWith("\r") ? line.slice(0, -1) : line;
  const m = text.match(BZ_LINE_PREFIX_RE);
  if (!m) {
    if (!text.trim()) return null;
    return { kind: "raw", text };
  }
  const body = text.slice(m[0].length).trim();
  switch (m[1]) {
    case "step":
      return body ? { kind: "step", text: body } : null;
    case "p": {
      const p = parseJsonObject(body);
      if (!p) return null;
      return {
        kind: "progress",
        phase: typeof p.phase === "string" ? p.phase : null,
        // pct 允许 null = 该阶段不可估；缺失/非有限数一律归 null（绝不假报）
        pct: Number.isFinite(p.pct) ? Number(p.pct) : null
      };
    }
    case "info": {
      const info = parseJsonObject(body);
      return info ? { kind: "info", data: info } : null;
    }
    case "ask": {
      const b = parseJsonObject(body);
      const ask = b ? parseAskBody(b) : null;
      return ask ? { kind: "ask", ask } : null;
    }
    default: {
      const r = parseJsonObject(body);
      return r ? { kind: "result", data: r } : null;
    }
  }
}
function parseJsonObject(body) {
  try {
    const v = JSON.parse(body);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
var MAX_LINE_BYTES = 1024 * 1024;
var BzLineSplitter = class {
  constructor(maxLineBytes = MAX_LINE_BYTES) {
    this.maxLineBytes = maxLineBytes;
    this.parts = [];
    this.len = 0;
    this.overflowed = false;
  }
  /** 喂一段 stdout（Buffer 或 string），返回其中切出的完整行（不含行尾符） */
  push(chunk) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    const lines = [];
    let pos = 0;
    while (pos < buf.length) {
      const nl = buf.indexOf(10, pos);
      if (nl === -1) {
        this.accumulate(buf.subarray(pos));
        break;
      }
      this.accumulate(buf.subarray(pos, nl));
      lines.push(this.takeLine());
      pos = nl + 1;
    }
    return lines;
  }
  /** 进程终结时冲刷残留半行（无残留返回 null）——无尾换行的最后一行靠这里出列 */
  flush() {
    return this.len > 0 || this.overflowed ? this.takeLine() : null;
  }
  /** 累积字节；超出单行上限后丢弃后续字节（截断语义，待换行时一并出列） */
  accumulate(part) {
    if (this.overflowed) return;
    const room = this.maxLineBytes - this.len;
    if (part.length <= room) {
      this.parts.push(part);
      this.len += part.length;
    } else {
      this.parts.push(part.subarray(0, room));
      this.len = this.maxLineBytes;
      this.overflowed = true;
    }
  }
  /** 出列一行（overflow 时为截断行）；CRLF 的 \r 在此剥除 */
  takeLine() {
    const s = Buffer.concat(this.parts).toString("utf8");
    this.parts = [];
    this.len = 0;
    this.overflowed = false;
    return s.endsWith("\r") ? s.slice(0, -1) : s;
  }
};
var STDERR_TAIL_CHARS = 2048;
var FORCE_KILL_GRACE_MS = 3e3;
function defaultChildProcess() {
  if (typeof window === "undefined") return null;
  const w = window;
  if (!w.require) return null;
  try {
    return w.require("child_process");
  } catch {
    return null;
  }
}
function runExternalTool(spec, cb, deps2) {
  const cp = deps2 && deps2.cp ? deps2.cp : defaultChildProcess();
  const splitter = new BzLineSplitter();
  let stderrTail = "";
  let settled = false;
  let stopped = false;
  let child = null;
  let exitSeen = false;
  let exitCode = null;
  let forceTimer = null;
  let resolveDone;
  const done = new Promise((r) => {
    resolveDone = r;
  });
  const settle2 = (o) => {
    if (settled) return;
    settled = true;
    if (forceTimer !== null) {
      clearTimeout(forceTimer);
      forceTimer = null;
    }
    resolveDone(o);
  };
  const collectStderr = (d) => {
    stderrTail += String(d);
    if (stderrTail.length > STDERR_TAIL_CHARS) stderrTail = stderrTail.slice(-STDERR_TAIL_CHARS);
  };
  const dispatchLine = (line) => {
    const ev = parseBzLine(line);
    if (!ev) return;
    switch (ev.kind) {
      case "step":
        cb.onStep(ev.text);
        break;
      case "progress":
        cb.onProgress(ev.phase, ev.pct);
        break;
      case "info":
        cb.onInfo(ev.data);
        break;
      case "result":
        cb.onResult(ev.data);
        break;
      case "ask":
        cb.onAsk?.(ev.ask);
        break;
      case "raw":
        if (cb.onRaw) cb.onRaw(ev.text);
        break;
    }
  };
  if (!cp) {
    settle2({ ok: false, stopped: false, code: null, stderr: "", error: new Error("仅桌面端可用：外部工具需要 Node.js 子进程") });
    return { stop: () => {
    }, answer: () => {
    }, done };
  }
  const spawnOpts = {
    shell: !!spec.shell,
    windowsHide: true,
    // stdin 只在交互运行下开 pipe（见 spec.interactive 的说明）：给所有工具无差别开管道，
    // 等于让一个「顺手读了 stdin」的工具凭空挂住——而它本来只是想要 /dev/null。
    stdio: [spec.interactive ? "pipe" : "ignore", "pipe", "pipe"]
  };
  if (spec.cwd) spawnOpts.cwd = spec.cwd;
  if (spec.env) spawnOpts.env = spec.env;
  try {
    child = cp.spawn(spec.cmd, spec.args || [], spawnOpts);
  } catch (e) {
    settle2({ ok: false, stopped: false, code: null, stderr: stderrTail.trim(), error: new Error(`外部工具启动失败：${e?.message || String(e)}`) });
    return { stop: () => {
    }, answer: () => {
    }, done };
  }
  child.stdout?.on("data", (d) => {
    for (const line of splitter.push(d)) dispatchLine(line);
  });
  child.stderr?.on("data", collectStderr);
  child.on("error", (e) => {
    if (settled) return;
    settle2({ ok: false, stopped: false, code: null, stderr: stderrTail.trim(), error: new Error(`外部工具启动失败：${e.message}`) });
  });
  child.on("exit", (code) => {
    exitSeen = true;
    exitCode = code;
  });
  child.on("close", (code) => {
    if (settled) return;
    const rest = splitter.flush();
    if (rest !== null) dispatchLine(rest);
    const stderr = stderrTail.trim();
    if (stopped) {
      settle2({ ok: false, stopped: true, code, stderr, error: null });
      return;
    }
    if (code === 0) {
      settle2({ ok: true, stopped: false, code: 0, stderr, error: null });
      return;
    }
    const err = new Error(code === null ? `外部工具异常退出（无退出码）${stderr ? "：" + stderr : ""}` : `外部工具异常退出（退出码 ${code}）${stderr ? "：" + stderr : ""}`);
    err.stderr = stderr;
    settle2({ ok: false, stopped: false, code, stderr, error: err });
  });
  const isWindows = () => process.platform === "win32";
  const spawnSuppressed = (cmd, args) => {
    try {
      const killer = cp.spawn(cmd, args, { stdio: "ignore", windowsHide: true });
      killer.on?.("error", () => {
      });
    } catch {
    }
  };
  const escalateForceKill = () => {
    forceTimer = null;
    if (settled) return;
    const pid = child?.pid;
    if (typeof pid !== "number" || pid <= 0) return;
    if (exitSeen) {
      settle2({ ok: false, stopped: true, code: exitCode, stderr: stderrTail.trim(), error: null });
      return;
    }
    if (isWindows()) {
      spawnSuppressed("taskkill", ["/pid", String(pid), "/T", "/F"]);
      return;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
    }
  };
  const stopChild = () => {
    const pid = child?.pid;
    if (spec.shell && isWindows() && typeof pid === "number" && pid > 0) {
      spawnSuppressed("taskkill", ["/pid", String(pid), "/T"]);
    } else {
      try {
        child?.kill?.();
      } catch {
      }
    }
    if (typeof pid === "number" && pid > 0) {
      forceTimer = setTimeout(escalateForceKill, FORCE_KILL_GRACE_MS);
    }
  };
  return {
    stop: () => {
      if (settled || stopped) return;
      stopped = true;
      stopChild();
    },
    answer: (id, ok) => {
      const s = child?.stdin;
      if (!s || s.destroyed || s.writableEnded) return;
      try {
        s.write(`[bz-answer] ${JSON.stringify({ id, ok: !!ok })}
`);
      } catch {
      }
    },
    done
  };
}

// src/dock/exec.ts
function dockEnv(input) {
  const env = {
    BZ_DOCK_CONTRACT: String(CONTRACT_VERSION),
    BZ_DOCK_TOOL: input.toolId,
    BZ_DOCK_RUN_ID: input.runId,
    BZ_DOCK_TRIGGER: input.trigger,
    BZ_DOCK_RUNS_FILE: pathOf.runs(input.declPath),
    BZ_DOCK_HEARTBEAT_FILE: pathOf.heartbeat(input.declPath)
  };
  if (input.vaultPath) env.BZ_DOCK_VAULT = input.vaultPath.replace(/[\\/]+$/, "");
  if (input.manifest) Object.assign(env, secretEnvOf(input.manifest, input.values));
  return env;
}
function judgeRun(input, records) {
  const base = {
    runId: input.runId,
    code: input.code,
    signal: input.signal,
    stderr: input.stderr,
    error: input.error,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs
  };
  if (input.stopped) {
    return { ...base, ok: false, status: "stopped", kind: "aborted", record: findByRunId(records, input.runId) };
  }
  if (input.timedOut) {
    return { ...base, ok: false, status: "timeout", kind: "timeout", record: findByRunId(records, input.runId) };
  }
  const record = findByRunId(records, input.runId);
  if (record) {
    const status = record.status === "running" ? "abandoned" : record.status;
    return {
      ...base,
      ok: status === "ok",
      status,
      kind: record.error?.kind ?? (status === "ok" ? "unknown" : "unknown"),
      record: { ...record, status }
    };
  }
  const ok = input.code === 0 && !input.error;
  const kind = input.code === null ? "config" : "unknown";
  return {
    ...base,
    ok,
    status: ok ? "ok" : "failed",
    kind,
    recordMissing: input.code === null ? "进程没能启动（命令或工作目录配错了）" : "工具没写这次运行的记录，多半没跑到写记录那一步"
  };
}
function hintOf(kind, recordMissing) {
  if (recordMissing) return recordMissing;
  switch (kind) {
    case "auth":
      return "登录态失效了，去重新填一次凭据";
    case "network":
      return "网络不通，检查代理或稍后重试";
    case "config":
      return "命令或参数配错了，检查启动命令与工作目录";
    case "timeout":
      return "跑超时了，可能是网络慢或任务量变大";
    case "aborted":
      return "被手动中止";
    default:
      return "打开运行记录看 stderr 尾部";
  }
}
function statusText(status) {
  switch (status) {
    case "ok":
      return "成功";
    case "failed":
      return "失败";
    case "timeout":
      return "超时";
    case "stopped":
      return "已中止";
    case "abandoned":
      return "没收尾";
    case "running":
      return "运行中";
  }
}
var deps;
function setExecDeps(d) {
  deps = d;
}
var live = /* @__PURE__ */ new Map();
var listeners = /* @__PURE__ */ new Set();
function liveOf(toolId) {
  return live.get(toolId);
}
function liveAll() {
  return Array.from(live.values()).sort((a, b) => (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0));
}
function fireLive() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
    }
  }
}
function runToolNow(args) {
  const runId = args.runId ?? makeRunId();
  const trigger = args.trigger ?? "manual";
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const rawTail = [];
  const steps = [];
  const spec = {
    cmd: args.entry.cmd,
    args: [...args.entry.args ?? [], ...buildArgs(args.manifest ?? { params: [] }, args.values), ...args.extraArgs ?? []],
    shell: args.entry.shell ?? /\.(cmd|bat)$/i.test(args.entry.cmd),
    /**
     * 工作目录，契约写的是「缺省 = 声明所在目录」。
     *
     * 这一句必须显式给：不给的话子进程继承宿主进程的 cwd —— 插件里是 Obsidian 的目录，
     * 值守里是仓库根。两种都不是工具目录，「`args: ['main.mjs']` 的相对路径」当场失效，
     * 症状是「面板上跑得起来、值守里报找不到文件」。
     */
    cwd: args.entry.cwd ?? dirOf(args.declPath),
    env: dockEnv({
      toolId: args.toolId,
      declPath: args.declPath,
      runId,
      trigger,
      vaultPath: args.vaultPath,
      manifest: args.manifest,
      values: args.values
    }),
    interactive: typeof args.cb?.onAsk === "function"
  };
  let phase = null;
  let pct = null;
  let timedOut = false;
  let handleRef = null;
  let runRef = null;
  const handle = runExternalTool(
    spec,
    {
      onStep: (text) => {
        steps.push({ text, at: (/* @__PURE__ */ new Date()).toISOString(), status: "ok" });
        args.cb?.onStep?.(text);
      },
      onProgress: (p, v) => {
        phase = p;
        pct = v;
        if (runRef) {
          runRef.phase = p;
          runRef.pct = v;
        }
        args.cb?.onProgress?.(p, v);
      },
      onInfo: (d) => args.cb?.onInfo?.(d),
      onResult: (d) => args.cb?.onResult?.(d),
      onRaw: (t) => {
        rawTail.push(t);
        if (rawTail.length > 200) rawTail.shift();
      },
      onAsk: (req) => {
        const ask = args.cb?.onAsk;
        if (!ask) {
          handleRef?.answer?.(req.id, false);
          return;
        }
        void Promise.resolve().then(() => ask(req)).then((yes) => handleRef?.answer?.(req.id, !!yes)).catch(() => handleRef?.answer?.(req.id, false));
      }
    },
    deps
  );
  handleRef = handle;
  const run = {
    runId,
    toolId: args.toolId,
    trigger,
    startedAt,
    steps,
    phase,
    pct,
    rawTail,
    handle,
    done: Promise.resolve(void 0)
  };
  runRef = run;
  const timeoutMs = args.timeoutMs ?? RUN_TIMEOUT_MS;
  const timer = timeoutMs > 0 ? setTimeout(() => {
    timedOut = true;
    handle.stop();
  }, timeoutMs) : null;
  run.done = handle.done.then((o) => {
    if (timer) clearTimeout(timer);
    const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    const outcome = judgeRun(
      {
        runId,
        toolId: args.toolId,
        startedAt,
        finishedAt,
        durationMs: Date.parse(finishedAt) - startedMs,
        code: o.code,
        stopped: o.stopped && !timedOut,
        timedOut,
        error: o.error,
        stderr: o.stderr
      },
      args.records()
    );
    live.delete(args.toolId);
    fireLive();
    args.cb?.onDone?.(outcome);
    return outcome;
  });
  live.set(args.toolId, run);
  fireLive();
  return run;
}

// src/dock/exit-pulse.ts
var EXIT_PULSE_FILENAME = "dock.exit.json";
function exitPulsePath(dataDir) {
  return joinPath(dataDir, EXIT_PULSE_FILENAME);
}
function selfPid() {
  try {
    const p = globalThis.process;
    const n = p?.pid;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
function pidAlive2(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return true;
  const p = globalThis.process;
  if (typeof p?.kill !== "function") return true;
  try {
    p.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}
function readExitPulse(dataDir, fs = currentFs()) {
  if (!fs || !dataDir) return null;
  const raw = fs.readText(exitPulsePath(dataDir));
  if (raw === null) return null;
  try {
    const o = JSON.parse(raw);
    const at = typeof o?.at === "string" ? o.at : "";
    const pid = typeof o?.pid === "number" ? o.pid : Number(o?.pid);
    if (!at || !Number.isFinite(Date.parse(at))) return null;
    return { at, pid: Number.isFinite(pid) ? pid : 0 };
  } catch {
    return null;
  }
}
function clearExitPulse(dataDir, fs = currentFs()) {
  if (!fs || !dataDir || !fs.unlink) return;
  try {
    fs.unlink(exitPulsePath(dataDir));
  } catch {
  }
}
function exitPulseFires(pulse, self = selfPid()) {
  if (!pulse) return false;
  if (!Number.isFinite(Date.parse(pulse.at))) return false;
  if (!Number.isFinite(pulse.pid) || pulse.pid <= 0) return false;
  if (self > 0 && pulse.pid === self) return false;
  return !pidAlive2(pulse.pid);
}

// src/dock/tick-once.ts
var KEEP_ALIVE_MS = 2e4;
async function tickOnce(opts) {
  const fs = opts.fs === void 0 ? currentFs() : opts.fs;
  if (!fs) return { skipped: "no-fs" };
  const now = opts.now ?? Date.now();
  let inner;
  try {
    inner = await withLock(
      opts.dataDir,
      opts.owner,
      async (lock) => {
        const { registry } = readRegistryAt(opts.registryPath, fs);
        const views = loadToolViews(registry.tools, { trust: opts.trust, fs });
        for (const view of views) {
          try {
            reclaimStale(view, now, fs);
          } catch (e) {
            opts.onError?.(e);
          }
        }
        const pulse = readExitPulse(opts.dataDir, fs);
        const exitFires = exitPulseFires(pulse);
        const events = exitFires ? [...opts.events ?? [], { kind: "obsidian-exit" }] : [...opts.events ?? []];
        const result = await runTick({
          dataDir: opts.dataDir,
          registry,
          views,
          now,
          sessionStart: opts.sessionStart,
          events,
          liveIds: opts.liveIds ?? /* @__PURE__ */ new Set(),
          values: readThresholds(views, opts.vaultPath, fs),
          fs,
          execute: (view, rule, runId) => executeOne(view, rule, runId, opts, fs),
          remind: (view, rule) => opts.onRemind?.(view, rule),
          shouldStop: () => lock.lost()
        });
        if (exitFires) clearExitPulse(opts.dataDir, fs);
        opts.onPlan?.(result.decisions, result);
        return { registry, views, result };
      },
      { fs, now, keepAliveMs: opts.keepAliveMs ?? KEEP_ALIVE_MS }
    );
  } catch (e) {
    opts.onError?.(e);
    return { skipped: "error" };
  }
  if (inner === null) return { skipped: "locked" };
  return { skipped: inner.skip, registry: inner.registry, views: inner.views, result: inner.result };
}
function readThresholds(views, vaultPath, fs) {
  const out = /* @__PURE__ */ new Map();
  const docs = /* @__PURE__ */ new Map();
  for (const view of views) {
    for (const rule of view.rules) {
      const t = rule.trigger;
      if (t.kind !== "value-threshold") continue;
      const file = vaultFileOf(t.path, vaultPath);
      if (!file) continue;
      let doc;
      if (docs.has(file)) {
        doc = docs.get(file);
      } else {
        doc = void 0;
        const size = fs.size?.(file);
        const text = size !== void 0 && size > 2 * 1024 * 1024 ? null : fs.readText(file);
        if (text !== null) {
          try {
            doc = JSON.parse(text);
          } catch {
            doc = void 0;
          }
        }
        docs.set(file, doc);
      }
      const n = pickNumber(doc, t.key);
      if (n !== void 0) out.set(thresholdKey(view.id, rule.id), n);
    }
  }
  return out;
}
function vaultFileOf(p, vaultPath) {
  const raw = String(p ?? "").trim();
  if (!raw) return null;
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("//")) return raw;
  const root = vaultPath?.replace(/\\/g, "/").replace(/\/+$/, "");
  if (raw.startsWith("/")) return root ? `${root}${raw}` : null;
  return root ? joinPath(root, raw) : null;
}
function pickNumber(doc, key) {
  const parts = String(key ?? "").split(".").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return void 0;
  let cur = doc;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return void 0;
    cur = cur[part];
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : void 0;
}
async function executeOne(view, rule, runId, opts, fs) {
  const at = (/* @__PURE__ */ new Date()).toISOString();
  if (!view.entry) {
    return {
      ok: false,
      status: "failed",
      runId,
      code: null,
      stderr: "",
      error: new Error("没有可执行的启动命令"),
      kind: "config",
      startedAt: at,
      finishedAt: at,
      durationMs: 0,
      recordMissing: "声明里没有 entry，跑不起来"
    };
  }
  const live2 = runToolNow({
    toolId: view.id,
    declPath: view.path,
    entry: view.entry,
    manifest: view.manifest,
    values: view.values,
    vaultPath: opts.vaultPath,
    trigger: "auto",
    // 工单号由内核定（pending 里已经记下），这里必须原样传
    runId,
    records: () => parseRunLines(readRunsText(pathOf.runs(view.path), fs, RUNS_TAIL_BYTES), view.id),
    cb: {
      onStep: (text) => opts.onStep?.(view, text, runId)
      // 没人可问 = 立即按取消回（`exec` 的既有约定），这里不需要额外处理
    }
  });
  const outcome = await live2.done;
  opts.onOutcome?.(view, outcome);
  return outcome;
}

// src/core/storage-path.ts
var DEFAULT_STORAGE_DIR = "CONFIG/STORAGE";
function normalizeStorageDir(value) {
  let dir = (value || DEFAULT_STORAGE_DIR).trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (/\.json$/i.test(dir)) {
    const idx = dir.lastIndexOf("/");
    dir = idx >= 0 ? dir.slice(0, idx) : "";
  }
  return dir || DEFAULT_STORAGE_DIR;
}
function storageFileIn(dir, name) {
  return `${normalizeStorageDir(dir).replace(/\/+$/, "")}/${name}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BREAKER_THRESHOLD,
  CONTRACT_VERSION,
  DECLARATION_FILENAME,
  DEFAULT_STORAGE_DIR,
  FAIL_COOLDOWN_MS,
  HEARTBEAT_FILENAME,
  HEARTBEAT_STALE_MS,
  INTENT_FILENAME,
  INTENT_VERSION,
  KEEP_ALIVE_MS,
  LOCK_FILENAME,
  LOCK_STALE_MS,
  MAX_ATTEMPTS,
  PANEL_FILENAME,
  REGISTRY_FILENAME,
  REGISTRY_VERSION,
  RUNS_FILENAME,
  RUNS_KEEP,
  RUNS_TAIL_BYTES,
  RUNTIME_FILENAME,
  RUNTIME_VERSION,
  RUN_TIMEOUT_MS,
  SETTINGS_FILENAME,
  SETTINGS_VERSION,
  TOOL_ID_MAX_LEN,
  TOOL_ID_RE,
  TRIGGER_KINDS,
  TRIGGER_LABEL,
  VAULT_PATH_PREFIX,
  acquireLock,
  actionText,
  buildArgs,
  clearBreaker,
  currentFs,
  dirOf,
  displayNameOf,
  dockVaultRootNow,
  findByRunId,
  hintOf,
  inspectLock,
  isEventTrigger,
  isPortablePath,
  joinPath,
  judgeRun,
  latestRun,
  liveAll,
  liveOf,
  loadToolView,
  loadToolViews,
  makeRunId,
  missingParams,
  nextDueOf,
  normalizeStorageDir,
  parseIntent,
  parseManifest,
  parseRegistry,
  parseRunLines,
  parseRuntime,
  parseSettingsText,
  pathOf,
  planTick,
  portableToolPath,
  readRegistryAt,
  readTextOf,
  reclaimStale,
  removeToolAt,
  resolveToolPath,
  ruleDue,
  ruleName,
  runSignature,
  runTick,
  runToolNow,
  secretEnvOf,
  setDockFs,
  setDockVaultRoot,
  setExecDeps,
  settle,
  statusText,
  storageFileIn,
  tickOnce,
  triggerText,
  upsertToolAt,
  withLock,
  writeAtomic,
  writeRegistryAt
});
