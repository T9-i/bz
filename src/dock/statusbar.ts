/**
 * 工具坞状态栏 —— 面板关着也能看见「有工具在跑」。
 *
 * 为什么需要它：从命令面板 / 快捷键起跑一个工具后，面板可能压根没开过。此前除了起跑那一声
 * toast 和结束通知，中间几分钟没有任何可见状态 —— 长任务跑起来像没发生。
 *
 * 只映**在场运行**（`liveRunsAll()`）：离场运行（值守进程拉起）bz 不是父进程，拿不到实时进度，
 * 在这里编一个「在跑」就是骗人（同 runner.ts 顶部那条 UI 约束）。
 *
 * 订阅走 `onLiveRunsChanged`（起跑 / 收尾各一次），不轮询 —— 状态栏是常驻件，每秒问一次
 * 名册没有意义。点击打开面板（面板里那条运行条才是能停止、能看输出详情的地方）。
 */
import { setIcon } from 'obsidian';
import type { App } from 'obsidian';
import { liveRunsAll, onLiveRunsChanged } from './runner';

let statusEl: HTMLElement | null = null;
let textEl: HTMLElement | null = null;
let off: (() => void) | null = null;
let hostApp: App | null = null;

export function mountDockStatusBar(container: HTMLElement, app: App): void {
  if (statusEl) return;
  hostApp = app;
  statusEl = document.createElement('span');
  statusEl.className = 'bz-dock-statusbar is-off';
  statusEl.title = '工具坞';

  const iconEl = document.createElement('span');
  iconEl.className = 'bz-dock-statusbar-icon';
  setIcon(iconEl, 'square-terminal');

  textEl = document.createElement('span');
  textEl.className = 'bz-dock-statusbar-text';

  statusEl.append(iconEl, textEl);
  statusEl.addEventListener('click', () => {
    // 函数体内延迟 import（ui.ts 顶层依赖 runner，避免循环引用环）
    void import('./ui').then((m) => m.openDock(hostApp as App));
  });
  container.appendChild(statusEl);

  off = onLiveRunsChanged(sync);
  sync();
}

export function unmountDockStatusBar(): void {
  off?.();
  off = null;
  statusEl?.remove();
  statusEl = null;
  textEl = null;
  hostApp = null;
}

/** 名册变了就刷一次：0 个整件隐藏（不为「可能有用」占位），1 个 / N 个分别说人话 */
function sync(): void {
  if (!statusEl) return;
  const n = liveRunsAll().length;
  statusEl.classList.toggle('is-off', n === 0);
  if (n === 0) return;
  const text = n === 1 ? '1 个在跑' : `${n} 个在跑`;
  if (textEl && textEl.textContent !== text) textEl.textContent = text;
  const title = `工具坞：${text}（点击查看）`;
  if (statusEl.title !== title) statusEl.title = title;
}
