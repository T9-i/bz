/**
 * 移动端的只读文件层 —— 工具坞的 fs 缝在手机上落到 vault adapter。
 *
 * 为什么需要这一层：桌面端的 fs 缝走 `window.require('fs')`，而移动端没有 Node，
 * `currentFs()` 为 null —— 于是声明、参数值、运行记录、展示板**全都读不到**，
 * 面板只剩登记项的 id/path，满屏「声明文件读不到」。可工具目录就在 vault 里
 * （`CONFIG/SCRIPTS/DockTools/<工具>/`），手机上的 `app.vault.adapter` 读得到。
 *
 * 唯一的接口错位：`DockFs.readText` 是**同步**的（`readDeclaration` 等一整条读链都是同步），
 * 而 adapter 只有异步 `read`。所以这里是「**先预取进内存，再同步查表**」：
 * 打开面板 / 刷新时把每个工具那几份文件读一遍，之后所有同步读都命中缓存。
 * 缓存不跨刷新保留 —— 手机上的文件可能被同步工具改掉，每次打开都重读才是对的。
 *
 * 只读：移动端不启动进程，参数与节奏的写入口在 UI 侧已经关掉，这里的 `writeText` 什么都不做。
 */

import type { App } from 'obsidian';
import {
  DECLARATION_FILENAME,
  DECLARATION_FILENAME_LEGACY,
  MAIN_ENTRY_FILENAME,
  PANEL_FILENAME,
  RUNS_FILENAME,
  RUNS_FILENAME_LEGACY,
  SETTINGS_FILENAME,
  SETTINGS_FILENAME_LEGACY,
  dirOf,
  joinPath,
  setDockFs,
  type DockFs,
} from './declaration';
import type { DockToolEntry } from './registry';

/** 路径规范化：统一分隔符、去掉尾部分隔符 */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * 绝对路径 → vault 相对路径（adapter 要的那种）。不在 vault 里返回 null。
 *
 * 两条路，任一条命中即可：
 *  1. `basePath` 前缀（桌面端与部分移动端适配器都有真实根路径）；
 *  2. 按**仓库名**定位 —— 手机上 adapter 的根是 `/storage/emulated/0/…`（甚至 SAF 的
 *     `content://`），跟登记里那条 Windows 路径对不上，但路径里一定含 `/<仓库名>/` 这一段。
 *
 * 取**最后一次**出现：vault 根是离文件最近的祖先，父目录重名时取到的是更深的那层才正确。
 */
export function relPathInVault(absPath: string, basePath: string, vaultName: string): string | null {
  const abs = normPath(absPath);
  if (!abs) return null;
  const base = normPath(basePath);
  if (base) {
    const lowAbs = abs.toLowerCase();
    const lowBase = base.toLowerCase();
    if (lowAbs === lowBase) return null;
    if (lowAbs.startsWith(`${lowBase}/`)) return abs.slice(base.length + 1);
  }
  const name = normPath(vaultName);
  if (name) {
    const marker = `/${name}/`;
    const i = abs.toLowerCase().lastIndexOf(marker.toLowerCase());
    if (i >= 0) return abs.slice(i + marker.length);
  }
  return null;
}

/** 某工具要预取的全部文件（声明 / 别名 / 约定入口 / 参数值 / 记录 / 展示板） */
export function primePathsOf(entry: DockToolEntry): string[] {
  const dir = dirOf(entry.path);
  const paths = [
    entry.path,
    joinPath(dir, DECLARATION_FILENAME),
    joinPath(dir, DECLARATION_FILENAME_LEGACY),
    joinPath(dir, MAIN_ENTRY_FILENAME),
    joinPath(dir, RUNS_FILENAME),
    joinPath(dir, RUNS_FILENAME_LEGACY),
    joinPath(dir, SETTINGS_FILENAME),
    joinPath(dir, SETTINGS_FILENAME_LEGACY),
    joinPath(dir, PANEL_FILENAME),
  ];
  return [...new Set(paths.map(normPath))];
}

/** 预取时的并发上限：手机上 adapter 每次 read 都要过一层原生桥，串行会明显变慢 */
const PRIME_CONCURRENCY = 6;

/** 当前生效的 vault 读桥；null = 没装（桌面端或尚未安装） */
let bridge: {
  read(absPath: string): Promise<string | null>;
  drop(): void;
} | null = null;

/** 是否已经装了移动端读桥 */
export function hasVaultFs(): boolean {
  return bridge !== null;
}

/** 预取一批路径（并发有上限；单个失败只记 null，不影响其余） */
export async function primeVaultFs(paths: readonly string[]): Promise<void> {
  if (!bridge) return;
  const b = bridge;
  const queue = [...paths];
  await Promise.all(
    Array.from({ length: Math.min(PRIME_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const p = queue.shift()!;
        await b.read(p);
      }
    }),
  );
}

/**
 * 装上移动端读桥（只该在 `Platform.isMobile` 时调用）。
 *
 * 装完 `currentFs()` 就不再是 null，桌面那套读链在手机上原样跑通 ——
 * 声明解析、运行记录、展示板、参数值全部复用，不另写一份读法。
 */
export function installVaultFs(app: App): void {
  const cache = new Map<string, string | null>();
  const adapter = app.vault.adapter;
  const vaultName = app.vault.getName();
  const basePath = String((adapter as unknown as { basePath?: string }).basePath ?? '');

  const read = async (absPath: string): Promise<string | null> => {
    const key = normPath(absPath);
    if (cache.has(key)) return cache.get(key) ?? null;
    const rel = relPathInVault(key, basePath, vaultName);
    if (!rel) {
      // 不在仓库里 —— 手机端读不到，磁盘上的路径再对也没用
      cache.set(key, null);
      return null;
    }
    let text: string | null = null;
    try {
      text = await adapter.read(rel);
    } catch {
      text = null; // 文件没同步过来 / 无权限，与「不存在」同价
    }
    cache.set(key, text);
    return text;
  };

  bridge = {
    read,
    drop: () => cache.clear(),
  };

  const fs: DockFs = {
    readText: (p) => cache.get(normPath(p)) ?? null,
    writeText: () => {
      /* 移动端只读：写入口在 UI 侧已关，这里静默忽略比抛错好 */
    },
    exists: (p) => (cache.get(normPath(p)) ?? null) !== null,
  };
  setDockFs(fs);
}

/** 卸下读桥（插件卸载 / 测试复位）；交还 fs 缝给默认实现 */
export function uninstallVaultFs(): void {
  bridge = null;
  setDockFs(undefined);
}

/** 丢掉缓存（下次读全部重新走 adapter）—— 面板刷新时用 */
export function resetVaultFs(): void {
  bridge?.drop();
}
