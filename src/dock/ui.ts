/**
 * 工具坞面板（dock 域 UI，spec §7 UI 定稿 = 卡片墙）。
 *
 * 形态：overlay 面板（对齐各域面板范式）——`.bz-panel-overlay` + `.bz-panel-frame`，
 * 头行走路样式库共享类（`.bz-panel-head` 族），组件一律消费 `core/ui`。
 *
 * 两个视图：
 *  - **卡片墙**（列表）：两分区（自动化 / 手动）+ 过滤条 + 卡片网格。一张卡 = 一个外部工具，
 *    卡面自带「最近 7 次通栏迷你时间轴」——一眼看出这周跑成什么样；欠跑的卡整卡标色；
 *    上次失败的卡把「怎么办」直接写在卡面上（可操作提示不藏在详情里）。
 *  - **详情**：左栏参数表单 + 运行台（在场运行的实时进度），右栏历史时间线（展开可看
 *    `steps` / `info` / `result` / `stderr` 尾部）。
 *
 * **元数据一律来自工具目录的声明文件**（`manifest.json`）：标题、描述、图标、参数定义、节奏、
 * 以及怎么跑。所以登记只有一个动作 —— 选那个文件。这里不提供「填表单说这个工具叫什么、
 * 什么参数、什么时候该跑」的入口：那些事实声明里已经有了，抄一份就多一个会和它打架的源。
 * 跑不跑由**规则表**说了算（`rules`），不再有「自动化 / 手动」的两分。
 *
 * 三条不可越界的 UI 约束（来自拍板决策，见 spec）：
 *  1) **不给没被 bz 拉起的运行画进度条**。D1 修订后判据是「谁启动的」而非「自动还是手动」：
 *     bz 亲手拉起（含调度器自动触发）的都是在场，照画；系统计划任务那种**离场**形态没有实时流，
 *     不许画。`liveRunsAll()` 里有没有它，就是这条的判据。
 *  2) **移动端只读**：能看状态与历史，不能启动（`core/external-tool` 在非桌面端本就返回
 *     「仅桌面端可用」；这里连按钮都不给，免得点了才知道）。
 *  3) 「任务」二字一律不出现（该词已被备忘录与 people 的画谱任务引擎占用）——用「外部工具」。
 */

import type { App } from 'obsidian';
import { Platform } from 'obsidian';
import { topifyZ } from '../core/z-order';
import { escManager } from '../core/esc-manager';
import { trapPanelFocus } from '../core/ui/focus-trap';
import { notice, notify, notifyUndo } from '../core/notice';
import { uiBtn, uiIconBtn, uiBtnRow, uiChip, uiChoice, uiDialogActions, uiEmpty, uiField, uiInput, uiModal, uiProgress, uiSearch, uiSelect, uiSwitch, uiIcon } from '../core/ui';
import { bindFormSubmit } from '../core/ui/modal';
import type { BzAskRequest } from '../core/external-tool';
import { openFlowDialog } from '../core/flow-dialog';
import { pickSystemFiles, pickSystemFolder } from '../core/path-picker';
import { attachItemActions, type ItemAction } from '../core/item-actions';
import { relTime } from '../core/ui/str';
import {
  displayDesc,
  displayIcon,
  displayName,
  isEnabled,
  isOverdue,
  isTrusted,
  loadToolView,
  loadToolViews,
  overview,
  patchRunState,
  readDockSwitch,
  readToolEntries,
  recordRunSuccess,
  runSignature,
  saveToolEntries,
  saveToolValues,
  summarize,
  updateToolEntry,
  type DockToolEntry,
  type DockToolView,
} from './data';
import { loadDockStore } from './store';
import {
  buildActArgs,
  parseActHref,
  resolveActArgs,
  type ParsedActRef,
} from './action';
import { judgeDirectRun, missingParamsMessage } from './command';
import {
  errorHint,
  initialValuesOf,
  lastRawTailOf,
  liveRunOf,
  liveRunsAll,
  notifyRunOutcome,
  runTool,
  statusText,
  stopRun,
  type DockLiveRun,
  type DockRunCallbacks,
} from './runner';
import { kickDockScheduler, notifyDockEvent } from './scheduler';
import {
  TRIGGER_KINDS,
  TRIGGER_LABEL,
  actionText,
  atSecondsOf,
  durationText as minutesText, // 与 schedule 的「跑多久」同名，故取别名
  hasActiveRule,
  newRuleId,
  todayAt,
  triggerText,
  type DockRule,
  type DockTrigger,
  type DockTriggerKind,
} from './rules';
import {
  DECLARATION_FILENAME,
  findDeclarationFiles,
  readDeclaration,
  readPanelText,
  resolveRun,
  type ResolvedRun,
} from './declaration';
import { hasVaultFs, primePathsOf, primeVaultFs, resetVaultFs } from './vault-fs';
import {
  consumeWatchdogQueue,
  readWatchdogQueue,
  summarizeWatchdogRuns,
  type WatchdogReport,
  type WatchdogReportRow,
} from './watchdog';
import {
  EDITABLE_SCHEDULE_KINDS,
  durationText,
  isAlarm,
  lastRun,
  missingRequiredParams,
  recentRuns,
  scheduleFromDraft,
  scheduleSignature,
  successRate,
  timeOf,
  type DockRunHealth,
  type EditableScheduleKind,
} from './schedule';
import type { DockErrorKind, DockManifest, DockParam, DockRunRecord, DockSchedule } from './schema';

// ==================== 模块状态 ====================

let hostApp: App | null = null;
let overlay: HTMLElement | null = null;
let escHandle: { unregister: () => void } | null = null;
/** 当前视图：列表 / 某工具详情 */
let view: { kind: 'list' } | { kind: 'detail'; id: string } = { kind: 'list' };
/** 搜索词（空 = 不过滤） */
let query = '';
/** 搜索行是否展开 */
let searchOpen = false;
/**
 * KPI 格点出来的过滤口径（增强 #15）：点哪格看哪类，再点一次回全部。
 * 只是列表的**视图**开关 —— KPI 数字本身的口径在 `overviewOf`，这里不另算一套。
 */
type KpiFilter = 'all' | 'alarms';
let kpiFilter: KpiFilter = 'all';
/** 正在刷新（读声明 + 读运行记录） */
let refreshing = false;
/** 打开面板时读出来的视图（渲染输入） */
let views: DockToolView[] = [];
/**
 * 参数表单草稿（按工具 id 记住，重渲不丢）。
 * 值的**家**是工具目录里的 `data.json`（`view.values`），这里只是编辑期的副本 ——
 * 每敲一下都写盘太吵，停手后再落（`queueValueSave`）。
 */
const draftValues = new Map<string, Record<string, unknown>>();
/** 草稿落盘的去抖定时器（按工具 id） */
const valueSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** 草稿落盘的去抖时长：够盖住连续击键，又短到「填完就关面板」不至于丢 */
const VALUE_SAVE_DEBOUNCE_MS = 500;
/** 已就「该跑没跑」打过通知的（本会话内去重：`<id>:<日>`） */
const dueNotified = new Set<string>();

/**
 * 节奏编辑草稿（按工具 id）。改完未点「保存节奏」时的暂存；保存/恢复脚本默认后即清，
 * 下次重新从**当前生效值**初始化。
 *
 * `kind` 刻意**不含 `on-demand`**：类型上就写死「编辑器产不出『只手动』」，「不开自动」由总闸表达
 * （ADR-0236 §补记）。`'inherit'` 也不给用户选 —— 它是「恢复脚本默认」按钮内部用的哨兵（= 清除覆盖）。
 */
interface AutoDraft {
  kind: EditableScheduleKind | 'inherit';
  hour: number;
  weekday: number;
  everyHours: number;
}
const autoDraft = new Map<string, AutoDraft>();

/** 节奏形态的中文名（面板用）；选项清单来自 `EDITABLE_SCHEDULE_KINDS`，这里只管怎么念 */
const SCHEDULE_KIND_LABEL: Record<EditableScheduleKind, string> = {
  daily: '每天',
  weekly: '每周',
  interval: '每隔若干小时',
};

const OVERLAY_ID = 'bz-dock-mask';
const FRAME_ID = 'bz-dock-panel';

// ==================== 小工具 ====================

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** 本地日键（漏跑通知去重用） */
function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 打开 / 定位产物（增强 #16）：vault 里真有这个相对路径 → 用 Obsidian 打开；
 * 其余（绝对路径、vault 找不到的）→ 系统文件管理器定位。移动端没有 shell → 降级复制路径。
 */
function openArtifact(p: string): void {
  const w = window as unknown as {
    require?: (id: string) => { shell?: { showItemInFolder(p: string): void } };
  };
  const shell = w.require?.('electron')?.shell;
  if (!shell) {
    void copyText(p, '产物路径');
    return;
  }
  const norm = p.replace(/\\/g, '/');
  const isAbsolute = /^[a-zA-Z]:\//.test(norm) || norm.startsWith('//') || norm.startsWith('/');
  if (!isAbsolute && hostApp) {
    const file = hostApp.vault.getAbstractFileByPath(norm);
    if (file) {
      void hostApp.workspace.openLinkText(norm, '', true);
      return;
    }
  }
  const base = hostApp
    ? (hostApp.vault as unknown as { adapter?: { getBasePath?: () => string } }).adapter?.getBasePath?.()
    : undefined;
  shell.showItemInFolder(isAbsolute || !base ? p : `${base}/${norm}`);
}

async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notice(`已复制${what}`);
  } catch {
    notice(`复制失败，请手动复制：${text}`, 'warning');
  }
}

/** 健康态 → 色点类（none 不画点） */
function dotClass(health: DockRunHealth | DockRunRecord['status']): string {
  switch (health) {
    case 'ok':
      return 'bz-dock-dot bz-dock-dot--ok';
    case 'due':
    case 'failed':
    case 'timeout':
      return 'bz-dock-dot bz-dock-dot--bad';
    case 'pending':
    case 'running':
    case 'stopped':
      return 'bz-dock-dot bz-dock-dot--warn';
    default:
      return 'bz-dock-dot bz-dock-dot--idle';
  }
}

/** 卡面「什么时候」：最近一次运行的相对时间——这是卡上最常被看的一个数，给它主信息的字号色阶 */
function whenTextOf(v: DockToolView, last: DockRunRecord | undefined): string {
  if (v.runsUnreadable) return '记录读不懂';
  if (!last) return '还没有运行过';
  return relTime(last.startedAt.replace('T', ' '));
}

/** 卡面「结果」：在场运行给实时阶段，离场给工具自己留的那句话 */
function messageTextOf(v: DockToolView, last: DockRunRecord | undefined): string {
  if (v.runsUnreadable) return '文件在，但内容不合契约';
  const live = liveRunOf(v.entry.id);
  if (live) return live.progress.phase ? `正在${live.progress.phase}…` : '正在运行…';
  if (!v.manifest) return v.declError ?? '声明文件读不到，先把路径修好';
  if (!v.run) return '没写怎么跑（既无 run 段，目录里也没有 main.mjs）';
  if (!last) return '等它按自己的节奏跑一次';
  return last.message || statusText(last.status);
}

/**
 * 卡面「怎么办」：上次失败且工具留了 `error.kind` 时给可操作提示。
 * 刻意**不放详情里藏**——「汇报完成情况」最值钱的就是这一句（「去重新导出 cookie」远比「失败了」有用），
 * 而卡墙才是你会扫视的那一层。没有 `error` 就不猜（工具没说死在哪儿，bz 不编）。
 */
function failHintOf(last: DockRunRecord | undefined): string | null {
  if (!last || !last.error) return null;
  if (last.status === 'ok' || last.status === 'running') return null;
  return errorHint(last.error.kind);
}

function viewById(id: string): DockToolView | undefined {
  return views.find((v) => v.entry.id === id);
}

/** 是否桌面端（只有桌面端能启动进程） */
function canRun(): boolean {
  return !Platform.isMobile;
}

/** 这个工具现在能不能启动：桌面端 + 已信任 + 信任没过期 + 声明里写了怎么跑 */
function canStart(v: DockToolView): boolean {
  return canRun() && isTrusted(v.entry) && !v.trustStale && !!v.run;
}

/** 「未信任」与「信任过期」共用的标签文案（两者都要求用户重新确认一次） */
function trustTagOf(v: DockToolView): string | null {
  // 移动端不跑进程，也没有「重新确认」的入口 —— 这个标签在那儿只是噪音。
  // 更要紧的是：声明读不到时 run 为 null，比对必然不等，会恒亮一条假的「命令已变」。
  if (!canRun()) return null;
  if (!isTrusted(v.entry)) return '未信任';
  if (v.trustStale) return '命令已变，待重新确认';
  return null;
}

// ==================== 打开 / 卸载 ====================

export function openDock(app: App): void {
  hostApp = app;
  if (!overlay) build(app);
  topifyZ(overlay!);
  overlay!.classList.remove('is-off');
  trapPanelFocus(overlay!.querySelector<HTMLElement>(`#${FRAME_ID}`) ?? overlay!);
  // hide 型常驻层重开：显示路径重放 ESC 注册，栈序跟随显示序
  escHandle?.unregister();
  escHandle = escManager.register('bz-dock', {
    isVisible: () => isPanelVisible(),
    close: () => closeDock(),
  });
  render();
  void refresh();
  // 「打开工具坞」本身也是一个触发条件（规则里的 panel-open）—— 通知调度器判一轮
  notifyDockEvent({ kind: 'panel-open' });
}

export function closeDock(): void {
  overlay?.classList.add('is-off');
  // 面板不可见了，那口 5 秒的重绘拍就没有观众了（状态栏自己会在运行结束时收起）。
  // 重开时 `openDock` → `render` → `ensureLiveTick` 会重新挂上。
  stopLiveTick();
}

/**
 * 通知 / 命令的「直达」入口：开面板并定位到该工具详情（面板已开着就只切换定位）。
 * 失败通知这类场景，用户要的不是「面板」而是「那个工具」。
 */
export function openDockTool(app: App, id: string): void {
  view = { kind: 'detail', id };
  openDock(app);
}

export function unloadDock(): void {
  // 先把还没落盘的参数草稿写掉再拆 —— 卸载恰好在去抖窗口内时，clearTimeout 会把
  // 最后一次输入静默丢掉（写盘是同步 fs，卸载路径里照常能完成）
  for (const v of views) saveValuesNow(v);
  stopLiveTick();
  stopOfflineTick();
  hostApp = null;
  escHandle?.unregister();
  escHandle = null;
  overlay?.remove();
  overlay = null;
  views = [];
  view = { kind: 'list' };
  draftValues.clear();
  for (const t of valueSaveTimers.values()) clearTimeout(t);
  valueSaveTimers.clear();
  dueNotified.clear();
  autoDraft.clear();
}

/** 插件启动时的域初始化（当前无监听，占位以对齐各域 ensureXxx 范式） */
export function ensureDock(_app: App): void {
  /* 面板本身不常驻（懒建 DOM）；常驻的后台任务是调度器，由 main.ts 直接 startDockScheduler 起
     （不在这里挂，免得 ensureDock 与调度器两处都能起、谁先谁后说不清）。 */
}

function isPanelVisible(): boolean {
  return !!overlay && !overlay.classList.contains('is-off');
}

// ==================== 面板壳 ====================

function build(app: App): void {
  const ov = el('div', 'bz-panel-overlay bz-dock-mask is-off');
  ov.id = OVERLAY_ID;
  const frame = el('div', 'bz-panel-frame bz-dock-panel bz-panel-mtop');
  frame.id = FRAME_ID;

  const head = el('div', 'bz-panel-head');
  const brand = el('div', 'bz-panel-brand');
  brand.appendChild(uiIcon('square-terminal'));
  const title = el('div', 'bz-panel-title', '工具坞');
  const pipe = el('div', 'bz-panel-head-pipe');
  const sub = el('div', 'bz-panel-head-sub');
  sub.id = 'bz-dock-headsub';
  const sp = el('div', 'bz-panel-head-sp');
  const btns = el('div', 'bz-panel-head-btns');
  btns.id = 'bz-dock-headbtns';
  head.append(brand, title, pipe, sub, sp, btns);

  const kpi = el('div', 'bz-dock-kpi');
  kpi.id = 'bz-dock-kpi';

  const runbar = el('div', 'bz-dock-runbar');
  runbar.id = 'bz-dock-runbar';

  const bar = el('div', 'bz-dock-bar');
  bar.id = 'bz-dock-bar';

  const body = el('div', 'bz-dock-body');
  body.id = 'bz-dock-body';

  frame.append(head, kpi, runbar, bar, body);
  ov.appendChild(frame);
  ov.addEventListener('click', (e) => {
    if (e.target === ov) closeDock();
  });
  document.body.appendChild(ov);
  overlay = ov;
  void app;
}

function kpiEl(): HTMLElement | null {
  return overlay?.querySelector<HTMLElement>('#bz-dock-kpi') ?? null;
}
function runbarEl(): HTMLElement | null {
  return overlay?.querySelector<HTMLElement>('#bz-dock-runbar') ?? null;
}
function barEl(): HTMLElement | null {
  return overlay?.querySelector<HTMLElement>('#bz-dock-bar') ?? null;
}
function bodyEl(): HTMLElement | null {
  return overlay?.querySelector<HTMLElement>('#bz-dock-body') ?? null;
}

// ==================== 刷新（读盘） ====================

async function refresh(): Promise<void> {
  if (!hostApp || refreshing) return;
  refreshing = true;
  renderHead();
  try {
    // 面板数据（登记表 / 台账 / 开关）先装载再读视图 —— 每次打开都现读，外部改了 dock.json
    // 也能在下次打开时生效（ADR-0239；与声明文件的「不缓存」同一条精神）
    await loadDockStore();
    // 移动端：读链是同步的，而 vault adapter 只有异步读 —— 先把每个工具那几份文件
    // 预取进内存，下面的 `loadToolViews` 才有一份能命中（见 vault-fs.ts）
    if (hasVaultFs()) {
      resetVaultFs();
      await primeVaultFs(readToolEntries().flatMap(primePathsOf));
    }
    views = await loadToolViews(hostApp);
    runDueNotifications();
  } catch (e) {
    console.warn('[dock] 载入工具视图失败', e);
    notice('工具坞载入失败，详见控制台', 'error');
  } finally {
    refreshing = false;
    render();
    // 离线简报在面板画完之后弹：它是盖在面板上的独立弹窗，先有底再弹才不闪
    showOfflineReportIfAny();
  }
}

/**
 * 值守记录里的 `kind` 是**工具自己写的**自由字符串（`runs.json` 的 `error.kind`），
 * 认不出的落 `unknown` —— 同 `schema` 读侧的「脏值不猜」口径。
 */
