/**
 * 把工具目录里的五个文件，读成面板与内核共用的**一份视图**。
 *
 * 为什么要有这一层：面板要卡片、内核要判据、通知要名字 —— 三处各读一遍文件，
 * 就会有三处各自决定「读不到时算什么」。这里读一次，缺什么就明确标什么：
 * 声明读不到是 `error`，没授权是 `trusted=false`，跑不了是 `runnable=false`。
 * 上层只负责显示，不再做判断。
 */

import { latestRun } from './parse';
import {
  dirOf,
  pathOf,
  resolveToolPath,
  readPanelText,
  readRunsText,
  readTextOf,
  currentFs,
  type DockFs,
} from './files';
import {
  parseHeartbeat,
  parseIntent,
  parseManifest,
  parseRunLines,
  parseRuntime,
  parseSettingsText,
  runSignature,
} from './parse';
import {
  HEARTBEAT_STALE_MS,
  RUNS_TAIL_BYTES,
  type DockHeartbeat,
  type DockIntent,
  type DockManifest,
  type DockRegistryEntry,
  type DockRule,
  type DockRuntime,
  type DockRunRecord,
  type DockToolView,
} from './types';

/** 信任表：工具 id → { at, run }（`run` 是授权时那条命令的签名） */
export type TrustMap = Record<string, { at: string; run: string }>;

export interface LoadOpts {
  /** 这台机器能不能跑（移动端 false） */
  canRun?: boolean;
  trust?: TrustMap;
  fs?: DockFs | null;
}

function readManifestFile(path: string, fs: DockFs | null): { manifest: DockManifest | null; error?: string } {
  const text = readTextOf(path, fs);
  if (text === null) return { manifest: null, error: '读不到 manifest.json' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { manifest: null, error: 'manifest.json 不是合法 JSON' };
  }
  const manifest = parseManifest(raw);
  if (!manifest) {
    return { manifest: null, error: 'manifest.json 校验不过（需要 v:2、合法 id、非空 name）' };
  }
  return { manifest };
}

export function loadToolView(entry: DockRegistryEntry, opts: LoadOpts = {}): DockToolView {
  const fs = opts.fs === undefined ? currentFs() : opts.fs;
  // 登记表里可能存的是 `vault:` 相对形态（跟着 vault 走）。所有读写都用还原后的绝对路径；
  // 原样留在 `declaredPath` 里，只给「从哪来的」这类展示用。
  const declPath = resolveToolPath(entry.path);
  const { manifest, error } = readManifestFile(declPath, fs ?? null);

  const intentRaw = fs ? readTextOf(pathOf.intent(declPath), fs) : null;
  const intent: DockIntent = parseIntent(safeJson(intentRaw), entry.id);

  const runtimeRaw = fs ? readTextOf(pathOf.runtime(declPath), fs) : null;
  const runtime: DockRuntime = parseRuntime(safeJson(runtimeRaw), entry.id);

  const settingsRaw = fs ? readTextOf(pathOf.settings(declPath), fs) : null;
  const parsedValues = parseSettingsText(settingsRaw, entry.id);
  const values = parsedValues ?? {};

  const records = fs ? parseRunLines(readRunsText(pathOf.runs(declPath), fs, RUNS_TAIL_BYTES), entry.id) : [];

  // 心跳：**新鲜**只说明「刚才还活着」，不说明「现在还在跑」。工具跑完不会删
  // `heartbeat.json`（契约里它只有「活着」这一个含义），所以再拿它的 runId 去账本里对一眼：
  // 已经有这一单的终态记录 = 早就跑完了。少了这一眼，跑完后的 60 秒里面板还会把按钮
  // 锁在「后台正在跑」，用户得干等或者重开面板（2026-10-24 实测撞上）。
  const beat = heartbeatOf(declPath, fs);
  const heartbeat = beat && !records.some((r) => r.runId === beat.runId) ? beat : null;

  const trust = opts.trust?.[entry.id];
  const signature = runSignature(manifest?.entry ?? null);
  const trusted = !!trust && !!signature && trust.run === signature;

  const rules: DockRule[] = intent.rules?.length ? intent.rules : (manifest?.defaultRules ?? []);

  return {
    id: entry.id,
    path: declPath,
    declaredPath: entry.path,
    dir: dirOf(declPath),
    manifest,
    error: error ?? (manifest && manifest.id !== entry.id ? `声明的 id 是 ${manifest.id}，登记的是 ${entry.id}` : undefined),
    entry: manifest?.entry ?? null,
    params: manifest?.params ?? [],
    values,
    intent,
    runtime,
    rules,
    trusted,
    trustStale: !!trust && !!signature && trust.run !== signature,
    lastRun: latestRun(records) as DockRunRecord | undefined,
    heartbeat: heartbeat ?? undefined,
    runnable: (opts.canRun ?? true) && !!manifest?.entry,
  };
}

