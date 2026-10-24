/**
 * 工具坞域入口（dock）：外部工具的登记、授权、运行、记账、调度。
 *
 * 契约 v2 —— **不认旧文件、不认旧字段**。整域只有三份真相：
 *  工具目录里的 `manifest.json`（作者写的）、`dock.intent.json`（人定的）、`dock.runtime.json`（机器记的）；
 *  外加数据目录的 `dock.json`（有哪些工具）与本机设置里的 `dockTrust`（授权）。
 *
 * 命令注册在 `main.ts`：`bz-dock-open` 在命令表里，每个已登记的工具另有一条直达运行命令。
 */

import { readRegistry, readTrust, setSwitch } from './registry';
import { loadToolView } from './view';

export { openDock, closeDock, unloadDock, ensureDock, openToolPanel } from './ui';
export { runToolDirect, dockToolLabel, judgeRunGate } from './command';
export { startDockScheduler, stopDockScheduler, kickDockScheduler, notifyDockEvent } from './host';
export { mountDockStatusBar, unmountDockStatusBar } from './statusbar';

/** 执行依赖注入缝（测试 / 评审壳塞假 child_process） */
export { setExecDeps as setDockRuntimeDeps } from './exec';
/** fs 注入缝（测试塞假 fs；移动端指向内存读桥） */
export { setDockFs } from './files';
/** 移动端只读读桥 */
export { installVaultFs, uninstallVaultFs, hasVaultFs, primeVaultFs, primePathsOf } from './vault-fs';

/** 登记表读取（main.ts 启动时按它注册直达命令） */
export function readToolEntries(): { id: string; path: string; enabled: boolean }[] {
  const { registry } = readRegistry();
  const trust = readTrust();
  return registry.tools.map((e) => ({
    id: e.id,
    path: e.path,
    enabled: loadToolView(e, { trust }).intent.enabled !== false,
  }));
}

/** 三个全域开关（设置页 / 调度器读） */
export function readDockSwitch(key: 'autoRun' | 'watchdog' | 'notifyMissed'): boolean {
  return readRegistry().registry[key];
}

export function saveDockSwitch(key: 'autoRun' | 'watchdog' | 'notifyMissed', value: boolean): void {
  setSwitch(key, value);
}

/** 登记表路径与文件名（诊断 / 数据体检用） */
export { registryPath as dockStorePath, DOCK_TRUST_KEY } from './registry';
export const DOCK_STORE_FILENAME = 'dock.json';

/** 启动时初始化（一切都是现读，没有需要预热的缓存；保留入口给宿主统一调用） */
export async function initDock(): Promise<void> {
  /* 空实现：上面所有读都是现读 */
}