function errorKindOf(kind: string | undefined): DockErrorKind {
  switch (kind) {
    case 'auth':
    case 'network':
    case 'config':
    case 'timeout':
    case 'aborted':
    case 'unknown':
      return kind;
    default:
      return 'unknown';
  }
}

/** 本次会话交代过离线简报没有 —— 弹过一次就定住（队列同时被消费，下次启动自然没得弹） */
let offlineReportDone = false;

/**
 * 「Obsidian 关着那段，值守进程替你跑了什么」—— 打开工具坞面板时用**独立弹窗**交代一次（ADR-0242）。
 *
 * 形态是弹窗而不是逐条通知：好几天的账拆成五条 toast 再加一句「另有 N 次」，既糊脸又读不出全貌，
 * 而「这段时间成没成、哪个工具掉了」正是要一眼看完的东西。
 *
 * 队列在弹窗时就被消费（`consumeWatchdogQueue`：**先重读再删、只删自己播过的** —— 值守进程可能
 * 正在追加新条目，整文件覆写会把它们一起抹掉）。所以这是**首次打开**的一次性交代：看完即入账，
 * 下次启动不再弹。不设第二把开关 —— 主动打开面板才看得到的东西不是「提醒」，不受 `notifyMissed` 管。
 */
function showOfflineReportIfAny(): void {
  if (offlineReportDone) return;
  offlineReportDone = true;
  const items = readWatchdogQueue();
  if (!items.length) return;
  const report = summarizeWatchdogRuns(items);
  if (!report) return;
  // 先弹再消费：消费是静默写盘，万一弹这一步出岔子，队列还在 —— 下次启动还能再交代一遍。
  // 反过来的代价不对等：先删的话，弹崩就等于「这几天那次离线运行从此没人知道」。
  openOfflineReport(report);
  consumeWatchdogQueue(items);
}

/** 简报里的时间戳：`MM-DD HH:MM`（这段区间本来就跨天，相对时间读不出先后） */
function shortStamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 一行右边的账：跑了几次、成没成 */
function reportRowFact(row: WatchdogReportRow): string {
  return row.fail === 0 ? `${row.runs} 次 · 全成功` : `${row.runs} 次 · ${row.fail} 次失败`;
}

/**
 * 弹离线简报。**纯只读**：关掉（点遮罩 / ESC）就结束了，不给任何后续动作按钮 ——
 * 该不该重跑由每个工具自己的规则表说了算，这里只负责「这几天发生了什么」。
 */
function openOfflineReport(report: WatchdogReport): void {
  const box = el('div', 'bz-dock-rep');

  const sum = el('div', 'bz-dock-rep-sum');
  sum.appendChild(el('div', 'bz-dock-rep-lead', `Obsidian 关闭期间跑了 ${report.runs} 次`));
  const tally = el('div', 'bz-dock-rep-tally');
  tally.appendChild(el('span', 'bz-dock-rep-ok', `${report.ok} 成功`));
  if (report.fail > 0) tally.appendChild(el('span', 'bz-dock-rep-bad', `${report.fail} 失败`));
  const days = Math.max(1, Math.ceil((Date.parse(report.to) - Date.parse(report.from)) / 86_400_000));
  tally.appendChild(
    el(
      'span',
      'bz-dock-rep-span',
      `${shortStamp(report.from)} → ${shortStamp(report.to)}${days > 1 ? ` · 跨 ${days} 天` : ''}`,
    ),
  );
  sum.appendChild(tally);
  box.appendChild(sum);

  const list = el('div', 'bz-dock-rep-list');
  for (const row of report.rows) {
    const bad = row.fail > 0;
    const item = el('div', `bz-dock-rep-item${bad ? ' is-bad' : ''}`);
    const line = el('div', 'bz-dock-rep-line');
    line.appendChild(el('span', 'bz-dock-rep-dot'));
    line.appendChild(el('span', 'bz-dock-rep-name', row.name));
    line.appendChild(el('span', 'bz-dock-rep-fact', reportRowFact(row)));
    item.appendChild(line);
    // 第二行：最近一次什么时候、说了什么。失败优先说原因 —— 工具自己写的那句，没有再按 kind 兜提示语
    const detail = bad
      ? `${shortStamp(row.lastAt)} · ${row.message || errorHint(errorKindOf(row.kind))}`
      : `${shortStamp(row.lastAt)}${row.message ? ` · ${row.message}` : ''}`;
    item.appendChild(el('div', 'bz-dock-rep-detail', detail));
    list.appendChild(item);
  }
  box.appendChild(list);

  uiModal({ head: true, title: '离线简报', maxWidth: 460, content: box });
}

/**
 * 「该跑没跑」通知（spec D11）。
 * 只对**已声明节奏**且判定为 `due` 的工具发；同一会话内每个工具每天最多一条
 * （不落盘 —— ADR-0218 已拍 bz 不持久化队列/状态；重启后重来一次，可接受）。
 * 开关 = `dock.json` 里的 `notifyMissed`（面板数据；设置面板「工具坞 → 提醒」那一行）；
 * 缺省开——键缺失视为开。
 *
 * **调度器会管的就不在这里喊**（ADR-0236）：能被自动跑的工具，它「该跑没跑」会被调度器直接
 * 补跑，再发一条「该跑没跑」就是同一件事喊两遍。只有调度器够不着的（总闸关、参数没填、自动
 * 已关、熔断暂停、未信任、没写 run）才轮到这条兜底提醒。
 */
function runDueNotifications(): void {
  if (!readDockSwitch('notifyMissed')) return;
  const day = todayKey();
  for (const v of views) {
    if (!isEnabled(v.entry)) continue;
    if (v.due.state !== 'due') continue;
    if (willAutoRun(v)) continue; // 调度器会补跑它，别重复喊
    const key = `${v.entry.id}:${day}`;
    if (dueNotified.has(key)) continue;
    dueNotified.add(key);
    notify(`${displayName(v)} 今天该跑没跑：${v.due.detail}`, {
      type: 'warning',
      dedupeKey: `dock-due-${key}`,
      action: { label: '查看', onClick: () => openDockTool(hostApp as App, v.entry.id) },
    });
  }
}

/**
 * 这个工具是否在**调度器的覆盖范围内**（用来避免与「该跑没跑」通知重复出声）。
 * 判据是调度资格的静态面（不含「到点没到点」与运行中的会话锁），与 `scheduler.decideDue`
 * 的口径一致但不必那么细。
 */
function willAutoRun(v: DockToolView): boolean {
  if (!readDockSwitch('autoRun')) return false;
  if (!isEnabled(v.entry) || !isTrusted(v.entry) || v.trustStale) return false;
  if (!v.run || !hasActiveRule(v.rules)) return false;
  if (v.runState?.pausedAt) return false;
  return missingRequiredParams(v.manifest?.params, v.values).length === 0;
}

// ==================== 渲染 ====================

function render(): void {
  renderHead();
  renderKpi();
  renderRunbar();
  renderBar();
  renderBody();
  ensureLiveTick(); // 面板开着且有东西在跑时，才挂那口 5 秒的拍
}

/**
 * 顶部四格 KPI（口径全在 `data.ts` 的 `overview()` 里，这里只负责画）。
 * 一格都没有工具时整条隐藏 —— 空面板上方压四个 0 只是噪音。
 */
function renderKpi(): void {
  const host = kpiEl();
  if (!host) return;
  host.innerHTML = '';
  // 详情页的统计是「当前脚本」的，由 renderDetail 画在工具头部下面 —— 全局四格让位
  if (!views.length || view.kind === 'detail') {
    host.classList.add('is-off');
    return;
  }
  host.classList.remove('is-off');

  const o = overview(views);
  const tile = (
    num: string,
    unit: string,
    label: string,
    sub: string,
    tone?: 'warn' | 'bad' | 'up',
    key?: KpiFilter,
  ): HTMLElement => {
    const t = el('div', tone ? `bz-dock-kpi-tile is-${tone}` : 'bz-dock-kpi-tile');
    const v = el('div', 'bz-dock-kpi-v', num);
    if (unit) v.appendChild(el('small', undefined, unit));
    t.appendChild(v);
    t.appendChild(el('div', 'bz-dock-kpi-l', label));
    t.appendChild(el('div', tone === 'up' ? 'bz-dock-kpi-d is-up' : 'bz-dock-kpi-d', sub));
    // 带口径的格可以点（增强 #15）：点下去列表只看那一类，再点一次回全部。
    // 过滤本身在 filtered() 里做，KPI 数字仍从 overviewOf 来 —— 两处不各算一套。
    if (key) {
      t.classList.add('is-click');
      if (kpiFilter === key) t.classList.add('is-selected');
      t.addEventListener('click', () => {
        kpiFilter = kpiFilter === key ? 'all' : key;
        renderKpi();
        renderBody();
      });
    }
    return t;
  };

  const left = o.autoTotal - o.autoDoneToday;
  host.appendChild(
    tile(
      String(o.autoDoneToday),
      ` / ${o.autoTotal}`,
      '今日自动化达标',
      o.autoTotal === 0 ? '还没有自动化工具' : left > 0 ? `还差 ${left} 个` : '今天都跑成了',
      o.autoTotal > 0 && left > 0 ? 'warn' : undefined,
    ),
  );

  host.appendChild(
    tile(
      o.rate7d === null ? '—' : String(Math.round(o.rate7d * 100)),
      o.rate7d === null ? '' : '%',
      '近 7 天成功率',
      o.runs7d ? `${o.runs7d} 次里成功 ${o.ok7d} 次` : '还没有可比的记录',
    ),
  );

  host.appendChild(
    tile(
      String(o.alarms),
      '',
      '待处理异常',
      o.alarmHint ? `${o.alarmHint.name} · ${o.alarmHint.reason}` : '没有要管的事',
      o.alarms ? 'bad' : undefined,
      'alarms',
    ),
  );

  // 「下次到期」只显示**还没到的**那一格（口径在 overview() 里：「已逾期」归上面的「待处理异常」，
  // 同一件事不在两格里各说一遍）
  if (o.nextDue) {
    const left = untilText(o.nextDue.at - Date.now());
    host.appendChild(tile(left.num, left.unit, '距下次到期', o.nextDue.name));
  } else {
    host.appendChild(tile('—', '', '距下次到期', '没有能算出下次到期的工具'));
  }
}

/** 剩余时长 → 拆成「数字 + 单位」两段（单位在 KPI 里降一档字号） */
function untilText(ms: number): { num: string; unit: string } {
  const m = ms / 60000;
  if (m < 60) return { num: String(Math.max(1, Math.round(m))), unit: 'm' };
  const h = m / 60;
  if (h < 24) return { num: String(Math.round(h)), unit: 'h' };
  return { num: String(Math.round(h / 24)), unit: 'd' };
}

/**
 * 面板顶层执行进度。
 *
 * **只画在场运行**（`liveRunsAll()`）—— 也就是 bz 亲手启动、能真的收到 `onProgress` 的那些。
 * D1 修订后，自动化工具由 bz 调度器亲手拉起，**于是它们也在这一条里**（有实时进度、能停止）；
 * 只有系统计划任务那种**离场**形态不在（bz 不是父进程、拿不到实时流），所以这里也不会出现编造的百分比。
 * 一个在跑的都没有时整条隐藏：不留空行，也不为「可能有用」占位。
 */
function renderRunbar(): void {
  const host = runbarEl();
  if (!host) return;
  host.innerHTML = '';
  const runs = liveRunsAll();
  // 详情页不画实时那条：运行台（左栏）已经有同一条运行的实时进度，头顶再挂一条就是同一件事
  // 说两遍。离场那条在详情页由运行台里的 `offlineHost` 承担（ADR-0250）。
  const offs = view.kind === 'detail'
    ? []
    : views
      .map((v) => ({ v, r: offlineRunOf(v) }))
      .filter((x): x is { v: DockToolView; r: DockRunRecord } => x.r !== null);
  if (!runs.length && !offs.length) {
    host.classList.add('is-off');
    return;
  }
  host.classList.remove('is-off');
  for (const run of runs) host.appendChild(makeRunbarRow(run));
  for (const o of offs) host.appendChild(makeOfflineRow(o.v, o.r));
  if (offs.length) ensureOfflineTick();
}

/** 顶栏里的离场行：没有停止钮、没有百分比 —— 唯一的确定性来自工具自己写的那行 */
function makeOfflineRow(v: DockToolView, run: DockRunRecord): HTMLElement {
  const row = el('div', 'bz-dock-rb');
  row.dataset.tool = v.entry.id;
  row.appendChild(el('span', 'bz-dock-rb-pulse'));
  row.appendChild(el('span', 'bz-dock-rb-name', displayName(v)));
  row.appendChild(el('span', 'bz-dock-rb-tag', '离线'));
  const last = run.steps && run.steps.length ? run.steps[run.steps.length - 1].text : '';
  row.appendChild(el('span', 'bz-dock-rb-step', last || run.message || '正在跑…'));
  row.title = '值守进程拉起的运行：bz 不是它的父进程，拿不到实时进度';
  return row;
}

function makeRunbarRow(run: DockLiveRun): HTMLElement {
  const row = el('div', 'bz-dock-rb');
  row.dataset.tool = run.toolId;
  row.appendChild(el('span', 'bz-dock-rb-pulse'));

  const v = viewById(run.toolId);
  row.appendChild(el('span', 'bz-dock-rb-name', v ? displayName(v) : run.toolId));
  row.appendChild(
    el('span', 'bz-dock-rb-phase', run.progress.phase ? `正在${run.progress.phase}…` : '运行中…'),
  );

  const lastStep = run.steps.length ? run.steps[run.steps.length - 1].text : '';
  row.appendChild(el('span', 'bz-dock-rb-step', lastStep));

  // pct 为 null = 该阶段不可估 → 不确定态，绝不假报百分比（同 schema.ts 的 pct 语义）
  const bar = uiProgress({ value: run.progress.pct ?? 0 });
  bar.el.classList.add('bz-dock-rb-track');
  if (run.progress.pct === null) bar.el.classList.add('is-indeterminate');
  row.appendChild(bar.el);
  row.appendChild(el('span', 'bz-dock-rb-pct', run.progress.pct === null ? '—' : `${Math.round(run.progress.pct)}%`));

  if (canRun()) {
    row.appendChild(
      uiBtn({
        label: '停止',
        icon: 'square',
        tone: 'danger',
        size: 'sm',
        onClick: () => stopRun(run.toolId),
      }),
    );
  }
  return row;
}

/**
 * 离场运行（ADR-0250）：值守进程拉起、bz 不是父进程的那一轮。
 *
 * 面板上原来对这类运行**什么都不显示** —— 只能干等（2026-10-23 用户问「离线跑，面板没有任何
 * 进度显示」）。但工具在跑的过程中每 8–10 秒会把「正在跑…第 N 步」写回 `runs.json`，
 * 记录文件本身也在被反复重写 —— 于是判两件事就够了：
 * 最新一条记录还挂着 `running`，且记录文件的 `updatedAt` 还在动。
 *
 * **不画百分比**：记录里没有可信的 pct，编一个就是假进度。画的是工具自己写的那行原话 +
 * 「已经跑了多久」，两者都是它写的，不是 bz 猜的。
 */
export const OFFLINE_STALE_MS = 90_000;

export function offlineRunOf(v: DockToolView, now: number = Date.now()): DockRunRecord | null {
  // 在场的那一轮有实时流，走 runbar / 运行台另一套，别在这儿重复一遍
  if (liveRunOf(v.entry.id)) return null;
  const r = v.runs.find((x) => x.status === 'running');
  if (!r) return null;
  // 心跳：记录文件的 updatedAt 优先（工具每写一次就刷）；老记录没有就退到 startedAt
  const beat = Date.parse(v.runsAt ?? '') || Date.parse(r.startedAt ?? '') || 0;
  if (!beat || now - beat > OFFLINE_STALE_MS) return null;
  return r;
}

/** 详情页「运行台」里的那一块（与列表顶栏那行同源，只是排版不同） */
function offlineHost(v: DockToolView): HTMLElement {
  const host = el('div', 'bz-dock-offline');
  host.dataset.tool = v.entry.id;
  renderOfflineInto(host, v);
  if (!host.classList.contains('is-off')) ensureOfflineTick();
  return host;
}

function renderOfflineInto(host: HTMLElement, v: DockToolView): void {
  host.innerHTML = '';
  const run = offlineRunOf(v);
  if (!run) {
    host.classList.add('is-off');
    return;
  }
  host.classList.remove('is-off');
  const head = el('div', 'bz-dock-offline-head');
  head.appendChild(el('span', 'bz-dock-rb-pulse'));
  head.appendChild(el('span', 'bz-dock-offline-title', '值守进程在跑'));
  const started = Date.parse(run.startedAt ?? '') || 0;
  if (started) head.appendChild(el('span', 'bz-dock-offline-ago', `已 ${elapsedText(Date.now() - started)}`));
  host.appendChild(head);
  const last = run.steps && run.steps.length ? run.steps[run.steps.length - 1] : undefined;
  host.appendChild(el('div', 'bz-dock-offline-step', (last && last.text) || run.message || '正在跑…'));
  host.appendChild(
    el(
      'div',
      'bz-dock-offline-note',
      'bz 不是这一轮的父进程，拿不到实时进度 —— 上面那行是它自己写进记录的原话，每十来秒更新',
    ),
  );
}

/**
 * 离场运行的轻量拍：每 5 秒把那一格重读一遍（只读这一个工具）。
 *
 * 为什么不用 `refresh()`：那条路会把整块面板重建（参数表单、滚动位置全丢）。这里只要
 * 「那行字有没有往前挪」，重读一个工具的记录就够。
 */
let offlineTick: ReturnType<typeof setInterval> | null = null;

function ensureOfflineTick(): void {
  if (offlineTick !== null) return;
  offlineTick = setInterval(() => void tickOffline(), 5_000);
}

function stopOfflineTick(): void {
  if (offlineTick !== null) {
    clearInterval(offlineTick);
    offlineTick = null;
  }
}

async function tickOffline(): Promise<void> {
  if (!hostApp) {
    stopOfflineTick();
    return;
  }
  // 要重读的：详情页里挂着那一块的 + 列表顶栏上正显示着的
  const ids = new Set<string>();
  for (const h of overlay?.querySelectorAll<HTMLElement>('.bz-dock-offline') ?? []) {
    if (h.dataset.tool) ids.add(h.dataset.tool);
  }
  for (const v of views) if (offlineRunOf(v)) ids.add(v.entry.id);
  if (!ids.size) {
    stopOfflineTick();
    renderRunbar();
    return;
  }
  let alive = 0;
  for (const id of ids) {
    const cur = viewById(id);
    if (!cur) continue;
    let nv: DockToolView | null = null;
    try {
      nv = await loadToolView(hostApp, cur.entry);
    } catch {
      nv = null; // 这一拍读不到就维持上一帧，不闪
    }
    if (!nv) continue;
    const i = views.findIndex((x) => x.entry.id === nv.entry.id);
    if (i >= 0) views[i] = nv;
    if (offlineRunOf(nv)) alive += 1;
    overlay
      ?.querySelectorAll<HTMLElement>(`.bz-dock-offline[data-tool="${id}"]`)
      .forEach((h) => renderOfflineInto(h, nv as DockToolView));
  }
  if (!alive) stopOfflineTick();
  renderRunbar();
}

