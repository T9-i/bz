/**
 * 插件宿主 —— 把内核接到 Obsidian 上：定时、事件、执行、通知。
 *
 * 它只做四件事，别的一律推给内核：
 *  1) 每 30 秒叫一拍；
 *  2) 把域事件与 vault 变动喂给这一拍；
 *  3) 拿执行权锁，拿到才算数（拿不到就让位，不争）；
 *  4) 真去起进程，并把结果交给内核记账。
 *
 * 上一版这里还有「租约」「让位」「两套冷却」「两套 inFlight」—— 现在全由那把锁替代。
 */

import { Platform, type App } from 'obsidian';
import { notify } from '../core/notice';
import { onDomainEvent } from '../core/domain-bus';
import { dirOf } from './files';
import { clearBreaker, missingParams, type Decision } from './kernel';
import { makeRunId, onLiveChanged, liveAll, liveOf, runToolNow } from './exec';
import { inspectLock, withLock } from './lock';
import { tickOnce, KEEP_ALIVE_MS } from './tick-once';
import { loadToolViews } from './view';
import { readRegistry, readTrust, registryPath } from './registry';
import { currentFs, pathOf, readRunsText } from './files';
import { parseRunLines } from './parse';
import { RUNS_TAIL_BYTES, type DockOutcome, type DockRule, type DockToolView } from './types';
import type { RuleEvent } from './rules';

/** 一拍间隔。分钟级精度够用；30 秒是为了「点完规则几十秒内就能看见它跑」 */
const TICK_MS = 30_000;
/** 启动后等一会儿再拍，别跟 Obsidian 自己的启动加载抢资源 */
const STARTUP_DELAY_MS = 3_000;
let app: App | null = null;
let unloaded: (() => boolean) | null = null;
let sessionStart = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;
let pendingEvents: RuleEvent[] = [];
let subscriptions: (() => void)[] = [];
let unsubscribeLive: (() => void) | null = null;

/** vault 根（绝对路径） */
export function vaultBasePath(a: App): string | undefined {
  const adapter = (a.vault as unknown as { adapter?: { getBasePath?: () => string } }).adapter;
  try {
    return adapter?.getBasePath?.();
  } catch {
    return undefined;
  }
}

function dataDir(): string {
  return dirOf(registryPath());
}

export function startDockScheduler(a: App, isUnloaded: () => boolean): void {
  if (app !== null) return;
  if (Platform.isMobile) return;
  app = a;
  unloaded = isUnloaded;
  sessionStart = Date.now();
  subscribeBus();
  unsubscribeLive = onLiveChanged(() => {
    /* 状态栏订阅；这里只是确保订阅表非空时有回调 */
  });
  startupTimer = setTimeout(() => {
    void kickDockScheduler();
    timer = setInterval(() => void kickDockScheduler(), TICK_MS);
  }, STARTUP_DELAY_MS);
}

export function stopDockScheduler(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (timer) clearInterval(timer);
  startupTimer = null;
  timer = null;
  for (const off of subscriptions) off();
  subscriptions = [];
  unsubscribeLive?.();
  unsubscribeLive = null;
  pendingEvents = [];
  app = null;
  unloaded = null;
  ticking = false;
}

/** 立刻拍一次（改完规则 / 点「立即运行」时调，免得干等 30 秒） */
export function kickDockScheduler(): Promise<void> {
  return tick();
}

export function notifyDockEvent(ev: RuleEvent): void {
  if (app === null) return;
  pendingEvents.push(ev);
  void kickDockScheduler();
}

/** 订阅哪些通道 —— 规则表是文件里的数据，可能被外部改，所以每拍重订 */
function subscribeBus(): void {
  for (const off of subscriptions) off();
  subscriptions = [];
  const wanted = new Set<string>();
  const { registry } = readRegistry();
  const trust = readTrust();
  for (const v of loadToolViews(registry.tools, { trust: toTrustMap(trust) })) {
    for (const r of v.rules) {
      if (r.enabled === false) continue;
      if (r.trigger.kind === 'domain-event') wanted.add(r.trigger.channel);
      if (r.trigger.kind === 'file-change') wanted.add('vault:file-changed');
    }
  }
  for (const ch of wanted) {
    subscriptions.push(onDomainEvent(ch, (evt) => fromBus(ch, evt)));
  }
}

function fromBus(channel: string, evt: unknown): void {
  const e = evt as { path?: unknown; file?: { path?: unknown } } | null;
  const p =
    typeof e?.path === 'string' ? e.path : typeof e?.file?.path === 'string' ? e.file.path : '';
  if (channel.startsWith('vault:')) notifyDockEvent({ kind: 'file-change', path: p });
  else notifyDockEvent({ kind: 'domain-event', channel });
}

