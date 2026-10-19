// @vitest-environment jsdom
/**
 * 询问框正文的结构守卫（2026-10-15）
 *
 * 两件事钉住，都是「用户看得见、但测试不写就没人守」的：
 *
 * ① **滚动归属**：正文区 `.bz-dock-ask-pane` 是滚动容器，沙箱框**不自滚**。
 *    框自滚会在框里长出一条原生滚动条（Windows 上还带箭头）—— 样式管不着、也不跟主题，
 *    用户 2026-10-15 报的「确认弹窗和展示窗口都不显示滚动条」就是它。
 *    所以：框的高度由内容决定（ui.ts 的 fitFrameHeight 不封顶）、正文区有 overflow-y: auto。
 *    这里断言结构（换层/换类名会被抓住），滚动行为由 styles.css 的注释与用例描述钉住。
 *
 * ② **框里没有 JavaScript**：`sandbox="allow-same-origin"` 但**不带** `allow-scripts`。
 *    这条是 ADR-0243/0244 的安全边界，改 srdoc 拼法的人最容易顺手把它弄丢。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { askBody } from '../../src/dock/ui';
import type { BzAskRequest } from '../../src/core/external-tool';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const req = (over: Partial<BzAskRequest> = {}): BzAskRequest => ({
  id: 'apply',
  title: '把分类写进 Steam',
  body: '',
  bodyHtml: '',
  confirmText: '写入 Steam',
  cancelText: '取消',
  timeoutSec: 300,
  ...over,
});

describe('询问框正文：HTML 那一路', () => {
  it('HTML 进沙箱框，正文区带 is-framed（描边/底色在正文区上，不在框上）', () => {
    const { el, framed } = askBody(req({ bodyHtml: '<p>四款</p>' }));
    expect(framed).toBe(true);
    const pane = el.querySelector('.bz-dock-ask-pane');
    expect(pane?.classList.contains('is-framed')).toBe(true);
    const frame = pane?.querySelector('iframe');
    expect(frame).toBeTruthy();
    // 框在正文区里 —— 框跟着内容长，外边那层才是滚动容器
    expect(el.firstElementChild).toBe(pane);
  });

  it('沙箱带 allow-same-origin（要量高度），**不带** allow-scripts', () => {
    const { el } = askBody(req({ bodyHtml: '<p>x</p>' }));
    const frame = el.querySelector('iframe') as HTMLIFrameElement;
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-scripts');
    expect(frame.getAttribute('title')).toBe('把分类写进 Steam'); // 读屏要一个名字
    expect(frame.getAttribute('srcdoc') ?? '').toContain('<p>x</p>');
    // 框文档的**根元素**带「隐藏滚动条」那条 —— core 的界面级规则跨不过文档边界（ADR-0122 够不着框里）
    expect(frame.getAttribute('srcdoc') ?? '').toMatch(/<html style="[^"]*scrollbar-width:none/);
  });

  it('超字节上限：退回纯文本（框不出现、正文区也不加皮），并把原因写在框里', () => {
    const { el, framed } = askBody(req({
      bodyHtml: `<p>${'x'.repeat(128 * 1024)}</p>`,
      body: '纯文本兜底',
    }));
    expect(framed).toBe(false);
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.querySelector('.bz-dock-ask-pane')?.classList.contains('is-framed')).toBe(false);
    expect(el.textContent).toContain('就不按 HTML 渲染了');
    expect(el.textContent).toContain('纯文本兜底');
  });
});

describe('询问框正文：纯文本那一路', () => {
  it('按 \\n 分段、段落进正文区、不当 HTML（尖括号原样是文本）', () => {
    const { el, framed } = askBody(req({ body: '写 4 款\n会关掉 Steam\n<img src=x onerror=alert(1)>' }));
    expect(framed).toBe(false);
    const pane = el.querySelector('.bz-dock-ask-pane');
    expect(pane?.classList.contains('is-framed')).toBe(false); // 纯文本不该被框起来
    expect(pane?.querySelectorAll('.bz-dock-ask-p')).toHaveLength(3);
    expect(pane?.innerHTML).not.toContain('<img');
    expect(pane?.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('什么都没给：明说「工具没说要做什么」，不摆一个空框', () => {
    const { el } = askBody(req());
    expect(el.textContent).toContain('（工具没说要做什么）');
  });
});

describe('两个框都不自滚（滚动交回宿主）', () => {
  it('询问框仍然没有写死上限；展示板的上限只挂在框元素上，fitFrameHeight 不做封顶', () => {
    const src = readFileSync(path.join(ROOT, 'src/dock/ui.ts'), 'utf8');
    // 2026-10-15 取消过两个上限常量：展示板 520px / 询问框正文 360px。
    // 2026-10-20 展示板那边又加回来了（BOARD_MAX_HEIGHT，走 frame.style.maxHeight）——
    // 因为框文档根元素已经隐藏滚动条，框内滚动不再露原生滚动条；
    // 询问框**没有**这个理由，它的上限仍然不许回来。
    expect(src).not.toMatch(/ASK_HTML_MAX_HEIGHT/);
    // 上限不许进 fitFrameHeight：那里封顶就等于把询问框也一起封了
    const at = src.indexOf('function fitFrameHeight');
    expect(at, '找不到 fitFrameHeight').toBeGreaterThan(0);
    const fn = src.slice(at, at + 900);
    expect(fn).toMatch(/\.style\.height\s*=/);
    expect(fn).not.toMatch(/Math\.min/);
  });
});