function renderHead(): void {
  const headEl = overlay?.querySelector<HTMLElement>('.bz-panel-head') ?? null;
  if (!headEl) return;
  // 详情页：头行整条换装成工具自己的（返回 + 封面），「工具坞」标题让位。
  // 换的是**同一条 .bz-panel-head** —— 它本来就在面板最顶端，这样头部才真的顶到头，
  // 不用在滚动区里靠负边距去凑。
  if (view.kind === 'detail') {
    const v = viewById(view.id);
    if (v) {
      renderToolHead(headEl, v);
      return;
    }
  }
  // 列表态。换装时 `innerHTML = ''` 会把 sub / btns 连节点一起摘走 —— 所以这里**重建**，
  // 不能信「查询不到就当骨架还在」：那正是「回列表头没换回来」这个 bug 的根因。
  headEl.classList.remove('bz-dock-toolhead');
  let sub = headEl.querySelector<HTMLElement>('#bz-dock-headsub');
  let btns = headEl.querySelector<HTMLElement>('#bz-dock-headbtns');
  if (!sub || !btns) {
    headEl.innerHTML = '';
    const brand = el('div', 'bz-panel-brand');
    brand.appendChild(uiIcon('square-terminal'));
    sub = el('div', 'bz-panel-head-sub');
    sub.id = 'bz-dock-headsub';
    btns = el('div', 'bz-panel-head-btns');
    btns.id = 'bz-dock-headbtns';
    headEl.append(
      brand,
      el('div', 'bz-panel-title', '工具坞'),
      el('div', 'bz-panel-head-pipe'),
      sub,
      el('div', 'bz-panel-head-sp'),
      btns,
    );
  }
  const s = summarize(views);
  sub.textContent = views.length
    ? `${s.total} 个工具${s.overdue ? ` · ${s.overdue} 个待关注` : ''}`
    : '还没有登记任何外部工具';
  btns.innerHTML = '';
  btns.appendChild(
    uiIconBtn({
      icon: 'search',
      title: '搜索工具',
      on: searchOpen,
      onClick: () => {
        searchOpen = !searchOpen;
        render();
      },
    }),
  );
  // 移动端只读：刷新（重读磁盘）与导入（选文件夹）都不给 —— 手机上既选不了文件夹，
  // 也没有「重读一遍」能改变的东西（数据本来就是同步过来的静态文件）
  if (canRun()) {
    btns.appendChild(
      uiIconBtn({
        icon: 'refresh-cw',
        title: '重新读取运行记录',
        disabled: refreshing,
        onClick: () => void refresh(),
      }),
    );
    btns.appendChild(
      uiIconBtn({
        icon: 'plus',
        title: '导入工具（选文件夹）',
        onClick: () => importToolFlow(),
      }),
    );
  }
  btns.appendChild(
    uiIconBtn({
      icon: 'x',
      title: '关闭',
      // ⚠️ 刻意**不**传 close:true —— 那个标记会带上 `bz-icon-btn--close`，而 core/styles.css 有
      // `button.bz-icon-btn--close { display: none !important }`（「非真全屏一律隐藏关闭钮」），
      // 域内后置的移动端 display 覆盖不动 !important。桌面对齐：关闭钮显隐由本域自己管。
      className: 'bz-dock-close',
      onClick: () => closeDock(),
    }),
  );
}

/**
 * 详情页的头部（画进 `.bz-panel-head`）：返回 + 图标 + 名 + 状态标签 + 描述。
 *
 * 刻意**不摆运行按钮**：运行的入口与实时进度都在下面的「运行台」里，头顶再来一个
 * 就是把同一件事说两遍（旧的顶层进度条同理，详情页不画 —— 见 `renderRunbar`）。
 */
function renderToolHead(host: HTMLElement, v: DockToolView): void {
  host.innerHTML = '';
  host.classList.add('bz-dock-toolhead');

  // 返回和封面**同一行**：36px 的点击面，与封面图标垂直居中对齐
  const back = uiIconBtn({
    icon: 'chevron-left',
    title: '返回列表',
    className: 'bz-dock-back',
    onClick: () => {
      view = { kind: 'list' };
      render();
    },
  });

  // 封面：大图标 + 名 + 状态标签 + 描述，留白拉开
  const main = el('div', 'bz-dock-covermain');
  const ic = el('div', 'bz-dock-coveric');
  ic.appendChild(uiIcon(displayIcon(v), 'bz-ic--lg'));

  const txt = el('div', 'bz-dock-covertxt');
  const line = el('div', 'bz-dock-coverline');
  line.appendChild(el('div', 'bz-dock-detail-name', displayName(v)));
  const tags = el('div', 'bz-dock-detail-tags');
  if (isOverdue(v.due.state)) tags.appendChild(el('span', 'bz-dock-tag bz-dock-tag--due', v.due.detail));
  const trustTag = trustTagOf(v);
  if (trustTag) tags.appendChild(el('span', 'bz-dock-tag bz-dock-tag--warn', trustTag));
  if (tags.children.length) line.appendChild(tags);
  txt.appendChild(line);
  const desc = displayDesc(v);
  if (desc) txt.appendChild(el('div', 'bz-dock-detail-desc', desc));

  main.append(back, ic, txt);
  host.appendChild(main);
}

/**
 * 搜索行。这一条只剩搜索 —— 原先把「全部 / 自动化 / 手动 / 待关注」四档也放这里，
 * 但那四档要说的两件事（自动化 vs 手动、有几个待关注）现在分别由分区标题和顶部 KPI 说过了。
 * 没展开搜索时整条隐藏，面板上不留一条空横杠。
 */
function renderBar(): void {
  const bar = barEl();
  if (!bar) return;
  bar.innerHTML = '';
  if (refreshing) bar.classList.add('is-loading');
  else bar.classList.remove('is-loading');
  // 详情页没有搜索（搜索钮在列表头里，详情头让位给工具自己的头部）
  if (!searchOpen || view.kind === 'detail') {
    bar.classList.add('is-off');
    return;
  }
  bar.classList.remove('is-off');

  const sp = el('div', 'bz-dock-search');
  const search = uiSearch({
    placeholder: '搜工具名 / 描述 / 命令',
    value: query,
    onInput: (v) => {
      query = v;
      renderBody();
    },
  });
  sp.appendChild(search.el);
  bar.appendChild(sp);
  // 展开即入焦（移动端跳过，防软键盘顶起）
  if (!Platform.isMobile) queueMicrotask(() => search.input.focus());
}

/**
 * 搜索后的视图。
 *
 * 面板**不再提供**「全部 / 自动化 / 手动 / 待关注」那排点击过滤档：分区标题已经把自动化与手动分开，
 * 顶上四格 KPI 已经回答了「有几个要管」，再摆一排 chip 只是让人多一次点击、还多一处会跟 KPI 对不上的计数。
 * 要缩小范围就用搜索。
 */
/** KPI「待处理异常」同一口径（`schedule.isAlarm` 导出的谓词，勿手抄）：已逾期，或最近一次**终结**运行失败 / 超时 */
function isAlarmView(v: DockToolView): boolean {
  return isAlarm(v.runs, isOverdue(v.due.state));
}

function filtered(): DockToolView[] {
  let list = views.slice();
  const q = query.trim().toLowerCase();
  if (q) {
    list = list.filter((v) => {
      const hay = [v.entry.id, displayName(v), displayDesc(v), v.run?.cmd ?? v.declPath]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }
  if (kpiFilter === 'alarms') list = list.filter(isAlarmView);
  return list;
}

function renderBody(): void {
  const body = bodyEl();
  if (!body) return;
  body.innerHTML = '';
  if (view.kind === 'detail') {
    const v = viewById(view.id);
    if (v) {
      renderDetail(body, v);
      return;
    }
    view = { kind: 'list' }; // 工具没了（被移除）：退回列表
  }
  renderList(body);
}

function renderList(body: HTMLElement): void {
  if (!views.length) {
    // 移动端只读：没有「导入工具」这个入口（选文件夹是桌面端的事），文案也要跟着改 ——
    // 不然手机上会得到一句「选一个工具文件夹」，而它根本给不了这个动作
    body.appendChild(
      uiEmpty({
        icon: 'square-terminal',
        title: '还没有外部工具',
        desc: canRun()
          ? '选一个工具文件夹，bz 会自己找里面的 manifest.json（旧名 dock.json 也认）；工具坞据此知道它叫什么、有哪些参数、该怎么跑，运行记录也归它收口'
          : '工具要在桌面端导入。手机上只读 —— 工具目录同步过来之后，这里就能看到它的声明、展示板与运行记录',
        actions: canRun()
          ? uiBtnRow(
              [uiBtn({ label: '导入工具', icon: 'file-input', tone: 'primary', onClick: () => importToolFlow() })],
              { center: true },
            )
          : undefined,
      }),
    );
    return;
  }
  const list = filtered();
  if (!list.length) {
    body.appendChild(
      uiEmpty({
        icon: 'search-x',
        title: '没有匹配的工具',
        desc: kpiFilter === 'alarms' ? '这个口径下没有 —— 点顶上的 KPI 格回到全部' : '换个词试试',
      }),
    );
    return;
  }
  // 一张平铺的表：跑不跑、什么时候跑，都由规则表自己说，不再分「自动化 / 手动」两区
  const grid = el('div', 'bz-dock-grid');
  for (const v of list) grid.appendChild(makeCard(v));
  body.appendChild(grid);
}

// ==================== 卡片 ====================

function makeCard(v: DockToolView): HTMLElement {
  const id = v.entry.id;
  const card = el('article', 'bz-dock-card');
  card.dataset.tool = id;
  if (isOverdue(v.due.state)) card.classList.add('is-due');
  if (!isEnabled(v.entry)) card.classList.add('is-disabled');
  if (liveRunOf(id)) card.classList.add('is-running');

  // 顶行：图标 + 名 + 触发标签
  const top = el('div', 'bz-dock-card-top');
  const ic = el('span', 'bz-dock-card-ic');
  ic.appendChild(uiIcon(displayIcon(v), 'bz-ic--md'));
  const idbox = el('div', 'bz-dock-card-idbox');
  const name = el('div', 'bz-dock-card-name', displayName(v));
  const tags = el('div', 'bz-dock-card-tags');
  if (isOverdue(v.due.state)) tags.appendChild(el('span', 'bz-dock-tag bz-dock-tag--due', '今日未跑'));
  const trustTag = trustTagOf(v);
  if (trustTag) tags.appendChild(el('span', 'bz-dock-tag bz-dock-tag--warn', trustTag));
  if (!v.manifest) tags.appendChild(el('span', 'bz-dock-tag bz-dock-tag--muted', '声明读不到'));
  if (v.manifest && !v.run) tags.appendChild(el('span', 'bz-dock-tag bz-dock-tag--muted', '只能看'));
  if (v.runState?.pausedAt) tags.appendChild(el('span', 'bz-dock-tag bz-dock-tag--warn', '自动已暂停'));
  idbox.append(name, tags);
  top.append(ic, idbox);
  card.appendChild(top);

  const desc = displayDesc(v);
  if (desc) card.appendChild(el('div', 'bz-dock-card-desc', desc));

  // 状态行：最近一次「什么时候 + 跑成什么样」，成功率贴右
  const state = el('div', 'bz-dock-card-state');
  const last = lastOf(v);
  state.appendChild(el('span', dotClass(last ? last.status : v.due.state)));
  state.appendChild(el('span', 'bz-dock-card-when', whenTextOf(v, last)));
  state.appendChild(el('span', 'bz-dock-card-msg', messageTextOf(v, last)));
  const rate = successRate(v.runs);
  if (rate !== null) {
    // ⚠️ 必须带上「成功」二字：光一个百分比挨着时间轴，会被读成进度条。
    //    这个数字是「记录里成功了几条」，不是任何一次运行的进度 —— 别让它被误读。
    const rateEl = el('span', 'bz-dock-rate', `${Math.round(rate * 100)}% 成功`);
    rateEl.title = `${v.runs.length} 条记录里成功了几条`;
    if (rate < 1) rateEl.classList.add('is-warn');
    state.appendChild(rateEl);
  }
  card.appendChild(state);

  // 上次失败 → 卡面就直接给「怎么办」（可操作提示不该藏在详情里）
  const hint = failHintOf(last);
  if (hint) {
    const box = el('div', 'bz-dock-card-fail');
    box.appendChild(uiIcon('alert-triangle', 'bz-ic--xs'));
    box.appendChild(el('span', 'bz-dock-card-failtext', hint));
    card.appendChild(box);
  }

  // 最近 7 次：通栏迷你时间轴（格子撑满一行 = 一眼看出这周达标几次；单格 hover 能问出是哪一次）
  const strip = el('div', 'bz-dock-strip');
  strip.title = '最近 7 次运行（左旧右新）';
  for (const r of recentRuns(v.runs, 7)) {
    const cell = el('i', 'bz-dock-pip');
    if (r) {
      cell.classList.add(`bz-dock-pip--${r.status}`);
      cell.title = `${relTime(r.startedAt.replace('T', ' '))} · ${statusText(r.status)}${r.message ? ` · ${r.message}` : ''}`;
    } else {
      cell.title = '这一次没有运行记录';
    }
    strip.appendChild(cell);
  }
  card.appendChild(strip);

  // 动作行：只留运行 —— 详情整卡点开，管理动作在详情页与右键菜单里
  const foot = el('div', 'bz-dock-card-foot');
  if (canRun()) {
    const live = liveRunOf(id);
    if (live) {
      foot.appendChild(
        uiBtn({
          label: '停止',
          icon: 'square',
          tone: 'danger',
          size: 'sm',
          onClick: () => {
            stopRun(id);
          },
        }),
      );
    } else {
      foot.appendChild(
        uiBtn({
          label: '运行',
          icon: 'play',
          tone: 'primary',
          size: 'sm',
          disabled: !canStart(v),
          onClick: () => void runFlow(v),
        }),
      );
    }
  } else {
    foot.appendChild(el('span', 'bz-dock-mobilehint', '移动端仅查看'));
  }
  card.appendChild(foot);

  // 菜单（右键 / 长按）+ 左键开详情。移动端只读：不挂抽屉 —— 里面的重读 / 运行 /
  // 重新导入 / 停用 / 移除全是操作，手机上一个都执行不了
  attachItemActions(card, canRun() ? cardActions(v) : []);
  card.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('button')) return; // 按钮自己处理
    view = { kind: 'detail', id };
    render();
  });
  return card;
}

function lastOf(v: DockToolView): DockRunRecord | undefined {
  return v.runs
    .slice()
    .sort((a, b) => (timeOf(b.startedAt) ?? 0) - (timeOf(a.startedAt) ?? 0))[0];
}

function cardActions(v: DockToolView): ItemAction[] {
  const id = v.entry.id;
  const acts: ItemAction[] = [
    {
      icon: 'chevron-right',
      label: '打开详情',
      onClick: () => {
        view = { kind: 'detail', id };
        render();
      },
    },
    {
      icon: 'refresh-cw',
      label: '重新读声明',
      onClick: () => void reloadDeclaration(v),
    },
  ];
  if (canStart(v)) {
    acts.push({
      icon: 'play',
      label: '运行',
      onClick: () => void runFlow(v),
    });
  }
  if (v.runState?.pausedAt) {
    acts.push({ icon: 'play', label: '恢复并立即重试', onClick: () => void resumeAndRetry(v) });
  }
  acts.push({ icon: 'pencil', label: '重新导入', onClick: () => void importToolFlow(v.entry) });
  acts.push({
    icon: 'trash-2',
    label: v.entry.enabled === false ? '启用' : '停用',
    onClick: () => void toggleEnabled(v.entry),
  });
  acts.push({
    icon: 'x-circle',
    label: '移除登记',
    kind: 'danger',
    onClick: () => void removeToolFlow(v),
  });
  return acts;
}

// ==================== 详情 ====================

// ---------- 自动运行（详情页；D1 修订后 bz 与调度器之间唯一的用户界面） ----------

/**
 * 取（或初始化）某工具的节奏草稿。**初值 = 当前生效值**（覆盖 ?? 默认），不是「跟随脚本」那种占位——
 * 用户要的是「打开就能直接改」，而不是先选一个「我要改了」才能看见可填的字段（ADR-0236 §补记）。
 * 脚本没给节奏（手动工具）或给的是 `on-demand` 时，落到一组能用的默认（每天 12:00），
 * 让人能就地把它排成自动化 —— 编辑器不提供「只手动」，那是总闸的事。
 */
function autoDraftOf(v: DockToolView): AutoDraft {
  const key = v.entry.id;
  const existing = autoDraft.get(key);
  if (existing) return existing;

  const cur = v.schedule;
  const k = cur?.kind;
  // 只有 daily/weekly/interval 是可编辑的「节奏」；`on-demand`/`unknown`/未声明都落到默认形态
  const kind: AutoDraft['kind'] =
    k === 'daily' || k === 'weekly' || k === 'interval' ? k : 'daily';
  const d: AutoDraft = {
    kind,
    hour: cur?.hour ?? 12,
    weekday: cur?.weekday ?? 1,
    everyHours: cur?.everyHours ?? 6,
  };
  autoDraft.set(key, d);
  return d;
}

/**
 * 保存节奏。存完踢调度器一拍，让改动作立刻生效。
 *
 * 两条口径：
 *  - `kind: 'inherit'`（「恢复脚本默认」按钮）→ **清除覆盖**，回落脚本那份默认（含它日后的改动）。
 *  - 改出来的节奏**与脚本默认一模一样** → 也清除覆盖。用户把值调回原样，意思就是「照脚本的来」，
 *    这时还留着一份覆盖只会让工具从此不再跟随脚本的后续改动 —— 那是隐坑，不是意图。
 */
async function saveAuto(v: DockToolView, d: AutoDraft): Promise<void> {
  const id = v.entry.id;
  const next = scheduleFromDraft(d.kind, d);
  const sameAsDeclared =
    next !== undefined && scheduleSignature(next) === scheduleSignature(v.declaredSchedule);
  if (!next || sameAsDeclared) {
    await updateToolEntry(id, { scheduleOverride: undefined, overrideDeclSig: undefined });
  } else {
    await updateToolEntry(id, {
      scheduleOverride: next,
      overrideDeclSig: scheduleSignature(v.declaredSchedule),
    });
  }
  autoDraft.delete(id);
  kickDockScheduler();
  await refresh();
}

