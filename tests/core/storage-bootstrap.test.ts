/**
 * 数据目录落位守卫（ADR-0270 及当天修订）。
 *
 * 守的是这条链：`storagePath` 现在是**启动时写一次显式值**，而 vault 根的老 `CONFIG/STORAGE`
 * 不再是任何场合的缺省值。三件容易回潮的事：
 *  1. 「值正好是老缺省」要被当成**没设过** —— 那个值是插件早期自己写进 data.json 的默认值，
 *     不是用户选的；不改它，用户永远搬不出来（v1.34.0 的实盘症状）。
 *  2. 搬的时候是**复制**不是搬运，而且复制完**不删原目录** —— 那里面可能是这个库的全部数据。
 *  3. 复制一个文件都没成功时**不许改路径** —— 把存储路径指向一个空目录比留在旧路径更糟。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockVault } from '../mock-vault';
import { setApp } from '../../src/core/app';
import { setPluginRelDir } from '../../src/core/plugin-path';
import { bootstrapStorageDir } from '../../src/core/storage';
import { LEGACY_STORAGE_DIR } from '../../src/core/storage-path';

const PLUGIN_DIR = '.obsidian/plugins/bz-test';

/** 复制走的是 adapter 的二进制读写（writeBinary 落 binaryFiles），断言时按二进制读回来比 */
async function readText(vault: MockVault, path: string): Promise<string | undefined> {
  if (!vault.binaryFiles.has(path)) return undefined;
  return new TextDecoder().decode(await vault.adapter.readBinary(path));
}
const TARGET = `${PLUGIN_DIR}/storage`;

function setupApp(vault: MockVault): void {
  setApp({ vault } as never);
  setPluginRelDir(PLUGIN_DIR);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('bootstrapStorageDir：新库直接落到插件目录', () => {
  it('没有任何值、盘上也什么都没有 → 写 <插件目录>/storage', async () => {
    const vault = new MockVault();
    setupApp(vault);
    const settings: { storagePath?: string } = { storagePath: '' };
    expect(await bootstrapStorageDir({ vault } as never, settings)).toBe(true);
    expect(settings.storagePath).toBe(TARGET);
  });

  it('目标目录已存在（删过 data.json 的库）→ 认它，不另建', async () => {
    const vault = new MockVault();
    vault.dirs.add(TARGET);
    setupApp(vault);
    const settings: { storagePath?: string } = {};
    expect(await bootstrapStorageDir({ vault } as never, settings)).toBe(true);
    expect(settings.storagePath).toBe(TARGET);
  });
});

describe('bootstrapStorageDir：老缺省值 = 没设过（迁移）', () => {
  it('盘上有老目录 → 复制全部文件到新目录、改设置、原目录保留', async () => {
    const vault = new MockVault();
    vault.files.set(`${LEGACY_STORAGE_DIR}/memo.json`, '[]');
    vault.files.set(`${LEGACY_STORAGE_DIR}/sub/quiz.json`, '{}');
    vault.dirs.add(LEGACY_STORAGE_DIR);
    setupApp(vault);
    const settings: { storagePath?: string } = { storagePath: LEGACY_STORAGE_DIR };
    expect(await bootstrapStorageDir({ vault } as never, settings)).toBe(true);
    expect(settings.storagePath).toBe(TARGET);
    expect(await readText(vault, `${TARGET}/memo.json`)).toBe('[]');
    expect(await readText(vault, `${TARGET}/sub/quiz.json`)).toBe('{}');
    // 原目录不动：复制不是搬运
    expect(vault.files.get(`${LEGACY_STORAGE_DIR}/memo.json`)).toBe('[]');
  });

  it('老值但盘上没有老目录 → 直接改设置，不报错', async () => {
    const vault = new MockVault();
    setupApp(vault);
    const settings: { storagePath?: string } = { storagePath: `${LEGACY_STORAGE_DIR}/` };
    expect(await bootstrapStorageDir({ vault } as never, settings)).toBe(true);
    expect(settings.storagePath).toBe(TARGET);
  });

  it('老目录存不下任何文件（adapter 无读写能力）→ 不改路径，留在原处', async () => {
    const vault = new MockVault();
    vault.files.set(`${LEGACY_STORAGE_DIR}/memo.json`, '[]');
    vault.dirs.add(LEGACY_STORAGE_DIR);
    const app = { vault: { adapter: { exists: vault.adapter.exists.bind(vault.adapter) } } };
    setApp(app as never);
    setPluginRelDir(PLUGIN_DIR);
    const settings: { storagePath?: string } = { storagePath: LEGACY_STORAGE_DIR };
    expect(await bootstrapStorageDir(app as never, settings)).toBe(false);
    expect(settings.storagePath).toBe(LEGACY_STORAGE_DIR);
  });
});

describe('bootstrapStorageDir：用户自己填的值一个字都不动', () => {
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
    const settings: { storagePath?: string } = { storagePath: TARGET };
    expect(await bootstrapStorageDir({ vault } as never, settings)).toBe(false);
  });
});

describe('bootstrapStorageDir：没有设置对象（极早期调用）', () => {
  it('null → 直接返回 false，不抛', async () => {
    const vault = new MockVault();
    setupApp(vault);
    expect(await bootstrapStorageDir({ vault } as never, null)).toBe(false);
  });
});

describe('bootstrapStorageDir：复制失败的兜底不看错误类型', () => {
  it('list 抛错 → 视为零复制，路径不动（不让设置指向空目录）', async () => {
    const vault = new MockVault();
    vault.files.set(`${LEGACY_STORAGE_DIR}/memo.json`, '[]');
    vault.dirs.add(LEGACY_STORAGE_DIR);
    const app = {
      vault: {
        adapter: {
          exists: async (p: string) => vault.files.has(p) || vault.dirs.has(p),
          list: vi.fn(async () => {
            throw new Error('磁盘读失败');
          }),
          readBinary: async () => new ArrayBuffer(0),
          writeBinary: async () => {},
        },
      },
    };
    setApp(app as never);
    setPluginRelDir(PLUGIN_DIR);
    const settings: { storagePath?: string } = { storagePath: LEGACY_STORAGE_DIR };
    expect(await bootstrapStorageDir(app as never, settings)).toBe(false);
    expect(settings.storagePath).toBe(LEGACY_STORAGE_DIR);
  });
});
