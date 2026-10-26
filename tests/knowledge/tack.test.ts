/**
 * 知识盒「挂到笔记」（tack）：把图版 / 影像里的媒体追加到目标笔记尾部。
 * 这组用例钉三件事——形态（quote callout 包裹、块前一个空行）、幂等（重挂不叠加、就地换块）、
 * 保真（CRLF 不被悄悄改行尾、目标笔记原有正文一个字不动）。
 */
import { describe, it, expect } from 'vitest';
import { mediaEmbedsOf, stripFrontmatter, tackBlock, tackLinkOf, upsertTackBlock } from '../../src/knowledge/tack';

const SRC_LINK = '[[王虹证明三维挂谷集维数为三并解释转针问题]]';
const MP4 = '![[CONFIG/APPENDIX/AI不会告诉你，王虹到底证明了什么_BV1Z6H56oEcQ_clip_00-01-49-00-03-56_crf23.mp4]]';
const TARGET = ['---', 'title: "挂谷集"', 'type: term', 'domain: 数学', 'related:', '---', '', '挂谷集是包含每个方向单位线段的集合。'].join('\n');

describe('mediaEmbedsOf（抽素材）', () => {
  it('取正文里的视频嵌入，frontmatter 里的不算', () => {
    const src = ['---', 'title: "x"', `cover: ${MP4}`, '---', '', `一根针转出的面积。${MP4}`].join('\n');
    expect(mediaEmbedsOf(src)).toEqual([MP4]);
  });

  it('图版多图按原顺序全取，尺寸别名原样保留', () => {
    const src = ['---', 'type: image', '---', '', '![[a.png]]', '![[b.jpg|400]]'].join('\n');
    expect(mediaEmbedsOf(src)).toEqual(['![[a.png]]', '![[b.jpg|400]]']);
  });

  it('同一张图重复出现只留一次', () => {
    const src = ['![[a.png]]', '正文', '![[a.png]]'].join('\n');
    expect(mediaEmbedsOf(src)).toEqual(['![[a.png]]']);
  });

  it('没有嵌入 → 空数组（调用方据此提示「没有可挂的」）', () => {
    expect(mediaEmbedsOf('一段纯文字。')).toEqual([]);
  });
});

describe('stripFrontmatter', () => {
  it('去掉首部 YAML 块，正文原样', () => {
    expect(stripFrontmatter(['---', 'a: 1', '---', '', '正文'].join('\n'))).toBe('\n正文');
  });
  it('没有 frontmatter 整串返回', () => {
    expect(stripFrontmatter('正文')).toBe('正文');
  });
  it('CRLF 文件的正文仍是 CRLF', () => {
    expect(stripFrontmatter('---\r\na: 1\r\n---\r\n\r\n正文')).toBe('\r\n正文');
  });
});

describe('tackLinkOf / tackBlock', () => {
  it('路径只取标题、去 .md，反斜杠归一（目录不进块头）', () => {
    expect(tackLinkOf('文献盒\\松果体.md')).toBe('[[松果体]]');
    expect(tackLinkOf('文献盒/子目录/松果体')).toBe('[[松果体]]');
    expect(tackLinkOf('松果体.md')).toBe('[[松果体]]');
    expect(tackLinkOf('')).toBe('');
  });

  it('块形态 = quote callout 头 + 每行带 > 前缀的嵌入', () => {
    expect(tackBlock(SRC_LINK, [MP4]).split('\n')).toEqual([`> [!quote] ${SRC_LINK}`, `> ${MP4}`]);
  });
});