function autoRow(label: string, value: string): HTMLElement {
  const row = el('div', 'bz-dock-autorow');
  row.appendChild(el('span', 'bz-dock-autorow-label', label));
  row.appendChild(el('span', 'bz-dock-autorow-val', value));
  return row;
}

/** 取值并夹到 [lo, hi] 的整数（输入框删空 / 乱输时回落到 fallback） */
function clampInt(raw: string, lo: number, hi: number, fallback: number): number {
  // '' 必须先拦：Number('') === 0，会假装成合法的 0 溜过 Number.isFinite，把「删空」变成「设成下限」
  if (raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * 「自动运行」块（详情页）。
 *
 * **模型一句话**（ADR-0236 §补记）：**自动化是 bz 这一侧的事** —— 开不开、怎么排，都在这里（用户）定；
 * 脚本声明里的节奏只是**初始默认值**。所以本块不是「让这个工具参与自动化」，而是「给这个工具配一个
 * bz 的定时任务」。措辞上别用「参与 / 授权 / 覆盖作者」那套 —— 会让人以为主动权在脚本那边。
 *
 * 三件事实摆出来：**脚本默认**（`declaredSchedule`）、**当前生效**（`scheduleOverride ?? declared`）、
 * 下次什么时候跑。改的永远是 bz 这一份覆盖，脚本那份只读不写（它在工具目录里，bz 不碰）。
 *
 * 没有「自动运行开关」这种东西：有生效规则就自动跑，没有就不跑 —— 规则表是唯一事实源，
 * 不摆第二个控件跟它说同一件事（两个开关互相打架的老坑不再挖）。
 */
// ---------- 自动运行（详情页）：规则表 —— 触发条件 → 执行 ----------

/** 新建 / 换类型时的默认触发条件（打开就能改，不用先选类型才看见字段） */
function defaultTriggerOf(kind: DockTriggerKind): DockTrigger {
  switch (kind) {
    case 'daily':
      return { kind: 'daily', at: '12:00' };
    case 'interval':
      return { kind: 'interval', everyMin: 60 };
    case 'on-launch':
      return { kind: 'on-launch', delayMin: 5 };
    case 'panel-open':
      return { kind: 'panel-open' };
    case 'tool-ok':
      return { kind: 'tool-ok', toolId: '' };
    case 'tool-fail':
      return { kind: 'tool-fail', toolId: '' };
    case 'domain-event':
      return { kind: 'domain-event', channel: '' };
    case 'vault-file':
      return { kind: 'vault-file', target: '' };
    case 'data-threshold':
      return { kind: 'data-threshold', path: '', key: '', op: '>', value: 0 };
  }
}

/** 写回规则表（规则唯一写入口）：整表重写，落盘前由 `parseRules` 把关 */
async function saveRules(v: DockToolView, next: DockRule[]): Promise<void> {
  await updateToolEntry(v.entry.id, { rules: next });
  kickDockScheduler();
  await refresh();
}

/** 删一条规则 */
async function removeRule(v: DockToolView, ruleId: string): Promise<void> {
  await saveRules(v, v.rules.filter((r) => r.id !== ruleId));
}

/**
 * 规则编辑器 —— 一个**弹窗**装下整条规则（触发条件 → 执行 → 随机延迟）。
 *
 * 为什么不在行内摆控件：九个触发条件各有各的参数，行内摆等于把整张表挤成一条横向滚动条，
 * 且每改一次类型都要重排整行。弹窗里改的是**草稿**，保存才落盘 —— 中途换类型不留残骸。
 */
function openRuleEditor(v: DockToolView, rule: DockRule | null): void {
  const draft: DockRule = rule
    ? { ...rule, trigger: { ...rule.trigger }, action: { ...rule.action } }
    : { id: newRuleId(), trigger: defaultTriggerOf('daily'), action: { kind: 'run', notify: 'fail' } };

  const form = el('div', 'bz-dock-ruleform');
  const params = el('div', 'bz-dock-ruleparams');
  const err = el('div', 'bz-dock-ruleformerr');
  const preview = el('div', 'bz-dock-rulepreview');

  /** 底行这句话是整条规则的**人话回显**：改哪儿它跟到哪儿，保存前能自己核对一遍 */
  const syncPreview = (): void => {
    const jit = draft.jitterMin ? ` · 抖 ${minutesText(draft.jitterMin)}` : '';
    preview.textContent = `${triggerText(draft.trigger)} → ${actionText(draft.action)}${jit}`;
  };
  /** 参数区重建（换触发类型 / 点快捷值都要重画） */
  const rebuild = (): void => {
    params.replaceChildren(...triggerFields(draft, rebuild));
    syncPreview();
  };

  const triggerPick = uiChoice<DockTriggerKind>({
    options: TRIGGER_KINDS.map((k) => ({ value: k, label: TRIGGER_LABEL[k] })),
    value: draft.trigger.kind,
    label: '触发条件',
    onChange: (kind) => {
      draft.trigger = defaultTriggerOf(kind);
      rebuild();
    },
  });

  const actionPick = uiChoice<string>({
    options: [
      { value: 'run', label: '运行' },
      { value: 'run-notify', label: '运行并提醒' },
      { value: 'remind', label: '只提醒' },
    ],
    value: draft.action.kind === 'remind' ? 'remind' : draft.action.notify === 'always' ? 'run-notify' : 'run',
    label: '执行',
    onChange: (val) => {
      draft.action =
        val === 'remind'
          ? { kind: 'remind' }
          : { kind: 'run', notify: val === 'run-notify' ? 'always' : 'fail' };
      syncPreview();
    },
  });

  const jitter = uiInput({
    type: 'number',
    value: String(draft.jitterMin ?? 0),
    onInput: (val) => {
      draft.jitterMin = clampInt(val, 0, 720, 0);
      syncPreview();
    },
  });
  jitter.min = '0';

  form.appendChild(sectionOf('触发条件', [triggerPick.el, params]));
  form.appendChild(sectionOf('执行', [actionPick.el]));
  form.appendChild(
    sectionOf('随机延迟（错峰用）', [
      uiField({ label: '到点后再等', desc: '0 = 不抖', control: jitter }),
      quickRow(
        [
          { label: '不抖', value: 0 },
          { label: '2 分', value: 2 },
          { label: '10 分', value: 10 },
          { label: '30 分', value: 30 },
        ],
        (n) => {
          draft.jitterMin = n;
          jitter.value = String(n);
          syncPreview();
        },
      ),
    ]),
  );
  form.appendChild(preview);
  form.appendChild(err);

  rebuild();

  const { popup, close } = uiModal({
    head: true,
    title: rule ? '编辑规则' : '新建规则',
    content: form,
    maxWidth: 480,
    className: 'bz-dock-rulemodal',
  });

  /** 缺参数的规则跑不起来 —— 说清缺什么，比让它静默生效强 */
  const problem = (): string | null => {
    const t = draft.trigger;
    if (t.kind === 'tool-ok' || t.kind === 'tool-fail') return t.toolId ? null : '还没选工具';
    if (t.kind === 'domain-event') return t.channel.trim() ? null : '还没填事件通道';
    if (t.kind === 'vault-file') return t.target.trim() ? null : '还没填目录';
    if (t.kind === 'data-threshold') return t.path.trim() && t.key.trim() ? null : '还没填文件与键';
    return null;
  };

  const commit = (): void => {
    const next = rule
      ? v.rules.map((r) => (r.id === rule.id ? draft : r))
      : [...v.rules, draft];
    close();
    void saveRules(v, next);
  };

  const ok = uiBtn({
    label: '保存',
    tone: 'primary',
    size: 'sm',
    onClick: () => {
      const p = problem();
      if (p) {
        err.textContent = p;
        return;
      }
      err.textContent = '';
      commit();
    },
  });
  const foot = el('div', 'bz-dock-ruleformfoot');
  foot.appendChild(
    uiBtn({
      label: '取消',
      size: 'sm',
      onClick: () => close(),
    }),
  );
  foot.appendChild(el('div', 'bz-dock-ruleformsp'));
  if (rule) {
    foot.appendChild(
      uiBtn({
        label: '删除',
        size: 'sm',
        danger: true,
        onClick: () => {
          close();
          void removeRule(v, rule.id);
        },
      }),
    );
  }
  foot.appendChild(ok);
  form.appendChild(foot);
  // 回车提交（弹窗表单的通用手感）：Ctrl/⌘+Enter 恒提交，单行 input 里回车也提交
  bindFormSubmit(popup, () => ok.click());
}

/** 弹窗里的一节：小标题 + 内容 */
function sectionOf(title: string, children: HTMLElement[]): HTMLElement {
  const sec = el('div', 'bz-dock-ruleformsec');
  sec.appendChild(el('div', 'bz-dock-ruleformlegend', title));
  for (const c of children) sec.appendChild(c);
  return sec;
}

/** 快捷值一行（点一下就填）—— 数值字段不用人人手敲 */
function quickRow(items: { label: string; value: number }[], onPick: (n: number) => void): HTMLElement {
  const row = el('div', 'bz-dock-rulequick');
  for (const it of items) {
    row.appendChild(uiBtn({ label: it.label, size: 'sm', onClick: () => onPick(it.value) }));
  }
  return row;
}

/** 触发条件的参数字段（草稿就地改；换值要重画时走 `rebuild`） */
function triggerFields(draft: DockRule, rebuild: () => void): HTMLElement[] {
  const t = draft.trigger;
  switch (t.kind) {
    case 'daily': {
      const inp = uiInput({
        type: 'time',
        value: atSecondsOf(t.at) === undefined ? '' : t.at,
        onInput: (val) => {
          draft.trigger = { kind: 'daily', at: val || '12:00' };
        },
      });
      return [
        uiField({ label: '时刻', control: inp }),
        quickRow(
          [
            { label: '08:00', value: 8 * 60 },
            { label: '12:00', value: 12 * 60 },
            { label: '20:00', value: 20 * 60 },
          ],
          (mins) => {
            const at = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
            draft.trigger = { kind: 'daily', at };
            rebuild();
          },
        ),
      ];
    }
    case 'interval': {
      const inp = uiInput({
        type: 'number',
        value: String(t.everyMin),
        onInput: (val) => {
          draft.trigger = { kind: 'interval', everyMin: clampInt(val, 1, 43200, 60) };
        },
      });
      inp.min = '1';
      return [
        uiField({ label: '每隔（分钟）', control: inp }),
        quickRow(
          [
            { label: '30 分', value: 30 },
            { label: '1 小时', value: 60 },
            { label: '6 小时', value: 360 },
            { label: '1 天', value: 1440 },
          ],
          (n) => {
            draft.trigger = { kind: 'interval', everyMin: n };
            rebuild();
          },
        ),
      ];
    }
    case 'on-launch': {
      const inp = uiInput({
        type: 'number',
        value: String(t.delayMin),
        onInput: (val) => {
          draft.trigger = { kind: 'on-launch', delayMin: clampInt(val, 0, 1440, 5) };
        },
      });
      inp.min = '0';
      return [
        uiField({ label: '启动后等（分钟）', control: inp }),
        quickRow(
          [
            { label: '立刻', value: 0 },
            { label: '1 分', value: 1 },
            { label: '5 分', value: 5 },
            { label: '30 分', value: 30 },
          ],
          (n) => {
            draft.trigger = { kind: 'on-launch', delayMin: n };
            rebuild();
          },
        ),
      ];
    }
    case 'panel-open':
      return [el('div', 'bz-dock-ruleformhint', '打开工具坞面板时触发，没有要填的')];
    case 'tool-ok':
    case 'tool-fail': {
      const sel = uiSelect<string>({
        options: [{ value: '', label: '选一个工具' }, ...toolOptions()],
        value: t.toolId,
        onChange: (val) => {
          draft.trigger = { kind: t.kind, toolId: val };
        },
      });
      return [uiField({ label: t.kind === 'tool-ok' ? '哪个工具成功后' : '哪个工具失败后', control: sel.el })];
    }
    case 'domain-event': {
      const inp = uiInput({
        type: 'text',
        value: t.channel,
        placeholder: '域名:事件',
        onInput: (val) => {
          draft.trigger = { kind: 'domain-event', channel: val };
        },
      });
      return [uiField({ label: '事件通道', desc: '如 people:changed', control: inp })];
    }
    case 'vault-file': {
      const inp = uiInput({
        type: 'text',
        value: t.target,
        placeholder: 'vault 里的目录',
        onInput: (val) => {
          draft.trigger = { kind: 'vault-file', target: val };
        },
      });
      return [uiField({ label: '哪个目录有变动', control: inp })];
    }
    case 'data-threshold': {
      const path = uiInput({
        type: 'text',
        value: t.path,
        placeholder: '数据文件',
        onInput: (val) => {
          draft.trigger = { ...t, path: val };
        },
      });
      const key = uiInput({
        type: 'text',
        value: t.key,
        placeholder: '键',
        onInput: (val) => {
          draft.trigger = { ...t, key: val };
        },
      });
      const op = uiSelect<string>({
        options: [
          { value: '>', label: '大于' },
          { value: '<', label: '小于' },
          { value: '=', label: '等于' },
        ],
        value: t.op,
        onChange: (val) => {
          draft.trigger = { ...t, op: val as '>' | '<' | '=' };
        },
      });
      const num = uiInput({
        type: 'number',
        value: String(t.value),
        onInput: (val) => {
          draft.trigger = { ...t, value: Number(val) || 0 };
        },
      });
      const grid = el('div', 'bz-dock-rulegrid');
      grid.append(uiField({ label: '文件', control: path }), uiField({ label: '键', control: key }));
      grid.append(uiField({ label: '比较', control: op.el }), uiField({ label: '阈值', control: num }));
      return [grid];
    }
  }
}

/**
 * 面板上一条规则 —— **只读摘要**，点一下进弹窗改。
 *
 * 摘要不摆控件：行内九个下拉加参数会把这一行撑爆，且「点哪儿都在改数据」让人不敢点。
 */
function ruleRow(v: DockToolView, rule: DockRule): HTMLElement {
  const row = el('div', 'bz-dock-rule');
  const main = el('div', 'bz-dock-rulemain');
  main.appendChild(el('div', 'bz-dock-ruleline', triggerText(rule.trigger)));
  main.appendChild(el('div', 'bz-dock-rulemeta', actionText(rule.action) + (rule.jitterMin ? ` · 抖 ${minutesText(rule.jitterMin)}` : '')));
  row.appendChild(main);
  // 移动端只读：不给「点进去改」的入口（也就没有箭头与 role=button —— 明示这里不可操作）
  if (!canRun()) {
    row.classList.add('is-readonly');
    return row;
  }
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.appendChild(el('span', 'bz-dock-rulearrow', '›'));
  const open = (): void => openRuleEditor(v, rule);
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    open();
  });
  return row;
}

/** 工具下拉的选项（已登记的 id；标题得读声明，这里不为了列表好看去读一遍磁盘） */
function toolOptions(): { value: string; label: string }[] {
  return readToolEntries().map((e) => ({ value: e.id, label: e.id }));
}


/**
 * 「自动运行」块（详情页）—— **规则表**：一行一条「触发条件 → 执行」。
 *
 * 开关只有总闸一个；规则的增删改全在下面。**不写说明文字**（不留 desc、不留提示段落）。
 */
function autoSection(v: DockToolView): HTMLElement {
  const sec = el('section', 'bz-dock-pane bz-dock-autopane');
  const head = el('div', 'bz-dock-pane-head');
  head.appendChild(el('h3', 'bz-dock-pane-title', '自动运行'));
  sec.appendChild(head);

  if (v.runState?.pausedAt && canRun()) {
    const last = lastRun(v.runs);
    const hint = last?.error ? errorHint(last.error.kind) : null;
    const bar = el('div', 'bz-dock-runbtns');
    bar.appendChild(
      uiBtn({
        label: hint ? `恢复并重试（上次：${hint}）` : '恢复并重试',
        size: 'sm',
        tone: 'primary',
        onClick: () => void resumeAndRetry(v),
      }),
    );
    sec.appendChild(bar);
  }

  const list = el('div', 'bz-dock-rulelist');
  if (v.rules.length) for (const rule of v.rules) list.appendChild(ruleRow(v, rule));
  else list.appendChild(el('div', 'bz-dock-ruleempty', '没有规则 —— 加一条就有了'));
  sec.appendChild(list);

  // 加规则要开编辑器、要落盘 —— 移动端只读，不给这个按钮
  if (canRun()) {
    sec.appendChild(
      uiBtn({ label: '添加规则', size: 'sm', onClick: () => openRuleEditor(v, null) }),
    );
  } else {
    sec.appendChild(el('div', 'bz-dock-mobilehint', '移动端只读，改节奏 / 规则请回桌面端'));
  }
  return sec;
}

