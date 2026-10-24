/**
 * 状态栏 —— 面板没开的时候，也得知道「有东西在跑」。
 *
 * 只用原生 DOM 方法（classList / textContent）：状态栏元素由宿主传入，
 * 测试桩里它是纯 jsdom 元素，没有 Obsidian 那套 `addClass` / `empty` 扩展。
 * 为了这么一小块去依赖扩展方法，代价是整条启动链在测试里必崩 —— 不值。
 */

import { liveAll, onLiveChanged } from './exec';
import { readRegistry } from './registry';

let el: HTMLElement | null = null;
let off: (() => void) | null = null;
let onOpen: (() => void) | null = null;

export function mountDockStatusBar(item: HTMLElement, open: () => void): void {
  el = item;
  onOpen = open;
  item.classList.add('bz-dock-statusbar');
  item.addEventListener('click', () => onOpen?.());
  off = onLiveChanged(render);
  render();
}

/** 设置页关掉「状态栏显示」后立刻生效 —— 不然得等下一次有工具跑完才重画 */
export function refreshDockStatusBar(): void {
  render();
}

export function unmountDockStatusBar(): void {
  off?.();
  off = null;
  if (el) {
    el.textContent = '';
    el.classList.remove('bz-dock-statusbar');
    el.classList.remove('is-active');
    el.classList.remove('is-off');
    el.remove();
  }
  el = null;
  onOpen = null;
}

function render(): void {
  if (!el) return;
  // 开关现读现判：设置页改完不必重启（`statusbar` 缺省开，读不到登记表也不至于把块弄没）
  if (readRegistry().registry.statusbar === false) {
    el.classList.add('is-off');
    el.classList.remove('is-active');
    el.textContent = '';
    return;
  }
  el.classList.remove('is-off');
  const runs = liveAll();
  el.textContent = '';
  if (!runs.length) {
    el.classList.remove('is-active');
    el.setAttribute('aria-label', '工具坞');
    el.textContent = '工具坞';
    return;
  }
  el.classList.add('is-active');
  el.setAttribute('aria-label', `${runs.length} 个工具在跑`);
  el.textContent = `${runs.length} 个在跑`;
}
