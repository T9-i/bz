/**
 * StPageFlip 空转守卫（issue 549）· `src/diary/flip-idle-guard.ts`
 *
 * 库的渲染器跑无条件 rAF 死循环，每帧给所有非当前页重写同一个 `display:none`
 * （真实 vault 那本 215 页的册子实测 36 720 次 style 变更/秒）。守卫只省「写同一个值」，
 * 这里用一个**照抄库行为**的渲染器替身把它钉住：
 *
 * 1. 结构对不上（换库版本 / 测试替身 / 字段改名）→ 原样不动，绝不让书打不开；
 * 2. 装上后：第一帧把每页藏一次，之后**同一组可见页**的每一帧 0 次写入（守卫的全部意义）；
 * 3. 可见页变了、或有页从显示态回到隐藏态 → 该藏的页**照样藏**（不许漏藏出幽灵页）；
 * 4. `hideTemporaryCopy()` 照旧；
 * 5. 幂等：重复调用只装一层。
 *
 * 计数走 MutationObserver 看 `style` 属性变更 —— 与真机上量到的口径一致（不是数函数调用次数）。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { guardIdleWrites } from '../../src/diary/flip-idle-guard';

/** 替身页：只带守卫用到的三个方法 */
class StubPage {
  el: HTMLElement;
  temp: unknown = null;
  hideCalls = 0;
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'stf__item';
    document.body.appendChild(this.el);
  }
  getElement(): HTMLElement {
    return this.el;
  }
  getTemporaryCopy(): unknown {
    return this.temp;
  }
  hideTemporaryCopy(): void {
    this.hideCalls += 1;
    this.temp = null;
  }
}

/** 替身渲染器：`clear()` **照抄库的原样写法**（每帧无脑重写），守卫要改的就是它 */
class StubRender {
  leftPage: unknown = null;
  rightPage: unknown = null;
  flippingPage: unknown = null;
  bottomPage: unknown = null;
  pages: StubPage[];
  app: { getPageCollection: () => { getPages?: () => StubPage[] } };
  constructor(pages: StubPage[]) {
    this.pages = pages;
    this.app = { getPageCollection: () => ({ getPages: () => this.pages }) };
  }
  clear(): void {
    for (const p of this.pages) {
      if (p !== this.leftPage && p !== this.rightPage && p !== this.flippingPage && p !== this.bottomPage) {
        p.getElement().style.cssText = 'display: none';
      }
      if (p.getTemporaryCopy() !== this.flippingPage) p.hideTemporaryCopy();
    }
  }
}

function setup(n = 5): { render: StubRender; flip: unknown } {
  const pages = Array.from({ length: n }, () => new StubPage());
  const render = new StubRender(pages);
  return { render, flip: { getRender: () => render } };
}

