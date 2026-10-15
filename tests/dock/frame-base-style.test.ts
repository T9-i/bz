// @vitest-environment jsdom
/**
 * 沙箱框基线的转义守卫（2026-10-15）
 *
 * 背景：`frameBaseStyle()` 把主题变量拼进 `style="…"` 灌给 iframe 内容（展示板 ADR-0243、
 * 询问框正文 ADR-0244）。而主题变量里有一个**带引号**的值：
 *
 *   --bz-font-ui: -apple-system, "Segoe UI", system-ui, "PingFang SC", …
 *
 * 原样拼进去，HTML 属性在第一个 `"` 处提前收尾 —— 后面的声明（`--bz-font-mono`、`--bz-space-*`
 * 与整条基线）全变成杂属性丢掉，框里退回 8px 边距 + Times + 16px。
 * 界面不报错、也不缺内容，只是「变丑了一点」—— 这类缺陷只能靠断言钉住。
 *
 * 所以这份测试两段：① 值确实被转义；② 转义之后**后面的声明还在**（不转义就是在这里红的）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { escapeStyleAttr, frameBaseStyle } from '../../src/dock/ui';

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

  it('框里也隐藏滚动条（ADR-0122 同款）：只隐藏条，不动 overflow', () => {
    const css = frameBaseStyle();
    expect(css).toMatch(/scrollbar-width:\s*none/);
    // 铁律那条 ADR-0122 只做一半：隐藏条、保留滚动 —— 基线里不许出现 overflow
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
