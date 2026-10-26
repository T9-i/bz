/**
 * 知识盒 frontmatter 行级手术（2026-10-26 列表右键菜单的写入层）：
 * 只动命中的那几行，其余键 / 正文 / 换行符零扰动——这是「不改用户手写格式」的底线，
 * 也是这组用例要钉死的东西（一旦改成整体 YAML 重序列化，注释、键序、缩进都会跑掉）。
 */
import { describe, it, expect } from 'vitest';
import { setFrontmatterKeys } from '../../src/knowledge/note-edit';

const FM = ['---', 'title: "松果体"', 'type: term', 'domain: "生理"', 'date: "2026-08-01 10:00:00"', '---', '', '正文一。'].join('\n');

describe('setFrontmatterKeys（知识盒 frontmatter 行级手术）', () => {
  it('替换已有键：只换那一行，其余行与正文逐字不动', () => {
    const out = setFrontmatterKeys(FM, [{ key: 'domain', value: '神经科学' }]);
    expect(out).toBe(FM.replace('domain: "生理"', 'domain: "神经科学"'));
    expect(out).toContain('type: term'); // 无引号的键形态原样保留
    expect(out).toContain('date: "2026-08-01 10:00:00"');
  });

  it('新增键：插到 frontmatter 末尾（关闭 --- 之前），正文一行不动', () => {
    const out = setFrontmatterKeys(FM, [{ key: 'source', value: 'https://example.com/a' }]);
    const lines = out.split('\n');
    expect(lines[lines.length - 4]).toBe('source: "https://example.com/a"');
    expect(lines.slice(lines.length - 3)).toEqual(['---', '', '正文一。']);
  });

  it('同一批新增多个键：按 edits 顺序相邻插入（source 在前、sourceTitle 在后）', () => {
    const out = setFrontmatterKeys(FM, [
      { key: 'source', value: 'https://example.com/a' },
      { key: 'sourceTitle', value: '一篇外链' },
    ]);
    const lines = out.split('\n');
    expect(lines.slice(-5)).toEqual([
      'source: "https://example.com/a"',
      'sourceTitle: "一篇外链"',
      '---',
      '',
      '正文一。',
    ]);
  });

  it('删除键：该行整行消失，sourceTitle 一并摘掉，其余零扰动', () => {
    const withSrc = FM.replace('domain: "生理"\n', 'domain: "生理"\nsource: "https://a.com"\nsourceTitle: "外链"\n');
    const out = setFrontmatterKeys(withSrc, [
      { key: 'source', value: null },
      { key: 'sourceTitle', value: null },
    ]);
    expect(out).not.toContain('source:');
    expect(out).not.toContain('sourceTitle:');
    expect(out).toContain('domain: "生理"');
    expect(out).toContain('正文一。');
  });

  it('删除不存在的键 = 无操作（输出与输入逐字节相同）', () => {
    expect(setFrontmatterKeys(FM, [{ key: 'source', value: null }])).toBe(FM);
  });

  it('无 frontmatter 且要新增：前置造一个只含该键的块', () => {
    const out = setFrontmatterKeys('正文一。\n\n正文二。', [{ key: 'domain', value: '物理' }]);
    expect(out).toBe('---\ndomain: "物理"\n---\n\n正文一。\n\n正文二。');
  });

  it('无 frontmatter 且全是删键：原样返回（不硬造空 frontmatter）', () => {
    const src = '正文一。';
    expect(setFrontmatterKeys(src, [{ key: 'domain', value: null }])).toBe(src);
  });

  it('CRLF 文件：换行符保真（不悄悄改成 LF，也不产出混排）', () => {
    const crlf = FM.replace(/\n/g, '\r\n');
    const out = setFrontmatterKeys(crlf, [{ key: 'domain', value: '神经科学' }]);
    expect(out).toBe(crlf.replace('domain: "生理"', 'domain: "神经科学"'));
    expect(out).not.toMatch(/[^\r]\n/); // 每个 \n 前都必须有 \r
  });

  it('同一键有多行（用户手抖重复）：只动第一行，后面的原样留着', () => {
    const dup = FM.replace('domain: "生理"\n', 'domain: "生理"\ndomain: "旧的"\n');
    const out = setFrontmatterKeys(dup, [{ key: 'domain', value: '新' }]);
    expect(out).toContain('domain: "新"');
    expect(out).toContain('domain: "旧的"');
  });

  it('值里的引号与反斜杠按 quoteYaml 转义（不会把 frontmatter 撑破）', () => {
    const out = setFrontmatterKeys(FM, [{ key: 'sourceTitle', value: '他说"你好"\\o/' }]);
    expect(out).toContain('sourceTitle: "他说\\"你好\\"\\\\o/"');
    const lines = out.split('\n');
    expect(lines.filter((l) => l.startsWith('sourceTitle:')).length).toBe(1);
  });

  it('幂等：同样的改动跑第二次，输出不变', () => {
    const once = setFrontmatterKeys(FM, [{ key: 'domain', value: '神经科学' }]);
    expect(setFrontmatterKeys(once, [{ key: 'domain', value: '神经科学' }])).toBe(once);
  });

  it('空 edits：原样返回（连解析都不做）', () => {
    expect(setFrontmatterKeys(FM, [])).toBe(FM);
  });
});