/** 数 style 属性变更（一帧 = 调一次 `clear()`） */
async function countWrites(run: (frame: number) => void, frames: number): Promise<number[]> {
  let cur = 0;
  const per = [] as number[];
  const mo = new MutationObserver((recs) => {
    cur += recs.length;
  });
  mo.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style'] });
  for (let i = 0; i < frames; i++) {
    cur = 0;
    run(i);
    await new Promise((r) => setTimeout(r, 0)); // 让 MutationObserver 的微任务落地
    per.push(cur);
  }
  mo.disconnect();
  return per;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('guardIdleWrites · 装不上的情形一律原样不动', () => {
  it('取不到渲染器 / 结构对不上 → 返回 false，不是抛错', () => {
    expect(guardIdleWrites(null)).toBe(false);
    expect(guardIdleWrites({})).toBe(false);
    expect(guardIdleWrites({ getRender: 'not-a-fn' })).toBe(false);
    expect(guardIdleWrites({ getRender: () => null })).toBe(false);
    expect(guardIdleWrites({ getRender: () => ({}) })).toBe(false); // 没有 clear
    expect(guardIdleWrites({ getRender: () => ({ clear: () => {}, app: {} }) })).toBe(false); // app 没有 getPageCollection
  });

  it('取页表拿不到（getPages 不是函数）→ clear 退回原生实现，绝不空转', async () => {
    const pages = [new StubPage(), new StubPage()];
    const render = new StubRender(pages);
    render.app = { getPageCollection: () => ({}) }; // 结构不全：拿不到 getPages
    const flip = { getRender: () => render };
    guardIdleWrites(flip);
    expect(render.clear).not.toBe(StubRender.prototype.clear); // 确实被包了一层
    const per = await countWrites(() => render.clear(), 2);
    expect(per[0]).toBeGreaterThan(0);
    expect(per[1]).toBeGreaterThan(0); // 原生行为：每帧照写
  });
});

describe('guardIdleWrites · 只省「写同一个值」', () => {
  it('未装守卫（对照）：每一帧都重写所有非当前页', async () => {
    const { render } = setup(5);
    const per = await countWrites(() => render.clear(), 4);
    expect(per.every((n) => n === 5)).toBe(true);
  });

  it('装上守卫：第一帧藏一遍，之后同一组可见页每帧 0 次写入', async () => {
    const { render, flip } = setup(5);
    expect(guardIdleWrites(flip)).toBe(true);
    const per = await countWrites(() => render.clear(), 5);
    expect(per[0]).toBe(5); // 五页都还是显示态 → 各藏一次
    expect(per.slice(1)).toEqual([0, 0, 0, 0]); // 之后每帧都是「写同一个值」→ 全跳过
    // 藏是藏住了：五页都是 display:none
    expect(render.pages.every((p) => p.getElement().style.display === 'none')).toBe(true);
  });

  it('可见页变了、或有页回到显示态 → 该藏的照样藏（不漏出幽灵页）', async () => {
    const { render, flip } = setup(5);
    guardIdleWrites(flip);
    await countWrites(() => render.clear(), 1);

    // 第 0 页成了当前页：它被「画」成显示态（真库里 simpleDraw 会这么干）
    render.rightPage = render.pages[0];
    render.pages[0].getElement().style.cssText = 'display: block; position: absolute;';
    const per = await countWrites(() => render.clear(), 2);
    expect(per[0]).toBe(0); // 可见集合换了，但没有页需要**重新藏**（其余四页早已 hidden）
    expect(per[1]).toBe(0);

    // 现在第 0 页退出可见集合：它必须被藏回来
    render.rightPage = render.pages[1];
    const per2 = await countWrites(() => render.clear(), 2);
    expect(per2[0]).toBe(1);
    expect(render.pages[0].getElement().style.display).toBe('none');
    expect(per2[1]).toBe(0); // 同一组 → 又回到 0
  });

  it('hideTemporaryCopy 照旧：可见集合变动那帧会收临时页；同组帧不再白叫', async () => {
    const { render, flip } = setup(3);
    guardIdleWrites(flip);
    await countWrites(() => render.clear(), 1);
    const base = render.pages.map((p) => p.hideCalls);

    render.flippingPage = render.pages[0]; // 翻动页换了 → 可见集合变
    await countWrites(() => render.clear(), 2);
    // 三个页都被叫过一次（第 0 页是翻动页本身 → getTemporaryCopy() 与 flippingPage 相等时跳过）
    expect(render.pages[1].hideCalls).toBe(base[1] + 1);
    expect(render.pages[2].hideCalls).toBe(base[2] + 1);
    // 第二帧同组：整段短路，不再重复叫
    expect(render.pages[1].hideCalls).toBe(base[1] + 1);
  });

  it('幂等：重复装只一层，行为不变', async () => {
    const { render, flip } = setup(4);
    expect(guardIdleWrites(flip)).toBe(true);
    const once = render.clear;
    expect(guardIdleWrites(flip)).toBe(true);
    expect(render.clear).toBe(once);
    const per = await countWrites(() => render.clear(), 3);
    expect(per[0]).toBe(4);
    expect(per.slice(1)).toEqual([0, 0]);
  });
});
