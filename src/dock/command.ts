/**
 * 直达运行 —— 命令面板里 `bz-dock-run-<id>` 那条命令的口径层。
 *
 * 门槛与面板**同一套判断**（`judgeRunGate`），不另写一份：上一版面板、命令、调度器各有一套
 * 「能不能跑」，三处说法不一致时，用户看到的就是「面板能点、命令说不能」。
 */

import { Platform, type App } from 'obsidian';
import { notify } from '../core/notice';
import { displayNameOf, loadToolView } from './view';
import { readRegistry, readTrust } from './registry';
import { missingParams } from './kernel';
import { liveOf } from './exec';
import type { DockToolView } from './types';

export type GateReason = 'no-tool' | 'no-entry' | 'untrusted' | 'running' | 'params' | 'mobile';

export interface GateResult {
  ok: boolean;
  reason?: GateReason;
  text?: string;
}

/** 能不能手动跑一次（面板按钮与直达命令共用） */
export function judgeRunGate(view: DockToolView | undefined, canRun: boolean): GateResult {
  if (!view) return { ok: false, reason: 'no-tool', text: '这个工具没登记' };
  if (!canRun) return { ok: false, reason: 'mobile', text: '手机上只能看，不能跑' };
  if (!view.entry) return { ok: false, reason: 'no-entry', text: '声明里没有启动命令（entry）' };
  if (!view.trusted) return { ok: false, reason: 'untrusted', text: '这条命令还没授权，先在面板里确认' };
  if (liveOf(view.id)) return { ok: false, reason: 'running', text: '它正在跑' };
  const missing = missingParams(view);
  if (missing.length) return { ok: false, reason: 'params', text: `还有必填参数没填：${missing.join('、')}` };
  return { ok: true };
}

export function findView(id: string, canRun = true): DockToolView | undefined {
  const { registry } = readRegistry();
  const entry = registry.tools.find((t) => t.id === id);
  if (!entry) return undefined;
  return loadToolView(entry, { trust: readTrust(), canRun });
}

/** 命令名里的工具名（声明读不到时退回 id） */
export function dockToolLabel(entry: { id: string; path: string }): string {
  const view = loadToolView(entry, { trust: readTrust() });
  return displayNameOf(view);
}

/** 命令面板直达运行（门槛不过就说明原因，不静默失败） */
export async function runToolDirect(app: App, id: string): Promise<void> {
  void app;
  const view = findView(id);
  // 手机上「看得到、跑不了」—— 这个事实要在这里说，不能写死 `true` 让命令面板去撞
  const gate = judgeRunGate(view, !Platform.isMobile);
  if (!gate.ok || !view) {
    notify(gate.text ?? '跑不了', { type: 'warning' });
    return;
  }
  const { runToolManually } = await import('./host');
  await runToolManually(view);
}
