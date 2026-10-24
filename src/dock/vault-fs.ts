/**
 * 移动端读桥 —— 手机上**只能看，不能跑**，但「看」得看得见。
 *
 * 手机上没有 Node，`window.require('fs')` 那条读链整条是断的。工具目录又通常在 vault 里，
 * 于是打开面板时先用 vault 适配器把这些文件**预取进内存**，再把 fs 缝指到内存上 ——
 * 上层的读代码一个字都不用改，同步读照样成立。
 *
 * 预取是一次性的：不跨刷新保留（工具改了文件，重开面板就能看见新的）。
 */

import type { App } from 'obsidian';
import { setDockFs, type DockFs } from './files';
import { pathOf } from './files';
import type { DockRegistryEntry } from './types';

const mem = new Map<string, string>();
let primed = false;

function norm(p: string): string {
  return p.replace(/\\/g, '/');
}

const memoryFs: DockFs = {
  readText: (p) => mem.get(norm(p)) ?? null,
  writeText: () => {
    /* 手机上不写 */
  },
  exists: (p) => mem.has(norm(p)),
};

export function installVaultFs(app: App): void {
  setDockFs(memoryFs);
  void app;
}

export function uninstallVaultFs(): void {
  setDockFs(undefined);
  mem.clear();
  primed = false;
}

export function hasVaultFs(): boolean {
  return primed;
}

/** 一个工具要预取哪些文件 */
export function primePathsOf(entry: DockRegistryEntry): string[] {
  return [
    entry.path,
    pathOf.settings(entry.path),
    pathOf.runs(entry.path),
    pathOf.heartbeat(entry.path),
    pathOf.panel(entry.path),
    pathOf.intent(entry.path),
    pathOf.runtime(entry.path),
  ];
}

/** 绝对路径 → vault 相对路径（认「仓库名那一段」，手机上的 basePath 与登记的 Windows 路径对不上） */
function toVaultRelative(abs: string, vaultName: string): string | null {
  const p = norm(abs);
  const marker = `/${vaultName}/`;
  const i = p.indexOf(marker);
  if (i < 0) return null;
  return p.slice(i + marker.length);
}

/**
 * 预取。读不到的（文件不存在 / 在 vault 外）就跳过 —— 上层会看到「读不到」，
 * 与桌面端缺文件时的表现一致，不需要另写一套降级。
 */
export async function primeVaultFs(app: App, entries: readonly DockRegistryEntry[]): Promise<void> {
  const vaultName = app.vault.getName();
  for (const entry of entries) {
    for (const abs of primePathsOf(entry)) {
      const rel = toVaultRelative(abs, vaultName);
      if (!rel) continue;
      try {
        const text = await app.vault.adapter.read(rel);
        mem.set(norm(abs), text);
      } catch {
        /* 这个文件不在 / 读不了 —— 跳过 */
      }
    }
  }
  primed = true;
}
