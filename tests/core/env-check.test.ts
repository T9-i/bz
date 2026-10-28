// @vitest-environment jsdom
/**
 * 环境自检（core/env-check.ts）：把「这台机器缺什么」一次说清。
 *
 * 钉住两条最容易骗人的判据：
 *  1. **「目录还没建」不等于「不可写」**——首次运行时数据目录是空的，逐级建一遍再写探针才作数；
 *  2. **真写一次**才算可写——`exists()` / 只读盘 / 占位文件都能让「存在」错当成「能写」。
 */
import { describe, it, expect, vi } from 'vitest';
import { MockVault } from '../mock-vault';
import { environmentCheck } from '../../src/core/env-check';
import { resetNodeRuntimeCache, setFsProbe } from '../../src/core/tool-runtime';

function appOf(vault: MockVault): unknown {
  return { vault: { adapter: vault.adapter, configDir: '.obsidian' } };
}

describe('environmentCheck', () => {
  it('一次给出运行环境 / vault / 插件目录 / 数据目录 / Node / 三个工具', async () => {
    resetNodeRuntimeCache();
    setFsProbe(() => false);
    const vault = new MockVault();
    setFsProbe(() => false);

    const rows = await environmentCheck(appOf(vault));
    const keys = rows.map((r) => r.key);

    expect(keys).toContain('运行环境');
    expect(keys).toContain('vault 路径');
    expect(keys).toContain('数据目录可写');
    expect(keys).toContain('Node 运行时');
    expect(keys).toContain('B站下载器');
    setFsProbe(null);
  });

  it('数据目录还不存在（首次运行）→ 判可写，不误报', async () => {
    resetNodeRuntimeCache();
    setFsProbe(() => false);
    const vault = new MockVault();
    // 不预置任何目录：CONFIG/STORAGE 此刻并不存在
    const rows = await environmentCheck(appOf(vault));
    const row = rows.find((r) => r.key === '数据目录可写')!;
    expect(row.value).toContain('CONFIG/STORAGE');
    expect(row.ok).toBe(true);
    setFsProbe(null);
  });

  it('写盘抛错 → 判不可写，并把原因写进 value（不是只给一个红点）', async () => {
    resetNodeRuntimeCache();
    setFsProbe(() => false);
    const vault = new MockVault();
    vi.spyOn(vault.adapter, 'write').mockRejectedValue(new Error('EACCES: permission denied'));

    const rows = await environmentCheck(appOf(vault));
    const row = rows.find((r) => r.key === '数据目录可写')!;
    expect(row.ok).toBe(false);
    expect(row.value).toContain('写不进去');
    setFsProbe(null);
  });

  it('Node 缺失 → 那一行判红（这是「工具下好了也跑不起来」的根因）', async () => {
    resetNodeRuntimeCache();
    setFsProbe(() => false);
    // jsdom 没有 window.require → 探测不到 node
    delete (window as unknown as { require?: unknown }).require;
    const rows = await environmentCheck(appOf(new MockVault()));
    const row = rows.find((r) => r.key === 'Node 运行时')!;
    expect(row.ok).toBe(false);
    expect(row.value).toContain('未找到');
    setFsProbe(null);
  });
});
