/**
 * 目录包资源（core/bundle-asset.ts）：在线资源里「外部工具」那条通道。
 *
 * 钉住四件事：
 *  1. 下载 → 解包 → 写就绪标记 的完整链路，文件全部落到 `downloads/tools/<id>/`；
 *  2. **hash 不符即拒收**（坏内容不进本地，与皮肤同口径）；
 *  3. 三态判定（missing / updated / ready）——清单换了版本，目录就对不上，自动变 updated；
 *  4. 本地归档缓存命中时不再打网络（省流量那条）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import zlib from 'node:zlib';
import { MockVault } from '../mock-vault';
import { bundleDirOf, bundleStatus, installBundle, readBundleMarker, BUNDLE_MARKER } from '../../src/core/bundle-asset';
import { sha256Bytes } from '../../src/core/sha256';
import type { ManifestDocEntry } from '../../src/core/download-manifest';

const BLOCK = 512;

function octal(value: number, len: number): string {
  return value.toString(8).padStart(len - 1, '0') + '\0';
}

function header(name: string, size: number): Buffer {
  const buf = Buffer.alloc(BLOCK);
  buf.write(name, 0, 100, 'utf8');
  buf.write(octal(0o644, 8), 100, 'ascii');
  buf.write(octal(0, 8), 108, 'ascii');
  buf.write(octal(0, 8), 116, 'ascii');
  buf.write(octal(size, 12), 124, 'ascii');
  buf.write(octal(0, 12), 136, 'ascii');
  buf.write('        ', 148, 'ascii');
  buf.write('0', 156, 'ascii');
  buf.write('ustar', 257, 5, 'ascii');
  buf.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return buf;
}

/** 造一个 tar.gz（内容 = entries） */
function makeTgz(entries: Array<{ name: string; body: string }>): Uint8Array {
  const chunks: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.body, 'utf8');
    chunks.push(header(e.name, data.length), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(BLOCK * 2));
  return new Uint8Array(zlib.gzipSync(Buffer.concat(chunks)));
}

const gunzip = (b: Uint8Array): Uint8Array => new Uint8Array(zlib.gunzipSync(Buffer.from(b)));

function appOf(vault: MockVault): unknown {
  return { vault: { adapter: vault.adapter, configDir: '.obsidian' } };
}