describe('upsertTackBlock（追加 / 就地更新）', () => {
  it('首次挂载：追加到末尾，块前恰好一个空行', () => {
    const { text, action } = upsertTackBlock(TARGET, SRC_LINK, [MP4]);
    expect(action).toBe('added');
    expect(text).toBe(`${TARGET}\n\n> [!quote] ${SRC_LINK}\n> ${MP4}\n`);
  });

  it('目标笔记原有内容逐字不动（只有尾部多了块）', () => {
    const { text } = upsertTackBlock(TARGET, SRC_LINK, [MP4]);
    expect(text.startsWith(TARGET)).toBe(true);
    expect(text).toContain('related:\n---'); // frontmatter 里的空 related 键没被顺手补值
  });

  it('尾部原本有多个空行：收成一个，不留空档', () => {
    const { text } = upsertTackBlock(`${TARGET}\n\n\n\n`, SRC_LINK, [MP4]);
    expect(text).toBe(`${TARGET}\n\n> [!quote] ${SRC_LINK}\n> ${MP4}\n`);
  });

  it('重复挂同一篇：不叠加，就地换成最新嵌入', () => {
    const once = upsertTackBlock(TARGET, SRC_LINK, [MP4]).text;
    const twice = upsertTackBlock(once, SRC_LINK, ['![[新版.mp4]]']);
    expect(twice.action).toBe('updated');
    expect(twice.text.match(/\[!quote\]/g)).toHaveLength(1);
    expect(twice.text).toContain('![[新版.mp4]]');
    expect(twice.text).not.toContain(MP4);
  });

  it('同一篇笔记挂两条材料：两块各占一段，互不吞并', () => {
    const a = upsertTackBlock(TARGET, SRC_LINK, [MP4]).text;
    const b = upsertTackBlock(a, '[[文献盒/另一条]]', ['![[b.png]]']).text;
    expect(b.match(/\[!quote\]/g)).toHaveLength(2);
    // 再更新第一块，第二块必须还在
    const c = upsertTackBlock(b, SRC_LINK, ['![[换过.mp4]]']).text;
    expect(c).toContain('[[文献盒/另一条]]');
    expect(c).toContain('![[b.png]]');
    expect(c.match(/\[!quote\]/g)).toHaveLength(2);
  });

  it('两块之间没有空行（用户手动贴一起）：更新前一块也不吞后一块', () => {
    const two = [
      TARGET,
      '',
      `> [!quote] ${SRC_LINK}`,
      `> ${MP4}`,
      `> [!quote] [[文献盒/另一条]]`,
      `> ![[b.png]]`,
      '',
    ].join('\n');
    const out = upsertTackBlock(two, SRC_LINK, ['![[换过.mp4]]']).text;
    expect(out.match(/\[!quote\]/g)).toHaveLength(2);
    expect(out).toContain('[[文献盒/另一条]]');
    expect(out).toContain('![[b.png]]');
    expect(out).toContain('![[换过.mp4]]');
  });

  it('用户给重名消歧补了目录（块头写成全路径）：再挂仍认得出是同一块，不新增', () => {
    const withPath = `${TARGET}\n\n> [!quote] [[文献盒/王虹证明三维挂谷集维数为三并解释转针问题]]\n> ${MP4}\n`;
    const out = upsertTackBlock(withPath, SRC_LINK, ['![[换过.mp4]]']);
    expect(out.action).toBe('updated');
    expect(out.text.match(/\[!quote\]/g)).toHaveLength(1);
    expect(out.text).toContain('![[换过.mp4]]');
  });

  it('别人的 callout 不是锚点：同标题但类型不是 quote 的块不被覆盖', () => {
    const foreign = `${TARGET}\n\n> [!note] ${SRC_LINK}\n> 人写的注解。\n`;
    const out = upsertTackBlock(foreign, SRC_LINK, [MP4]);
    expect(out.action).toBe('added');
    expect(out.text).toContain('> 人写的注解。');
  });

  it('正文以 --- 分割线开头：不当成 frontmatter 剥掉', () => {
    const src = ['---', '', '![[a.png]]', '', '---', '', '后面'].join('\n');
    expect(stripFrontmatter(src)).toBe(src);
  });

  it('用户手删了块 = 取下；重挂照常追加回来', () => {
    const once = upsertTackBlock(TARGET, SRC_LINK, [MP4]).text;
    const removed = once.replace(/> \[!quote\][\s\S]*$/, '').trimEnd();
    const again = upsertTackBlock(removed, SRC_LINK, [MP4]);
    expect(again.action).toBe('added');
    expect(again.text).toBe(`${TARGET}\n\n> [!quote] ${SRC_LINK}\n> ${MP4}\n`);
  });

  it('CRLF 目标文件：追加后仍是 CRLF，不混行尾', () => {
    const crlf = TARGET.replace(/\n/g, '\r\n');
    const { text } = upsertTackBlock(crlf, SRC_LINK, [MP4]);
    expect(text).not.toMatch(/[^\r]\n/);
    expect(text.endsWith(`\r\n> ${MP4}\r\n`)).toBe(true);
  });

  it('空笔记：块直接落地，不前置空行', () => {
    expect(upsertTackBlock('', SRC_LINK, [MP4]).text).toBe(`> [!quote] ${SRC_LINK}\n> ${MP4}\n`);
  });

  it('内容相同的重跑：文本逐字一致（调用方据此跳过写盘）', () => {
    const once = upsertTackBlock(TARGET, SRC_LINK, [MP4]).text;
    const twice = upsertTackBlock(once, SRC_LINK, [MP4]).text;
    expect(twice).toBe(once);
  });
});