/** 整表装载（顺序即登记顺序 —— 面板与「该跑的先跑」都靠它稳定） */
export function loadToolViews(entries: readonly DockRegistryEntry[], opts: LoadOpts = {}): DockToolView[] {
  return entries.map((e) => loadToolView(e, opts));
}

/** 某工具最近若干条记录（详情页用；按时间倒序） */
export function recentRunsOf(declPath: string, toolId: string, limit = 20, fs: DockFs | null = currentFs()): DockRunRecord[] {
  const all = parseRunLines(readRunsText(pathOf.runs(resolveToolPath(declPath)), fs, RUNS_TAIL_BYTES), toolId);
  return all
    .slice()
    .sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0))
    .slice(0, limit);
}

/**
 * 只读心跳（`heartbeat.json`）。
 *
 * 单独一个函数是因为**列表页每 3 秒要问一遍「谁在跑」** —— 为了这一件事去
 * `loadToolView`（它会读声明、意图、账本、设置、记录尾部）等于每 3 秒把所有文件读一遍。
 */
export function heartbeatOf(declPath: string, fs: DockFs | null = currentFs()): DockHeartbeat | null {
  if (!fs) return null;
  return parseHeartbeat(safeJson(readTextOf(pathOf.heartbeat(resolveToolPath(declPath)), fs)));
}

/**
 * 「这个工具现在还在跑吗」—— 列表页每 3 秒要问一遍的那件事。
 *
 * 判据两条，缺一不可，而且**必须和 `loadToolView` 里的口径一致**（那边少的是时效这一步）：
 *  1) 心跳够新鲜（`HEARTBEAT_STALE_MS` 内）；
 *  2) 账本里**还没有**这一单（同一个 runId）的终态记录 —— 有就是跑完了，心跳只是没删。
 *
 * 少了第 2 条，跑完之后的 60 秒会继续显示「正在跑」；少了第 1 条，工具崩掉后心跳留着，
 * 就永远在跑。两处不一致则更糟：卡片挂着绿点，点进去按钮却是可用的。
 */
export function runningHeartbeatOf(
  declPath: string,
  fs: DockFs | null = currentFs(),
  now: number = Date.now(),
): DockHeartbeat | null {
  const hb = heartbeatOf(declPath, fs);
  if (!hb) return null;
  const at = Date.parse(hb.at);
  if (!Number.isFinite(at) || now - at > HEARTBEAT_STALE_MS) return null;
  if (!fs) return hb;
  const records = parseRunLines(readRunsText(pathOf.runs(resolveToolPath(declPath)), fs, RUNS_TAIL_BYTES));
  return records.some((r) => r.runId === hb.runId) ? null : hb;
}

export function panelOf(declPath: string, fs: DockFs | null = currentFs()): string | null {
  return readPanelText(pathOf.panel(declPath), fs);
}

function safeJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 显示名（声明读不到时退回 id，别在界面上留空） */
export function displayNameOf(view: Pick<DockToolView, 'manifest' | 'id'>): string {
  return view.manifest?.name?.trim() || view.id;
}