function renderDetail(body: HTMLElement, v: DockToolView): void {
  // 头部在 `.bz-panel-head` 里（renderToolHead），这里从「当前脚本的统计」开始
  const wrap = el('div', 'bz-dock-detail');

  if (v.declError) {
    const box = el('div', 'bz-dock-meta-warn');
    // 移动端补一句人话：这里的「读不到」跟桌面端不是一回事 —— 路径多半是对的，
    // 差的是「文件还没同步到这台设备」或「工具目录不在仓库里」
    box.textContent = canRun()
      ? v.declError
      : `${v.declError}（手机端只读：文件没同步到这台设备，或工具目录不在仓库里）`;
    wrap.appendChild(box);
  }

  // 展示板**排在最前**：详情页第一眼该看到的是「这个工具给我看了什么」，而不是它怎么跑、
  // 上次跑成什么样。工具没画（目录里没有 panel.html）就没有这一块，其余照旧往下排。
  const board = boardSection(v);
  if (board) wrap.appendChild(board);

  // 统计：**当前脚本**的（全局四格只在列表页有）
  wrap.appendChild(toolStats(v));

  // meta 行：怎么跑 / 在哪 —— 命令不再由登记给，而是声明文件里那份
  const meta = el('div', 'bz-dock-meta');
  // 作者 / 版本 / 文档（增强 #2）：声明里写了才显示，没写不占位
  const who = [v.manifest?.author, v.manifest?.toolVersion].filter(Boolean).join(' · ');
  if (who) meta.appendChild(metaRow('作者', who));
  if (v.manifest?.docs) {
    const docs = v.manifest.docs;
    const row = el('div', 'bz-dock-meta-row');
    row.appendChild(el('span', 'bz-dock-meta-label', '文档'));
    row.appendChild(el('span', 'bz-dock-meta-val', docs));
    // 只放行 http(s) —— 声明是外部文件，docs 写什么都可能，别把它当任意跳转的入口
    if (/^https?:\/\//i.test(docs)) {
      row.appendChild(
        uiIconBtn({ icon: 'external-link', title: '打开文档', xs: true, onClick: () => window.open(docs, '_blank') }),
      );
    } else {
      row.appendChild(uiIconBtn({ icon: 'copy', title: '复制', xs: true, onClick: () => void copyText(docs, '文档地址') }));
    }
    meta.appendChild(row);
  }
  meta.appendChild(
    metaRow('声明文件', v.declPath, true, () => void copyText(v.declPath, '声明文件路径')),
  );
  if (v.run) {
    meta.appendChild(metaRow('命令', v.run.cmd, true));
    if (v.run.args.length) meta.appendChild(metaRow('固定参数', v.run.args.join(' '), true));
    if (v.run.cwd) meta.appendChild(metaRow('工作目录', v.run.cwd, true));
    if (v.run.shell) meta.appendChild(metaRow('经 shell 启动', '是'));
  } else {
    meta.appendChild(metaRow('命令', '没写怎么跑（既无 run 段，目录里也没有 main.mjs）'));
  }
  meta.appendChild(
    metaRow('参数值文件', v.valuesPath, true, () => void copyText(v.valuesPath, '参数值文件路径')),
  );
  meta.appendChild(metaRow('运行记录', v.runsPath, true, () => void copyText(v.runsPath, '运行记录路径')));
  if (v.overLimit) {
    meta.appendChild(el('div', 'bz-dock-meta-warn', '记录条数已超约定上限 —— 裁剪是工具自己的活，去检查它的 GC'));
  }
  if (v.runsUnreadable) {
    meta.appendChild(el('div', 'bz-dock-meta-warn', '运行记录文件读不懂（坏 JSON 或结构不符）；工具坞不打补丁、不改写，等工具自己修好'));
  }
  wrap.appendChild(meta);
  wrap.appendChild(autoSection(v));

  const cols = el('div', 'bz-dock-cols');
  cols.appendChild(runPane(v));
  cols.appendChild(histPane(v));
  wrap.appendChild(cols);
  body.appendChild(wrap);
}

// ---------- 展示板（工具自己画的那一块，ADR-0243） ----------

/**
 * 展示板文件的上限。面板不是浏览器：几百 KB 的文档灌进 srcdoc 会把「打开详情页」拖成秒级，
 * 而展示板是「一眼看完的几行数」—— 想放长文该去写手册，不是塞这里。超了就不渲染并说清楚。
 */
const BOARD_MAX_BYTES = 512 * 1024;

/**
 * 展示板的可视高度上限（2026-10-20 补）：内容再多，这块也只占这么高，超了在框内滚。
 *
 * 这条**反复过两次**，别急着改回去：
 *  - 2026-10-15 之前有 520 px 上限，压矮 iframe 让框自己滚 —— 框里长出一根**原生**滚动条
 *    （带箭头、不跟主题），用户报「展示窗口有滚动条」，上限被废。
 *  - 现在上限回来，同时把那条滚动条**在框文档里藏掉**（见 FRAME_SCROLLBAR_CSS）——
 *    两次抱怨是同一个病根：条没藏住。藏住了，压矮就是对的：滚动只在框内发生，
 *    外面的详情页不会因为一块展示板被顶成一堵墙。
 *
 * 为什么不套一层外层滚动容器：滚的是外层时，鼠标停在框里滚不动（轮子事件落在框文档里），
 * 手感是坏的。高度与滚动都归框自己管，不分两处。
 */
const BOARD_MAX_HEIGHT = 560;

/**
 * 框文档里的滚动条样式（2026-10-20 补·铁律 4 的第二处、也是**唯一**一处例外）
 *
 * `scrollbar-width:none` 只在 Chromium 121+ 生效 —— 用户这台 Obsidian 的 Electron 更老，
 * 那条**静默无效**：上限一加，框里立刻长出带箭头的原生滚动条（用户第二次报滚动条）。
 * `::-webkit-scrollbar` 从老版本起就认，两条一起上才稳。
 *
 * 为什么只能注入 `<style>`：`style` 属性写不了伪元素，core 里那套界面级隐藏规则（ADR-0122）
 * 跨不过文档边界。作用域严格限定在**沙箱框文档内部**，碰不到插件自己的 UI —— 
 * 所以它不违反「插件 UI 样式只从 styles.css 来」的本意（ADR-0199 管的是插件 UI，
 * 不是别人递进来的 iframe 文档）。改这里之前先读 ADR-0243 的补记。
 */
const FRAME_SCROLLBAR_CSS =
  '<style>html,body{scrollbar-width:none;-ms-overflow-style:none}' +
  'html::-webkit-scrollbar,body::-webkit-scrollbar{display:none;width:0;height:0}</style>';

/**
 * 灌给展示板的主题变量 —— 只挑「画一块内容」够用的那一小撮。
 * 给全套等于把面板内部 token 变成公开 API（日后重构得先问过所有工具），而这一小撮已经够
 * 脚本画出「像是面板的一部分」的东西：底色/文字/描边/品牌色/圆角/字体/间距。
 */
const BOARD_THEME_VARS = [
  '--bz-surface-0',
  '--bz-surface-1',
  '--bz-surface-2',
  '--bz-surface-3',
  '--bz-text-1',
  '--bz-text-2',
  '--bz-text-3',
  '--bz-border',
  '--bz-brand',
  '--bz-success',
  '--bz-warning',
  '--bz-danger',
  '--bz-radius-sm',
  '--bz-radius-md',
  '--bz-font-ui',
  '--bz-font-mono',
  '--bz-space-xs',
  '--bz-space-sm',
  '--bz-space-md',
  '--bz-space-lg',
];

/**
 * 灌给 iframe 内容的主题变量 + 基线样式，合成一个 `style` 属性的值（变量一个都读不到就只剩基线，
 * 框里退回自己的默认观感）。
 *
 * 两个消费者共用它：展示板（`panel.html`，ADR-0243）与询问框的 HTML 正文（ADR-0244）。
 * 它们想要的是同一件事 ——「画出来的东西像是面板的一部分」，所以口径只有这一份。
 *
 * **值必须转义**：主题变量里有 `--bz-font-ui: -apple-system, "Segoe UI", …` 这种**带引号**的值，
 * 原样拼进 `style="…"` 会让属性在第一个 `"` 处提前收尾 —— 它后面的声明（`--bz-font-mono`、
 * `--bz-space-*` 与整条基线：margin / padding / color / font-family / font-size / line-height）
 * 全被当成杂属性丢掉，框里退回 8px 边距、Times、16px（ADR-0243 起就埋着，2026-10-15 做询问框时
 * 端到端验出来的）。**这条转义不是防注入，是让后面的声明还能生效** —— 别删。
 *
 * 走 `style` 属性而不是拼一段 `<style>`：自定义属性本来就是这么传的，够用；而且这样本模块里
 * 一处 `<style>` 字面量都没有 —— 铁律 4 的唯一注入点守卫（ADR-0199）不必为它开第二个口子。
 *
 * **滚动条也有、但只隐藏条**：框里是**独立文档**，core 那条界面级隐藏滚动条的通杀规则
 * （ADR-0122，选择器按 `bz-` 前缀枚举）**够不着它** —— CSS 不跨文档。而「隐藏条、保留滚动」
 * 是 bz 界面的既有口径，所以在这里补上（不是薄条、不是自绘，是隐藏）。这也是唯一能进框的通道：
 * 走 `style` 属性，不新增 `<style>` 注入点（铁律 4）。
 *
 * **挂根元素、不是挂 body**（无头实测 2026-10-15）：框里的滚动条是**视口滚动条**，归根元素管；
 * 而 `scrollbar-width` **不继承**，挂在 `<body>` 上对它是无效的（实测条占位仍是 15px，挂到
 * `<html>` 上才是 0px）。所以那条在 `frameRootStyle()`，别往这条基线里加。
 *
 * 代价要认：内联 `style` 的优先级高于任何选择器，所以**框里没法用普通规则改这几条基线**
 * （要改得用 `!important`）—— 这也正是为什么基线只留最必要的几条，其余都交给框里自己。
 */
export function frameBaseStyle(): string {
  const cs = getComputedStyle(document.body);
  const parts = BOARD_THEME_VARS.map((name) => {
    const value = cs.getPropertyValue(name).trim();
    return value ? `${name}:${escapeStyleAttr(value)}` : '';
  }).filter(Boolean);
  // 基线：撑满 + 跟随主题 + 一点内边距。`margin:0` 与 `background:transparent` 是**必需**的
  // （body 默认 8px 外边距、iframe 内容默认白底），另几条只是给个合理默认观感
  parts.push(
    'margin:0',
    'padding:var(--bz-space-md)',
    'background:transparent',
    'color:var(--bz-text-1)',
    'font-family:var(--bz-font-ui)',
    'font-size:var(--bz-font-label)',
    'line-height:1.6',
  );
  return parts.join(';');
}

/**
 * 一个值要塞进双引号包的 HTML 属性时的转义。只两样要管：`&`（不然 `&quot;` 这类会被二次解码）
 * 与 `"`（不然属性提前收尾 —— 见 frameBaseStyle 的注释）。
 */
export function escapeStyleAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * 框文档**根元素**（`<html>`）上那一条：隐藏框自己的滚动条（ADR-0122「只隐藏条、保留滚动」同款）。
 *
 * 为什么单独一条、而且必须挂在根上：框里的滚动条是**视口滚动条**，归 `<html>` 管；而
 * `scrollbar-width` **不继承**，挂在 `<body>` 上对它无效（2026-10-15 无头实测：挂 body 条占位
 * 仍是 15px，挂 html 才是 0px）。所以别把这条并进 `frameBaseStyle()`（那是 body 基线）。
 *
 * 为什么不能靠 core 那条界面级规则：它是 CSS，跨不过文档边界（iframe 是独立文档），够不着框里。
 */
export function frameRootStyle(): string {
  return 'scrollbar-width:none';
}

/**
 * 把 iframe 撑到**内容那么高**（不封顶）—— sandbox 带 allow-same-origin 才读得到它自己的文档。
 *
 * **为什么不封顶**：封了就会在框里长出一条原生滚动条（Windows 上还带上下箭头，与宿主观感完全
 * 不是一回事）—— 而那是**框内滚动**，样式管不着、也没法跟着主题走。框跟着内容长、滚动交给外面
 * 那层（展示板是面板的内容区 `.bz-dock-body`，询问框是弹窗正文区）之后，滚动条是宿主自己的。
 * 代价要认：展示板理论上能长到任意高（512 KB 上限只管体积），所以它仍是「一眼看完的几行数」。
 *
 * **为什么不能只量一次**（2026-10-15 用户报「还是有滚动条」，无头实测出两条）：
 *  - **量到 0**：面板**关着**的时候也会渲染（刷新 / 运行结束后的重渲染），而 `display:none` 的框里
 *    文档没有布局 —— `scrollHeight` 量出来是 0（实测）。只量一次、又只认 > 0 的值，这一帧之后就
 *    再也不纠正，框停在默认 150px、内容溢出、框里长出一根原生条。
 *  - **量短了**：emoji / 字体在 load 之后才落地，内容会长高；量到的旧高度就短了那么一点 ——
 *    溢出的那一点点正好够长出一条条（截图里拇指几乎顶满轨道，就是这么来的）。
 *
 * 所以：立刻量一次 + `ResizeObserver` 跟着框内文档的尺寸走（隐藏时它不派发，一旦显示、布局
 * 从 0 变成真高度，它会派发 —— 这正是「关着渲染」那条路需要的）。
 */
export function fitFrameHeight(frame: HTMLIFrameElement): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  let last = -1;
  const measure = (): void => {
    const h = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
    // 差 1px 不动它：否则「量高 → 框变高 → 框内重排 → 再量」会互相追着改
    if (h > 0 && Math.abs(h - last) > 1) {
      last = h;
      frame.style.height = `${h}px`;
    }
  };
  measure();
  try {
    const ro = new ResizeObserver(measure);
    if (doc.body) ro.observe(doc.body);
    ro.observe(doc.documentElement);
  } catch { /* 没有 ResizeObserver 的老环境：只留上面那一次，行为与本条之前一致 */ }
}

/**
 * 报告（HTML 片段）装进一个沙箱 iframe —— 展示板与询问框的 HTML 正文共用这一段。
 *
 * **为什么是沙箱 iframe，而不是净化后直接插进 DOM**：
 *  - 直接插，一段 `<style>` 就会串到整个面板，一个没闭合的标签就会把后面的 DOM 吃掉；
 *  - iframe 天然把这两样挡在框里，框里的样式也只能影响它自己；
 *  - 脚本按用途分开给（ADR-0249，2026-10-22 用户拍板）：**展示板**要自己画交互（搜索框那种
 *    「读输入、改列表」的东西，靠预设的 `:checked` 状态做不到），给 `allow-scripts`；
 *    **询问框**只问一句话，递进来的 HTML 没有理由需要执行能力，仍然不给。
 *    沙箱能保证的是「样式与 DOM 只影响框内」；它不能保证「框里不跑代码」，这一条现在由调用方选。
 *  - 带 `allow-same-origin` 是为了能读 `contentDocument` 量高度（不带它量不到，只能写死高度），
 *    也顺带让宿主的 click 监听够得着框里的链接（外链与动作，ADR-0247）。
 */
function sandboxFrame(
  html: string,
  className: string,
  title: string,
  opts: {
    maxHeight?: number;
    allowPopups?: boolean;
    /**
     * 让框里自己的脚本跑（ADR-0249，2026-10-22 用户拍板）。
     *
     * 只给**展示板**开：工具要画自己的交互（搜索框那种「读输入、改列表」的东西），
     * 没有脚本就只能靠预设状态，做不到。询问框（ask body）**不开** —— 那一屏只问一句话，
     * 递进来的 HTML 没有理由需要执行能力。
     */
    allowScripts?: boolean;
    /** 框里点了 `#bz-act:` 链接时回调（ADR-0247）。给了它才拦这类链接 */
    onAct?: (ref: ParsedActRef) => void;
  } = {},
): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.className = className;
  // allow-popups：工具想在展示板里放**外链**（比如直达商店页）就得有它，否则 `target=_blank`
  // 会被沙箱静默吃掉 —— 点了没反应也不报错。配套的 allow-popups-to-escape-sandbox 不能少：
  // 少了的话新标签页继承这层沙箱，目标站点自己的 JS 全废，开出来是个残页。
  // allow-scripts：展示板要自己画交互（ADR-0249）。**仍然不给** allow-top-navigation ——
  // 框可以跑脚本，但顶不掉整个面板。
  // （另外还有 wireExternalLinks 在外面兜一层 —— 光靠这个 flag，宿主不一定真开。）
  const sandbox = ['allow-same-origin'];
  if (opts.allowPopups) sandbox.push('allow-popups', 'allow-popups-to-escape-sandbox');
  if (opts.allowScripts) sandbox.push('allow-scripts');
  frame.setAttribute('sandbox', sandbox.join(' '));
  frame.setAttribute('title', title);
  // max-height 挂在元素上：`fitFrameHeight` 写的是 inline height，CSS 的 max-height 照样压得住；
  // 超出的部分由框自己滚，条已被 FRAME_SCROLLBAR_CSS 藏掉
  if (opts.maxHeight) frame.style.maxHeight = `${opts.maxHeight}px`;
  // 框里写**片段**就行（不必 `<!doctype html><html><body>`）—— 外层裹的 `<html>` 挂根上的那条
  // （隐藏根滚动条），`<body>` 承载主题基线；作者递了整份文档也能用（内层标签的属性以这一层为准）
  frame.srcdoc =
    `<html style="${frameRootStyle()}"><head>${FRAME_SCROLLBAR_CSS}</head>` +
    `<body style="${frameBaseStyle()}">${html}</body></html>`;
  frame.addEventListener('load', () => {
    fitFrameHeight(frame);
    if (opts.allowPopups || opts.onAct) wireExternalLinks(frame, opts.onAct);
  });
  return frame;
}

/**
 * 展示板里的点击处理（2026-10-20；动作回传见 ADR-0247）
 *
 * 两件事共用这一个 capture 监听：
 *  - **外链**交给系统浏览器。只靠沙箱的 `allow-popups` 不保险：Electron 里 `target=_blank`
 *    走的是 Obsidian 自己的 window.open 处理，开不开、开到哪儿全看宿主版本，用户看到的就是
 *    「点了没反应」。而框是**同源**的（allow-same-origin），外面直接能挂监听 —— 于是拦下
 *    点击自己开，`shell.openExternal` 一定走默认浏览器。
 *  - **动作引用** `#bz-act:<id>?...` 交给 `onAct`。这条与「框里能不能跑脚本」无关：动作的两道门
 *    （声明白名单 + 参数掐口）必须由宿主来做，交给框里自己判断就等于没有门（ADR-0247）；
 *    另外导航类（`obsidian://` 之类）在没给 `allow-top-navigation` 的框里会被 Chromium 直接吞掉
 *    （2026-10-20 实测：点了毫无反应）。只有宿主自己挂的监听拿得到这一下点击 ——
 *    这也顺带保证了外部网页伪造不了它。
 *
 * capture 阶段拦，preventDefault 之后宿主不会再补一次。
 */
function wireExternalLinks(
  frame: HTMLIFrameElement,
  onAct?: (ref: ParsedActRef) => void,
): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.addEventListener(
    'click',
    (ev) => {
      const target = ev.target as HTMLElement | null;
      const a = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      // 动作放在 http 判断**之前**：`#` 锚点在这条链路上没有别的用途。
      // 没给 onAct（询问框的正文框）就不拦 —— 让它退化成框内锚点跳转，至少不会静默吃掉点击。
      const act = onAct ? parseActHref(href) : null;
      if (act) {
        ev.preventDefault();
        onAct!(act);
        return;
      }
      if (!/^https?:\/\//i.test(href)) return;
      ev.preventDefault();
      const shell = (window as unknown as {
        require?: (id: string) => { shell?: { openExternal(url: string): void } };
      }).require?.('electron')?.shell;
      if (shell) shell.openExternal(href);
      else window.open(href, '_blank', 'noopener');
    },
    true,
  );
}

/**
 * 展示板（ADR-0243）：工具目录里的 `panel.html`。工具自己画，详情页把它内嵌在「自动运行」
 * 与「运行台 / 运行记录」之间，整宽。文件没有（或只有空白）就整块不出现。
 */
