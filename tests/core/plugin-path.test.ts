/**
 * core/plugin-path：插件目录名由用户决定（`bz` / `包仔` / `bz-test`），
 * 写死 `plugins/bz` 会让「下载落位」与「读取位置」双双错位。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  injectedPluginRelDir,
  pluginDirOf,
  pluginRelDirOf,
  pluginVaultPath,
  setPluginRelDir,
  vaultBasePathOf,
} from '../../src/core/plugin-path';

const appOf = (opts: { base?: string; configDir?: string; manifestDir?: string } = {}): unknown => ({
  vault: { configDir: opts.configDir, adapter: { getBasePath: () => opts.base ?? '' } },
  plugins: opts.manifestDir === undefined ? {} : { manifests: { bz: { dir: opts.manifestDir } } },
});

afterEach(() => setPluginRelDir(''));

describe('插件目录解析', () => {
  it('注入的运行中目录优先（用户把文件夹改名了也认）', () => {
    setPluginRelDir('.obsidian/plugins/包仔');
    expect(injectedPluginRelDir()).toBe('.obsidian/plugins/包仔');
    expect(pluginRelDirOf(appOf({ manifestDir: '.obsidian/plugins/bz' }))).toBe('.obsidian/plugins/包仔');
  });

  it('没注入 → 用 Obsidian 清单里记的那条', () => {
    expect(pluginRelDirOf(appOf({ manifestDir: '.obsidian/plugins/bz-test' }))).toBe('.obsidian/plugins/bz-test');
  });

  it('都没有 → 回落 <configDir>/plugins/bz（configDir 可能是自定义的）', () => {
    expect(pluginRelDirOf(appOf({ configDir: '.config' }))).toBe('.config/plugins/bz');
    expect(pluginRelDirOf(appOf({}))).toBe('.obsidian/plugins/bz');
  });

  it('注入值两端的斜杠被剪掉（拼路径时不会出现 //）', () => {
    setPluginRelDir('/.obsidian/plugins/bz/');
    expect(pluginRelDirOf(appOf({}))).toBe('.obsidian/plugins/bz');
  });

  it('pluginDirOf 拼上 vault 绝对路径；拿不到 basePath → 空串', () => {
    setPluginRelDir('.obsidian/plugins/包仔');
    expect(pluginDirOf(appOf({ base: 'E:\\Obsidian\\叫我包仔' }))).toBe('E:\\Obsidian\\叫我包仔/.obsidian/plugins/包仔');
    expect(pluginDirOf(appOf({ base: '' }))).toBe('');
  });

  it('vaultBasePathOf 剪掉尾斜杠', () => {
    expect(vaultBasePathOf(appOf({ base: 'E:\\vault\\' }))).toBe('E:\\vault');
  });

  it('pluginVaultPath 是写盘用的 vault 相对路径', () => {
    setPluginRelDir('.obsidian/plugins/包仔');
    expect(pluginVaultPath(appOf({}), 'downloads/tools/node-runtime/node.exe')).toBe(
      '.obsidian/plugins/包仔/downloads/tools/node-runtime/node.exe',
    );
  });
});
