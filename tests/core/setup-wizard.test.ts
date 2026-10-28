/**
 * core/setup-wizard 的任务编排：勾选清单 → 补齐队列。
 * 这里只测纯函数（buildSetupTasks / sizeText）——DOM 与真实下载不在单测里跑，
 * 但「下哪些、按什么顺序下、体积怎么算」是这里的责任，也最容易写错。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildSetupTasks,
  defaultSelection,
  resourceDocsOf,
  selectedTasks,
  setupAlreadyDone,
  setupDoneStorageKey,
  sizeText,
  splitProbeRows,
} from '../../src/core/setup-wizard';
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


describe('检测屏的分段：工具只出现一次（2026-10-28 截图里的重复）', () => {
  const rows = [
    { id: 'runtime', key: '运行环境' },
    { id: 'node', key: 'Node 运行时' },
    { id: 'tool-B站下载器', key: 'B站下载器' },
    { id: 'tool-工具坞值守', key: '工具坞值守' },
    { id: 'tool-脸谱工具包', key: '脸谱工具包' },
    { id: 'python', key: 'Python 环境' },
    { id: 'ai', key: 'AI 服务' },
  ];

  it('三个工具进「外部工具」段，环境行里不再出现它们', () => {
    const { env, tools } = splitProbeRows(rows);
    expect(tools.map((r) => r.key)).toEqual(['B站下载器', '工具坞值守', '脸谱工具包']);
    expect(env.map((r) => r.key)).toEqual(['运行环境', 'Node 运行时', 'Python 环境', 'AI 服务']);
  });

  it('两段互斥：没有任何一行同时出现在两边', () => {
    const { env, tools } = splitProbeRows(rows);
    const set = new Set(tools.map((r) => r.key));
    expect(env.some((r) => set.has(r.key))).toBe(false);
    expect(env.length + tools.length).toBe(rows.length);
  });

  it('「在线资源」段排除目录包：工具不会在下面再列一遍', () => {
    const docs = [
      { id: 'changelog', name: '更新日志' },
      { id: 'tool-dock-watch', name: '工具坞值守', kind: 'bundle' },
      { id: 'manual', name: '使用手册' },
    ];
    expect(resourceDocsOf({ docs }).map((d) => d.id)).toEqual(['changelog', 'manual']);
  });
});

/**
 * 引导是否已走过：**必须按库分开**。
 *
 * localStorage 是 Obsidian 整个应用共用的，用一把全局键会让「在 A 库走完引导」变成
 * 「新开的 B 库也算走过」——2026-10-28 用户报障：换个新库打开插件，Node、工具包、文档
 * 一概没有，却一次引导都不弹。
 */
describe('引导已走过：按库分键', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('设置里 setupDone=true → 走过（与库无关，data.json 本来就是按库的）', () => {
    expect(setupAlreadyDone({ setupDone: true }, 'E:/vault-a')).toBe(true);
  });

  it('localStorage 兜底按库分键：A 库走过不影响 B 库', () => {
    localStorage.setItem(setupDoneStorageKey('E:/vault-a'), '1');
    expect(setupAlreadyDone(null, 'E:/vault-a')).toBe(true);
    expect(setupAlreadyDone(null, 'E:/vault-b')).toBe(false);
  });

  it('路径形态不同但指向同一个库 → 视为同一个库（反斜杠/尾斜杠归一）', () => {
    localStorage.setItem(setupDoneStorageKey('E:\\vault-a\\'), '1');
    expect(setupAlreadyDone(null, 'E:/vault-a')).toBe(true);
  });

  it('取不到 vault 路径 → 退回全局那把键（不因此崩，也不误判成「走过」）', () => {
    expect(setupDoneStorageKey('')).toBe('bz-setup-done');
    expect(setupAlreadyDone(null, '')).toBe(false);
    localStorage.setItem('bz-setup-done', '1');
    expect(setupAlreadyDone(null, '')).toBe(true);
  });
});

/**
 * 手改 `"setupDone": false` 必须能复位引导（2026-10-28 用户报障）。
 *
 * 兜底键只在「设置压根写不进去」时才有资格说话：关过引导的人，localStorage 里已经有一把
 * `1`，若还让兜底参与判定，改 data.json 就永远看不到引导 —— 而手改 data.json 是用户最直接
 * 的复位手段。第三个参数 = data.json 里是否真有这个键（main.ts 从 loadData 的原始对象判断）。
 */
describe('引导已走过：设置优先，兜底只兜「设置写不进去」', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('data.json 里明确 false + 兜底键还在 → 仍算没走过（复位生效）', () => {
    localStorage.setItem(setupDoneStorageKey('E:/vault-a'), '1');
    expect(setupAlreadyDone({ setupDone: false }, 'E:/vault-a', true)).toBe(false);
  });

  it('data.json 里明确 true → 走过（哪怕兜底键被清掉）', () => {
    expect(setupAlreadyDone({ setupDone: true }, 'E:/vault-a', true)).toBe(true);
  });

  it('data.json 里没这个键（只读库/首次）→ 才吃兜底键', () => {
    localStorage.setItem(setupDoneStorageKey('E:/vault-a'), '1');
    expect(setupAlreadyDone({ setupDone: false }, 'E:/vault-a', false)).toBe(true);
  });
});
