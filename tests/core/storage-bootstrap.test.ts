/**
 * 数据目录初值守卫（ADR-0270 修订版：只改缺省值，不搬老库，也不认领老目录）。
 *
 * 守四条：
 *  1. 新库（没有 storagePath）→ 写 `<插件目录>/storage`，**哪怕盘上还留着老的 CONFIG/STORAGE**；
 *     凭目录名猜「这库想用老位置」只会让 CONFIG 在界面上继续出现。
 *  2. 老库（已有 storagePath，哪怕值正好是老的 `CONFIG/STORAGE`）→ **一个字都不动**；
 *     那是库里数据的实际位置，改它就是搬家。
 *  3. 这个函数**只写设置值，不建目录、不写文件** —— 目录由引导的写探针或首次落盘创建。
 *  4. 没有设置对象（极早期调用）就什么都不做。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockVault } from '../mock-vault';
import { setApp } from '../../src/core/app';
import { setPluginRelDir } from '../../src/core/plugin-path';
import { bootstrapStorageDir } from '../../src/core/storage';
import { DEFAULT_STORAGE_DIR } from '../../src/core/storage-path';

const PLUGIN_DIR = '.obsidian/plugins/bz-test';
const TARGET = `${PLUGIN_DIR}/storage`;
/** 老缺省的字面量：常量已经删除（不再有「认领」这条路），这里只在断言里当历史值用 */
const LEGACY = 'CONFIG/STORAGE';

function setupApp(vault: MockVault): void {
  setApp({ vault } as never);
  setPluginRelDir(PLUGIN_DIR);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('bootstrapStorageDir：新库落到 <插件目录>/storage', () => {
  it('没有任何值、盘上也什么都没有 → 写缺省目录', async () => {
    const vault = new MockVault();
    setupApp(vault);
    const settings: { storagePath?: string } = { storagePath: '' };
    expect(await bootstrapStorageDir({ vault } as never, settings)).toBe(true);
    expect(settings.storagePath).toBe(TARGET);
  });

  it('目标目录已存在（删过 data.json 的库）→ 照写同一个值', async () => {
    const vault = new MockVault();
    vault.dirs.add(TARGET);
    setupApp(vault);
    const settings: { storagePath?: string } = {};
    expect(await bootstrapStorageDir({ vault } as never, settings)).toBe(true);
    expect(settings.storagePath).toBe(TARGET);
  });

  it('没有插件目录可问 → 落到常量兜底', async () => {
    const vault = new MockVault();
    setApp({ vault } as never);
    setPluginRelDir(null);
    const settings: { storagePath?: string } = {};
    await bootstrapStorageDir({ vault } as never, settings);
    expect(settings.storagePath).toBe(DEFAULT_STORAGE_DIR);
  });

  it('只写设置值：不建目录、不写文件（建目录留给引导探针/首次落盘）', async () => {
    const vault = new MockVault();
    setupApp(vault);
    const before = { dirs: vault.dirs.size, files: vault.files.size };
    await bootstrapStorageDir({ vault } as never, { storagePath: '' });
    expect(vault.dirs.size).toBe(before.dirs);
    expect(vault.files.size).toBe(before.files);
  });
});

describe('bootstrapStorageDir：盘上留着老 CONFIG/STORAGE 也不认领', () => {
  it('老目录里有文件、但设置里没有值 → 仍写新缺省，不复制', async () => {
    const vault = new MockVault();
    vault.files.set(`${LEGACY}/memo.json`, '[]');
    vault.dirs.add(LEGACY);
    setupApp(vault);
    const settings: { storagePath?: string } = {};
    expect(await bootstrapStorageDir({ vault } as never, settings)).toBe(true);
    expect(settings.storagePath).toBe(TARGET);
    expect(vault.files.get(`${LEGACY}/memo.json`)).toBe('[]');
    expect(vault.dirs.has(TARGET)).toBe(false);
  });
});

describe('bootstrapStorageDir：已有值一律不动（老用户零影响）', () => {
  it('值正好是老缺省 CONFIG/STORAGE → false 且原值保留，不建新目录', async () => {
    const vault = new MockVault();
    vault.files.set(`${LEGACY}/memo.json`, '[]');
    vault.dirs.add(LEGACY);
    setupApp(vault);
    const settings: { storagePath?: string } = { storagePath: LEGACY };
    expect(await bootstrapStorageDir({ vault } as never, settings)).toBe(false);
    expect(settings.storagePath).toBe(LEGACY);
    expect(vault.dirs.has(TARGET)).toBe(false);
  });

  it('自定义目录 → false 且原值保留', async () => {
    const vault = new MockVault();
    setupApp(vault);
    const settings: { storagePath?: string } = { storagePath: '我的/数据' };
    expect(await bootstrapStorageDir({ vault } as never, settings)).toBe(false);
    expect(settings.storagePath).toBe('我的/数据');
  });

  it('已经是目标值 → false（不重复落盘）', async () => {
    const vault = new MockVault();
    setupApp(vault);
    expect(await bootstrapStorageDir({ vault } as never, { storagePath: TARGET })).toBe(false);
  });
});

describe('bootstrapStorageDir：没有设置对象（极早期调用）', () => {
  it('null → 直接返回 false，不抛', async () => {
    const vault = new MockVault();
    setupApp(vault);
    expect(await bootstrapStorageDir({ vault } as never, null)).toBe(false);
  });
});
