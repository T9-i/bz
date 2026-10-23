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
  DECLARATION_FILENAME: () => DECLARATION_FILENAME,
  DOCK_RUNS_PER_TOOL_LIMIT: () => DOCK_RUNS_PER_TOOL_LIMIT,
  MAIN_ENTRY_FILENAME: () => MAIN_ENTRY_FILENAME,
  OFFLINE_STALE_MS: () => OFFLINE_STALE_MS,
  RUNS_FILENAME: () => RUNS_FILENAME,
  SETTINGS_FILENAME: () => SETTINGS_FILENAME,
  TOOL_ID_MAX_LEN: () => TOOL_ID_MAX_LEN,
  TOOL_ID_RE: () => TOOL_ID_RE,
  TOOL_STATE_FILENAME: () => TOOL_STATE_FILENAME,
  TOOL_STATE_VERSION: () => TOOL_STATE_VERSION,
  buildArgs: () => buildArgs,
  currentFs: () => currentFs,
  dirOf: () => dirOf,
  effectiveRules: () => effectiveRules,
  hasActiveRule: () => hasActiveRule,
  joinPath: () => joinPath,
  missingRequiredParams: () => missingRequiredParams,
  offlineRunningOf: () => offlineRunningOf,
  parseJsonObjectText: () => parseJsonObjectText,
  parseManifest: () => parseManifest,
  parseRuleState: () => parseRuleState,
  parseRules: () => parseRules,
  parseRunState: () => parseRunState,
  parseRunsFileText: () => parseRunsFileText,
  parseSchedule: () => parseSchedule,
  parseToolEntries: () => parseToolEntries,
  parseToolState: () => parseToolState,
  readDeclaration: () => readDeclaration,
  readRunsText: () => readRunsText,
  readSettings: () => readSettings,
  readToolState: () => readToolState,
  resolveRun: () => resolveRun,
  ruleDue: () => ruleDue,
  runSignature: () => runSignature,
  runsPathFor: () => runsPathFor,
  setDockFs: () => setDockFs,
  settingsPathFor: () => settingsPathFor,
  toolDirOf: () => toolDirOf,
  toolStateOf: () => toolStateOf,
  toolStatePathFor: () => toolStatePathFor,
  writeToolState: () => writeToolState
});
module.exports = __toCommonJS(watch_core_exports);