function boardSection(v: DockToolView): HTMLElement | null {
  const html = readPanelText(v.declPath);
  if (html === null) return null;

  const host = el('div', 'bz-dock-board');
  // **不给标题**：这块就是「工具自己画的东西」，摆在最前、一眼就该看出来是什么 ——
  // 再写个「展示板」是面板在自说自话（iframe 的 `title` 属性留给读屏，那里需要一个名字）

  // 按**字节**算：字符串的 `length` 是 UTF-16 码元数，中文一个码元要占三字节 —— 拿码元当上限
  // 等于对中文内容把门槛放成三倍，而展示板恰恰最可能是中文写的
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > BOARD_MAX_BYTES) {
    host.appendChild(
      el(
        'div',
        'bz-dock-board-warn',
        `panel.html 有 ${Math.round(bytes / 1024)} KB，超过 ${BOARD_MAX_BYTES / 1024} KB 就不渲染了 —— 展示板是「一眼看完的几行数」`,
      ),
    );
    return host;
  }

  host.appendChild(
    sandboxFrame(html, 'bz-dock-board-frame', `${displayName(v)} 的展示板`, {
      maxHeight: BOARD_MAX_HEIGHT,
      allowPopups: true,
      // 展示板可以自己跑脚本（ADR-0249）：工具要画搜索框这类「读输入、改列表」的交互，
      // 光靠预设的 :checked 状态做不到。询问框不跟着开。
      allowScripts: true,
      // 声明里没写 actions 就不拦（省得把「点了没反应」造出来）
      onAct: v.manifest?.actions ? (ref) => void runBoardAction(v, ref) : undefined,
    }),
  );
  return host;
}

/**
 * 详情页的统计条 —— **当前脚本**的三格：成功率 / 最近一次 / 下次预计。
 * 复用全局 KPI 的瓦片样式，但不带点击过滤（口径只有这一个工具，没什么可筛的）。
 */
function toolStats(v: DockToolView): HTMLElement {
  const host = el('div', 'bz-dock-kpi bz-dock-toolstats');
  const tile = (num: string, unit: string, label: string, sub: string, tone?: 'warn' | 'bad'): HTMLElement => {
    const t = el('div', tone ? `bz-dock-kpi-tile is-${tone}` : 'bz-dock-kpi-tile');
    const v2 = el('div', 'bz-dock-kpi-v', num);
    if (unit) v2.appendChild(el('small', undefined, unit));
    t.appendChild(v2);
    t.appendChild(el('div', 'bz-dock-kpi-l', label));
    t.appendChild(el('div', 'bz-dock-kpi-d', sub));
    return t;
  };

  const rate = successRate(v.runs);
  host.appendChild(
    tile(
      rate === null ? '—' : String(Math.round(rate * 100)),
      rate === null ? '' : '%',
      '成功率',
      rate === null ? '还没有运行记录' : `共 ${v.runs.length} 条记录`,
      rate !== null && rate < 1 ? 'warn' : undefined,
    ),
  );

  const last = lastOf(v);
  host.appendChild(
    tile(
      last ? relTime(last.startedAt.replace('T', ' ')) : '—',
      '',
      '最近一次',
      last ? statusText(last.status) + (last.message ? ` · ${last.message}` : '') : '这个脚本还没跑过',
      last?.status === 'failed' ? 'bad' : undefined,
    ),
  );

  const next = nextDueOfView(v);
  if (next) {
    const left = untilText(next.at - Date.now());
    host.appendChild(tile(left.num, left.unit, '下次预计', next.sub, next.at < Date.now() ? 'warn' : undefined));
  } else {
    host.appendChild(tile('—', '', '下次预计', '没有基于时间的规则（事件触发不算钟点）'));
  }
  return host;
}

/**
 * 这条工具**下一次会自动跑**的钟点（`规则表 v2` 的读侧估算）：
 * 只算时间类规则（daily / interval）里**最早**的那个；事件类规则没有钟点，不算。
 * 记账读 `ruleFiredAt`（规则级），与调度器同一副账本 —— 它跑没跑过，这里不另猜。
 */
function nextDueOfView(v: DockToolView): { at: number; sub: string } | null {
  const now = Date.now();
  let best: { at: number; sub: string } | null = null;
  for (const r of v.rules) {
    if (r.enabled === false) continue;
    const last = v.ruleFiredAt[r.id];
    let at: number | undefined;
    if (r.trigger.kind === 'daily') {
      const t = todayAt(r.trigger, now);
      if (t === undefined) continue;
      at = now < t && (last ?? 0) < t ? t : t + 86400000;
    } else if (r.trigger.kind === 'interval' && r.trigger.everyMin > 0) {
      at = (last ?? now) + r.trigger.everyMin * 60000;
    }
    if (at === undefined) continue;
    if (!best || at < best.at) best = { at, sub: triggerText(r.trigger) };
  }
  return best;
}

function metaRow(label: string, value: string, mono = false, onCopy?: () => void): HTMLElement {
  const row = el('div', 'bz-dock-meta-row');
  row.appendChild(el('span', 'bz-dock-meta-label', label));
  const val = el('span', 'bz-dock-meta-val' + (mono ? ' is-mono' : ''), value);
  val.title = value;
  row.appendChild(val);
  if (onCopy) {
    row.appendChild(uiIconBtn({ icon: 'copy', title: '复制', xs: true, onClick: onCopy }));
  }
  return row;
}

// ---------- 运行台（左栏） ----------

function runPane(v: DockToolView): HTMLElement {
  const pane = el('section', 'bz-dock-pane bz-dock-runpane');
  pane.appendChild(el('h3', 'bz-dock-pane-title', '运行台'));

  if (!v.manifest) {
    // 读声明**不需要信任** —— 它就是读一个文件。所以这里给的是「修路径 / 重读」，不是「要授权」。
    // 移动端不给这个按钮：手机上重读一遍也还是那份同步过来的文件，读了不会有新结果。
    const box = el('div', 'bz-dock-noManifest');
    box.appendChild(el('div', 'bz-dock-note', v.declError ?? '声明文件读不到。'));
    if (canRun()) {
      box.appendChild(
        uiBtn({
          label: '重新读声明',
          icon: 'refresh-cw',
          onClick: () => void reloadDeclaration(v),
        }),
      );
    }
    pane.appendChild(box);
    pane.appendChild(liveHost(v.entry.id));
    return pane;
  }

  const params = v.manifest.params ?? [];
  if (params.length) {
    const form = el('div', 'bz-dock-form');
    const values = valuesOf(v);
    for (const p of params) form.appendChild(paramRow(p, values, v));
    pane.appendChild(form);
  } else {
    pane.appendChild(el('div', 'bz-dock-note', '这个工具没有参数。'));
  }

  if (!v.run) {
    pane.appendChild(
      el('div', 'bz-dock-meta-warn', '这份声明没写 run 段 —— 能看它的记录，但不知道该怎么跑。'),
    );
  }

  const btns = el('div', 'bz-dock-runbtns');
  if (canRun()) {
    const live = liveRunOf(v.entry.id);
    btns.appendChild(
      live
        ? uiBtn({ label: '停止', icon: 'square', tone: 'danger', onClick: () => stopRun(v.entry.id) })
        : uiBtn({
            label: '运行',
            icon: 'play',
            tone: 'primary',
            disabled: !canStart(v),
            onClick: () => void runFlow(v),
          }),
    );
    if (params.length) {
      btns.appendChild(
        uiBtn({ label: '重置参数', size: 'sm', onClick: () => resetValues(v) }),
      );
    }
  } else {
    btns.appendChild(el('span', 'bz-dock-mobilehint', '移动端不能启动进程，只能看'));
  }
  pane.appendChild(btns);
  // 离场运行（值守进程拉起、bz 不是父进程）：没有实时流，但工具自己每十来秒把「跑到第几步」
  // 写进记录，这里读出来画成人话（ADR-0250）。没有这种运行时整块隐藏。
  pane.appendChild(offlineHost(v));
  // 上一次现场运行的原始输出尾部（增强 #17）：跑完不清，下次运行覆盖；只在内存，不落盘
  if (!liveRunOf(v.entry.id)) {
    const lastTail = lastRawTailOf(v.entry.id);
    if (lastTail?.length) {
      const box = el('div', 'bz-dock-lastraw');
      box.appendChild(el('div', 'bz-dock-lastraw-head', '上次现场输出（尾部）'));
      const tail = el('pre', 'bz-dock-raw');
      tail.textContent = lastTail.slice(-12).join('\n');
      box.appendChild(tail);
      pane.appendChild(box);
    }
  }
  pane.appendChild(liveHost(v.entry.id));
  return pane;
}

function liveHost(id: string): HTMLElement {
  const host = el('div', 'bz-dock-live');
  host.dataset.tool = id;
  renderLiveInto(host, id);
  return host;
}

/** 已跑多久（人话）。只给「比预估慢」那一行用，口径与运行记录的 durationText 一致 */
function elapsedText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  return `${m} 分 ${s - m * 60} 秒`;
}

/**
 * 运行中的轻量拍。
 *
 * 为什么需要：`renderLiveInto` 平时只在工具吐出新步骤/进度时被调 —— 真卡住的工具**什么都不会吐**，
 * 于是「比预估慢」那条提醒永远没机会出现。这里每 5 秒把在跑的几格重画一次，只在有名册时启动。
 */
let liveTick: ReturnType<typeof setInterval> | null = null;

function ensureLiveTick(): void {
  if (liveTick !== null || !liveRunsAll().length) return;
  liveTick = setInterval(() => {
    const runs = liveRunsAll();
    if (!runs.length) {
      stopLiveTick();
      renderRunbar();
      return;
    }
    for (const r of runs) {
      overlay
        ?.querySelectorAll<HTMLElement>(`.bz-dock-live[data-tool="${r.toolId}"]`)
        .forEach((h) => renderLiveInto(h, r.toolId));
    }
    renderRunbar();
  }, 5_000);
}

function stopLiveTick(): void {
  if (liveTick !== null) {
    clearInterval(liveTick);
    liveTick = null;
  }
}

function renderLiveInto(host: HTMLElement, id: string): void {
  host.innerHTML = '';
  const run = liveRunOf(id);
  if (!run) {
    host.classList.add('is-off');
    return;
  }
  host.classList.remove('is-off');

  host.appendChild(el('div', 'bz-dock-live-head', '正在跑（bz 亲手启动的，所以有实时进度）'));
  const ptxt = run.progress.phase
    ? `${run.progress.phase}${run.progress.pct === null ? '' : ` ${Math.round(run.progress.pct)}%`}`
    : '进行中';
  host.appendChild(el('div', 'bz-dock-live-phase', ptxt));

  // 「比预估慢」：声明里写了 estimatedSec 才有判据（没写就不猜）。3 倍是个粗阈值 ——
  // 签到 20 秒的工具跑到 1 分钟就该提醒，而备份半小时的工具跑到 90 分钟才算异常。
  // 不自动中止：慢不等于死，掐不掐由人判断。
  const est = run.estimatedSec;
  if (est !== undefined && est > 0) {
    const elapsed = Date.now() - (timeOf(run.startedAt) ?? Date.now());
    if (elapsed > est * 1000 * 3) {
      host.appendChild(
        el(
          'div',
          'bz-dock-live-hint',
          `已跑 ${elapsedText(elapsed)}，超过声明预估的 ${est} 秒不少 —— 可能卡住了，必要时点停止`,
        ),
      );
    }
  }

  // pct 为 null = 该阶段不可估 —— 画的是不确定态条纹，不是假进度
  const bar = uiProgress({ value: run.progress.pct ?? 0 });
  if (run.progress.pct === null) bar.el.classList.add('is-indeterminate');
  host.appendChild(bar.el);

  const steps = el('ol', 'bz-dock-steps');
  for (const s of run.steps.slice(-8)) {
    const li = el('li', 'bz-dock-step');
    li.appendChild(el('span', 'bz-dock-step-dot'));
    li.appendChild(el('span', 'bz-dock-step-text', s.text));
    steps.appendChild(li);
  }
  host.appendChild(steps);
  if (run.rawTail.length) {
    const tail = el('pre', 'bz-dock-raw');
    tail.textContent = run.rawTail.slice(-12).join('\n');
    host.appendChild(tail);
  }
}

/**
 * 参数表单草稿。
 *
 * 初值 = 声明默认值叠加**工具目录里已存的值**（`view.values`，来自 `data.json`）；
 * 之后每次改动只落在草稿上，去抖后写回那个文件（`queueValueSave`）。
 * 草稿按工具 id 在会话内保留 —— 重渲（切视图、刷新）不该把用户正在填的东西冲掉。
 */
function valuesOf(v: DockToolView): Record<string, unknown> {
  const id = v.entry.id;
  if (!draftValues.has(id)) {
    draftValues.set(id, initialValuesOf(v.manifest?.params, v.values));
  }
  return draftValues.get(id)!;
}

/** 草稿落盘（去抖）。写失败只提示一次 —— 面板要照常能用，不能让一次落盘失败卡住填表 */
function queueValueSave(v: DockToolView): void {
  const id = v.entry.id;
  const prev = valueSaveTimers.get(id);
  if (prev) clearTimeout(prev);
  valueSaveTimers.set(
    id,
    setTimeout(() => {
      valueSaveTimers.delete(id);
      saveValuesNow(v);
    }, VALUE_SAVE_DEBOUNCE_MS),
  );
}

/** 立刻落盘（去抖未到就要启动运行、或关面板时用） */
function saveValuesNow(v: DockToolView): void {
  const id = v.entry.id;
  const t = valueSaveTimers.get(id);
  if (t) {
    clearTimeout(t);
    valueSaveTimers.delete(id);
  }
  const draft = draftValues.get(id);
  if (!draft) return;
  if (!saveToolValues(v.entry, draft)) {
    notice('参数没存住（写不进工具目录），检查那个目录是否能写', 'warning');
  }
}

/** 重置参数：清掉已存的值，回到声明默认（不是「清空表单」—— 声明给了默认就回默认） */
function resetValues(v: DockToolView): void {
  // cookie / 路径这类值手填很贵，误点一次就全没了 —— 先留一份草稿快照，重置后给 6 秒撤销窗口。
  // 不走「确认框」：这是可逆操作，事后反悔比事前打断更省事（core 的删除口径同理）。
  const prev = { ...valuesOf(v) };
  draftValues.set(v.entry.id, initialValuesOf(v.manifest?.params));
  saveValuesNow(v);
  render();
  notifyUndo(
    '已重置参数',
    () => {
      draftValues.set(v.entry.id, prev);
      saveValuesNow(v);
      render();
    },
    { type: 'info' },
  );
}

function paramRow(p: DockParam, values: Record<string, unknown>, v: DockToolView): HTMLElement {
  // 移动端只读：控件全禁用、不挂「选文件夹」按钮、改了也不落盘 ——
  // 能看见工具现在用的是哪个值，但改不了（改参数是桌面端的事）
  const ro = !canRun();
  const set = (val: unknown) => {
    if (ro) return;
    values[p.key] = val;
    queueValueSave(v);
  };
  let control: HTMLElement;
  switch (p.type) {
    case 'bool': {
      const sw = uiSwitch({ checked: values[p.key] === true, disabled: ro, onChange: (c) => set(c) });
      control = sw.el;
      break;
    }
    case 'choice': {
      const opts = (p.options ?? []).map((o) => ({ value: o.value, label: o.label }));
      if (!opts.length) opts.push({ value: '', label: '（无选项）' });
      // 初值：已填过 → 用已填；否则用清单 default（不在选项里就退回第一项）
      const seed = values[p.key] !== undefined ? String(values[p.key]) : String(p.default ?? opts[0].value);
      const picked = opts.some((o) => o.value === seed) ? seed : opts[0].value;
      set(picked);
      const sel = uiSelect<string>({
        options: opts,
        value: picked,
        placeholder: '请选择',
        onChange: (val) => set(val),
      });
      if (ro) {
        // uiSelect 没有 disabled 选项：摘掉可聚焦性 + 类名让点击穿过去（样式见 styles.css）
        sel.el.classList.add('is-readonly');
        sel.el.tabIndex = -1;
        sel.el.setAttribute('aria-disabled', 'true');
      }
      control = sel.el;
      break;
    }
    case 'multichoice': {
      const box = el('div', 'bz-dock-multichoice');
      const cur = new Set<string>(Array.isArray(values[p.key]) ? (values[p.key] as string[]) : []);
      for (const o of p.options ?? []) {
        box.appendChild(
          uiChip({
            label: o.label,
            selectedSoft: cur.has(o.value),
            disabled: ro,
            onClick: () => {
              if (cur.has(o.value)) cur.delete(o.value);
              else cur.add(o.value);
              set([...cur]);
              render();
            },
          }),
        );
      }
      control = box;
      break;
    }
    case 'number': {
      const inp = uiInput({
        type: 'number',
        value: values[p.key] === undefined ? '' : String(values[p.key]),
        placeholder: p.placeholder,
        disabled: ro,
        onInput: (val) => set(val === '' ? undefined : Number(val)),
      });
      if (p.min !== undefined) inp.min = String(p.min);
      if (p.max !== undefined) inp.max = String(p.max);
      if (p.step !== undefined) inp.step = String(p.step);
      control = inp;
      break;
    }
    case 'multiline': {
      const ta = el('textarea', 'bz-dock-textarea');
      ta.rows = p.rows ?? 4;
      ta.value = values[p.key] === undefined ? '' : String(values[p.key]);
      if (p.placeholder) ta.placeholder = p.placeholder;
      ta.disabled = ro;
      ta.addEventListener('input', () => set(ta.value));
      control = ta;
      break;
    }
    case 'path': {
      const row = el('div', 'bz-dock-pathrow');
      const inp = uiInput({
        value: values[p.key] === undefined ? '' : String(values[p.key]),
        placeholder: p.placeholder,
        disabled: ro,
        onInput: (val) => set(val),
      });
      row.appendChild(inp);
      if (!ro) {
        row.appendChild(
          uiIconBtn({
            icon: 'folder-open',
            title: p.mode === 'dir' ? '选择文件夹' : '选择文件',
            onClick: () => {
              void (async () => {
                if (p.mode === 'dir') {
                  const dir = await pickSystemFolder();
                  if (dir) {
                    inp.value = dir;
                    set(dir);
                  }
                } else {
                  const files = await pickSystemFiles(`选择${p.label}`, []);
                  if (files.length) {
                    inp.value = files[0];
                    set(files[0]);
                  }
                }
              })();
            },
          }),
        );
      }
      control = row;
      break;
    }
    case 'secret': {
      const inp = uiInput({
        type: 'password',
        value: values[p.key] === undefined ? '' : String(values[p.key]),
        placeholder: p.placeholder || '只存在本机工具目录',
        disabled: ro,
        onInput: (val) => set(val),
      });
      control = inp;
      break;
    }
    default: {
      const inp = uiInput({
        value: values[p.key] === undefined ? '' : String(values[p.key]),
        placeholder: p.placeholder,
        disabled: ro,
        onInput: (val) => set(val),
      });
      control = inp;
      break;
    }
  }
  const desc = p.help || (p.type === 'secret' ? '存在本机工具目录里，不进 vault、不写运行记录' : undefined);
  return uiField({ label: p.label + (p.required ? ' *' : ''), desc, control });
}

