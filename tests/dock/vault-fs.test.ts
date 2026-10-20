// @vitest-environment node
/**
 * 移动端只读读桥（`vault-fs`）。
 *
 * 盯三件事：
 *  1. **绝对路径 → vault 相对路径**：手机 adapter 的根跟登记里那条 Windows 路径对不上，
 *     只能靠「仓库名那一段」定位；仓库不在路径里就是读不到（不能瞎猜成某个相对路径）。
 *  2. **预取之后同步读才有货**：`DockFs.readText` 是同步的，adapter 只有异步 read ——
 *     没预取的文件必须老实返回 null，而不是编一个空内容。
 *  3. **只读**：写进去不落任何地方（移动端不执行进程，写入口在 UI 侧已关，这里兜底）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { currentFs } from '../../src/dock/declaration';
import {
  installVaultFs,
  primePathsOf,
  primeVaultFs,
  relPathInVault,
  resetVaultFs,
  uninstallVaultFs,
} from '../../src/dock/vault-fs';
import type { DockToolEntry } from '../../src/dock/registry';

afterEach(() => {
  uninstallVaultFs();
});

describe('relPathInVault', () => {
  it('basePath 命中时按前缀切（两种斜杠混用也认）', () => {
    expect(
      relPathInVault(
        'E:\\Obsidian\\叫我包仔\\CONFIG\\SCRIPTS\\DockTools\\a\\manifest.json',
        'E:/Obsidian/叫我包仔/',
        '叫我包仔',
      ),
    ).toBe('CONFIG/SCRIPTS/DockTools/a/manifest.json');
  });

  it('手机根与登记路径对不上时，按仓库名那一段定位', () => {
    expect(
      relPathInVault(
        'E:\\Obsidian\\叫我包仔\\CONFIG\\SCRIPTS\\DockTools\\a\\manifest.json',
        '/storage/emulated/0/叫我包仔',
        '叫我包仔',
      ),
    ).toBe('CONFIG/SCRIPTS/DockTools/a/manifest.json');
  });

  it('仓库名出现两次时取最后一次（vault 根是离文件最近的那层）', () => {
    expect(
      relPathInVault('D:/叫我包仔/备份/叫我包仔/CONFIG/x.json', '', '叫我包仔'),
    ).toBe('CONFIG/x.json');
  });

  it('不在仓库里 → null（不猜）', () => {
    expect(relPathInVault('D:/Other/place/manifest.json', '', '叫我包仔')).toBeNull();
  });

  it('路径本身就是仓库根 → null（不是文件）', () => {
    expect(relPathInVault('E:/Obsidian/叫我包仔', 'E:/Obsidian/叫我包仔', '叫我包仔')).toBeNull();
  });

  it('大小写不敏感（Windows 路径）', () => {
    expect(
      relPathInVault('e:/obsidian/叫我包仔/CONFIG/a.json', 'E:/Obsidian/叫我包仔', '叫我包仔'),
    ).toBe('CONFIG/a.json');
  });
});

describe('primePathsOf', () => {
  it('一个工具目录下要读的八份文件都在，且去重', () => {
    const entry: DockToolEntry = { id: 'demo', path: 'E:/v/叫我包仔/tools/demo/manifest.json' };
    const paths = primePathsOf(entry);
    expect(paths).toHaveLength(8);
    expect(new Set(paths).size).toBe(8);
    for (const name of [
      'manifest.json',
      'dock.json',
      'main.mjs',
      'runs.json',
      'dock.runs.json',
      'data.json',
      'dock.settings.json',
      'panel.html',
    ]) {
      expect(paths.some((p) => p.endsWith(`/${name}`))).toBe(true);
    }
  });
});

describe('installVaultFs', () => {
  const entry: DockToolEntry = { id: 'demo', path: 'E:/Obsidian/叫我包仔/tools/demo/manifest.json' };
  const files: Record<string, string> = {
    'tools/demo/manifest.json': '{"v":1,"id":"demo","name":"演示"}',
    'tools/demo/runs.json': '{"v":1,"tool":"demo","runs":[]}',
  };
  const makeApp = () => ({
    vault: {
      getName: () => '叫我包仔',
      adapter: {
        basePath: '/storage/emulated/0/叫我包仔',
        read: async (rel: string) => {
          if (!(rel in files)) throw new Error('ENOENT');
          return files[rel];
        },
      },
    },
  });

  it('预取后同步读命中；没预取的不编内容', async () => {
    installVaultFs(makeApp() as never);
    expect(currentFs()?.readText(entry.path)).toBeNull(); // 还没预取
    await primeVaultFs(primePathsOf(entry));
    expect(currentFs()?.readText(entry.path)).toContain('演示');
    expect(currentFs()?.readText('E:/Obsidian/叫我包仔/tools/demo/panel.html')).toBeNull();
    expect(currentFs()?.exists?.('E:/Obsidian/叫我包仔/tools/demo/panel.html')).toBe(false);
  });

  it('不在仓库里的工具读不到（哪怕磁盘上真的有）', async () => {
    installVaultFs(makeApp() as never);
    const outside = 'D:/Elsewhere/tool/manifest.json';
    await primeVaultFs([outside]);
    expect(currentFs()?.readText(outside)).toBeNull();
  });

  it('写被忽略：只读不落盘', async () => {
    installVaultFs(makeApp() as never);
    currentFs()?.writeText(entry.path, 'overwritten');
    expect(currentFs()?.readText(entry.path)).toBeNull();
  });

  it('reset 之后回到未预取状态', async () => {
    installVaultFs(makeApp() as never);
    await primeVaultFs([entry.path]);
    expect(currentFs()?.readText(entry.path)).toContain('演示');
    resetVaultFs();
    expect(currentFs()?.readText(entry.path)).toBeNull();
  });
});
