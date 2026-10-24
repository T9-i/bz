// @vitest-environment node
/**
 * 登记表路径的**形态**守卫。
 *
 * 这条测试守的是一个很隐蔽的实盘缺陷：工具坞走 node fs，而 node 的相对路径是按
 * `process.cwd()` 解析的 —— Obsidian 渲染进程的 cwd 不是 vault 根。`storageFile()` 给的是
 * 相对 vault 根的串（那是给 vault 适配器用的），所以这里必须拼上 vault 根。
 *
 * 不拼的后果不是「读不到」这么简单：`dock.lock` 也会落到别处，插件与值守各锁一个文件，
 * 互斥当场失效 —— 同一个工具跑两遍，而且两边都不觉得自己错。
 */

import { describe, expect, it } from 'vitest';
import { setApp } from '../../src/core/app';
import { registryPath } from '../../src/dock/registry';
import { dirOf } from '../../src/dock/files';

function vaultAt(base: string): void {
  setApp({ vault: { adapter: { getBasePath: () => base } } } as never);
}

describe('登记表路径', () => {
  it('拼成绝对路径（含数据目录的缺省值）', () => {
    vaultAt('D:/VAULT');
    expect(registryPath()).toBe('D:/VAULT/CONFIG/STORAGE/dock.json');
  });

  it('Windows 反斜杠统一成正斜杠，尾部斜杠不产生双斜杠', () => {
    vaultAt('E:\\Obsidian\\叫我包仔\\');
    expect(registryPath()).toBe('E:/Obsidian/叫我包仔/CONFIG/STORAGE/dock.json');
  });

  it('取不到 vault 根时退回相对路径（移动端适配器没有 getBasePath）', () => {
    setApp({ vault: {} } as never);
    expect(registryPath()).toBe('CONFIG/STORAGE/dock.json');
  });

  it('锁与登记表在同一个目录 —— 否则跨宿主互斥失效', () => {
    vaultAt('D:/VAULT');
    // dataDir 由 registryPath 推出来（host.ts 的 dataDir()），所以这里也应该是绝对路径
    expect(dirOf(registryPath())).toBe('D:/VAULT/CONFIG/STORAGE');
  });
});
