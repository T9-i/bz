/**
 * 登记表与信任 —— bz 侧**仅有的两份全局事实**（宿主侧：只负责算路径 + 读写信任）。
 *
 * | 东西 | 住哪 | 为什么 |
 * |---|---|---|
 * | 有哪些工具（id + 声明路径）+ 三个开关 | 数据目录的 `dock.json` | 跟着 `storagePath` 走，备份/迁移不漏 |
 * | 授权了哪条命令 | 插件设置 `dockTrust` | **刻意不住 vault** |
 *
 * 信任为什么不能进 `dock.json`：那份会随 vault 同步、进 git、被整个分享。授权要是也在里面，
 * 别人给你一份 vault 就等于把「已授权执行这条命令」一起送来了 —— 打开别人的仓库 = 在他机器上
 * 跑任意命令。这条边界跟怎么重写无关。
 *
 * `dock.json` 的读写本身在 `registry-file.ts`（零宿主依赖，值守进程共用同一份）。
 */

import { REGISTRY_FILENAME, type DockEntry, type DockRegistryEntry } from './types';
import { runSignature } from './parse';
import {
  readRegistryAt,
  removeToolAt,
  setSwitchAt,
  upsertToolAt,
  writeRegistryAt,
} from './registry-file';
import { currentFs, type DockFs } from './files';
import { storageFile } from '../core/storage';
import { saveSettings, tryGetSettings } from '../core/settings-provider';

/** 信任记录：授权时刻 + 当时那条命令的签名 */
export interface DockTrustRecord {
  at: string;
  run: string;
}

export const DOCK_TRUST_KEY = 'dockTrust';

/** 登记表文件名（导出给诊断用；与契约常量同源） */
export { REGISTRY_FILENAME };

/** 登记表路径（`storagePath` 变了它就跟着变；相对 vault 根） */
export function registryPath(): string {
  return storageFile(REGISTRY_FILENAME);
}

export function readRegistry(fs: DockFs | null = currentFs()): ReturnType<typeof readRegistryAt> {
  return readRegistryAt(registryPath(), fs);
}

export function writeRegistry(reg: Parameters<typeof writeRegistryAt>[1], fs: DockFs | null = currentFs()): boolean {
  return writeRegistryAt(registryPath(), reg, fs);
}

/** 加一条登记（同 id 覆盖路径，否则追加） */
export function upsertTool(entry: DockRegistryEntry, fs?: DockFs | null): ReturnType<typeof upsertToolAt> {
  return upsertToolAt(registryPath(), entry, fs === undefined ? currentFs() : fs);
}

export function removeTool(id: string, fs?: DockFs | null): ReturnType<typeof removeToolAt> {
  return removeToolAt(registryPath(), id, fs === undefined ? currentFs() : fs);
}

export function setSwitch(
  key: 'autoRun' | 'watchdog' | 'notifyMissed',
  value: boolean,
  fs?: DockFs | null,
): ReturnType<typeof setSwitchAt> {
  return setSwitchAt(registryPath(), key, value, fs === undefined ? currentFs() : fs);
}

// ==================== 信任 ====================

/** 读信任表（脏条目丢弃） */
export function readTrust(): Record<string, DockTrustRecord> {
  const raw = (tryGetSettings() as Record<string, unknown>)[DOCK_TRUST_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, DockTrustRecord> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const r = v as Record<string, unknown>;
    const at = typeof r.at === 'string' ? r.at : '';
    const run = typeof r.run === 'string' ? r.run : '';
    if (!at) continue;
    out[id] = { at, run };
  }
  return out;
}

/** 授权一条命令 —— 对象永远是声明里**现读出来**的那条，不给手写入 */
export async function trustTool(id: string, entry: DockEntry): Promise<void> {
  const trust = readTrust();
  trust[id] = { at: new Date().toISOString(), run: runSignature(entry) };
  const settings = tryGetSettings() as Record<string, unknown>;
  settings[DOCK_TRUST_KEY] = trust;
  await saveSettings();
}

/** 撤销授权（只删这一条，不动登记表） */
export async function untrustTool(id: string): Promise<void> {
  const trust = readTrust();
  if (!(id in trust)) return;
  delete trust[id];
  const settings = tryGetSettings() as Record<string, unknown>;
  settings[DOCK_TRUST_KEY] = trust;
  await saveSettings();
}
