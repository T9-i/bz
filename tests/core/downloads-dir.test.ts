/**
 * 全新库第一次写下载资源：`downloads/` 这个根目录必须由插件自己建出来。
 *
 * 报障（2026-10-28 新库）：引导页永远「资源清单没拉到」。真实原因不在网络 ——
 * `writeAssetText('manifest.json')` 先调 `ensureDir`，而 `ensureDir` 只在路径**含斜杠**时
 * 才进建目录的循环；单文件资产（`manifest.json` / `bz-manual.html`）没有斜杠 → 直接 return
 * → `downloads/` 从未被创建。Obsidian 的 `adapter.write` 是 `fs.writeFile` 语义，父目录
 * 不存在就 ENOENT，于是「清单拉到了、写不进去」，`refreshManifest` 抛错被引导页吞成
 * 「清单没拉到」。
 *
 * 为什么既有测试全程绿灯：`MockVault.adapter.write` 往 Map 里塞，不校验父目录。这里改用
 * **真实文件系统 + 非递归 mkdir** 的 adapter，跟 Obsidian 的行为一致。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeAssetText } from '../../src/core/remote-asset';
import { setPluginRelDir } from '../../src/core/plugin-path';

let root = '';

/** Obsidian FileSystemAdapter 的最小复刻：mkdir 不递归、write 不建父目录 */
function appOf(): unknown {
  return {
    vault: {
      configDir: '.obsidian',
      adapter: {
        getBasePath: () => root,
        mkdir: async (p: string) => {
          await mkdir(join(root, p));
        },
        write: async (p: string, data: string) => {
          await writeFile(join(root, p), data, 'utf8');
        },
        exists: async (p: string) => existsSync(join(root, p)),
        read: async (p: string) => readFile(join(root, p), 'utf8'),
      },
    },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bz-downloads-'));
  // 插件目录本身当然存在（插件就装在这儿），但 downloads/ 不存在 —— 全新库的真实形态
  mkdirSync(join(root, '.obsidian/plugins/bz'), { recursive: true });
  setPluginRelDir(null); // 别的用例可能注入过，这里要按 app 自动解析
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('全新库写下载资源', () => {
  it('单文件资产（无子目录）也能落盘：downloads/ 由插件建，不指望它本来就在', async () => {
    await writeAssetText(appOf(), 'manifest.json', '{"version":1}');
    const p = join(root, '.obsidian/plugins/bz/downloads/manifest.json');
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('{"version":1}');
  });

  it('多级资产照旧逐级建（skins/<域>/<id>.css）', async () => {
    await writeAssetText(appOf(), 'skins/bookshelf/noir.css', '.bz-skin-noir{}');
    expect(existsSync(join(root, '.obsidian/plugins/bz/downloads/skins/bookshelf/noir.css'))).toBe(true);
  });

  it('重复写同一个文件不因「目录已存在」而失败（mkdir 幂等）', async () => {
    await writeAssetText(appOf(), 'manifest.json', 'a');
    await writeAssetText(appOf(), 'manifest.json', 'b');
    expect(readFileSync(join(root, '.obsidian/plugins/bz/downloads/manifest.json'), 'utf8')).toBe('b');
  });
});