// src/dock/schema.ts
var DOCK_CONTRACT_VERSION = 1;
var DOCK_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
var DOCK_ID_MAX_LEN = 64;
var PARAM_TYPES = /* @__PURE__ */ new Set([
  "text",
  "multiline",
  "number",
  "bool",
  "choice",
  "multichoice",
  "path",
  "secret"
]);
var SCHEDULE_KINDS = /* @__PURE__ */ new Set([
  "daily",
  "weekly",
  "interval",
  "on-demand",
  "unknown"
]);
var DOCK_ACTION_ID_RE = /^[a-z0-9][a-z0-9:._-]*$/;
var DOCK_ACTION_ID_MAX_LEN = 64;
var ACTION_ARG_TYPES = /* @__PURE__ */ new Set(["appid", "text"]);
var RUN_STATUSES = /* @__PURE__ */ new Set([
  "ok",
  "failed",
  "stopped",
  "running",
  "timeout"
]);
var ERROR_KINDS = /* @__PURE__ */ new Set([
  "auth",
  "network",
  "config",
  "timeout",
  "aborted",
  "unknown"
]);
var DOCK_RUNS_PER_TOOL_LIMIT = 200;
function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v) {
  return typeof v === "string" ? v : void 0;
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function bool(v) {
  return typeof v === "boolean" ? v : void 0;
}
function nonEmptyStr(v) {
  const s = str(v);
  return s !== void 0 && s.trim() !== "" ? s : void 0;
}
function intInRange(v, lo, hi) {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : void 0;
}
function parseJsonObjectText(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.charCodeAt(0) === 65279 ? text.slice(1) : text;
  if (trimmed.trim() === "") return null;
  try {
    const v = JSON.parse(trimmed);
    return isPlainObject(v) ? v : null;
  } catch {
    return null;
  }
}
function parseParam(raw) {
  if (!isPlainObject(raw)) return null;
  const key = nonEmptyStr(raw.key);
  const label = nonEmptyStr(raw.label);
  const type = str(raw.type);
  if (!key || !label || !type || !PARAM_TYPES.has(type)) return null;
  let options;
  if (type === "choice" || type === "multichoice") {
    if (Array.isArray(raw.options)) {
      const kept = [];
      for (const o of raw.options) {
        if (!isPlainObject(o)) continue;
        const value = str(o.value);
        if (value === void 0) continue;
        kept.push({ value, label: nonEmptyStr(o.label) ?? value });
      }
      options = kept;
    }
  }
  const out = { key, label, type };
  if ("default" in raw) out.default = raw.default;
  const help = nonEmptyStr(raw.help);
  if (help) out.help = help;
  const placeholder = nonEmptyStr(raw.placeholder);
  if (placeholder) out.placeholder = placeholder;
  const required = bool(raw.required);
  if (required !== void 0) out.required = required;
  const min = num(raw.min);
  if (min !== void 0) out.min = min;
  const max = num(raw.max);
  if (max !== void 0) out.max = max;
  const step = num(raw.step);
  if (step !== void 0) out.step = step;
  const rows = num(raw.rows);
  if (rows !== void 0) out.rows = rows;
  if (type === "path") {
    const mode = str(raw.mode);
    out.mode = mode === "file" || mode === "dir" ? mode : "file";
  }
  if (options) out.options = options;
  return out;
}
function parseSchedule(raw) {
  if (!isPlainObject(raw)) return void 0;
  const kind = str(raw.kind);
  if (!kind || !SCHEDULE_KINDS.has(kind)) return void 0;
  const s = { kind };
  const note = nonEmptyStr(raw.note);
  if (note) s.note = note;
  const hour = intInRange(raw.hour, 0, 23);
  if (hour !== void 0) s.hour = hour;
  const weekday = intInRange(raw.weekday, 0, 6);
  if (weekday !== void 0) s.weekday = weekday;
  const everyHours = num(raw.everyHours);
  if (everyHours !== void 0 && everyHours > 0) s.everyHours = everyHours;
  return s;
}
var ARG_NAME_RE = /^[a-z][a-z0-9_]*$/;
var ARG_PLACEHOLDER_RE = /\{\{([a-z][a-z0-9_]*)\}\}/g;
function parseAction(raw) {
  if (!isPlainObject(raw)) return null;
  const out = { ...raw };
  const argSpecs = {};
  if (isPlainObject(raw.args)) {
    for (const [key, v] of Object.entries(raw.args)) {
      if (!ARG_NAME_RE.test(key)) continue;
      if (!isPlainObject(v)) continue;
      const type = str(v.type);
      if (!type || !ACTION_ARG_TYPES.has(type)) continue;
      const spec = { type };
      const many = bool(v.many);
      if (many !== void 0) spec.many = many;
      argSpecs[key] = spec;
    }
  }
  if (Object.keys(argSpecs).length) out.args = argSpecs;
  else delete out.args;
  if (isPlainObject(raw.run) && Array.isArray(raw.run.args)) {
    const tpl = raw.run.args.filter((x) => typeof x === "string");
    const declared = new Set(Object.keys(argSpecs));
    const ok = tpl.every((t) => [...t.matchAll(ARG_PLACEHOLDER_RE)].every((m) => declared.has(m[1])));
    if (!ok) return null;
    if (tpl.length) out.run = { args: tpl };
    else delete out.run;
  } else {
    delete out.run;
  }
  if (!out.run) return null;
  return out;
}
function parseActions(raw) {
  if (!isPlainObject(raw)) return void 0;
  const out = {};
  for (const [id, v] of Object.entries(raw)) {
    if (id.length > DOCK_ACTION_ID_MAX_LEN || !DOCK_ACTION_ID_RE.test(id)) continue;
    const parsed = parseAction(v);
    if (parsed) out[id] = parsed;
  }
  return Object.keys(out).length ? out : void 0;
}
function parseManifest(raw) {
  if (!isPlainObject(raw)) return null;
  if (raw.v !== DOCK_CONTRACT_VERSION) return null;
  const id = str(raw.id);
  if (!id || id.length > DOCK_ID_MAX_LEN || !DOCK_ID_RE.test(id)) return null;
  const name = nonEmptyStr(raw.name);
  if (!name) return null;
  const params = [];
  if (Array.isArray(raw.params)) {
    const seen = /* @__PURE__ */ new Set();
    for (const p of raw.params) {
      const parsed = parseParam(p);
      if (!parsed) continue;
      if (seen.has(parsed.key)) continue;
      seen.add(parsed.key);
      params.push(parsed);
    }
  }
  const out = { ...raw, v: DOCK_CONTRACT_VERSION, id, name, params };
  out.description = nonEmptyStr(raw.description);
  out.author = nonEmptyStr(raw.author);
  out.toolVersion = nonEmptyStr(raw.toolVersion);
  out.icon = nonEmptyStr(raw.icon);
  out.group = nonEmptyStr(raw.group);
  out.docs = nonEmptyStr(raw.docs);
  out.desktopOnly = bool(raw.desktopOnly);
  if (Array.isArray(raw.produces)) {
    out.produces = raw.produces.filter((x) => typeof x === "string");
  }
  if (isPlainObject(raw.run)) {
    const cmd = nonEmptyStr(raw.run.cmd)?.trim();
    if (cmd) {
      const r = { cmd };
      if (Array.isArray(raw.run.args)) {
        const args = raw.run.args.filter((x) => typeof x === "string");
        if (args.length) r.args = args;
      }
      const cwd = nonEmptyStr(raw.run.cwd)?.trim();
      if (cwd) r.cwd = cwd;
      const shell = bool(raw.run.shell);
      if (shell !== void 0) r.shell = shell;
      out.run = r;
    } else {
      delete out.run;
    }
  } else {
    delete out.run;
  }
  const schedule = parseSchedule(raw.schedule);
  if (schedule) out.schedule = schedule;
  else delete out.schedule;
  const actions = parseActions(raw.actions);
  if (actions) out.actions = actions;
  else delete out.actions;
  if (isPlainObject(raw.runtime)) {
    const estimatedSec = num(raw.runtime.estimatedSec);
    out.runtime = estimatedSec !== void 0 && estimatedSec > 0 ? { estimatedSec } : {};
  } else {
    delete out.runtime;
  }
  return out;
}
function parseRunRecord(raw) {
  if (!isPlainObject(raw)) return null;
  const startedAt = nonEmptyStr(raw.startedAt);
  const status = str(raw.status);
  if (!startedAt || !status || !RUN_STATUSES.has(status)) return null;
  const runId = nonEmptyStr(raw.runId) ?? startedAt;
  const trigger = str(raw.trigger) === "auto" ? "auto" : "manual";
  const out = { ...raw, runId, trigger, status, startedAt };
  out.finishedAt = nonEmptyStr(raw.finishedAt);
  if (raw.exitCode === null) out.exitCode = null;
  else out.exitCode = num(raw.exitCode);
  out.durationMs = num(raw.durationMs);
  out.message = nonEmptyStr(raw.message);
  if (isPlainObject(raw.params)) out.params = raw.params;
  else delete out.params;
  if (Array.isArray(raw.steps)) {
    const steps = [];
    for (const s of raw.steps) {
      if (!isPlainObject(s)) continue;
      const text = nonEmptyStr(s.text);
      if (!text) continue;
      const step = { text };
      const at = nonEmptyStr(s.at);
      if (at) step.at = at;
      const st = nonEmptyStr(s.status);
      if (st) step.status = st;
      steps.push(step);
    }
    if (steps.length) out.steps = steps;
    else delete out.steps;
  } else {
    delete out.steps;
  }
  if (isPlainObject(raw.progress)) {
    const phase = nonEmptyStr(raw.progress.phase) ?? null;
    const pctRaw = raw.progress.pct;
    const pct = typeof pctRaw === "number" && Number.isFinite(pctRaw) ? pctRaw : null;
    out.progress = { phase, pct };
  } else {
    delete out.progress;
  }
  if (!Array.isArray(raw.info)) delete out.info;
  if (!("result" in raw)) delete out.result;
  if (isPlainObject(raw.metrics)) {
    const metrics = {};
    for (const [k, v] of Object.entries(raw.metrics)) {
      const n = num(v);
      if (n !== void 0) metrics[k] = n;
    }
    if (Object.keys(metrics).length) out.metrics = metrics;
    else delete out.metrics;
  } else {
    delete out.metrics;
  }
  if (Array.isArray(raw.artifacts)) {
    const artifacts = [];
    for (const a of raw.artifacts) {
      if (!isPlainObject(a)) continue;
      const path = nonEmptyStr(a.path);
      if (!path) continue;
      const label = nonEmptyStr(a.label);
      artifacts.push(label ? { path, label } : { path });
    }
    if (artifacts.length) out.artifacts = artifacts;
    else delete out.artifacts;
  } else {
    delete out.artifacts;
  }
  if (isPlainObject(raw.error)) {
    const kindRaw = str(raw.error.kind);
    const kind = kindRaw && ERROR_KINDS.has(kindRaw) ? kindRaw : "unknown";
    const error = { kind };
    const detail = nonEmptyStr(raw.error.detail);
    if (detail) error.detail = detail;
    const stderr = nonEmptyStr(raw.error.stderr);
    if (stderr) error.stderr = stderr;
    out.error = error;
  } else {
    delete out.error;
  }
  return out;
}
function parseRunsFile(raw, expectToolId) {
  if (!isPlainObject(raw)) return null;
  if (raw.v !== DOCK_CONTRACT_VERSION) return null;
  const tool = str(raw.tool);
  if (!tool) return null;
  if (expectToolId !== void 0 && tool !== expectToolId) return null;
  const runs = [];
  if (Array.isArray(raw.runs)) {
    for (const r of raw.runs) {
      const parsed = parseRunRecord(r);
      if (parsed) runs.push(parsed);
    }
  }
  const out = { ...raw, v: DOCK_CONTRACT_VERSION, tool, runs };
  const updatedAt = nonEmptyStr(raw.updatedAt);
  if (updatedAt) out.updatedAt = updatedAt;
  else delete out.updatedAt;
  return out;
}
function parseRunsFileText(text, expectToolId) {
  return parseRunsFile(parseJsonObjectText(text), expectToolId);
}
function buildArgs(manifest, values) {
  const args = [];
  for (const p of manifest.params) {
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

// src/dock/rules.ts
function atSecondsOf(at) {
  if (!at) return void 0;
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(at.trim());
  if (!m) return void 0;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = m[3] === void 0 ? 0 : Number(m[3]);
  if (h > 23 || mi > 59 || s > 59) return void 0;
  return h * 3600 + mi * 60 + s;
}
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function todayAt(trigger, now) {
  const sec = atSecondsOf(trigger.at);
  if (sec === void 0) return void 0;
  return startOfDay(now) + sec * 1e3;
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
      const base = ctx.sessionStart;
      if (base === void 0) return false;
      if (ctx.now < base + t.delayMin * 6e4) return false;
      return (ctx.lastFiredAt ?? 0) < base;
    }
    case "panel-open":
      return ctx.event?.kind === "panel-open";
    case "tool-ok":
      return ctx.event?.kind === "tool-ok" && ctx.event.toolId === t.toolId;
    case "tool-fail":
      return ctx.event?.kind === "tool-fail" && ctx.event.toolId === t.toolId;
    case "domain-event":
      return ctx.event?.kind === "domain-event" && ctx.event.channel === t.channel;
    case "vault-file": {
      if (ctx.event?.kind !== "vault-file") return false;
      const p = ctx.event.path ?? "";
      if (!p) return false;
      const target = t.target.replace(/\/+$/, "");
      return p === target || p.startsWith(target + "/");
    }
    case "data-threshold": {
      if (ctx.value === void 0) return false;
      if (t.op === ">") return ctx.value > t.value;
      if (t.op === "<") return ctx.value < t.value;
      return ctx.value === t.value;
    }
  }
}
var pad2 = (n) => String(n).padStart(2, "0");
function clockText(at) {
  const sec = atSecondsOf(at);
  if (sec === void 0) return at;
  return `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor(sec % 3600 / 60))}`;
}
function defaultAction() {
  return { kind: "run", notify: "fail" };
}
function seedRuleFromSchedule(s, id) {
  if (!s) return null;
  if (s.kind === "daily") {
    const h = s.hour ?? 12;
    return { id, trigger: { kind: "daily", at: `${pad2(h)}:00` }, action: defaultAction() };
  }
  if (s.kind === "interval" && s.everyHours) {
    return {
      id,
      trigger: { kind: "interval", everyMin: s.everyHours * 60 },
      action: defaultAction()
    };
  }
  return null;
}
function effectiveRules(rules, override, declared) {
  if (rules && rules.length) return rules.slice();
  const seed = seedRuleFromSchedule(override, "seed") ?? seedRuleFromSchedule(declared, "seed");
  return seed ? [seed] : [];
}
function hasActiveRule(rules) {
  return rules.some((r) => r.enabled !== false);
}
function str2(v) {
  return typeof v === "string" ? v.trim() : void 0;
}
function intOf(v, min, max) {
  if (typeof v !== "number" || !Number.isFinite(v)) return void 0;
  const n = Math.floor(v);
  if (n < min || n > max) return void 0;
  return n;
}
function parseTrigger(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  switch (r.kind) {
    case "daily": {
      const at = str2(r.at);
      if (!at || atSecondsOf(at) === void 0) return null;
      return { kind: "daily", at: clockText(at) };
    }
    case "interval": {
      const everyMin = intOf(r.everyMin, 1, 43200);
      return everyMin === void 0 ? null : { kind: "interval", everyMin };
    }
    case "on-launch": {
      const delayMin = intOf(r.delayMin, 0, 1440);
      return delayMin === void 0 ? null : { kind: "on-launch", delayMin };
    }
    case "panel-open":
      return { kind: "panel-open" };
    case "tool-ok":
      return { kind: "tool-ok", toolId: str2(r.toolId) ?? "" };
    case "tool-fail":
      return { kind: "tool-fail", toolId: str2(r.toolId) ?? "" };
    case "domain-event":
      return { kind: "domain-event", channel: str2(r.channel) ?? "" };
    case "vault-file":
      return { kind: "vault-file", target: str2(r.target) ?? "" };
    case "data-threshold": {
      const op = r.op;
      if (op !== ">" && op !== "<" && op !== "=") return null;
      const value = r.value;
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      return {
        kind: "data-threshold",
        path: str2(r.path) ?? "",
        key: str2(r.key) ?? "",
        op,
        value
      };
    }
    default:
      return null;
  }
}
function parseAction2(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  if (r.kind === "remind") {
    const open = str2(r.open);
    return open ? { kind: "remind", open } : { kind: "remind" };
  }
  if (r.kind !== "run") return null;
  const n = r.notify;
  return { kind: "run", notify: n === "always" || n === "fail" || n === "never" ? n : "fail" };
}
function parseRule(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  const id = str2(r.id);
  if (!id) return null;
  const trigger = parseTrigger(r.trigger);
  if (!trigger) return null;
  const out = { id, trigger, action: parseAction2(r.action) ?? defaultAction() };
  const name = str2(r.name);
  if (name) out.name = name;
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  const jit = intOf(r.jitterMin, 0, 720);
  if (jit !== void 0) out.jitterMin = jit;
  return out;
}
function parseRules(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of raw) {
    const parsed = parseRule(item);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push(parsed);
  }
  return out;
}
function parseRuleState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void 0;
  const out = {};
  let any = false;
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const at = str2(v.lastFiredAt);
    if (!at) continue;
    out[k] = { lastFiredAt: at };
    any = true;
  }
  return any ? out : void 0;
}

