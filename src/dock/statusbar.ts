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
/**
 * 设置页那个开关的当前值 —— **挂载与设置变更时读一次就够**。
 *
 * `render` 挂在 `onLiveChanged` 上，每次工具启停都会回调；为了一个几乎不变的布尔，
 * 每次都去读一遍 `dock.json`（同步 IO）不值。开关只可能从设置页改（改完调
 * `refreshDockStatusBar`），手改文件本来就得重载插件才生效，缓存不会说谎。
 */
let shown = true;

export function mountDockStatusBar(item: HTMLElement, open: () => void): void {
  el = item;
  onOpen = open;
  item.classList.add('bz-dock-statusbar');
  item.addEventListener('click', () => onOpen?.());
  off = onLiveChanged(render);
  shown = readShown();
  render();
}

/** 设置页关掉「状态栏显示」后立刻生效 —— 不然得等下一次有工具跑完才重画 */
export function refreshDockStatusBar(): void {
  shown = readShown();
  render();
}

/** 读开关（缺省开；读不到登记表也不至于把块弄没） */
function readShown(): boolean {
  return readRegistry().registry.statusbar !== false;
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
  if (!shown) {
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
