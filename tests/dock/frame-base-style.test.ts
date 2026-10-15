// @vitest-environment jsdom
/**
 * 沙箱框这条线上的守卫（2026-10-15）——三件事，都是「用户看得见、但没人守就会悄悄回潮」的：
 *
 * ① **转义**：`frameBaseStyle()` 把主题变量拼进 `style="…"` 灌给 iframe 内容（展示板 ADR-0243、
 *    询问框正文 ADR-0244）。主题变量里有一个**带引号**的值：
 *
 *      --bz-font-ui: -apple-system, "Segoe UI", system-ui, "PingFang SC", …
 *
 *    原样拼进去，HTML 属性在第一个 `"` 处提前收尾 —— 后面的声明（`--bz-font-mono`、`--bz-space-*`
 *    与整条基线）全变成杂属性丢掉，框里退回 8px 边距 + Times + 16px。
 *
 * ② **隐藏条**：那条挂框文档的**根元素**上，不在 body 基线上（`scrollbar-width` 不继承，
 *    挂 body 实测无效）。
 *
 * ③ **量高**：量到 0（面板关着时渲染）要能在之后补上，内容变高要跟上，且不许互相追着改。
 *
 * 三件都「界面不报错、也不缺内容，只是难看了/多了根条」—— 只能靠断言钉住。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { escapeStyleAttr, fitFrameHeight, frameBaseStyle, frameRootStyle } from '../../src/dock/ui';

/** 与 tokens.css 的真实取值同形（引号是重点，值本身随皮肤变） */
const FONT_UI = '-apple-system, "Segoe UI", system-ui, "PingFang SC", sans-serif';

afterEach(() => {
  document.body.removeAttribute('style');
});

describe('沙箱框基线的转义', () => {
  it('引号与 & 转义；其余原样（别顺手把连字符、逗号也编掉）', () => {
    expect(escapeStyleAttr(FONT_UI)).toBe('-apple-system, &quot;Segoe UI&quot;, system-ui, &quot;PingFang SC&quot;, sans-serif');
    expect(escapeStyleAttr('a &amp; b')).toBe('a &amp;amp; b'); // 已编码的照样再编一层，不猜
    expect(escapeStyleAttr('#e8e8ec')).toBe('#e8e8ec');
    expect(escapeStyleAttr('12px')).toBe('12px');
  });

  it('隐藏条那条挂在**根元素**上，不在 body 基线上（挂 body 无效 —— 不继承，实测条占位 15px）', () => {
    expect(frameRootStyle()).toBe('scrollbar-width:none');
    const css = frameBaseStyle();
    expect(css).not.toMatch(/scrollbar-width/);
    // ADR-0122 那条只做一半：隐藏条、保留滚动 —— 基线里不许出现 overflow
    expect(css).not.toContain('overflow');
  });

  it('基线灌进 style 属性后，font-size / line-height / margin 都还在（不转义就全丢）', () => {
    document.body.style.setProperty('--bz-text-1', '#e8e8ec');
    document.body.style.setProperty('--bz-font-ui', FONT_UI);
    document.body.style.setProperty('--bz-font-mono', 'ui-monospace, monospace');
    document.body.style.setProperty('--bz-font-label', '13px');
    document.body.style.setProperty('--bz-space-md', '12px');

    const css = frameBaseStyle();
    // 走真解析（innerHTML 才认 `&quot;`）—— 与 srcdoc 那条路同一个 HTML 解析器
    document.body.innerHTML = `<div id="probe" style="${css}"></div>`;
    const probe = document.getElementById('probe') as HTMLElement;

    // 属性没被截断：`--bz-font-ui` 之后写进去的东西全都活着。
    // （jsdom 的 cssstyle 不解析 `var()`，所以这里断言的是「声明还在」，值原样带 `var(...)`）
    expect(probe.style.fontSize).toBe('var(--bz-font-label)');
    expect(probe.style.fontFamily).toBe('var(--bz-font-ui)');
    expect(probe.style.lineHeight).toBe('1.6');
    expect(probe.style.margin).toBe('0px');
    expect(probe.style.color).toBe('var(--bz-text-1)');
    // 带引号那条自己也没被啃掉
    expect(css).toContain('Segoe UI&quot;');
    expect(css).not.toMatch(/Segoe UI"/);
  });
});

describe('沙箱框量高：量到 0 之后要能补，内容变高要跟上', () => {
  /** 捕获 ResizeObserver 实例，方便手动触发它的回调 */
  const callbacks: Array<() => void> = [];
  class FakeResizeObserver {
    constructor(cb: () => void) { callbacks.push(cb); }
    observe(): void { /* 记下回调就够了 */ }
    disconnect(): void { /* 不用 */ }
  }
  /** 造一个「框内文档高度可拨」的框（jsdom 不做布局，高度只能自己拨） */
  function fakeFrame(getH: () => number): HTMLIFrameElement {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument as Document;
    for (const el of [doc.body, doc.documentElement]) {
      Object.defineProperty(el, 'scrollHeight', { configurable: true, get: getH });
    }
    return frame;
  }
  const fire = (): void => { for (const cb of callbacks) cb(); };

  afterEach(() => {
    callbacks.length = 0;
    vi.unstubAllGlobals();
  });

  it('面板关着时渲染 → 量到 0 不设高；显示之后（ResizeObserver 派发）补上真高度', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    let h = 0;
    const frame = fakeFrame(() => h);

    fitFrameHeight(frame);
    expect(frame.style.height).toBe('');   // 量到 0：宁可保持默认，也不设成 0
    h = 300;
    fire();                                 // 一旦显示，布局从 0 变成真高度 → 回调派发
    expect(frame.style.height).toBe('300px');
  });

  it('内容后续长高要跟上（emoji / 字体在 load 之后落地）；差 1px 不动它（免得互相追着改）', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    let h = 300;
    const frame = fakeFrame(() => h);

    fitFrameHeight(frame);
    expect(frame.style.height).toBe('300px');
    h = 301;
    fire();
    expect(frame.style.height).toBe('300px');  // 1px 内不动：否则「量高 → 框变高 → 框内重排 → 再量」会绕圈
    h = 420;
    fire();
    expect(frame.style.height).toBe('420px');
  });

  it('没有 ResizeObserver 的老环境：不抛，退化成「只量一次」', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const frame = fakeFrame(() => 260);
    expect(() => fitFrameHeight(frame)).not.toThrow();
    expect(frame.style.height).toBe('260px');
  });
});
