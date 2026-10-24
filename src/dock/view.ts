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
import { RUNS_TAIL_BYTES, type DockIntent, type DockManifest, type DockRegistryEntry, type DockRule, type DockRuntime, type DockRunRecord, type DockToolView } from './types';

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
  const { manifest, error } = readManifestFile(entry.path, fs ?? null);

  const intentRaw = fs ? readTextOf(pathOf.intent(entry.path), fs) : null;
  const intent: DockIntent = parseIntent(safeJson(intentRaw), entry.id);

  const runtimeRaw = fs ? readTextOf(pathOf.runtime(entry.path), fs) : null;
  const runtime: DockRuntime = parseRuntime(safeJson(runtimeRaw), entry.id);

  const settingsRaw = fs ? readTextOf(pathOf.settings(entry.path), fs) : null;
  const parsedValues = parseSettingsText(settingsRaw, entry.id);
  const values = parsedValues ?? {};

  const records = fs ? parseRunLines(readRunsText(pathOf.runs(entry.path), fs, RUNS_TAIL_BYTES), entry.id) : [];

  // 心跳只读不判 —— 「有没有人在跑它」由调用方按时效判断（`HEARTBEAT_STALE_MS`）
  const heartbeat = fs ? parseHeartbeat(safeJson(readTextOf(pathOf.heartbeat(entry.path), fs))) : null;

  const trust = opts.trust?.[entry.id];
  const signature = runSignature(manifest?.entry ?? null);
  const trusted = !!trust && !!signature && trust.run === signature;

  const rules: DockRule[] = intent.rules?.length ? intent.rules : (manifest?.defaultRules ?? []);

  return {
    id: entry.id,
    path: entry.path,
    dir: dirOf(entry.path),
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
  const all = parseRunLines(readRunsText(pathOf.runs(declPath), fs, RUNS_TAIL_BYTES), toolId);
  return all
    .slice()
    .sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0))
    .slice(0, limit);
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
