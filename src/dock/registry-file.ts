/**
 * 登记表 `dock.json` 的**纯读写** —— 路径由调用方给，这一层不知道 Obsidian 存在。
 *
 * 为什么从 `registry.ts` 里拆出来：值守进程（`tools/dock-watch/`）也要读同一份登记表，
 * 但它跑在插件进程之外，拿不到 `storageFile()`（那条链要 `getApp()`）。
 * 与其让值守自己写一份「怎么找 dock.json」，不如把路径推导留在宿主侧、读写留在这一层 ——
 * **同一份解析、同一份容错**，两边不会读出两种结论。
 *
 * 宿主侧（`registry.ts`）只做两件事：算出路径、转发。
 */

import { emptyRegistry, parseRegistry } from './parse';
import type { DockRegistry, DockRegistryEntry, DockSwitchKey } from './types';
import { readTextOf, writeAtomic, type DockFs } from './files';

export interface RegistryRead {
  registry: DockRegistry;
  /** 第一条可读的错误（给面板显示，不抛） */
  error?: string;
}

/** 读登记表。读不到 / 坏了 → 空表 + 一句人话 */
export function readRegistryAt(path: string, fs: DockFs | null): RegistryRead {
  const text = readTextOf(path, fs);
  if (text === null) return { registry: emptyRegistry() };
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    return { registry: emptyRegistry(), error: '登记表不是合法 JSON，已按空处理' };
  }
  const parsed = parseRegistry(raw);
  return { registry: parsed.registry, error: parsed.errors[0] };
}

export function writeRegistryAt(path: string, reg: DockRegistry, fs: DockFs | null): boolean {
  if (!fs) return false;
  return writeAtomic(fs, path, JSON.stringify(reg, null, 2));
}

/** 加一条登记（同 id 覆盖路径，否则追加） */
export function upsertToolAt(path: string, entry: DockRegistryEntry, fs: DockFs | null): DockRegistry {
  const { registry } = readRegistryAt(path, fs);
  const i = registry.tools.findIndex((t) => t.id === entry.id);
  const tools = registry.tools.slice();
  if (i >= 0) tools[i] = entry;
  else tools.push(entry);
  const next: DockRegistry = { ...registry, tools };
  writeRegistryAt(path, next, fs);
  return next;
}

export function removeToolAt(path: string, id: string, fs: DockFs | null): DockRegistry {
  const { registry } = readRegistryAt(path, fs);
  const next: DockRegistry = { ...registry, tools: registry.tools.filter((t) => t.id !== id) };
  writeRegistryAt(path, next, fs);
  return next;
}

export function setSwitchAt(
  path: string,
  key: DockSwitchKey,
  value: boolean,
  fs: DockFs | null,
): DockRegistry {
  const { registry } = readRegistryAt(path, fs);
  const next: DockRegistry = { ...registry, [key]: value };
  writeRegistryAt(path, next, fs);
  return next;
}
