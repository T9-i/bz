/**
 * 触发判据 —— **纯函数，零依赖，node 可直跑**。
 *
 * 这一份是「该不该跑」的**唯一答案**。插件、值守进程、测试都调它；谁都不许再写第二份
 * （上一版两边各一套、靠注释对齐，两次误报都是从那儿来的）。
 *
 * 三条纪律：
 *  1) **判不出就不跑**：没有基线、读不到值、时间解析不出来 —— 一律 false，不假装到点；
 *  2) **不掷骰、不读盘、不发通知**：随机延迟与副作用在调用方那一侧；
 *  3) **按规则各自记账**：`lastFiredAt` 挂在规则上，不共享一副全局欠账。
 *
 * 精度到分钟：调度是分钟级节拍，多一位精度只是让界面变长。
 */

import type { DockAction, DockRule, DockTrigger, DockTriggerKind } from './types';

// ==================== 上下文 ====================

export interface RuleEvent {
  kind: 'panel-open' | 'obsidian-exit' | 'tool-ok' | 'tool-fail' | 'domain-event' | 'file-change';
  toolId?: string;
  channel?: string;
  path?: string;
}

export interface RuleCtx {
  now: number;
  /** 本规则上次跑完的时刻（ms） */
  lastFiredAt?: number;
  /** 本次 Obsidian 启动的时刻（ms）—— `on-launch` 唯一的时间基准 */
  sessionStart?: number;
  event?: RuleEvent;
  /** `value-threshold` 的当前值；读不到就 undefined */
  value?: number;
}

/** 本地时区零点 */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 今天的 HH:MM 落在哪个时刻（ms） */
export function todayAt(trigger: DockTrigger & { kind: 'daily' }, now: number): number | undefined {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(trigger.at);
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return undefined;
  return startOfDay(now) + (h * 3600 + mi * 60) * 1000;
}

// ==================== 判据 ====================

export function ruleDue(rule: DockRule, ctx: RuleCtx): boolean {
  const t = rule.trigger;
  switch (t.kind) {
    case 'daily': {
      const at = todayAt(t, ctx.now);
      if (at === undefined) return false;
      if (ctx.now < at) return false;
      return (ctx.lastFiredAt ?? 0) < at;
    }
    case 'interval': {
      if (!(t.everyMin > 0)) return false;
      if (ctx.lastFiredAt === undefined) return true;
      return ctx.now - ctx.lastFiredAt >= t.everyMin * 60_000;
    }
    case 'on-launch': {
      if (ctx.sessionStart === undefined) return false;
      if (ctx.now < ctx.sessionStart + t.delayMin * 60_000) return false;
      return (ctx.lastFiredAt ?? 0) < ctx.sessionStart;
    }
    case 'panel-open':
      return ctx.event?.kind === 'panel-open';
    case 'obsidian-exit':
      return ctx.event?.kind === 'obsidian-exit';
    case 'tool-ok':
      return ctx.event?.kind === 'tool-ok' && ctx.event.toolId === t.toolId;
    case 'tool-fail':
      return ctx.event?.kind === 'tool-fail' && ctx.event.toolId === t.toolId;
    case 'domain-event':
      return ctx.event?.kind === 'domain-event' && ctx.event.channel === t.channel;
    case 'file-change': {
      if (ctx.event?.kind !== 'file-change') return false;
      const p = ctx.event.path ?? '';
      if (!p) return false;
      return p === t.target || p.startsWith(`${t.target}/`);
    }
    case 'value-threshold': {
      if (ctx.value === undefined) return false;
      if (t.op === '>') return ctx.value > t.value;
      if (t.op === '<') return ctx.value < t.value;
      return ctx.value === t.value;
    }
  }
}

/** 这次触发是不是靠事件（决定面板显不显示「下次预计」） */
export function isEventTrigger(kind: DockTriggerKind): boolean {
  return kind !== 'daily' && kind !== 'interval' && kind !== 'on-launch';
}

/**
 * 下次该跑的时刻。事件类返回 null（等事件，算不出钟点）。
 * 注意：它只是**给人看的预计**，真正的到期时刻由内核在排上队时写进账本。
 */
export function nextDueOf(rule: DockRule, ctx: RuleCtx): number | null {
  const t = rule.trigger;
  switch (t.kind) {
    case 'daily': {
      const today = todayAt(t, ctx.now);
      if (today === undefined) return null;
      if (ctx.now < today && (ctx.lastFiredAt ?? 0) < today) return today;
      return today + 86_400_000;
    }
    case 'interval': {
      if (!(t.everyMin > 0)) return null;
      if (ctx.lastFiredAt === undefined) return ctx.now;
      return ctx.lastFiredAt + t.everyMin * 60_000;
    }
    case 'on-launch': {
      if (ctx.sessionStart === undefined) return null;
      const at = ctx.sessionStart + t.delayMin * 60_000;
      return (ctx.lastFiredAt ?? 0) < ctx.sessionStart ? at : null;
    }
    default:
      return null;
  }
}

// ==================== 人话 ====================

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function clockText(at: string): string {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(at);
  if (!m) return at;
  return `${pad2(Number(m[1]))}:${pad2(Number(m[2]))}`;
}

export function durationText(min: number): string {
  if (min >= 60 && min % 60 === 0) return `${min / 60} 小时`;
  return `${min} 分钟`;
}

export function triggerText(t: DockTrigger, nameOf?: (id: string) => string): string {
  const name = (id: string): string => (nameOf ? nameOf(id) : id);
  switch (t.kind) {
    case 'daily':
      return `每天 ${clockText(t.at)}`;
    case 'interval':
      return `每 ${durationText(t.everyMin)}`;
    case 'on-launch':
      return `启动后 ${durationText(t.delayMin)}`;
    case 'panel-open':
      return '打开工具坞时';
    case 'obsidian-exit':
      return '关闭 Obsidian 后';
    case 'tool-ok':
      return `${name(t.toolId)} 成功后`;
    case 'tool-fail':
      return `${name(t.toolId)} 失败后`;
    case 'domain-event':
      return `事件 ${t.channel}`;
    case 'file-change':
      return `${t.target} 有变动`;
    case 'value-threshold':
      return `${t.path} 的 ${t.key} ${t.op} ${t.value}`;
  }
}

export function actionText(a: DockAction): string {
  return a.kind === 'remind' ? '只提醒' : '运行';
}

export function ruleName(rule: DockRule, index: number): string {
  return rule.name?.trim() || `规则 ${index + 1}`;
}

/** 面板新建一条规则时的初值 */
export function defaultRule(now: number = Date.now()): DockRule {
  return {
    id: `r${now.toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`,
    trigger: { kind: 'daily', at: '09:00' },
    action: { kind: 'run' },
  };
}
