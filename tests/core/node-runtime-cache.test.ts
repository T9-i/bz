/**
 * 便携 Node 的两条「离线重装」路径：
 *   ① 归档缓存（`downloads/tools/.cache/<归档>`）—— Defender 隔离了 node.exe 之后不必重下 36MB；
 *   ② 离线包（`<vault>/bz-offline/node/<归档>`）—— 完全没有外网时唯一来源。
 *
 * 这两条都只在**别人的机器 / 特殊网络**上走到，所以在这里钉死：
 * 缓存命中就不该联网，离线包在就不该联网，缓存坏了要自动丢弃而不是一直失败。
 */
import { describe, it, expect } from 'vitest';
import { installPortableNode, nodeArchivePlans, PORTABLE_NODE_VERSION } from '../../src/core/node-runtime-install';
import { MockVault } from '../mock-vault';

const BASE = '/mock-vault';

/* ---------- 造一个只有 stored（不压缩）条目的 zip ---------- */

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function storedZip(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const crc = crc32(data);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(6, 0, true);
  local.setUint16(8, 0, true); // stored
  local.setUint32(14, crc, true);
  local.setUint32(18, data.byteLength, true);
  local.setUint32(22, data.byteLength, true);
  local.setUint16(26, nameBytes.byteLength, true);
  const localBytes = new Uint8Array(local.buffer);

  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 20, true);
  central.setUint16(6, 20, true);
  central.setUint16(10, 0, true);
  central.setUint32(16, crc, true);
  central.setUint32(20, data.byteLength, true);
  central.setUint32(24, data.byteLength, true);
  central.setUint16(28, nameBytes.byteLength, true);
  central.setUint32(42, 0, true);
  const centralBytes = new Uint8Array(central.buffer);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, 1, true);
  eocd.setUint16(10, 1, true);
  eocd.setUint32(12, centralBytes.byteLength + nameBytes.byteLength, true);
  eocd.setUint32(16, localBytes.byteLength + nameBytes.byteLength + data.byteLength, true);
  const eocdBytes = new Uint8Array(eocd.buffer);

  const out = new Uint8Array(
    localBytes.byteLength + nameBytes.byteLength + data.byteLength + centralBytes.byteLength + nameBytes.byteLength + 22,
  );
  let off = 0;
  for (const part of [localBytes, nameBytes, data, centralBytes, nameBytes, eocdBytes]) {
    out.set(part, off);
    off += part.byteLength;
  }
  return out;
}

const PLATFORM = 'win32';
const ARCHIVE = nodeArchivePlans(PLATFORM, 'x64')[0].file;

/** 一份「看起来像运行时」的归档：入口条目 6MB（高于 MIN_NODE_BYTES 5MB） */
function fakeNodeZip(): Uint8Array {
  return storedZip(`node-${PORTABLE_NODE_VERSION}-win-x64/node.exe`, new Uint8Array(6 * 1024 * 1024));
}

function appOf(vault: MockVault): unknown {
  return { vault: { adapter: { ...vault.adapter, basePath: BASE }, configDir: '.obsidian' } };
}

/** 让 runNodeVersion 能跑起来（真实 -v 在单测里不可能有）：返回 status 0 + 版本串 */
function stubNodeRuns(): void {
  (window as unknown as { require: (m: string) => unknown }).require = (m: string) => {
    if (m === 'child_process') {
      return { spawnSync: () => ({ status: 0, stdout: `${PORTABLE_NODE_VERSION}\n`, stderr: '' }) };
    }
    if (m === 'fs') return { existsSync: () => true, chmodSync: () => undefined };
    return null;
  };
}

describe('归档缓存：Defender 删掉 node.exe 之后不再重下 36MB', () => {
  it('缓存命中 → 联网次数为 0，装成功', async () => {
    const vault = new MockVault();
    vault.binaryFiles.set(`.obsidian/plugins/bz/downloads/tools/.cache/${ARCHIVE}`, fakeNodeZip());
    stubNodeRuns();
    let fetched = 0;

    const r = await installPortableNode(appOf(vault), {
      platform: PLATFORM,
      arch: 'x64',
      fetchBytes: async () => {
        fetched++;
        throw new Error('不该联网');
      },
    });

    expect(fetched).toBe(0);
    expect(r.version).toBe(PORTABLE_NODE_VERSION);
    expect(vault.binaryFiles.has('.obsidian/plugins/bz/downloads/tools/node-runtime/node.exe')).toBe(true);
  });

  it('缓存是空文件 → 当没有，继续走网络', async () => {
    const vault = new MockVault();
    vault.binaryFiles.set(`.obsidian/plugins/bz/downloads/tools/.cache/${ARCHIVE}`, new Uint8Array(0));
    stubNodeRuns();
    let fetched = 0;
    const zip = fakeNodeZip();

    await installPortableNode(appOf(vault), {
      platform: PLATFORM,
      arch: 'x64',
      fetchBytes: async () => {
        fetched++;
        return zip;
      },
    });

    expect(fetched).toBe(1);
  });

  it('下载成功后会把归档留一份（下次重装用）', async () => {
    const vault = new MockVault();
    stubNodeRuns();
    const zip = fakeNodeZip();
    await installPortableNode(appOf(vault), { platform: PLATFORM, arch: 'x64', fetchBytes: async () => zip });
    expect(vault.binaryFiles.has(`.obsidian/plugins/bz/downloads/tools/.cache/${ARCHIVE}`)).toBe(true);
  });
});

describe('离线包：完全没有外网时也能装', () => {
  it('bz-offline/node/<归档> 在 → 不联网，装成功', async () => {
    const vault = new MockVault();
    const zip = fakeNodeZip();
    vault.binaryFiles.set(`bz-offline/node/${ARCHIVE}`, zip);
    (window as unknown as { require: (m: string) => unknown }).require = (m: string) => {
      if (m === 'child_process') return { spawnSync: () => ({ status: 0, stdout: `${PORTABLE_NODE_VERSION}\n` }) };
      if (m === 'fs') {
        return {
          existsSync: (p: string) => {
            const rel = p.startsWith(`${BASE}/`) ? p.slice(BASE.length + 1) : p;
            return vault.binaryFiles.has(rel) || [...vault.binaryFiles.keys()].some((k) => k.startsWith(`${rel}/`));
          },
          readFileSync: (p: string) => {
            const rel = p.startsWith(`${BASE}/`) ? p.slice(BASE.length + 1) : p;
            const bytes = vault.binaryFiles.get(rel);
            if (!bytes) throw new Error(`ENOENT: ${p}`);
            return Buffer.from(bytes);
          },
          chmodSync: () => undefined,
        };
      }
      return null;
    };
    let fetched = 0;

    const r = await installPortableNode(appOf(vault), {
      platform: PLATFORM,
      arch: 'x64',
      fetchBytes: async () => {
        fetched++;
        throw new Error('不该联网');
      },
    });

    expect(fetched).toBe(0);
    expect(r.version).toBe(PORTABLE_NODE_VERSION);
  });
});