function entryOf(tgz: Uint8Array, over: Partial<ManifestDocEntry> = {}): ManifestDocEntry {
  return {
    id: 'tool-demo',
    name: '演示工具',
    file: 'tools/demo.tar.gz',
    sha256: sha256Bytes(tgz),
    kind: 'bundle',
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('installBundle：下载 → 解包 → 标记', () => {
  it('文件落到 downloads/tools/<id>/，标记记下归档 hash 与文件数', async () => {
    const vault = new MockVault();
    const app = appOf(vault);
    const tgz = makeTgz([
      { name: 'cli.js', body: 'console.log("hi")' },
      { name: 'lib/a.js', body: 'a' },
    ]);
    const entry = entryOf(tgz);

    const r = await installBundle(app, entry, { gunzip, fetchBytes: async () => tgz });

    expect(r.dir).toBe('tools/demo');
    expect(r.files).toBe(2);
    // 文件真的写进了二进制树
    expect(vault.binaryFiles.has('.obsidian/plugins/bz/downloads/tools/demo/cli.js')).toBe(true);
    expect(vault.binaryFiles.has('.obsidian/plugins/bz/downloads/tools/demo/lib/a.js')).toBe(true);
    // 归档本体也缓存了一份（下次解包不必再下）
    expect(vault.binaryFiles.has('.obsidian/plugins/bz/downloads/tools/demo.tar.gz')).toBe(true);

    const marker = await readBundleMarker(app, entry);
    expect(marker).toMatchObject({ id: 'tool-demo', sha256: entry.sha256, files: 2 });
    expect(await bundleStatus(app, entry)).toBe('ready');
  });

  it('sha256 不符 → 拒收（抛错且不写任何文件）', async () => {
    const vault = new MockVault();
    const app = appOf(vault);
    const tgz = makeTgz([{ name: 'cli.js', body: 'x' }]);
    const entry = entryOf(tgz, { sha256: 'f'.repeat(64) });

    await expect(installBundle(app, entry, { gunzip, fetchBytes: async () => tgz })).rejects.toThrow(/sha256|下载失败/);
    expect(vault.binaryFiles.size).toBe(0);
  });

  it('包名不是 .tar.gz → 直接拒绝（避免解到半截目录名）', async () => {
    const vault = new MockVault();
    const tgz = makeTgz([{ name: 'a.js', body: 'x' }]);
    await expect(
      installBundle(appOf(vault), entryOf(tgz, { file: 'tools/demo.zip' }), { gunzip, fetchBytes: async () => tgz }),
    ).rejects.toThrow(/不是 \.tar\.gz/);
  });

  it('本地归档缓存命中 → 不再走网络（fetchBytes 一次都不该被调）', async () => {
    const vault = new MockVault();
    const app = appOf(vault);
    const tgz = makeTgz([{ name: 'a.js', body: 'cached' }]);
    const entry = entryOf(tgz);
    // 预放归档缓存
    vault.binaryFiles.set(
      '.obsidian/plugins/bz/downloads/tools/demo.tar.gz',
      new Uint8Array(tgz),
    );
    const fetchBytes = vi.fn(async () => tgz);

    await installBundle(app, entry, { gunzip, fetchBytes });
    expect(fetchBytes).not.toHaveBeenCalled();
  });
});

describe('bundleStatus：三态', () => {
  it('没装 → missing；装了同版本 → ready；清单换了 hash → updated', async () => {
    const vault = new MockVault();
    const app = appOf(vault);
    const tgz = makeTgz([{ name: 'a.js', body: 'v1' }]);
    const entry = entryOf(tgz);

    expect(await bundleStatus(app, entry)).toBe('missing');
    await installBundle(app, entry, { gunzip, fetchBytes: async () => tgz });
    expect(await bundleStatus(app, entry)).toBe('ready');

    // 远端出了新版（清单 hash 变了）→ 旧目录对不上
    expect(await bundleStatus(app, { ...entry, sha256: 'a'.repeat(64) })).toBe('updated');
  });

  it('标记文件坏 → updated（不是 ready，也不是崩）', async () => {
    const vault = new MockVault();
    const app = appOf(vault);
    const entry = entryOf(makeTgz([{ name: 'a.js', body: 'x' }]));
    vault.files.set(`.obsidian/plugins/bz/downloads/${bundleDirOf(entry.file)}/${BUNDLE_MARKER}`, '{ 坏 JSON');
    expect(await bundleStatus(app, entry)).toBe('updated');
  });
});

/** 把 MockVault 的二进制树接到真实 fs 语义上（深校验要 stat，测试里不能真写盘） */
function appWithStat(vault: MockVault): unknown {
  const base = '/mock-vault';
  const abs = (rel: string): string => `${base}/${rel}`;
  (globalThis as unknown as { window: { require: (m: string) => unknown } }).window.require = (m: string) => {
    if (m !== 'fs') return null;
    return {
      statSync: (p: string) => {
        const rel = p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
        const bytes = vault.binaryFiles.get(rel);
        const text = vault.files.get(rel);
        if (bytes) return { isFile: () => true, size: bytes.byteLength };
        if (text !== undefined) return { isFile: () => true, size: new TextEncoder().encode(text).byteLength };
        throw new Error(`ENOENT: ${p}`);
      },
    };
  };
  return { vault: { adapter: { ...vault.adapter, basePath: base }, configDir: '.obsidian' } };
}

describe('bundleStatus 深校验：标记在、文件没了要看得出来', () => {
  it('正常装完后 deep 也是 ready', async () => {
    const vault = new MockVault();
    const app = appWithStat(vault);
    const tgz = makeTgz([
      { name: 'cli.js', body: 'console.log(1)' },
      { name: 'lib/a.js', body: 'a' },
    ]);
    const entry = entryOf(tgz);
    await installBundle(app, entry, { gunzip, fetchBytes: async () => tgz });
    expect(await bundleStatus(app, entry, { deep: true })).toBe('ready');
  });

  it('有文件被删（安全软件隔离 / 同步盘截断）→ 深校验判 updated，浅校验仍说 ready', async () => {
    const vault = new MockVault();
    const app = appWithStat(vault);
    const tgz = makeTgz([
      { name: 'cli.js', body: 'console.log(1)' },
      { name: 'lib/a.js', body: 'a' },
    ]);
    const entry = entryOf(tgz);
    await installBundle(app, entry, { gunzip, fetchBytes: async () => tgz });

    vault.binaryFiles.delete('.obsidian/plugins/bz/downloads/tools/demo/lib/a.js');
    // 只看标记的判据会骗人：这正是「面板说已就绪、一跑就报找不到文件」的来源
    expect(await bundleStatus(app, entry)).toBe('ready');
    expect(await bundleStatus(app, entry, { deep: true })).toBe('updated');
  });

  it('文件被改坏（字节数变了）也能抓到', async () => {
    const vault = new MockVault();
    const app = appWithStat(vault);
    const tgz = makeTgz([{ name: 'cli.js', body: 'console.log(1)' }]);
    const entry = entryOf(tgz);
    await installBundle(app, entry, { gunzip, fetchBytes: async () => tgz });

    vault.binaryFiles.set('.obsidian/plugins/bz/downloads/tools/demo/cli.js', new Uint8Array([1, 2, 3]));
    expect(await bundleStatus(app, entry, { deep: true })).toBe('updated');
  });
});