// ---------- 历史（右栏） ----------

function histPane(v: DockToolView): HTMLElement {
  const pane = el('section', 'bz-dock-pane bz-dock-histpane');
  const head = el('div', 'bz-dock-pane-head');
  head.appendChild(el('h3', 'bz-dock-pane-title', '运行记录'));
  head.appendChild(el('span', 'bz-dock-pane-count', `${v.runs.length} 条`));
  pane.appendChild(head);

  if (!v.runs.length) {
    pane.appendChild(
      uiEmpty({
        icon: 'history',
        title: v.runsUnreadable ? '记录读不懂' : '还没有运行记录',
        desc: v.runsUnreadable
          ? '文件在，但内容不合契约；工具坞只读不改'
          : '跑一次，或等它按声明的节奏自动跑完，记录就会出现',
      }),
    );
    return pane;
  }
  const list = el('div', 'bz-dock-histlist');
  // 文件顺序不是契约（schedule.ts 全部先按时间排再判）；「最近 60 条」得自己排，不能信落盘顺序
  const newestFirst = [...v.runs].sort(
    (a, b) => (timeOf(b.startedAt) ?? 0) - (timeOf(a.startedAt) ?? 0),
  );
  for (const r of newestFirst.slice(0, 60)) list.appendChild(histRow(r));
  pane.appendChild(list);
  if (v.runs.length > 60) pane.appendChild(el('div', 'bz-dock-note', '只显示最近 60 条'));
  return pane;
}

function histRow(r: DockRunRecord): HTMLElement {
  const row = el('article', 'bz-dock-histrow');
  const head = el('div', 'bz-dock-histhead');
  head.appendChild(el('span', dotClass(r.status)));
  head.appendChild(el('span', 'bz-dock-histtime', relTime(r.startedAt.replace('T', ' '))));
  head.appendChild(el('span', 'bz-dock-histstatus', statusText(r.status)));
  const dur = durationText(r);
  if (dur) head.appendChild(el('span', 'bz-dock-histdur', dur));
  head.appendChild(el('span', 'bz-dock-histtrig', r.trigger === 'auto' ? '自动' : '手动'));
  row.appendChild(head);
  if (r.message) row.appendChild(el('div', 'bz-dock-histmsg', r.message));

  if (r.error) {
    const box = el('div', 'bz-dock-histerr');
    box.appendChild(el('div', 'bz-dock-histerr-hint', errorHint(r.error.kind)));
    if (r.error.detail) box.appendChild(el('div', 'bz-dock-histerr-detail', r.error.detail));
    row.appendChild(box);
  }

  const hasMore =
    (r.steps && r.steps.length > 0) ||
    (r.info && r.info.length > 0) ||
    r.result !== undefined ||
    r.metrics !== undefined ||
    (r.artifacts && r.artifacts.length > 0) ||
    r.error?.stderr;
  if (hasMore) {
    const btn = uiBtn({
      label: '展开',
      size: 'sm',
      className: 'bz-dock-histtoggle',
      onClick: () => {
        const open = row.classList.toggle('is-open');
        btn.querySelector('span')!.textContent = open ? '收起' : '展开';
      },
    });
    row.appendChild(btn);

    const more = el('div', 'bz-dock-histmore');
    if (r.steps?.length) more.appendChild(block('步骤', r.steps.map((s) => s.text).join('\n')));
    if (r.metrics) more.appendChild(block('指标', JSON.stringify(r.metrics, null, 2)));
    if (r.artifacts?.length) {
      // 产物路径可点（增强 #16）：vault 里的用 Obsidian 打开，外面的在文件管理器定位
      const box = el('div', 'bz-dock-block');
      box.appendChild(el('div', 'bz-dock-block-label', '产物'));
      for (const a of r.artifacts) {
        const row = el('div', 'bz-dock-artrow');
        row.appendChild(el('span', 'bz-dock-artrow-path', `${a.label ? a.label + ' · ' : ''}${a.path}`));
        row.appendChild(
          uiIconBtn({ icon: 'external-link', title: '打开 / 定位产物', xs: true, onClick: () => openArtifact(a.path) }),
        );
        box.appendChild(row);
      }
      more.appendChild(box);
    }
    if (r.result !== undefined) more.appendChild(block('结果', JSON.stringify(r.result, null, 2)));
    if (r.info?.length) more.appendChild(block('信息', JSON.stringify(r.info, null, 2)));
    if (r.error?.stderr) more.appendChild(block('stderr 尾部', r.error.stderr));
    row.appendChild(more);
  }
  if (r.startedAt) {
    const exact = el('div', 'bz-dock-histexact', r.startedAt.replace('T', ' ').replace(/\..*$/, ''));
    row.appendChild(exact);
  }
  return row;
}

function block(label: string, text: string): HTMLElement {
  const b = el('div', 'bz-dock-block');
  b.appendChild(el('div', 'bz-dock-block-label', label));
  const pre = el('pre', 'bz-dock-json');
  pre.textContent = text;
  b.appendChild(pre);
  return b;
}

// ==================== 运行 ====================

/** 运行前置检查 → 启动 */
/**
 * 手动跑一次。
 *
 * `opts.extraArgs` 只给展示板动作用（ADR-0247）：那些参数不来自表单，是一次性的，
 * 拼在命令行末尾、**不落进 `data.json`** —— 所以这里不碰 `saveValuesNow` 那套。
 */
async function runFlow(v: DockToolView, opts: { extraArgs?: string[] } = {}): Promise<void> {
  if (!hostApp) return;
  if (!canRun()) {
    notice('移动端不能启动本机进程', 'warning');
    return;
  }
  if (!v.run) {
    notice('这份声明没写怎么跑：既无 run 段，目录里也没有 main.mjs', 'warning');
    return;
  }
  if (!isTrusted(v.entry) || v.trustStale) {
    // 未信任 / 声明把命令改了 → 先看清再确认。**确认之前一个字节都不会被执行**
    const ok = await applyTrust(v.entry, v.manifest!, v.declPath, v.run, {
      title: v.trustStale ? '启动命令变了，重新确认信任' : '信任此命令',
      accept: '信任',
    });
    if (!ok) return;
  }
  // 值先落盘再启动：工具坞发的参数与设置文件里那份必须一致，否则用户下次看到的和这次跑的不是一回事
  saveValuesNow(v);
  const values = valuesOf(v);
  // 与调度器同一条口径（missingRequiredParams）：手动这边放行、自动那边却报「必填参数没填」，
  // 同一个状态两处说法不一样，人就没法对账。`null` / 空数组（multichoice 全不选）都算缺。
  const missing = missingRequiredParams(v.manifest?.params, values);
  if (missing.length) {
    notice(`还差必填参数：${missing.join('、')}`, 'warning');
    return;
  }

  const run = runTool(hostApp, v.entry, v.run, v.manifest, values, {
    ...liveCallbacks(v.entry.id),
    onDone: (outcome) => {
      notifyRunOutcome(displayName(v), outcome, () => openDockTool(hostApp as App, v.entry.id));
      // 手动成功也给熔断记账（与调度器同一把笔 recordRunSuccess）；手动失败不动台账
      if (outcome.ok) void recordRunSuccess(v.entry.id, outcome.finishedAt);
      void refresh();
      updateLive(v.entry.id);
    },
  }, opts.extraArgs ? { extraArgs: opts.extraArgs } : {});
  void run;
  render();
}

/**
 * 展示板动作 → 一次运行（ADR-0247）。
 *
 * 只有两道门，都是**契约**上的事，没有一行业务判断：
 *  ① 声明里有这个 id —— 表外的 id 一律拒，不做「按链接拼参数」的透传；
 *  ② 参数按声明掐得过 —— 声明外的参数名、不合类型的值都拒（`appid` 只收数字）。
 *
 * **不做的事**（用户 2026-10-20 拍板）：不弹确认框、不问「真的要删吗」、不记谁点了什么。
 * 确认界面由展示板自己画（`checkbox + label`，一行 JS 都不用），误删怎么补由脚本自己负责。
 * bz 在这条链路上只是**通道 + 参数契约**；业务判断长在这里，就等于让面板替工具做决定。
 *
 * 过了两道门与手动运行**完全同一条路**（`runFlow`）：信任检查、参数必填校验、租约、记录、
 * 可停止，一样都不少。动作参数只多拼在命令行末尾，不落进 `data.json`。
 */
async function runBoardAction(v: DockToolView, ref: ParsedActRef): Promise<void> {
  const spec = v.manifest?.actions?.[ref.id];
  if (!spec) {
    notice(`展示板引用了一个没声明的动作：${ref.id}`, 'warning');
    return;
  }
  const checked = resolveActArgs(spec, ref.args);
  if (!checked.ok) {
    notice(`动作 ${ref.id} 没有执行：${checked.reason}`, 'warning');
    return;
  }
  await runFlow(v, { extraArgs: buildActArgs(spec, checked.values) });
}

/** 四行协议 → 现场视图刷新：runFlow 与直跑命令共用一份回调形状（onDone 各自不同） */
function liveCallbacks(id: string): Pick<DockRunCallbacks, 'onStep' | 'onProgress' | 'onInfo' | 'onResult' | 'onAsk'> {
  return {
    onStep: () => updateLive(id),
    onProgress: () => updateLive(id),
    onInfo: () => updateLive(id),
    onResult: () => updateLive(id),
    // 工具问人：刷新一次（运行台要显示「在等你拍板」），然后弹窗等答案
    onAsk: (req) => {
      updateLive(id);
      return confirmAsk(req);
    },
  };
}

/** 纯文本正文的框宽（够放一段说明） */
const ASK_MODAL_WIDTH = 460;
/** HTML 正文的框宽：工具常要摆一张「分类 → 游戏」的表，多这点宽度能明显少折行 */
const ASK_HTML_MODAL_WIDTH = 560;
/**
 * HTML 正文的字节上限（128 KB）。一个弹窗正文不该有展示板那么大 —— 那说明它把该写进手册的
 * 东西塞进来了；超了退回纯文本 `body` 并**明说**（静默退回最难查：工具以为版式生效了，
 * 人看到的是一坨源码标签）。
 */
const ASK_HTML_MAX_BYTES = 128 * 1024;

/**
 * 那一块正文：HTML 优先（沙箱 iframe），没给就逐段渲染纯文本。
 * `framed` 告诉调用方走的是哪条路 —— 框宽不一样（HTML 那份要宽一些）。
 *
 * **正文区是滚动容器，不是框自己滚**（2026-10-15 用户报「都不显示滚动条」）：框跟着内容长到
 * 内容那么高，长过弹窗上限时由这一层滚 —— 滚动条于是是宿主自己的（细、跟主题），按钮行还钉在
 * 下面。同 `memo` 的编辑弹窗（`.bz-memo-editor-popup`）那一套。
 */
export function askBody(req: BzAskRequest): { el: HTMLElement; framed: boolean } {
  const host = el('div', 'bz-dock-ask');
  // 正文区：`is-framed` 时才画描边与底色 —— 纯文本那一路本来就不该被框起来
  const pane = el('div', 'bz-dock-ask-pane');
  host.appendChild(pane);
  const html = String(req.bodyHtml ?? '').trim();
  if (html) {
    const bytes = new TextEncoder().encode(html).length;
    if (bytes <= ASK_HTML_MAX_BYTES) {
      pane.classList.add('is-framed');
      pane.appendChild(sandboxFrame(html, 'bz-dock-ask-frame', req.title));
      return { el: host, framed: true };
    }
    pane.appendChild(el('p', 'bz-dock-ask-p',
      `工具给的正文有 ${Math.round(bytes / 1024)} KB，超过 ${ASK_HTML_MAX_BYTES / 1024} KB 就不按 HTML 渲染了，退回纯文本。`));
  }
  const paras = String(req.body ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!paras.length) {
    pane.appendChild(el('p', 'bz-dock-ask-p', html ? '（HTML 正文超上限，工具也没给纯文本）' : '（工具没说要做什么）'));
  }
  for (const p of paras) pane.appendChild(el('p', 'bz-dock-ask-p', p));
  return { el: host, framed: false };
}

/**
 * 工具跑到一半请用户拍板（[bz-ask] 的那一屏）。
 *
 * 与信任框是两种东西，别混用：信任框核对的是「这东西会跑什么」，是**启动前**的一次性授权；
 * 这一框是**运行中**的一次具体动作要不要做（例：把分类写进 Steam，得先关 Steam），
 * 每次跑都要重新问——所以正文由工具给，bz 只管摆得清楚、并把答案原样回给它。
 *
 * 两个刻意的设计：
 *  - **工具写的东西永远不进面板 DOM**。纯文本正文按 \n 分成段落**当文本**渲染（`textContent`），
 *    不是 innerHTML —— 工具输出是外部进程的产物，当 HTML 插进来等于给每个工具发一张 XSS 通行证
 *    （bili-dl 那类会打印远端标题的工具尤其明显）。要摆表格、分组、自己的版式的，走 `bodyHtml`：
 *    装在**沙箱 iframe**（询问框这一路不给 `allow-scripts`，与展示板的允许脚本是两回事，ADR-0244/0249）里画，样式与标签都关在框内。
 *  - **超时 = 取消，不是确认**，并把倒计时摆在按钮旁。人不在电脑前时，悬着的一次运行
 *    会把队列堵到 bz 十分钟强杀；「没人应答就当同意」更是没有第二种解释的错。
 */
function confirmAsk(req: BzAskRequest): Promise<boolean> {
  // 同信任框：uiModal 不自带「新框顶替旧框」，同时只留一个；已有的那个还在等人，返回 false
  // 让这一个立刻收场（两个都等 = 两个都会超时，还让人分不清该点哪个）。
  if (document.querySelector('.bz-dock-askmodal')) return Promise.resolve(false);

  const { el: body, framed } = askBody(req);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let closeRef: () => void = () => undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    const stopClocks = (): void => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (tick !== null) { clearInterval(tick); tick = null; }
    };
    const settle = (v: boolean): void => {
      if (settled) return;
      settled = true;
      stopClocks();
      resolve(v);
      closeRef();
    };

    const left = el('span', 'bz-dock-ask-left', `${req.timeoutSec}`);
    const countdown = el('div', 'bz-dock-ask-clock');
    countdown.append('不操作就取消，还剩 ', left, ' 秒');

    const actions = uiDialogActions({
      cancelText: req.cancelText,
      okText: req.confirmText,
      onCancel: () => settle(false),
      onOk: () => settle(true),
    });
    actions.row.appendChild(countdown);
    body.appendChild(actions.row);

    const { close } = uiModal({
      head: true,
      title: req.title,
      content: body,
      maxWidth: framed ? ASK_HTML_MODAL_WIDTH : ASK_MODAL_WIDTH,
      className: 'bz-dock-askmodal',
      onClose: () => settle(false), // 遮罩 / ESC = 取消
    });
    closeRef = close;

    const deadline = Date.now() + req.timeoutSec * 1000;
    tick = setInterval(() => {
      const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      left.textContent = String(s);
    }, 1000);
    timer = setTimeout(() => settle(false), req.timeoutSec * 1000);

    // 焦点落在**取消**：这一框的默认动作是「不改任何东西」，回车不该替用户拍板。
    // （信任框那边落在主动作，是因为它核对完就是要放行；这里是另一件事。）
    actions.cancelBtn?.focus?.();
  });
}

/** 熔断恢复 + 立即补跑，一步到位：恢复是清台账，补跑走手动同一条路（全部门槛照过） */
async function resumeAndRetry(v: DockToolView): Promise<void> {
  await patchRunState(v.entry.id, null);
  kickDockScheduler();
  await refresh();
  const nv = viewById(v.entry.id);
  if (nv && canStart(nv)) await runFlow(nv);
}

function updateLive(id: string): void {
  const hosts = overlay?.querySelectorAll<HTMLElement>(`.bz-dock-live[data-tool="${id}"]`);
  hosts?.forEach((h) => renderLiveInto(h, id));
  renderRunbar(); // 顶层进度条与详情里的运行台是同一次运行的两个视角，一起动
  ensureLiveTick();
}

// ==================== 直达运行命令（bz-dock-run-<id>） ====================

/**
 * 命令直达运行：不开面板，直接把某个已登记工具跑起来（main.ts 为每个启用的工具注册一条
 * `bz-dock-run-<id>`，可挂快捷键）。
 *
 * 门槛与面板同一条口径（`judgeDirectRun`，与 runFlow 逐条对应）：声明有 `run`、未信任 /
 * 信任过期走既有信任确认（确认框展示将跑的命令，D7）、必填参数缺失 notify 后返回。
 * 参数值取工具目录 `data.json` 那份——这里没有表单草稿可冲，与调度器同源。
 *
 * 完成通知带「查看」动作，落到该工具的详情视图（面板没开就先开）；跑完只在面板开着时
 * refresh（关着的面板没有可刷的 DOM）。
 */
export async function runToolDirect(app: App, id: string): Promise<void> {
  if (!canRun()) {
    notice('移动端不能启动本机进程', 'warning');
    return;
  }
  hostApp = app; // 命令路径可能先于面板存在：把宿主记上，「查看」才开得了面板（openDock 同款赋值）
  const entry = readToolEntries().find((e) => e.id === id);
  if (!entry) {
    notice('这个工具已经不在登记表里（可能刚被移除）', 'warning');
    return;
  }
  // 视图现读，不吃面板的快照：信任态、声明、参数值都以盘上此刻为准（面板可能压根没开过）
  let v: DockToolView;
  try {
    v = await loadToolView(app, entry);
  } catch (e) {
    console.warn('[dock] 直达运行载入视图失败', e);
    notice('工具视图载入失败，详见控制台', 'error');
    return;
  }
  if (liveRunOf(id)) {
    // 已经在跑：面板里那颗运行钮这时是「停止」，命令这边不再叠跑一份（live 表会被顶掉）
    notice(`${displayName(v)} 已经在运行`, 'info');
    locateDetail(id);
    return;
  }
  const verdict = judgeDirectRun(v);
  if (!verdict.pass && 'needTrust' in verdict) {
    if (!v.manifest) {
      notice(v.declError ?? '声明读不到', 'error');
      return;
    }
    // 与 runFlow 同序：先信任后参数——确认框核对的是「会跑什么」，参数缺不缺是下一件事。
    // 信任建立后**不重跑整份判定**（applyTrust 写的是新登记项，手里这份旧视图的 entry 还是
    // 未信任的旧账），照 runFlow 接着只查必填参数——确认期间值不会变
    const ok = await applyTrust(v.entry, v.manifest, v.declPath, v.run, {
      title: v.trustStale ? '启动命令变了，重新确认信任' : '信任此命令',
      accept: '信任',
    });
    if (!ok) return;
    const msg = missingParamsMessage(v.manifest?.params, v.values);
    if (msg !== null) {
      notice(msg, 'warning');
      return;
    }
  } else if (!verdict.pass) {
    notice(verdict.message, 'warning');
    return;
  }
  if (!v.run) return; // 判定放行则必有 run，这里只做类型窄化
  const name = displayName(v);
  notice(`${name} 已开始运行`, 'info'); // 命令触发没有就地反馈（面板可能没开），起跑说一声
  runTool(app, v.entry, v.run, v.manifest, v.values, {
    ...liveCallbacks(id),
    onDone: (outcome) => {
      notifyRunOutcome(name, outcome, () => locateDetail(id));
      // 命令手动跑成功与面板手动同账（recordRunSuccess），两条手动路径不分叉
      if (outcome.ok) void recordRunSuccess(id, outcome.finishedAt);
      updateLive(id);
      if (isPanelVisible()) void refresh();
    },
  });
}

