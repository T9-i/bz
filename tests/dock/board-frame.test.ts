/**
 * 展示板外框的两条边界（2026-10-20）
 *
 * 展示板走的是 `boardSection()`，它没导出、要构造整个 DockToolView 才跑得到，
 * 所以这里按本仓的老办法——**读源码文本**守着，改拼法的人会被抓住：
 *
 * ① **高度有上限**：内容再多也只到 `BOARD_MAX_HEIGHT`，超了在框内滚。
 *    2026-10-15 曾经取消过上限（那时框内滚动会露出一根原生滚动条），
 *    现在上限回来了，条件是**条必须在框文档里藏掉**（`FRAME_SCROLLBAR_CSS`）——
 *    两次抱怨其实是同一个病根：条没藏住。
 *
 * ② **允许开外链、允许跑脚本**：`allow-popups` + `allow-popups-to-escape-sandbox`。
 *    少了第一个，`target=_blank` 被沙箱静默吃掉（点了没反应也不报错）；
 *    少了第二个，新标签页继承沙箱，目标站点的 JS 全废。
 *    `allow-scripts` 2026-10-22 起也给了（ADR-0249：展示板要画搜索框这类交互），
 *    但**只给展示板**；询问框不跟着开，也始终不给 `allow-top-navigation`。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(path.join(ROOT, 'src/dock/ui.ts'), 'utf8');

describe('展示板外框', () => {
  it('高度上限存在，且 boardSection 真的把它用上了', () => {
    expect(src).toMatch(/const BOARD_MAX_HEIGHT = \d+;/);
    const at = src.indexOf("sandboxFrame(html, 'bz-dock-board-frame'");
    expect(at).toBeGreaterThan(-1);
    const call = src.slice(at, at + 320); // 不按右括号切：模板串里先出现 `)` 的是 ${displayName(v)}
    expect(call).toContain('maxHeight: BOARD_MAX_HEIGHT');
    expect(call).toContain('allowPopups: true');
  });

  it('沙箱放开了外链与脚本，但不许顶掉面板', () => {
    // 2026-10-22 起展示板允许跑脚本（ADR-0249：工具要画搜索框这类交互）。
    // 仍然不给 allow-top-navigation —— 框能跑代码，但顶不掉整个面板。
    expect(src).toContain("const sandbox = ['allow-same-origin']");
    expect(src).toMatch(/if \(opts\.allowPopups\) sandbox\.push\('allow-popups', 'allow-popups-to-escape-sandbox'\)/);
    expect(src).toMatch(/if \(opts\.allowScripts\) sandbox\.push\('allow-scripts'\)/);
    // 断言只看**拼 flag 的那一段**（注释里为了解释「不给」会写到这个词）
    const flagsAt = src.indexOf("const sandbox = ['allow-same-origin']");
    expect(src.slice(flagsAt, flagsAt + 320)).not.toContain('allow-top-navigation');
    // 展示板那一路真的开了脚本；询问框不跟着开（那一屏只问一句话）
    const at = src.indexOf("sandboxFrame(html, 'bz-dock-board-frame'");
    expect(src.slice(at, at + 520)).toContain('allowScripts: true');
    expect(src).toContain("sandboxFrame(html, 'bz-dock-ask-frame', req.title)");
  });

  it('上限挂在 frame 元素上（inline height 压得住，max-height 也压得住）', () => {
    expect(src).toMatch(/frame\.style\.maxHeight\s*=\s*`\$\{opts\.maxHeight\}px`/);
  });

  // 滚动条不藏在宿主这一层：框自己滚，条由框文档里的 FRAME_SCROLLBAR_CSS 藏掉。
  // 那份注入的边界由 tests/core/skin-pack-split-guard.test.ts 掐死（只准滚动条声明）。
  it('框文档里带了隐藏滚动条的样式（老 Electron 不认 scrollbar-width，靠 ::-webkit-scrollbar 兜底）', () => {
    expect(src).toMatch(/FRAME_SCROLLBAR_CSS[\s\S]{0,300}::-webkit-scrollbar/);
    expect(src).toMatch(/srcdoc\s*=[\s\S]{0,200}\$\{FRAME_SCROLLBAR_CSS\}/);
  });

  it('外链由外面接管（openExternal），不只指望沙箱的 allow-popups', () => {
    expect(src).toMatch(/function wireExternalLinks/);
    expect(src).toContain("closest('a[href]')");
    expect(src).toContain('openExternal');
    // 只在展示板那一路挂；询问框不碰（询问框调 sandboxFrame 时不传 allowPopups / onAct）
    expect(src).toMatch(/if \(opts\.allowPopups \|\| opts\.onAct\) wireExternalLinks\(frame, opts\.onAct\)/);
    expect(src).toMatch(/sandboxFrame\(html, 'bz-dock-ask-frame', req\.title\)/);
  });

  // ADR-0247：动作回传同样挂在宿主这一层。框里没有 allow-scripts，`<button onclick>`
  // 一律不执行；导航类（obsidian:// 等）在没给 allow-top-navigation 的框里被 Chromium 吞掉
  // （2026-10-20 实测点了毫无反应）。所以「点一条链接触发一次运行」只能由这条监听接。
  it('展示板动作走宿主挂的 click 监听，且 boardSection 真的把 onAct 传下去了', () => {
    expect(src).toMatch(/const act = onAct \? parseActHref\(href\) : null/);
    const at = src.indexOf("sandboxFrame(html, 'bz-dock-board-frame'");
    const call = src.slice(at, at + 420);
    expect(call).toContain('onAct:');
    // 声明里没有 actions 就不拦 —— 免得造出「点了没反应」
    expect(src).toContain('v.manifest?.actions ? (ref) => void runBoardAction(v, ref) : undefined');
  });
});
