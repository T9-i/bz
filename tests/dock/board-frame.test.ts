/**
 * 展示板外框的两条边界（2026-10-20）
 *
 * 展示板走的是 `boardSection()`，它没导出、要构造整个 DockToolView 才跑得到，
 * 所以这里按本仓的老办法——**读源码文本**守着，改拼法的人会被抓住：
 *
 * ① **高度有上限**：内容再多也只到 `BOARD_MAX_HEIGHT`，超了在框内滚。
 *    2026-10-15 曾经取消过上限（那时框内滚动会露出一根原生滚动条），
 *    后来框文档根元素挂了 `scrollbar-width:none`，滚动条不再出现，上限才改回来。
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
});