/** 「查看」的落点：开面板（没开就先开）并切到该工具的详情页 */
function locateDetail(id: string): void {
  if (!hostApp) return;
  openDock(hostApp); // 幂等：开着就顶置重渲，没开就地建（内含一次异步 refresh）
  view = { kind: 'detail', id };
  render();
}

// ==================== 声明 ====================

/**
 * 重新读声明文件。
 *
 * **不需要信任** —— 声明是文件，读它不执行任何东西。这正是 D4 修订要换来的顺序：先看清它会
 * 跑什么，再决定信不信任。原先靠 `<cmd> --manifest` 自描述，要读清单就得先执行那条命令，
 * 于是信任只能在「还不知道它会跑什么」的前提下做出。
 */
async function reloadDeclaration(v: DockToolView): Promise<void> {
  const res = readDeclaration(v.entry.path);
  if (!res.ok || !res.manifest) {
    notice(res.error ?? '声明读不到', 'error');
    return;
  }
  const m = res.manifest;
  if (m.id !== v.entry.id) {
    // 声明里 id 变了 → 登记的键对不上。bz 不自动改键（改了运行记录就失联），交给人定
    notice(
      `声明里的 id 是「${m.id}」，与登记的「${v.entry.id}」不一致 —— 当两个工具看，或移除后重新导入`,
      'warning',
    );
  }
  // 回落命中旧名时以实际路径为准（cwd 等缺省都从它算）；没写 run 段时带上约定入口的探测结果
  const run = resolveRun(m, res.path ?? v.entry.path, res.conventionalRun);
  const sig = run ? runSignature(run) : undefined;
  if (isTrusted(v.entry) && sig !== v.entry.trustedRun) {
    // 声明改了「怎么跑」→ 信任作废：信任的对象是那条命令，不是这个 id
    if (
      await applyTrust(v.entry, m, res.path ?? v.entry.path, run, {
        title: '启动命令变了，重新确认信任',
        accept: '信任',
      })
    ) {
      return;
    }
    notice('已保留原样 —— 但这条命令在你重新确认之前不会被运行', 'warning');
    return;
  }
  notice(`声明已重新读取：${m.params.length} 个参数`, 'success');
  await refresh();
}

/**
 * 节奏 → 人话（只认节奏对象本身；**声明那份与用户覆盖那份共用这一份口径**，免得两处措辞漂开）。
 *
 * `withNote: false` 给信任框用：`note` 是工具作者写给使用者的提示（「模拟器关着会自动拉起」…），
 * 详情页该显示，但在信任框那一行里会和后面的前提说明叠成两个连着的括号，像一句话念了两遍。
 */
function scheduleTextOf(s: DockSchedule | undefined, withNote = true): string {
  if (!s) return '未声明';
  const base: Record<string, string> = {
    daily: '每天一次',
    weekly: s.weekday !== undefined ? `每周${'日一二三四五六'[s.weekday]}` : '每周一次',
    interval: s.everyHours !== undefined ? `每 ${s.everyHours} 小时` : '按间隔',
    'on-demand': '按需（只手动）',
    unknown: '未声明',
  };
  const parts = [base[s.kind] ?? s.kind];
  if (s.kind === 'daily' && s.hour !== undefined) parts.push(`${String(s.hour).padStart(2, '0')}:00 前`);
  if (withNote && s.note) parts.push(`（${s.note}）`);
  return parts.join('');
}

/** 到期时刻 → 人话（当天说「今天 HH:MM」，跨天说「M-D HH:MM」） */
function dueTimeText(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}-${p(d.getDate())} ${hm}`;
}

/** 声明里「会跑什么」的人话摘要（信任确认框与详情页共用一份口径） */
function runTextOf(run: ResolvedRun | null): string {
  if (!run) return '没写怎么跑（既无 run 段，目录里也没有 main.mjs）';
  return [run.cmd, ...run.args].join(' ');
}

/**
 * 信任确认（spec D7：加一次，长期有效；不做每次执行前确认）。
 *
 * 这一框**不是「是/否」问句，是一张核对表** —— 用户在做的是核对「这东西会跑什么」。
 * 所以它不走 `openFlowDialog`：那个组件的 `message` 是一段散文（`\n` → `<br>`，整体居中、
 * 400px 窄卡、全篇一个字号），一句话能摆下，九行事实摆进去就成了一坨 —— 路径按词居中折行、
 * 「会跑什么」和「免责说明」一样重，等于没有重点（issue 543）。
 * 改域内自绘 `uiModal`，与规则编辑框同一套壳（`.bz-dock-rulemodal` 先例）。
 *
 * 层级按**决策要用到的顺序**排，不按字段顺序：
 *   ① 它是什么（名 + 一句描述）
 *   ② 会跑什么 —— 等宽代码块。信任的对象就是这条命令，所以它是这屏的重点，不是备注；
 *   ③ 配套事实（工作目录 / 声明文件 / 节奏 / 参数）：标签定宽、值左对齐，路径等宽且允许任意断行
 *      （路径没有空格，按词折行必然折出参差的居中块）；
 *   ④ 信任语义：最弱一档，一条分隔线隔开，不再和事实抢注意力。
 */
function confirmTrust(
  manifest: DockManifest,
  declPath: string,
  run: ResolvedRun | null,
  title: string,
  accept: string,
): Promise<boolean> {
  // 旧 openFlowDialog 自带「新框顶替旧框」，同时只会有一个；uiModal 不会，显式挡一道。
  // 返回 false = 没确认 → 导入中止，是安全的那一侧。
  if (document.querySelector('.bz-dock-trustmodal')) return Promise.resolve(false);

  const body = el('div', 'bz-dock-trust');

  // ① 它是什么
  const who = el('div', 'bz-dock-trust-who');
  who.appendChild(el('div', 'bz-dock-trust-name', manifest.name));
  if (manifest.description) who.appendChild(el('div', 'bz-dock-trust-desc', manifest.description));
  body.appendChild(who);

  // ② 会跑什么 —— 这屏的重点
  const runSec = el('div', 'bz-dock-trust-runsec');
  runSec.appendChild(el('div', 'bz-dock-trust-runlabel', '会跑什么'));
  const runText = runTextOf(run);
  const cmd = el('code', 'bz-dock-trust-cmd', runText);
  cmd.title = runText; // 命令很长被折行时，悬停仍能看全
  runSec.appendChild(cmd);
  body.appendChild(runSec);

  // ③ 配套事实：标签定宽一列对齐，值左对齐起 —— 扫读的是值，不是居中散开的碎句子。
  // 用 dl/dt/dd 而不是 div/span：读屏能把「声明文件」和它的值播报成一对键值。
  // （HTML5 允许 `<dl>` 的子项是包着 dt/dd 的 `<div>`，所以这里的分组不违规。）
  const facts = el('dl', 'bz-dock-trust-facts');
  const fact = (label: string, value: string, isPath = false): void => {
    const row = el('div', 'bz-dock-trust-fact');
    row.appendChild(el('dt', 'bz-dock-trust-factk', label));
    const v = el('dd', `bz-dock-trust-factv${isPath ? ' is-path' : ''}`, value);
    v.title = value;
    row.appendChild(v);
    facts.appendChild(row);
  };
  if (run?.cwd) fact('工作目录', run.cwd, true);
  fact('声明文件', declPath, true);
  // withNote=false：作者那句提示留给详情页，不在这里和下面的前提挤成两个括号
  fact('节奏', manifest.schedule ? scheduleTextOf(manifest.schedule, false) : '未声明（只手动跑）');
  fact('参数', `${manifest.params.length} 个`);
  body.appendChild(facts);

  // ④ 信任语义：弱化小字。三句都是前提，一句都不能省 ——
  // 这是安全框，省略就会变成「我到底在同意什么」（旧文案里「读声明不需要信任」那句要留着：
  // 它解释了为什么用户是在文件已经被读完之后才被问）
  body.appendChild(
    el(
      'div',
      'bz-dock-trust-note',
      '读声明不需要信任，建立之后工具坞才会运行它。' +
        '信任的对象是「那条命令」——建立一次长期有效，命令变了会重新问。' +
        '节奏取声明里的默认值（可在工具详情页改），bz 开着的时候才会按它跑。',
    ),
  );

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let closeRef: () => void = () => undefined;
    // 先 resolve 再 close：close 会触发 onClose（= 取消），先 resolve 才拿得到本次这个答案。
    // settled 守卫是防重构踩雷的 —— 现在靠的是 Promise 只认第一次 resolve，太隐晦。
    const settle = (v: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(v);
      closeRef();
    };
    // 焦点与旧流程框一致：落在主动作（回车 = 接受）。刻意不改这条语义 —— 只改排版，
    // 顺手把「回车确认」换成「回车取消」是另一个决定，不该夹带进来。
    const actions = uiDialogActions({
      cancelText: '取消',
      okText: accept,
      onCancel: () => settle(false),
      onOk: () => settle(true),
    });
    body.appendChild(actions.row);

    const { close } = uiModal({
      head: true,
      title,
      content: body,
      maxWidth: 520, // 比确认框的 400 宽：这一屏要摆两条完整路径
      className: 'bz-dock-trustmodal',
      onClose: () => resolve(false), // 遮罩 / ESC = 取消
    });
    closeRef = close;
    actions.okBtn.focus();
  });
}

// ==================== 登记（导入声明 / 重新导入 / 停用 / 移除） ====================

/**
 * 给**已登记**的工具建立 / 重建信任，并落盘。三处共用：重新读声明发现命令变了、运行前被拦下、
 * 详情页手动点「重新确认信任」。
 *
 * 落盘的是**当前这条命令的签名**（`trustedRun`）—— 下次声明再被人改，比对不上就又会被拦。
 * 返回是否已建立信任；用户取消返回 false（此时**一个字都不会被执行**）。
 */
async function applyTrust(
  entry: DockToolEntry,
  manifest: DockManifest,
  declPath: string,
  run: ResolvedRun | null,
  opts: { title: string; accept: string },
): Promise<boolean> {
  const ok = await confirmTrust(manifest, declPath, run, opts.title, opts.accept);
  if (!ok) return false;
  const next: DockToolEntry = { ...entry, trustedAt: new Date().toISOString() };
  if (run) next.trustedRun = runSignature(run);
  else delete next.trustedRun;
  await persist(readToolEntries().map((e) => (e.id === entry.id ? next : e)), `已信任 ${manifest.name}`);
  return true;
}

/**
 * 一个文件夹里找到多份声明时，让用户挑一份（**不猜**：选错工具比多一次点击贵得多）。
 *
 * 行上的主文案取声明里的 `name`；读不出来就退回相对路径 —— 一份坏声明不该挡住同目录里
 * 其它能导入的工具。取消（按钮 / 遮罩 / ESC）→ null，导入中止。
 */
function chooseDeclaration(root: string, paths: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const box = el('div', 'bz-dock-pick');
    let settled = false;
    let close = (): void => {};

    const finish = (p: string | null): void => {
      if (settled) return;
      settled = true;
      close();
      resolve(p);
    };

    for (const p of paths) {
      const res = readDeclaration(p);
      const rel = relPathOf(root, p);
      const row = el('button', 'bz-dock-pickrow');
      row.type = 'button';
      row.appendChild(el('span', 'bz-dock-pickname', res.manifest?.name || rel));
      row.appendChild(el('span', 'bz-dock-pickpath', rel));
      row.addEventListener('click', () => finish(p));
      box.appendChild(row);
    }

    const modal = uiModal({
      head: true,
      title: `找到 ${paths.length} 个工具，选一个`,
      content: box,
      maxWidth: 460,
      className: 'bz-dock-pickmodal',
      onClose: () => finish(null),
    });
    close = modal.close;
  });
}

/** 相对路径（只用于文案；不在同一棵树下就原样返回） */
function relPathOf(root: string, p: string): string {
  const a = root.replace(/[\\/]+$/, '');
  const b = p.replace(/[\\/]+$/, '');
  return b.startsWith(`${a}/`) ? b.slice(a.length + 1) : b;
}

/**
 * 导入一份工具声明 —— **唯一的登记入口，输入只有一个：工具文件夹在哪**。
 *
 * 用户想的是「导入这个工具」，手里有的是那个工具目录 —— 不该被要求知道声明文件叫什么、
 * 更不该在文件对话框里一层层导航到 `manifest.json` 本身。所以这里选**文件夹**，
 * 声明由 `findDeclarationFiles` 递归找（同目录新名优先）。找到多份时让用户挑，不猜。
 *
 * 标题 / 描述 / 图标 / 参数 / 节奏 / 启动命令全部读自那份声明，所以这里没有「填表单」。
 * 用户看到的是「它会跑什么」的核对，不是「请你告诉我它是什么」的问卷。
 *
 * 传 `entry` 表示重新导入某个已登记的工具（换目录，或文件内容变了想刷新）。
 */
async function importToolFlow(entry?: DockToolEntry): Promise<void> {
  if (!canRun()) {
    notice('导入声明需要桌面端（要读本机文件）', 'warning');
    return;
  }
  const dir = await pickSystemFolder();
  if (!dir) return;
  const found = findDeclarationFiles(dir);
  if (!found.length) {
    notice(`这个文件夹里没找到 ${DECLARATION_FILENAME}（或旧名 dock.json）`, 'warning');
    return;
  }
  const declPath = found.length === 1 ? found[0] : await chooseDeclaration(dir, found);
  if (!declPath) return;

  const res = readDeclaration(declPath);
  if (!res.ok || !res.manifest) {
    notice(res.error ?? '声明读不到', 'error');
    return;
  }
  const manifest = res.manifest;
  // 约定入口必须带上：导入是登记的主路，信任框与 trustedRun 都按「真实会跑的命令」算，
  // 漏了它，三行最薄声明（guide §2.3）登记完立即 trustStale，自动运行永远跑不起来
  const run = resolveRun(manifest, declPath, res.conventionalRun);

  const entries = readToolEntries();
  if (entries.some((e) => e.id === manifest.id && e.id !== entry?.id)) {
    notice(`id「${manifest.id}」已被另一个登记占用 —— 改声明里的 id，或先移除那个`, 'warning');
    return;
  }

  const next: DockToolEntry = { id: entry?.id ?? manifest.id, path: declPath };
  if (entry) {
    if (entry.enabled !== undefined) next.enabled = entry.enabled;
    // bz 侧的调度状态一并沿用：重新导入是「换文件 / 刷新」，不是「重置我的配置」
    if (entry.scheduleOverride !== undefined) next.scheduleOverride = entry.scheduleOverride;
    if (entry.overrideDeclSig !== undefined) next.overrideDeclSig = entry.overrideDeclSig;
    // 命令没变就沿用旧信任；变了则不带 trustedAt（下面重新问）
    const sig = run ? runSignature(run) : undefined;
    if (sig !== undefined && sig === entry.trustedRun) {
      next.trustedAt = entry.trustedAt;
      next.trustedRun = entry.trustedRun;
    }
  }

  if (!isTrusted(next)) {
    const ok = await confirmTrust(
      manifest,
      declPath,
      run,
      entry ? '重新导入声明' : '导入工具声明',
      entry ? '确认并信任' : '信任并登记',
    );
    if (!ok) return;
    next.trustedAt = new Date().toISOString();
    const sig = run ? runSignature(run) : undefined;
    if (sig !== undefined) next.trustedRun = sig;
  }

  // 信任状态在上面的 confirmTrust 分支里已写进 next（沿用旧的或本次新授），此处不再二次拼装
  const list = entry ? entries.map((e) => (e.id === entry.id ? next : e)) : [...entries, next];
  await persist(list, entry ? `已更新 ${manifest.name}` : `已登记 ${manifest.name}`);
}

/** 登记项显示名（优先取视图里的声明名；视图还没有时退回 id） */
function nameOfEntry(id: string): string {
  const v = viewById(id);
  return v ? displayName(v) : id;
}

async function persist(list: DockToolEntry[], msg: string): Promise<void> {
  // 结构性改动之前先把在填的参数落住 —— 否则改个停用就顺手把刚才填的东西丢了
  for (const v of views) saveValuesNow(v);
  try {
    await saveToolEntries(list);
    notice(msg, 'success');
  } catch (e) {
    notice(`保存失败：${(e as Error)?.message ?? e}`, 'error');
    return;
  }
  // 登记变了 → 视图重建，草稿按新声明重新播种（旧草稿可能对应已经删掉的参数）
  draftValues.clear();
  await refresh();
}

async function toggleEnabled(entry: DockToolEntry): Promise<void> {
  const entries = readToolEntries();
  const next = { ...entry, enabled: entry.enabled === false };
  const name = nameOfEntry(entry.id);
  await persist(
    entries.map((e) => (e.id === entry.id ? next : e)),
    next.enabled ? `已启用 ${name}` : `已停用 ${name}`,
  );
}

async function removeToolFlow(v: DockToolView): Promise<void> {
  const res = await openFlowDialog({
    title: '移除登记',
    message:
      `确定把「${displayName(v)}」从工具坞移除？\n\n` +
      '只移除 bz 这边的登记 —— 声明文件、参数值文件、运行记录文件都不会被删' +
      '（前两个是工具目录里的，后一个是工具的账本）。调度台账（失败计数 / 熔断标记）一并清掉。',
    actions: [
      { label: '取消', value: 'cancel' },
      { label: '移除', value: 'ok', cta: true, danger: true },
    ],
  });
  if (res !== 'ok') return;
  const entries = readToolEntries().filter((e) => e.id !== v.entry.id);
  if (view.kind === 'detail' && view.id === v.entry.id) view = { kind: 'list' };
  // 台账一并清（增强 #19）：失败计数 / 熔断标记不留孤儿（重导同 id 会从头记，正该如此）
  await patchRunState(v.entry.id, null);
  await persist(entries, `已移除 ${displayName(v)}`);
}
