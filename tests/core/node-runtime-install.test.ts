/**
 * core/node-runtime-install：干净机器上没有 Node 时的唯一出路是把一份下进插件目录。
 * 这里测「取哪个包、从哪取、取不到怎么说话」——真实的 36MB 下载不在单测里跑。
 */
import { describe, it, expect } from 'vitest';
import {
  bundledNodeFile,
  installPortableNode,
  NODE_RUNTIME_DIR,
  nodeArchivePlans,
  PORTABLE_NODE_VERSION,
  portableNodeRelPath,
} from '../../src/core/node-runtime-install';

describe('便携 Node：取哪个包', () => {
  it('Windows 用官方 zip（nodejs.org 没有 win 的 tar.gz）', () => {
    const [plan] = nodeArchivePlans('win32', 'x64');
    expect(plan.file).toBe(`node-${PORTABLE_NODE_VERSION}-win-x64.zip`);
    expect(plan.kind).toBe('zip');
    expect(plan.member).toBe('node.exe');
  });

  it('macOS / Linux 用 tar.gz，取 bin/node', () => {
    for (const p of ['darwin', 'linux']) {
      const [plan] = nodeArchivePlans(p, 'arm64');
      expect(plan.file).toBe(`node-${PORTABLE_NODE_VERSION}-${p}-arm64.tar.gz`);
      expect(plan.kind).toBe('tar.gz');
      expect(plan.member).toBe('bin/node');
    }
  });

  it('双源：npmmirror 镜像在前（国内直连），官方在后（兜底）', () => {
    const [plan] = nodeArchivePlans('win32', 'x64');
    expect(plan.urls[0]).toContain('registry.npmmirror.com');
    expect(plan.urls[1]).toContain('nodejs.org');
  });

  it('没有官方产物的平台/架构 → 空数组（如实说不支持，不去撞网）', () => {
    expect(nodeArchivePlans('aix', 'ppc64')).toEqual([]);
    expect(nodeArchivePlans('win32', 'ia32')).toEqual([]);
  });

  it('落位与探测口径一致：downloads/tools/node-runtime/<entry>', () => {
    expect(NODE_RUNTIME_DIR).toBe('downloads/tools/node-runtime');
    expect(portableNodeRelPath('win32')).toBe('downloads/tools/node-runtime/node.exe');
    expect(portableNodeRelPath('darwin')).toBe('downloads/tools/node-runtime/bin/node');
    expect(bundledNodeFile('win32')).toBe('node.exe');
  });
});

describe('便携 Node：装不上时怎么说话', () => {
  it('双源都失败 → 抛错并带上两个地址的失败原因', async () => {
    const app = { vault: { adapter: { writeBinary: async () => undefined } } };
    await expect(
      installPortableNode(app, {
        platform: 'win32',
        arch: 'x64',
        fetchBytes: async (url) => {
          throw new Error(`连不上 ${url.split('/')[2]}`);
        },
      }),
    ).rejects.toThrow(/Node 运行时安装失败.*连不上/);
  });

  it('平台不支持 → 直接说「自行安装 Node.js」，不做无意义的下载', async () => {
    await expect(installPortableNode({}, { platform: 'aix', arch: 'ppc64' })).rejects.toThrow(/没有官方 Node 产物/);
  });

  it('归档里没有入口文件 → 报「包里没有」，不是写一个空文件', async () => {
    const app = { vault: { adapter: { writeBinary: async () => undefined } } };
    // 一个空 zip（只有目录尾）——能读，但找不到 node.exe
    const emptyZip = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    await expect(
      installPortableNode(app, {
        platform: 'win32',
        arch: 'x64',
        fetchBytes: async () => emptyZip,
      }),
    ).rejects.toThrow(/没有 node\.exe/);
  });
});
