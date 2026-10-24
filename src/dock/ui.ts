/**
 * 工具坞面板 —— 一个 overlay、两个视图（列表 / 详情），没有别的状态。
 *
 * 这一版刻意不做「抽屉 + 弹窗 + 内嵌页」三件套：上一版 3600 行里有一半是在维护那些
 * 互相叠着的容器。这里是**替换内容**，不是层层叠加 —— 返回列表就真的把详情拆掉。
 *
 * 面板只做三件事：**看清楚**（状态、最近几次、为什么没跑）、**改得动**（参数、规则、开关）、
 * **跑得掉**（手动运行 / 停止 / 授权）。它不做判断 —— 能不能跑问 `judgeRunGate`，
 * 该不该跑问 `kernel.planTick`，面板不自己发明规则。
 */

import { Notice, Platform, setIcon, type App } from 'obsidian';
import { notify } from '../core/notice';
import { loadToolView, loadToolViews, displayNameOf, panelOf, recentRunsOf } from './view';
import { readRegistry, readTrust, removeTool, trustTool, untrustTool, upsertTool } from './registry';
import { currentFs, writeIntent, writeSettings } from './files';
import { parseManifest } from './parse';
import { actionText, defaultRule, isEventTrigger, nextDueOf, ruleName, triggerText } from './rules';
import { missingParams } from './kernel';
import { judgeRunGate, runToolDirect } from './command';
import { liveAll, liveOf, onLiveChanged, stopLive } from './exec';
import { clearBreakerSafely, kickDockScheduler, notifyDockEvent, runToolManually } from './host';
import {
  TRIGGER_KINDS,
  TRIGGER_LABEL,
  type DockParam,
  type DockRule,
  type DockRunRecord,
  type DockToolView,
  type DockTrigger,
  type DockTriggerKind,
} from './types';

// ==================== 容器 ====================

let root: HTMLElement | null = null;
let bodyEl: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let app: App | null = null;
let view: 'list' | 'detail' = 'list';
let detailId = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** 详情页上次渲染时的签名（轮询据此决定要不要重绘） */
let detailKey = '';
let liveOff: (() => void) | null = null;

export function ensureDock(a: App): void {
  app = a;
  if (root) return;
  root = document.body.createDiv({ cls: 'bz-dock-overlay' });
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '工具坞');

  const sheet = root.createDiv({ cls: 'bz-dock-sheet' });
  const head = sheet.createDiv({ cls: 'bz-dock-head' });
  titleEl = head.createSpan({ cls: 'bz-dock-title', text: '工具坞' });
  const tools = head.createDiv({ cls: 'bz-dock-head-tools' });
  iconBtn(tools, 'folder-input', '导入工具', () => pickFolder());
  iconBtn(tools, 'refresh-cw', '刷新', () => render());
  iconBtn(tools, 'x', '关闭', () => closeDock());

  bodyEl = sheet.createDiv({ cls: 'bz-dock-body' });
  root.addEventListener('click', (e) => {
    if (e.target === root) closeDock();
  });
  document.addEventListener('keydown', onKey);
  liveOff = onLiveChanged(() => {
    if (view === 'detail') renderDetail();
    else renderListMeta();
  });
}

function onKey(e: KeyboardEvent): void {
  if (!root || root.hasClass('is-hidden')) return;
  if (e.key === 'Escape') {
    if (view === 'detail') showList();
    else closeDock();
  }
}

export function openDock(a: App): void {
  ensureDock(a);
  if (!root) return;
  root.removeClass('is-hidden');
  showList();
  notifyDockEvent({ kind: 'panel-open' });
  startPoll();
}

export function closeDock(): void {
  if (!root) return;
  root.addClass('is-hidden');
  stopPoll();
}

export function unloadDock(): void {
  stopPoll();
  document.removeEventListener('keydown', onKey);
  liveOff?.();
  liveOff = null;
  root?.remove();
  root = null;
  bodyEl = null;
  titleEl = null;
  app = null;
  view = 'list';
  detailId = '';
}

