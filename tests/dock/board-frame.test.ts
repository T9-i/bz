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
 * ② **允许开外链**：`allow-popups` + `allow-popups-to-escape-sandbox`。
 *    少了第一个，`target=_blank` 被沙箱静默吃掉（点了没反应也不报错）；
 *    少了第二个，新标签页继承沙箱，目标站点的 JS 全废。
 *    注意这两条**不是** allow-scripts —— 框里依旧跑不了脚本。
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

  it('沙箱放开了外链，但没放开脚本', () => {
    const attr = /opts\.allowPopups\s*\?\s*'([^']+)'/.exec(src)?.[1] ?? '';
    expect(attr).toContain('allow-same-origin');
    expect(attr).toContain('allow-popups');
    expect(attr).toContain('allow-popups-to-escape-sandbox');
    expect(attr).not.toContain('allow-scripts');
    expect(attr).not.toContain('allow-top-navigation');
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
    // 只在展示板那一路挂；询问框不碰
    expect(src).toMatch(/if \(opts\.allowPopups\) wireExternalLinks\(frame\)/);
  });
});
