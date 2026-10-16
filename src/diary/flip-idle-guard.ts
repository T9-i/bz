/**
 * StPageFlip 空转守卫（issue 549）——把「每帧重写同一个 display:none」这条省掉。
 *
 * ## 为什么需要它
 *
 * 库的 HTML 渲染器（`loadFromHTML` 那一路）跑的是**无条件 rAF 死循环**：
 *
 * ```js
 * start() { this.update(); const t = e => { this.render(e), requestAnimationFrame(t) }; requestAnimationFrame(t) }
 * ```
 *
 * 而每帧的 `drawFrame()` 里，`clear()` 会给**所有非当前页**写一次
 * `element.style.cssText = "display: none"` —— 同一个值、每帧重写。
 * 真实 vault 那本 215 页的册子实测（无头 Edge，MutationObserver 1 秒窗）：
 *
 * ```
 * rAF frames/s = 171
 * style 变更 = 36 720 次/秒   （隐藏页 36 594 + 当前页 342）
 * ```
 *
 * 折算到手机 60fps 仍是 ~12.8k 次/秒的样式属性写入 —— 一直烧着、一直失效、一直耗电，
 * 与「翻页异常卡顿」「读久了烫手」对得上。**它跟书里排了多少篇正相关**：
 * 全量渲染是这条底噪的乘数（`页数 × 每帧一次`），所以册子越大越明显。
 *
 * ## 做什么
 *
 * 只把「写同一个值」的那部分省掉，**观感逐像素不变**：
 *
 * - 逐页判：元素还不是隐藏态时才写一次 `display: none`；已经是隐藏态的只读一下 `style.display`；
 * - 整段短路：当前页 / 翻动页 / 底页这组引用没变过 ⇒ 没有页会「从可见变不可见」，整个循环跳过。
 *
 * 剩下该做的照做：`hideTemporaryCopy()`、可见页的 `simpleDraw()`（位置/尺寸）、
 * 翻页动画与拖拽期间每帧的 `draw()` 全都不动 —— 动画期 `flippingPage` / `bottomPage` 一直在变，
 * 短路的判据自然落空，逐帧照画。
 *
 * ## 耦合与失守口径
 *
 * 与库内部结构的耦合（`app.getPageCollection().getPages()`、
 * `leftPage / rightPage / flippingPage / bottomPage`）**集中在本文件**；
 * 结构对不上（换库版本 / 测试替身 / 字段被改名）就**原样返回、什么都不改**——
 * 本守卫只该省冗余，不该改行为，也不该让书打不开。
 */

/** 渲染器实例里本守卫要用到的那几个字段（库未公开，按结构声明） */
interface FlipPageLike {
  getElement(): HTMLElement;
  getTemporaryCopy(): unknown;
  hideTemporaryCopy(): void;
}

interface FlipAppLike {
  getPageCollection?: () => { getPages?: () => FlipPageLike[] };
}

interface FlipRenderLike {
  leftPage: unknown;
  rightPage: unknown;
  flippingPage: unknown;
  bottomPage: unknown;
  app: FlipAppLike;
  clear: () => void;
}

/** 取渲染器实例。测试替身没有 `getRender()` ⇒ 拿不到 ⇒ 调用方原样返回 */
function renderOf(flip: unknown): FlipRenderLike | null {
  const get = (flip as { getRender?: () => unknown } | null | undefined)?.getRender;
  if (typeof get !== 'function') return null;
  try {
    return (get.call(flip) as FlipRenderLike) || null;
  } catch {
    return null;
  }
}

/**
 * 给一本书装上空转守卫。返回值只用于测试与日志：`true` = 装上了，`false` = 环境/版本对不上、原样未动。
 * **幂等**：同一实例重复调用只装一层（打标在渲染器上）。
 */
export function guardIdleWrites(flip: unknown): boolean {
  const render = renderOf(flip);
  if (!render || typeof render.clear !== 'function' || !render.app) return false;
  const app = render.app;
  if (typeof app.getPageCollection !== 'function') return false;
  const probe = render as unknown as Record<string, unknown>;
  if (probe.__bzIdleGuarded) return true;
  probe.__bzIdleGuarded = true;

  const orig = render.clear;

  /** 对象 → 稳定序号（含库按需 clone 出来的临时页，靠引用相等即可） */
  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const idOf = (o: unknown): string => {
    if (!o || typeof o !== 'object') return '-';
    let id = ids.get(o as object);
    if (id === undefined) {
      id = ++nextId;
      ids.set(o as object, id);
    }
    return String(id);
  };

  /** 上一帧「该露在外面的那几页」；引用没变 ⇒ 没有页需要重新藏 */
  let lastSig: string | null = null;

  render.clear = function guardedClear(this: FlipRenderLike): void {
    /* 取页表：拿不到就退回原生实现（宁可多写，不可不写） */
    const pages = app.getPageCollection?.()?.getPages?.();
    if (!Array.isArray(pages)) {
      orig.call(this);
      return;
    }
    const sig = `${idOf(this.leftPage)}|${idOf(this.rightPage)}|${idOf(this.flippingPage)}|${idOf(this.bottomPage)}`;
    if (sig === lastSig) return;
    lastSig = sig;

    for (const page of pages) {
      const visible = page === this.leftPage || page === this.rightPage || page === this.flippingPage || page === this.bottomPage;
      const el = page.getElement();
      if (!el) continue;
      /* 要藏的页：只在还不是隐藏态时写一次；已经是 `display:none` 的，改写同一个值纯属白烧 CPU */
      if (!visible && el.style.display !== 'none') el.style.cssText = 'display: none';
      if (page.getTemporaryCopy() !== this.flippingPage) page.hideTemporaryCopy();
    }
  };

  return true;
}