/** 打开某个工具的详情（调度器通知「查看」跳这里） */
export function openToolPanel(a: App, id: string): void {
  openDock(a);
  showDetail(id);
}

function startPoll(): void {
  stopPoll();
  pollTimer = setInterval(() => {
    if (!root || root.hasClass('is-hidden')) return;
    if (view === 'detail') {
      // 只在账本真的变了才重绘。整块重绘会重建展示板的 iframe ——
      // 那块 `srcdoc` 里的东西会被从头加载一遍，用户正在里面点的东西每次清零。
      const v = viewOf(detailId);
      if (!v || detailSignature(v) !== detailKey) renderDetail();
    } else {
      renderListMeta();
    }
  }, 3000);
}

/**
 * 详情页的「有没有变化」签名。
 *
 * 只放**会改变渲染结果**的那几个字段：最近一次运行的工单号、上次尝试时刻、熔断状态、授权状态。
 * 不放运行记录全文（每 3 秒读一遍全量记录，正是上一版面板卡顿的来源）。
 */
function detailSignature(v: DockToolView): string {
  return [
    v.id,
    v.path,
    v.trusted ? '1' : '0',
    v.trustStale ? '1' : '0',
    v.runtime.run?.lastAttemptAt ?? '',
    v.runtime.run?.pausedAt ?? '',
    v.lastRun?.runId ?? '',
    v.lastRun?.status ?? '',
    String(v.rules.length),
  ].join('|');
}