// src/dock/schedule.ts
var OFFLINE_STALE_MS = 9e4;
function offlineRunningOf(runs, runsAt, now = Date.now()) {
  const r = runs.find((x) => x.status === "running");
  if (!r) return null;
  const beat = Date.parse(runsAt ?? "") || Date.parse(r.startedAt ?? "") || 0;
  if (!beat || now - beat > OFFLINE_STALE_MS) return null;
  return r;
}
function missingRequiredParams(params, values) {
  const out = [];
  for (const p of params ?? []) {
    if (!p.required) continue;
    const v = values[p.key];
    const empty = v === void 0 || v === null || v === "" || Array.isArray(v) && v.length === 0;
    if (empty) out.push(p.label || p.key);
  }
  return out;
}

// src/dock/registry.ts
var TOOL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
var TOOL_ID_MAX_LEN = 64;
function runSignature(run) {
  return [run.cmd, run.shell ? "shell" : "raw", ...run.args ?? []].join("\0");
}
function parseToolEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const path = typeof r.path === "string" ? r.path.trim() : "";
  if (!id || id.length > TOOL_ID_MAX_LEN || !TOOL_ID_RE.test(id)) return null;
  if (!path) return null;
  const out = { id, path };
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (typeof r.trustedAt === "string" && r.trustedAt.trim()) out.trustedAt = r.trustedAt.trim();
  if (typeof r.trustedRun === "string" && r.trustedRun !== "") out.trustedRun = r.trustedRun;
  if (typeof r.autoRun === "boolean") out.autoRun = r.autoRun;
  const rules = parseRules(r.rules);
  if (rules.length) out.rules = rules;
  const ruleState = parseRuleState(r.ruleState);
  if (ruleState) out.ruleState = ruleState;
  const override = parseSchedule(r.scheduleOverride);
  if (override) {
    out.scheduleOverride = override;
    if (typeof r.overrideDeclSig === "string" && r.overrideDeclSig !== "") {
      out.overrideDeclSig = r.overrideDeclSig;
    }
  }
  return out;
}
function parseToolEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of raw) {
    const parsed = parseToolEntry(item);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push(parsed);
  }
  return out;
}