function toTrustMap(trust: Record<string, { at: string; run: string }>): Record<string, { at: string; run: string }> {
  return trust;
}

// ==================== 一拍 ====================

async function tick(): Promise<void> {
  const a = app;
  if (a === null || unloaded === null || ticking) return;
  if (unloaded()) return;
  ticking = true;
  try {
    const res = await tickOnce({
      dataDir: dataDir(),
      registryPath: registryPath(),
      trust: readTrust(),
      sessionStart,
      events: pendingEvents,
      vaultPath: vaultBasePath(a),
      owner: 'plugin',
      liveIds: new Set(liveAll().map((r) => r.toolId)),
      onOutcome: announce,
      onRemind: remindOf,
    });
    // 没拿到锁 = 这一拍什么都没做，事件留着下一拍用（别丢）
    if (res.skipped === 'locked') return;
    pendingEvents = [];
    if (res.result && res.views) reportMissingParams(res.result.decisions, res.views);
  } catch {
    /* 一拍出错不该把宿主带走 */
  } finally {
    ticking = false;
  }
}

function announce(view: DockToolView, outcome: DockOutcome): void {
  const name = view.manifest?.name ?? view.id;
  if (outcome.ok) {
    notify(`${name} 跑完了`, { type: 'success' });
    return;
  }
  if (outcome.status === 'stopped') {
    notify(`${name} 已中止`, { type: 'warning' });
    return;
  }
  notify(`${name} 失败：${outcome.recordMissing ?? '看运行记录里的 stderr 尾部'}`, { type: 'error' });
}

function remindOf(view: DockToolView, rule: DockRule): void {
  const why = rule.name?.trim() || '规则';
  notify(`${view.manifest?.name ?? view.id}：该手动跑一次了（${why}）`, { type: 'info' });
}

/** 必填参数没填的提示，每会话每工具一次 */
const warned = new Set<string>();
function reportMissingParams(decisions: readonly Decision[], views: readonly DockToolView[]): void {
  for (const d of decisions) {
    if (d.reason !== 'missing-params' || warned.has(d.toolId)) continue;
    warned.add(d.toolId);
    const v = views.find((x) => x.id === d.toolId);
    if (v) notify(`${v.manifest?.name ?? v.id} 没自动跑：必填参数还没填`, { type: 'warning' });
  }
}

// ==================== 手动运行 ====================

/**
 * 手动跑一次（面板按钮 / 直达命令）。
 *
 * 手动运行**不经过判据也不需要排队**，但同样要先过门槛：已授权、有 entry、不在跑。
 * 它也要拿锁 —— 不是为了排队，是为了不和自动那一拍同时起两个进程。
 */
export async function runToolManually(
  view: DockToolView,
  opts: { extraArgs?: string[]; onStep?(text: string): void } = {},
): Promise<DockOutcome | null> {
  const a = app;
  if (!a) return null;
  if (liveOf(view.id)) return null;
  const outcome = await withLock(dataDir(), 'plugin', async () => {
    if (!view.entry) return null;
    const live = runToolNow({
      toolId: view.id,
      declPath: view.path,
      entry: view.entry,
      manifest: view.manifest,
      values: view.values,
      vaultPath: vaultBasePath(a),
      trigger: 'manual',
      extraArgs: opts.extraArgs,
      runId: makeRunId(),
      records: () => parseRunLines(readRunsText(pathOf.runs(view.path), currentFs(), RUNS_TAIL_BYTES), view.id),
      cb: { onStep: opts.onStep },
    });
    return live.done;
  }, { keepAliveMs: KEEP_ALIVE_MS });
  if (outcome) announce(view, outcome);
  return outcome;
}

/** 诊断：这一拍的锁归谁、有没有人卡着 */
export function dockLockState(): ReturnType<typeof inspectLock> {
  return inspectLock(dataDir());
}

/**
 * 手动恢复熔断。**必须在锁内写** —— `dock.runtime.json` 的写者是调度内核，
 * 面板绕过锁直接写，就回到了「两个人改同一本账」的老问题。
 * 拿不到锁（有工具正在跑）就明说，不硬写。
 */
export async function clearBreakerSafely(view: DockToolView): Promise<boolean> {
  const ok = await withLock(dataDir(), 'plugin', () => {
    clearBreaker(view);
    return true;
  }, { keepAliveMs: KEEP_ALIVE_MS });
  return ok === true;
}

/** 必填参数缺失检查（面板用） */
export function missingParamsOf(view: DockToolView): string[] {
  return missingParams(view);
}