function stopPoll(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ==================== 数据 ====================

function views(): DockToolView[] {
  const { registry } = readRegistry();
  return loadToolViews(registry.tools, {
    trust: readTrust(),
    canRun: !Platform.isMobile,
    fs: currentFs(),
  });
}

function viewOf(id: string): DockToolView | undefined {
  const { registry } = readRegistry();
  const entry = registry.tools.find((t) => t.id === id);
  if (!entry) return undefined;
  return loadToolView(entry, { trust: readTrust(), canRun: !Platform.isMobile, fs: currentFs() });
}

// ==================== 列表 ====================

function showList(): void {
  view = 'list';
  detailId = '';
  if (titleEl) titleEl.setText('工具坞');
  render();
}

function render(): void {
  if (!bodyEl) return;
  bodyEl.empty();
  if (view === 'detail') {
    renderDetail();
    return;
  }
  const all = views();
  renderSummary(all);

  if (!all.length) {
    const empty = bodyEl.createDiv({ cls: 'bz-dock-empty' });
    empty.createDiv({ cls: 'bz-dock-empty-title', text: '还没有登记任何工具' });
    empty.createDiv({
      cls: 'bz-dock-empty-desc',
      text: '选一个含 manifest.json 的文件夹。bz 只读它、不执行 —— 看清它要跑什么，再决定授不授权。',
    });
    const btn = btnOf(empty, '导入工具文件夹', 'mod-cta');
    btn.addEventListener('click', () => pickFolder());
    return;
  }

  const auto = all.filter((v) => v.rules.some((r) => r.enabled !== false));
  const manual = all.filter((v) => !v.rules.some((r) => r.enabled !== false));
  if (auto.length) section('自动运行', auto);
  if (manual.length) section('手动', manual);
}

function renderListMeta(): void {
  // 只更新卡片上的状态点与「在跑」标记，避免整块重绘打断点击
  if (!bodyEl) return;
  for (const card of Array.from(bodyEl.querySelectorAll<HTMLElement>('.bz-dock-card'))) {
    const id = card.dataset.toolId ?? '';
    const live = liveOf(id);
    card.toggleClass('is-running', !!live);
    const dot = card.querySelector<HTMLElement>('.bz-dock-dot');
    if (dot) {
      dot.dataset.state = live ? 'running' : lastStateOf(id);
    }
  }
}

function renderSummary(all: DockToolView[]): void {
  if (!bodyEl) return;
  const row = bodyEl.createDiv({ cls: 'bz-dock-summary' });
  const running = liveAll().length;
  const today = all.filter((v) => v.lastRun && isToday(v.lastRun.startedAt)).length;
  const failed = all.filter((v) => v.lastRun?.status === 'failed' || v.lastRun?.status === 'timeout').length;
  cell(row, '正在跑', running ? String(running) : '—');
  cell(row, '今天跑过', String(today));
  cell(row, '最近失败', failed ? String(failed) : '—');
  cell(row, '工具', String(all.length));
}

function cell(parent: HTMLElement, label: string, value: string): void {
  const c = parent.createDiv({ cls: 'bz-dock-kpi' });
  c.createDiv({ cls: 'bz-dock-kpi-value', text: value });
  c.createDiv({ cls: 'bz-dock-kpi-label', text: label });
}

function section(name: string, list: DockToolView[]): void {
  if (!bodyEl) return;
  bodyEl.createDiv({ cls: 'bz-dock-section', text: name });
  const grid = bodyEl.createDiv({ cls: 'bz-dock-grid' });
  for (const v of list) card(grid, v);
}

function card(grid: HTMLElement, v: DockToolView): void {
  const el = grid.createDiv({ cls: 'bz-dock-card' });
  el.dataset.toolId = v.id;
  el.tabIndex = 0;
  if (liveOf(v.id)) el.addClass('is-running');

  const top = el.createDiv({ cls: 'bz-dock-card-top' });
  const icon = top.createDiv({ cls: 'bz-dock-card-icon' });
  setIcon(icon, v.manifest?.icon || 'box');

  const name = top.createDiv({ cls: 'bz-dock-card-name' });
  name.setText(displayNameOf(v));
  const dot = name.createSpan({ cls: 'bz-dock-dot' });
  dot.dataset.state = liveOf(v.id) ? 'running' : lastStateOf(v.id);

  el.createDiv({
    cls: 'bz-dock-card-desc',
    text: v.error ?? v.manifest?.description ?? '（这份声明里没有描述）',
  });

  const meta = el.createDiv({ cls: 'bz-dock-card-meta' });
  const trigger = v.rules.find((r) => r.enabled !== false);
  meta.createSpan({
    cls: 'bz-dock-tag',
    text: trigger ? triggerText(trigger.trigger, (id) => id) : '手动',
  });
  if (!v.trusted) meta.createSpan({ cls: 'bz-dock-tag is-warn', text: '待授权' });

  const strip = el.createDiv({ cls: 'bz-dock-strip' });
  const runs = recentRunsOf(v.path, v.id, 7);
  for (let i = 6; i >= 0; i--) {
    const r = runs[6 - i];
    const tick = strip.createDiv({ cls: 'bz-dock-tick' });
    if (r) tick.dataset.state = r.status;
  }

  const open = (): void => showDetail(v.id);
  el.addEventListener('click', open);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
}

function lastStateOf(id: string): string {
  const v = viewOf(id);
  return v?.lastRun?.status ?? 'never';
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// ==================== 详情 ====================

function showDetail(id: string): void {
  view = 'detail';
  detailId = id;
  const v = viewOf(id);
  if (titleEl) titleEl.setText(v ? displayNameOf(v) : '工具');
  renderDetail();
}

function renderDetail(): void {
  if (!bodyEl) return;
  const v = viewOf(detailId);
  detailKey = v ? detailSignature(v) : '';
  bodyEl.empty();
  if (!v) {
    bodyEl.createDiv({ cls: 'bz-dock-empty-desc', text: '这个工具已经不在登记表里了' });
    backBtn();
    return;
  }

  const bar = bodyEl.createDiv({ cls: 'bz-dock-detail-bar' });
  const back = bar.createDiv({ cls: 'bz-dock-back' });
  setIcon(back, 'arrow-left');
  back.createSpan({ text: '返回' });
  back.addEventListener('click', () => showList());

  const acts = bar.createDiv({ cls: 'bz-dock-actions' });
  const gate = judgeRunGate(v, !Platform.isMobile);
  const live = liveOf(v.id);
  if (live) {
    const stop = btnOf(acts, '停止');
    stop.addEventListener('click', () => stopLive(v.id));
  } else {
    const run = btnOf(acts, '运行', 'mod-cta');
    run.disabled = !gate.ok;
    if (!gate.ok) run.setAttribute('title', gate.text ?? '');
    run.addEventListener('click', () => void doRun(v));
  }

  if (!v.trusted) {
    const trust = btnOf(acts, v.trustStale ? '重新授权' : '授权这条命令');
    trust.addEventListener('click', () => void doTrust(v));
  } else {
    const untrust = btnOf(acts, '撤销授权');
    untrust.addEventListener('click', () => void doUntrust(v));
  }

  renderProblem(v);
  renderPanelBoard(v);
  renderParams(v);
  renderRules(v);
  renderLive(v);
  renderHistory(v);
  renderFooter(v);
}

function backBtn(): void {
  if (!bodyEl) return;
  const b = bodyEl.createDiv({ cls: 'bz-dock-back' });
  setIcon(b, 'arrow-left');
  b.createSpan({ text: '返回' });
  b.addEventListener('click', () => showList());
}

/** 声明有问题 / 未授权 / 缺参数 / 在跑 —— 都在这儿说清楚，别等人去猜 */
function renderProblem(v: DockToolView): void {
  if (!bodyEl) return;
  const problems: string[] = [];
  if (v.error) problems.push(v.error);
  if (!v.entry) problems.push('声明里没有 entry，跑不起来（只能看）');
  if (!v.trusted) problems.push(v.trustStale ? '声明里的启动命令改过了，需要重新授权' : '这条命令还没授权，跑不了');
  const missing = missingParams(v);
  if (missing.length) problems.push(`必填参数还没填：${missing.join('、')}`);
  if (v.runtime.run?.pausedAt) problems.push('连续失败太多次，自动运行已经暂停（下面可以恢复）');
  if (!problems.length) return;
  const box = bodyEl.createDiv({ cls: 'bz-dock-problem' });
  for (const p of problems) box.createDiv({ cls: 'bz-dock-problem-line', text: p });
  if (v.runtime.run?.pausedAt) {
    const btn = btnOf(box, '恢复自动运行');
    btn.addEventListener('click', () => {
      void clearBreakerSafely(v).then((ok) => {
        if (!ok) {
          new Notice('有工具正在跑，等它跑完再恢复');
          return;
        }
        renderDetail();
      });
    });
  }
}

/**
 * 展示板 iframe **文档内部**的滚动条样式 —— 全仓唯一允许的 `<style>` 注入（ADR-0243 补记）。
 *
 * 为什么改不了 CSS 文件：`style` 属性写不了伪元素，core 的界面级规则（ADR-0122）又跨不过
 * 文档边界。所以只放滚动条声明，选择器只落在 html / ::-webkit-scrollbar 上 —— 想顺手改框里
 * 别的样式，守卫会红。
 */
export const FRAME_SCROLLBAR_CSS =
  '<style>html{scrollbar-width:none;-ms-overflow-style:none}' +
  'html::-webkit-scrollbar{display:none;width:0;height:0}</style>';

function renderPanelBoard(v: DockToolView): void {
  if (!bodyEl) return;
  const html = panelOf(v.path, currentFs());
  if (!html) return;
  const box = bodyEl.createDiv({ cls: 'bz-dock-board' });
  const frame = box.createEl('iframe', { cls: 'bz-dock-frame' });
  frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.srcdoc = html.toLowerCase().includes('<head>')
    ? html.replace(/<head([^>]*)>/i, `<head$1>${FRAME_SCROLLBAR_CSS}`)
    : `<!DOCTYPE html><html><head>${FRAME_SCROLLBAR_CSS}</head><body>${html}</body></html>`;
}

function renderParams(v: DockToolView): void {
  if (!bodyEl || !v.params.length) return;
  block('参数');
  const form = bodyEl.createDiv({ cls: 'bz-dock-form' });
  const values: Record<string, unknown> = { ...v.values };

  for (const p of v.params) {
    const row = form.createDiv({ cls: 'bz-dock-field' });
    row.createDiv({ cls: 'bz-dock-label', text: (p.label ?? p.key) + (p.required ? ' *' : '') });
    const input = fieldOf(row, p, values[p.key] ?? p.default);
    const commit = (): void => {
      values[p.key] = readField(p, input);
      writeSettings(v.path, v.id, values);
    };
    input.addEventListener('change', commit);
    if (p.type === 'text' || p.type === 'number' || p.type === 'multiline') input.addEventListener('blur', commit);
    if (p.hint) row.createDiv({ cls: 'bz-dock-hint', text: p.hint });
    if (p.type === 'secret') row.createDiv({ cls: 'bz-dock-hint', text: '凭据不进 vault、不写运行记录，只在本机工具目录里' });
  }
}

function fieldOf(row: HTMLElement, p: DockParam, value: unknown): HTMLElement {
  if (p.type === 'bool') {
    const input = row.createEl('input', { type: 'checkbox' });
    input.checked = value === true;
    return input;
  }
  if (p.type === 'choice' || p.type === 'multichoice') {
    const sel = row.createEl('select', { cls: p.type === 'multichoice' ? 'is-multi' : '' });
    if (p.type === 'multichoice') sel.multiple = true;
    const opts = p.options ?? [];
    const picked = p.type === 'multichoice' ? (Array.isArray(value) ? value.map(String) : []) : [String(value ?? '')];
    for (const o of opts) {
      const opt = sel.createEl('option', { text: o, value: o });
      if (picked.includes(o)) opt.selected = true;
    }
    return sel;
  }
  if (p.type === 'multiline') {
    const input = row.createEl('textarea', { cls: 'bz-dock-textarea' });
    input.value = value === undefined ? '' : String(value);
    return input;
  }
  const input = row.createEl('input', {
    type: p.type === 'secret' ? 'password' : p.type === 'number' ? 'number' : 'text',
    cls: 'bz-dock-input',
  });
  input.value = value === undefined ? '' : String(value);
  return input;
}

function readField(p: DockParam, input: HTMLElement): unknown {
  if (p.type === 'bool') return (input as HTMLInputElement).checked;
  if (p.type === 'multichoice') {
    return Array.from((input as HTMLSelectElement).selectedOptions).map((o) => o.value);
  }
  if (p.type === 'number') {
    const n = Number((input as HTMLInputElement).value);
    return Number.isFinite(n) ? n : undefined;
  }
  return (input as HTMLInputElement).value;
}

function renderRules(v: DockToolView): void {
  if (!bodyEl) return;
  block('规则');
  const list = bodyEl.createDiv({ cls: 'bz-dock-rules' });
  if (!v.rules.length) {
    list.createDiv({ cls: 'bz-dock-hint', text: '没有规则 —— 只能手动点运行' });
  }
  v.rules.forEach((rule, i) => ruleRow(list, v, rule, i));
  const add = btnOf(list, '加一条规则');
  add.addEventListener('click', () => {
    const next = v.rules.concat(defaultRule());
    saveRules(v, next);
    renderDetail();
  });
}

function ruleRow(parent: HTMLElement, v: DockToolView, rule: DockRule, index: number): void {
  const row = parent.createDiv({ cls: 'bz-dock-rule' });
  const head = row.createDiv({ cls: 'bz-dock-rule-head' });

  const toggle = head.createEl('input', { type: 'checkbox' });
  toggle.checked = rule.enabled !== false;
  toggle.addEventListener('change', () => {
    const next = v.rules.slice();
    next[index] = { ...rule, enabled: toggle.checked };
    saveRules(v, next);
  });

  head.createSpan({ cls: 'bz-dock-rule-name', text: ruleName(rule, index) });
  head.createSpan({ cls: 'bz-dock-rule-text', text: `${triggerText(rule.trigger, (id) => id)} · ${actionText(rule.action)}` });

  const del = head.createSpan({ cls: 'bz-dock-rule-del' });
  setIcon(del, 'trash-2');
  del.addEventListener('click', () => {
    saveRules(v, v.rules.filter((r) => r.id !== rule.id));
    renderDetail();
  });

  const edit = row.createDiv({ cls: 'bz-dock-rule-edit' });
  const trig = edit.createEl('select');
  for (const kind of TRIGGER_KINDS) {
    const o = trig.createEl('option', { text: TRIGGER_LABEL[kind], value: kind });
    if (rule.trigger.kind === kind) o.selected = true;
  }
  trig.addEventListener('change', () => {
    const next = v.rules.slice();
    next[index] = { ...rule, trigger: blankTrigger(trig.value as DockTriggerKind) };
    saveRules(v, next);
    renderDetail();
  });

  const arg = triggerArgInput(rule.trigger);
  if (arg) {
    edit.appendChild(arg.el);
    arg.el.addEventListener('change', () => {
      const next = v.rules.slice();
      const t = patchTrigger(rule.trigger, arg.el.value);
      if (!t) return;
      next[index] = { ...rule, trigger: t };
      saveRules(v, next);
    });
  }

  const jitter = edit.createEl('input', { type: 'number', cls: 'bz-dock-jitter' });
  jitter.min = '0';
  jitter.max = '720';
  jitter.value = String(rule.jitterMin ?? 0);
  jitter.setAttribute('title', '错峰：到点后再随机等这么多分钟');
  jitter.addEventListener('change', () => {
    const next = v.rules.slice();
    const n = Number(jitter.value);
    next[index] = { ...rule, jitterMin: Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined };
    saveRules(v, next);
  });

  const act = edit.createEl('select');
  for (const k of ['run', 'remind'] as const) {
    const o = act.createEl('option', { text: k === 'run' ? '运行' : '只提醒', value: k });
    if (rule.action.kind === k) o.selected = true;
  }
  act.addEventListener('change', () => {
    const next = v.rules.slice();
    next[index] = { ...rule, action: { kind: act.value === 'remind' ? 'remind' : 'run' } };
    saveRules(v, next);
  });

  const due = nextDueOf(rule, { now: Date.now() });
  if (due && !isEventTrigger(rule.trigger.kind)) {
    edit.createSpan({ cls: 'bz-dock-hint', text: `下次 ${new Date(due).toLocaleString()}` });
  }
}

function blankTrigger(kind: DockTriggerKind): DockTrigger {
  switch (kind) {
    case 'daily':
      return { kind: 'daily', at: '09:00' };
    case 'interval':
      return { kind: 'interval', everyMin: 60 };
    case 'on-launch':
      return { kind: 'on-launch', delayMin: 5 };
    case 'tool-ok':
      return { kind: 'tool-ok', toolId: '' };
    case 'tool-fail':
      return { kind: 'tool-fail', toolId: '' };
    case 'domain-event':
      return { kind: 'domain-event', channel: '' };
    case 'file-change':
      return { kind: 'file-change', target: '' };
    case 'value-threshold':
      return { kind: 'value-threshold', path: '', key: '', op: '>', value: 0 };
    default:
      return { kind: 'panel-open' };
  }
}

function triggerArgInput(t: DockTrigger): { el: HTMLInputElement } | null {
  if (t.kind === 'daily') {
    const el = document.createElement('input');
    el.type = 'time';
    el.className = 'bz-dock-trigger-arg';
    el.value = t.at;
    return { el };
  }
  if (t.kind === 'interval') {
    const el = document.createElement('input');
    el.type = 'number';
    el.className = 'bz-dock-trigger-arg';
    el.min = '1';
    el.value = String(t.everyMin);
    el.setAttribute('title', '每隔多少分钟');
    return { el };
  }
  if (t.kind === 'on-launch') {
    const el = document.createElement('input');
    el.type = 'number';
    el.className = 'bz-dock-trigger-arg';
    el.min = '0';
    el.value = String(t.delayMin);
    el.setAttribute('title', '启动后多少分钟');
    return { el };
  }
  if (t.kind === 'tool-ok' || t.kind === 'tool-fail') {
    const el = document.createElement('input');
    el.className = 'bz-dock-trigger-arg';
    el.value = t.toolId;
    el.setAttribute('title', '工具 id');
    return { el };
  }
  if (t.kind === 'file-change') {
    const el = document.createElement('input');
    el.className = 'bz-dock-trigger-arg';
    el.value = t.target;
    el.setAttribute('title', 'vault 里的目录');
    return { el };
  }
  return null;
}

function patchTrigger(t: DockTrigger, value: string): DockTrigger | null {
  if (t.kind === 'daily') {
    if (!/^\d{1,2}:\d{2}$/.test(value)) return null;
    return { kind: 'daily', at: value };
  }
  if (t.kind === 'interval') {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 ? { kind: 'interval', everyMin: Math.floor(n) } : null;
  }
  if (t.kind === 'on-launch') {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? { kind: 'on-launch', delayMin: Math.floor(n) } : null;
  }
  if (t.kind === 'tool-ok' || t.kind === 'tool-fail') return { ...t, toolId: value.trim() };
  if (t.kind === 'file-change') return { kind: 'file-change', target: value.trim() };
  return null;
}

function saveRules(v: DockToolView, rules: DockRule[]): void {
  const intent = { ...v.intent, v: 1, tool: v.id, rules };
  writeIntent(v.path, intent);
  void kickDockScheduler();
}

function renderLive(v: DockToolView): void {
  if (!bodyEl) return;
  const live = liveOf(v.id);
  if (!live) return;
  block('正在跑');
  const box = bodyEl.createDiv({ cls: 'bz-dock-log' });
  box.createDiv({ cls: 'bz-dock-log-run', text: `工单 ${live.runId} · ${live.phase ?? '进行中'}${live.pct !== null ? ` ${live.pct}%` : ''}` });
  for (const s of live.steps.slice(-40)) box.createDiv({ cls: 'bz-dock-log-line', text: s.text });
  if (!live.steps.length) box.createDiv({ cls: 'bz-dock-hint', text: '还没有输出' });
}

function renderHistory(v: DockToolView): void {
  if (!bodyEl) return;
  block('最近');
  const runs = recentRunsOf(v.path, v.id, 12);
  const box = bodyEl.createDiv({ cls: 'bz-dock-history' });
  if (!runs.length) {
    box.createDiv({ cls: 'bz-dock-hint', text: '还没跑过' });
    return;
  }
  for (const r of runs) historyRow(box, r);
}

function historyRow(parent: HTMLElement, r: DockRunRecord): void {
  const row = parent.createDiv({ cls: 'bz-dock-history-row' });
  row.dataset.state = r.status;
  row.createSpan({ cls: 'bz-dock-history-when', text: new Date(r.startedAt).toLocaleString() });
  row.createSpan({ cls: 'bz-dock-history-status', text: statusWord(r.status) });
  row.createSpan({ cls: 'bz-dock-history-msg', text: r.message ?? r.error?.detail ?? '' });
  if (r.durationMs) row.createSpan({ cls: 'bz-dock-history-dur', text: `${Math.round(r.durationMs / 1000)}s` });
}

function statusWord(s: string): string {
  switch (s) {
    case 'ok':
      return '成功';
    case 'failed':
      return '失败';
    case 'timeout':
      return '超时';
    case 'stopped':
      return '中止';
    case 'abandoned':
      return '没收尾';
    case 'running':
      return '在跑';
    default:
      return s;
  }
}

function renderFooter(v: DockToolView): void {
  if (!bodyEl) return;
  const foot = bodyEl.createDiv({ cls: 'bz-dock-footer' });
  foot.createDiv({ cls: 'bz-dock-path', text: v.path });

  const enable = btnOf(foot, v.intent.enabled === false ? '启用' : '停用');
  enable.addEventListener('click', () => {
    writeIntent(v.path, { ...v.intent, v: 1, tool: v.id, enabled: v.intent.enabled === false });
    renderDetail();
  });

  const auto = btnOf(foot, v.intent.autoRun === false ? '允许自动运行' : '只手动跑');
  auto.addEventListener('click', () => {
    writeIntent(v.path, { ...v.intent, v: 1, tool: v.id, autoRun: v.intent.autoRun === false });
    renderDetail();
  });

  const del = btnOf(foot, '移除登记', 'mod-warning');
  del.addEventListener('click', () => {
    const sure = window.confirm(`从工具坞移除「${displayNameOf(v)}」？\n只删登记，不动磁盘上的文件。`);
    if (!sure) return;
    removeTool(v.id);
    showList();
  });
}

function block(title: string): void {
  if (!bodyEl) return;
  bodyEl.createDiv({ cls: 'bz-dock-block-title', text: title });
}

// ==================== 动作 ====================

async function doRun(v: DockToolView): Promise<void> {
  await runToolManually(v);
  if (view === 'detail' && detailId === v.id) renderDetail();
}

async function doTrust(v: DockToolView): Promise<void> {
  if (!v.entry) return;
  await trustTool(v.id, v.entry);
  notify(`${displayNameOf(v)} 已授权`, { type: 'success' });
  renderDetail();
}

async function doUntrust(v: DockToolView): Promise<void> {
  const sure = window.confirm(`撤销「${displayNameOf(v)}」的授权？\n撤销后它不能再跑，直到重新授权。`);
  if (!sure) return;
  await untrustTool(v.id);
  renderDetail();
}

// ==================== 导入 ====================

function pickFolder(): void {
  const input = document.createElement('input');
  input.type = 'file';
  // webkitdirectory 在 Electron 里可用；选中的是目录下的文件，我们只要 manifest.json
  (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    const manifest = files.find((f) => f.name === 'manifest.json');
    if (!manifest) {
      new Notice('这个文件夹里没有 manifest.json');
      return;
    }
    const abs = (manifest as File & { path?: string }).path;
    if (!abs) {
      new Notice('读不到文件夹路径（这个平台不支持）');
      return;
    }
    void importFrom(abs);
  });
  input.click();
}

async function importFrom(manifestPath: string): Promise<void> {
  const fs = currentFs();
  if (!fs) {
    new Notice('桌面端才能导入');
    return;
  }
  const text = fs.readText(manifestPath);
  if (text === null) {
    new Notice('读不到这个文件');
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    new Notice('manifest.json 不是合法 JSON');
    return;
  }
  const manifest = parseManifest(raw);
  if (!manifest) {
    new Notice('声明校验不过（需要 v:2、合法 id、非空 name）');
    return;
  }
  upsertTool({ id: manifest.id, path: manifestPath });
  notify(`已登记「${manifest.name}」，先看一眼它会跑什么，再授权`, { type: 'info' });
  render();
  showDetail(manifest.id);
}

// ==================== 小工具 ====================

/** 按钮（Obsidian 的 HTMLElement 扩展没有 createButton，统一走这里） */
function btnOf(parent: HTMLElement, text: string, cls?: string): HTMLButtonElement {
  return parent.createEl('button', { text, cls: cls ? `bz-dock-btn ${cls}` : 'bz-dock-btn' });
}

function iconBtn(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
  const b = parent.createDiv({ cls: 'bz-dock-icon-btn' });
  b.setAttribute('aria-label', label);
  b.setAttribute('title', label);
  setIcon(b, icon);
  b.addEventListener('click', onClick);
}

/** 供 main.ts 注册直达命令时读登记表（此处留一个薄封装，避免它直接摸 registry） */
export function listToolEntries(): { id: string; path: string }[] {
  return readRegistry().registry.tools.map((t) => ({ id: t.id, path: t.path }));
}

export { runToolDirect };
