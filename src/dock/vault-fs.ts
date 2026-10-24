/**
 * 移动端读桥 —— 手机上**只能看，不能跑**，但「看」得看得见。
 *
 * 手机上没有 Node，`window.require('fs')` 那条读链整条是断的。所以打开库时先用 vault 适配器
 * 把文件**预取进内存**，再把 fs 缝指到内存上 —— 上层读代码一个字都不用改，同步读照样成立。
 *
 * ## 自举：先读登记表，再读它点的名
 *
 * 上一版是倒着来的：调用方先 `readToolEntries()`（读登记表）拿到工具列表，再预取那些工具的文件。
 * 可手机上登记表本身就还没预取 —— 于是永远拿到空列表，面板一片空白。
 *
 * 现在只有一步：`primeVaultFs(app)`。它自己按「数据目录 + 登记表文件名」把 `dock.json` 读进来，
 * 解析出工具列表，再逐个预取。这条路不依赖任何预置状态。
 *
 * ## 路径形态
 *
 * 内存 fs 的键同时登记**相对形态**与**绝对形态**（`basePath + '/' + rel`）：
 * 登记表里存的是 `vault:CONFIG/...`，还原出来是绝对路径；而 `dock.json` 自己的路径来自
 * `storageFile()`（相对）。两种键都存，读的人就不用关心自己手里是哪一形态。
 *
 * 预取是一次性的：不跨刷新保留（工具改了文件，重开面板就能看见新的）。
 */

import type { App } from 'obsidian';
import { setDockFs, currentFs, isPortablePath, resolveToolPath, type DockFs } from './files';
import { readRegistryAt } from './registry-file';
import { parseManifest } from './parse';
import { storageFile } from '../core/storage';
import { REGISTRY_FILENAME, VAULT_PATH_PREFIX, type DockRegistryEntry } from './types';

const mem = new Map<string, string>();
let primed = false;
/** 当前 vault 根（适配器口径：`vault.adapter.read()` 吃的是相对它的路径） */
let basePath = '';

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

/** vault 根。取不到就是空串（相对路径照用，与 `registryPath()` 同一口径） */
function baseOf(app: App): string {
  try {
    const adapter = (app.vault as unknown as { adapter?: { getBasePath?: () => string } }).adapter;
    const b = adapter?.getBasePath?.();
    return typeof b === 'string' ? norm(b).replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

export function installVaultFs(app: App): void {
  basePath = baseOf(app);
  setDockFs(memoryFs);
}

export function uninstallVaultFs(): void {
  setDockFs(undefined);
  mem.clear();
  primed = false;
  basePath = '';
}

export function hasVaultFs(): boolean {
  return primed;
}

/** 把一份文本按「相对 + 绝对」两种键登记（读的人手里是哪一种都能命中） */
function put(abs: string, text: string): void {
  const p = norm(abs);
  mem.set(p, text);
  if (basePath && p.startsWith(`${basePath}/`)) mem.set(p.slice(basePath.length + 1), text);
  else if (basePath) mem.set(`${basePath}/${p.replace(/^\/+/, '')}`, text);
}

/**
 * 绝对路径 / 可移植路径 → vault 相对路径。
 * 两者都还原不出来 = 这个文件不在当前 vault 里（工具目录在库外），跳过。
 */
function toVaultRelative(p: string): string | null {
  const s = norm(p);
  if (isPortablePath(s)) return s.slice(VAULT_PATH_PREFIX.length).replace(/^\/+/, '');
  if (basePath && s.startsWith(`${basePath}/`)) return s.slice(basePath.length + 1);
  return null;
}

/**
 * 预取整个工具坞需要读的东西。
 *
 * 读不到的（文件不存在 / 在 vault 外）就跳过 —— 上层会看到「读不到」，
 * 与桌面端缺文件时的表现一致，不需要另写一套降级。
 */
export async function primeVaultFs(app: App): Promise<void> {
  basePath = baseOf(app);

  // 1) 登记表自己：按数据目录的相对路径读，不依赖任何预置状态
  const registryRel = storageFile(REGISTRY_FILENAME);
  await primeOne(app, registryRel);

  // 2) 它点的名：解析登记表（走内存 fs，与真身同一段解析代码）
  const fs: DockFs = memoryFs;
  let entries: DockRegistryEntry[] = [];
  try {
    entries = readRegistryAt(registryRel, fs).registry.tools;
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    const declAbs = resolveToolPath(entry.path);
    await primeOne(app, declAbs);
    const rel = toVaultRelative(declAbs);
    if (!rel) continue;
    const dir = rel.slice(0, rel.lastIndexOf('/') + 1);
    // 与工具目录同级的六份伴生文件（用户填的值、意图、运行账、记录、心跳、展示板）
    for (const name of ['data.json', 'dock.intent.json', 'dock.runtime.json', 'runs.jsonl', 'heartbeat.json', 'panel.html']) {
      await primeOne(app, `${dir}${name}`);
    }
  }

  primed = true;
}

/** 读一份进内存。相对路径与绝对路径都收（内部统一转相对再交给适配器） */
async function primeOne(app: App, p: string): Promise<void> {
  const rel = toVaultRelative(p);
  if (!rel) return;
  try {
    const text = await app.vault.adapter.read(rel);
    put(p, text);
  } catch {
    /* 这个文件不在 / 读不了 —— 跳过 */
  }
}

/** 面板里显示的「从哪来的」：能转相对就转，转不了就原样（不给人看一长串绝对路径） */
export function displayPathOf(abs: string): string {
  const rel = toVaultRelative(abs);
  return rel ?? norm(abs);
}

/** 当前内存里有多少份文件（排障 / 测试用） */
export function primedCount(): number {
  return new Set([...mem.keys()].map(norm)).size;
}

/** 一个工具在内存里读得到声明吗（面板据此说「手机上读不到」） */
export function manifestPrimed(declPath: string): boolean {
  const text = currentFs()?.readText(declPath) ?? null;
  return !!text && !!parseManifest(safeJson(text));
}

function safeJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
