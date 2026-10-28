/**
 * core/setup-wizard 的任务编排：勾选清单 → 补齐队列。
 * 这里只测纯函数（buildSetupTasks / sizeText）——DOM 与真实下载不在单测里跑，
 * 但「下哪些、按什么顺序下、体积怎么算」是这里的责任，也最容易写错。
 */
import { describe, it, expect } from 'vitest';
import { buildSetupTasks, defaultSelection, selectedTasks, sizeText } from '../../src/core/setup-wizard';
import type { DownloadManifest } from '../../src/core/download-manifest';

const manifest: DownloadManifest = {
  version: 1,
  docs: [
    { id: 'changelog', name: '更新日志', file: 'bz-changelog.html', sha256: 'a'.repeat(64), size: 1000 },
    { id: 'tool-bili-downloader', name: 'B站下载器', file: 'tools/bili-downloader.tar.gz', sha256: 'b'.repeat(64), kind: 'bundle', size: 26 * 1024 },
    { id: 'tool-dock-watch', name: '工具坞值守', file: 'tools/dock-watch.tar.gz', sha256: 'c'.repeat(64), kind: 'bundle', size: 46 * 1024 },
    { id: 'cinema-douban-index', name: '豆瓣影视索引', file: 'cinema-douban-index.json', sha256: 'd'.repeat(64), size: 7 * 1024 * 1024 },
  ],
  skins: [
    { id: 'noir', domain: 'memo', name: '墨', file: 'skins/memo/noir.css', sha256: 'e'.repeat(64), size: 2000 },
    { id: 'mono', domain: 'memo', name: '素', file: 'skins/memo/mono.css', sha256: 'f'.repeat(64), size: 3000 },
  ],
};

describe('首次准备：补齐队列', () => {
  it('Node 排第一（36MB 最久，先让小包在它之后秒完）', () => {
    const tasks = buildSetupTasks({}, manifest, { nodeMissing: true });
    expect(tasks[0].id).toBe('node');
    expect(tasks[0].size).toBeGreaterThan(30 * 1024 * 1024);
  });

  it('已有 Node → 不排 Node 任务', () => {
    const tasks = buildSetupTasks({}, manifest, { nodeMissing: false });
    expect(tasks.some((t) => t.id === 'node')).toBe(false);
  });

  it('目录包先于文档（工具是「能不能用」，文档是「查得到」）', () => {
    const ids = buildSetupTasks({}, manifest, { nodeMissing: false }).map((t) => t.id);
    expect(ids.indexOf('tool-bili-downloader')).toBeLessThan(ids.indexOf('changelog'));
    expect(ids.indexOf('tool-dock-watch')).toBeLessThan(ids.indexOf('cinema-douban-index'));
  });

  it('在线资源全部进队列（文档 + 索引 + 皮肤都在，不留「选择性漏下」）', () => {
    const ids = buildSetupTasks({}, manifest, { nodeMissing: false }).map((t) => t.id);
    expect(ids).toContain('changelog');
    expect(ids).toContain('cinema-douban-index');
    expect(ids).toContain('skins');
  });

  it('皮肤合并成一项，体积是各套之和', () => {
    const skin = buildSetupTasks({}, manifest, { nodeMissing: false }).find((t) => t.id === 'skins')!;
    expect(skin.size).toBe(5000);
    expect(skin.desc).toContain('2 套');
  });

  it('清单拉不到 → 只剩 Node 任务（不静默当成「没有要下的」）', () => {
    const tasks = buildSetupTasks({}, null, { nodeMissing: true });
    expect(tasks.map((t) => t.id)).toEqual(['node']);
  });

  it('清单拉不到且已有 Node → 空队列（界面据此说「什么都不缺」）', () => {
    expect(buildSetupTasks({}, null, { nodeMissing: false })).toEqual([]);
  });
});

describe('体积文案', () => {
  it('MB / KB 分档，0 与空值不显示', () => {
    expect(sizeText(36.4 * 1024 * 1024)).toBe('36 MB'); // ≥10MB 取整，别摆小数
    expect(sizeText(26 * 1024)).toBe('26 KB');
    expect(sizeText(0)).toBe('');
    expect(sizeText(null)).toBe('');
  });
});

describe('按需下载：大索引不占首装', () => {
  it('豆瓣索引标成按需项（列出来，但默认不勾）', () => {
    const item = buildSetupTasks({}, manifest, { nodeMissing: false }).find((t) => t.id === 'cinema-douban-index')!;
    expect(item.optional).toBe(true);
    expect(item.desc).toContain('按需');
    // 其它文档不是按需项：该下的还是要下
    expect(buildSetupTasks({}, manifest, { nodeMissing: false }).find((t) => t.id === 'changelog')!.optional).toBeUndefined();
  });

  it('defaultSelection 跳过按需项与皮肤，其余都勾上', () => {
    const items = buildSetupTasks({}, manifest, { nodeMissing: true }).map((t) => ({ ...t, ready: false }));
    const selected = defaultSelection(items);
    expect(selected.has('cinema-douban-index')).toBe(false);
    expect(selected.has('skins')).toBe(false);
    expect(selected.has('changelog')).toBe(true);
    expect(selected.has('tool-dock-watch')).toBe(true);
  });

  it('用户自己勾上按需项 → 照样下（不拦）', () => {
    const items = buildSetupTasks({}, manifest, { nodeMissing: false }).map((t) => ({ ...t, ready: false }));
    const selected = new Set(['cinema-douban-index']);
    expect(selectedTasks(items, selected).map((t) => t.id)).toEqual(['cinema-douban-index']);
  });
});