// src/dock/tool-state.ts
var TOOL_STATE_FILENAME = "dock-state.json";
var TOOL_STATE_VERSION = 1;
function isPlainObject2(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function parseRunState(raw) {
  if (!isPlainObject2(raw)) return {};
  const out = {};
  if (typeof raw.lastAttemptAt === "string" && raw.lastAttemptAt !== "") out.lastAttemptAt = raw.lastAttemptAt;
  if (typeof raw.lastAttemptOk === "boolean") out.lastAttemptOk = raw.lastAttemptOk;
  if (typeof raw.consecutiveFailures === "number" && Number.isInteger(raw.consecutiveFailures) && raw.consecutiveFailures > 0) {
    out.consecutiveFailures = raw.consecutiveFailures;
  }
  if (typeof raw.pausedAt === "string" && raw.pausedAt !== "") out.pausedAt = raw.pausedAt;
  return out;
}
function parseToolState(raw, toolId) {
  if (!isPlainObject2(raw)) return null;
  if (raw.v !== TOOL_STATE_VERSION) return null;
  if (typeof raw.tool !== "string" || raw.tool !== toolId) return null;
  const out = {};
  if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
  if (typeof raw.autoRun === "boolean") out.autoRun = raw.autoRun;
  const rules = parseRules(raw.rules);
  if (rules.length) out.rules = rules;
  const ruleState = parseRuleState(raw.ruleState);
  if (ruleState) out.ruleState = ruleState;
  const runState = parseRunState(raw.runState);
  if (Object.keys(runState).length) out.runState = runState;
  const override = parseSchedule(raw.scheduleOverride);
  if (override) {
    out.scheduleOverride = override;
    if (typeof raw.overrideDeclSig === "string" && raw.overrideDeclSig !== "") {
      out.overrideDeclSig = raw.overrideDeclSig;
    }
  }
  return out;
}
function toolStateOf(entry) {
  const out = {};
  if (typeof entry.enabled === "boolean") out.enabled = entry.enabled;
  if (typeof entry.autoRun === "boolean") out.autoRun = entry.autoRun;
  if (entry.scheduleOverride) {
    out.scheduleOverride = entry.scheduleOverride;
    if (entry.overrideDeclSig !== void 0) out.overrideDeclSig = entry.overrideDeclSig;
  }
  if (entry.rules && entry.rules.length) out.rules = entry.rules;
  if (entry.ruleState) out.ruleState = entry.ruleState;
  if (entry.runState && Object.keys(entry.runState).length) out.runState = entry.runState;
  return out;
}
function toolStateFileOf(toolId, state) {
  return { v: TOOL_STATE_VERSION, tool: toolId, ...toolStateOf(state) };
}

// src/dock/declaration.ts
var DECLARATION_FILENAME = "manifest.json";
var DECLARATION_FILENAME_LEGACY = "dock.json";
var SETTINGS_FILENAME = "data.json";
var SETTINGS_FILENAME_LEGACY = "dock.settings.json";
var RUNS_FILENAME = "runs.json";
var RUNS_FILENAME_LEGACY = "dock.runs.json";
var MAIN_ENTRY_FILENAME = "main.mjs";
var DOCK_SETTINGS_VERSION = 1;
var injectedFs;
function setDockFs(fs) {
  injectedFs = fs;
}
function defaultDockFs() {
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
      exists: typeof fs.existsSync === "function" ? (p) => {
        try {
          if (!fs.existsSync(p)) return false;
          return fs.statSync ? fs.statSync(p).isFile() : true;
        } catch {
          return false;
        }
      } : void 0,
      unlink: typeof fs.unlinkSync === "function" ? (p) => fs.unlinkSync(p) : void 0,
      mkdir: typeof fs.mkdirSync === "function" ? (p) => {
        try {
          fs.mkdirSync(p, { recursive: true });
        } catch {
        }
      } : void 0,
      readdir: typeof fs.readdirSync === "function" ? (p) => {
        try {
          return fs.readdirSync(p, { withFileTypes: true }).map((d) => ({
            name: d.name,
            dir: d.isDirectory()
          }));
        } catch {
          return null;
        }
      } : void 0
    };
  } catch {
    return null;
  }
}
function currentFs() {
  return injectedFs !== void 0 ? injectedFs : defaultDockFs();
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
function settingsPathFor(declPath) {
  return joinPath(dirOf(declPath), SETTINGS_FILENAME);
}
function runsPathFor(declPath) {
  return joinPath(dirOf(declPath), RUNS_FILENAME);
}
function toolStatePathFor(declPath) {
  return joinPath(dirOf(declPath), TOOL_STATE_FILENAME);
}
function toolDirOf(declPath) {
  return dirOf(declPath);
}
function aliasOf(p, from, to) {
  const base = p.replace(/\\/g, "/").split("/").pop() ?? "";
  if (base !== from) return null;
  return joinPath(dirOf(p), to);
}
function resolveRun(manifest, declPath, conventional) {
  const run = manifest?.run ?? conventional;
  if (!run || !run.cmd) return null;
  return {
    cmd: run.cmd,
    args: [...run.args ?? []],
    cwd: run.cwd ?? (dirOf(declPath) || void 0),
    shell: run.shell ?? /\.(cmd|bat)$/i.test(run.cmd)
  };
}
function hasMainEntry(dir, fs) {
  const p = joinPath(dir, MAIN_ENTRY_FILENAME);
  return fs.exists ? fs.exists(p) : fs.readText(p) !== null;
}
function readDeclaration(declPath, fs = currentFs()) {
  if (!fs) return { ok: false, error: "读声明需要桌面端（移动端只读面板）" };
  let text = fs.readText(declPath);
  let usedPath = declPath;
  if (text === null) {
    const alias = aliasOf(declPath, DECLARATION_FILENAME, DECLARATION_FILENAME_LEGACY) ?? aliasOf(declPath, DECLARATION_FILENAME_LEGACY, DECLARATION_FILENAME);
    if (alias !== null) {
      const alt = fs.readText(alias);
      if (alt !== null) {
        text = alt;
        usedPath = alias;
      }
    }
  }
  if (text === null) return { ok: false, error: `声明文件读不到：${declPath}` };
  const raw = parseJsonObjectText(text);
  if (raw === null) return { ok: false, error: `声明文件不是合法 JSON：${usedPath}` };
  const manifest = parseManifest(raw);
  if (!manifest) {
    return {
      ok: false,
      error: `声明文件校验不过（v 须为 1、id 只能小写字母数字连字符、name 不能空）：${usedPath}`
    };
  }
  const conventionalRun = manifest.run || !hasMainEntry(dirOf(usedPath), fs) ? void 0 : { cmd: "node", args: [MAIN_ENTRY_FILENAME] };
  return { ok: true, manifest, path: usedPath, conventionalRun };
}
function isPlainObject3(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function parseSettingsText(text, toolId) {
  if (text === null) return null;
  const raw = parseJsonObjectText(text);
  if (!raw) return {};
  if (raw.v !== DOCK_SETTINGS_VERSION) return {};
  if (raw.tool !== toolId) return {};
  return isPlainObject3(raw.values) ? { ...raw.values } : {};
}
function readSettings(declPath, toolId, fs = currentFs()) {
  if (!fs) return {};
  const direct = parseSettingsText(fs.readText(settingsPathFor(declPath)), toolId);
  if (direct !== null) return direct;
  const legacy = parseSettingsText(fs.readText(joinPath(dirOf(declPath), SETTINGS_FILENAME_LEGACY)), toolId);
  return legacy ?? {};
}
function readToolState(declPath, toolId, fs = currentFs()) {
  if (!fs) return {};
  const text = fs.readText(toolStatePathFor(declPath));
  if (text === null) return {};
  const raw = parseJsonObjectText(text);
  return parseToolState(raw, toolId) ?? {};
}
function writeToolState(declPath, toolId, state, fs = currentFs()) {
  if (!fs) return false;
  const target = toolStatePathFor(declPath);
  const keep = {};
  try {
    const prev = parseJsonObjectText(fs.readText(target));
    if (prev) for (const [k, v] of Object.entries(prev)) keep[k] = v;
  } catch {
  }
  const fresh = toolStateFileOf(toolId, state);
  const next = { ...keep, ...fresh };
  for (const k of [
    "enabled",
    "autoRun",
    "scheduleOverride",
    "overrideDeclSig",
    "rules",
    "ruleState",
    "runState"
  ]) {
    if (!(k in fresh)) delete next[k];
  }
  const text = JSON.stringify(next, null, 2);
  try {
    if (fs.readText(target) === text) return false;
  } catch {
  }
  try {
    if (fs.rename) {
      const tmp = `${target}.tmp`;
      fs.writeText(tmp, text);
      fs.rename(tmp, target);
    } else {
      fs.writeText(target, text);
    }
  } catch {
    return false;
  }
  return true;
}
function readRunsText(declPath, fs = currentFs()) {
  if (!fs) return null;
  return fs.readText(runsPathFor(declPath)) ?? fs.readText(joinPath(dirOf(declPath), RUNS_FILENAME_LEGACY));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DECLARATION_FILENAME,
  DOCK_RUNS_PER_TOOL_LIMIT,
  MAIN_ENTRY_FILENAME,
  OFFLINE_STALE_MS,
  RUNS_FILENAME,
  SETTINGS_FILENAME,
  TOOL_ID_MAX_LEN,
  TOOL_ID_RE,
  TOOL_STATE_FILENAME,
  TOOL_STATE_VERSION,
  buildArgs,
  currentFs,
  dirOf,
  effectiveRules,
  hasActiveRule,
  joinPath,
  missingRequiredParams,
  offlineRunningOf,
  parseJsonObjectText,
  parseManifest,
  parseRuleState,
  parseRules,
  parseRunState,
  parseRunsFileText,
  parseSchedule,
  parseToolEntries,
  parseToolState,
  readDeclaration,
  readRunsText,
  readSettings,
  readToolState,
  resolveRun,
  ruleDue,
  runSignature,
  runsPathFor,
  setDockFs,
  settingsPathFor,
  toolDirOf,
  toolStateOf,
  toolStatePathFor,
  writeToolState
});
