/**
 * 值守进程的唯一入口面 —— **`tools/dock-watch/dock-core.cjs` 就是从这打出去的**。
 *
 * 这个文件刻意只有一个职责：把「零宿主依赖」的那一半模块挑出来导出。
 * 一旦这里混进碰 Obsidian API 的模块（`ui` / `host` / `registry` / `settings` / `vault-fs`），
 * 值守进程启动就会 `require('obsidian')` 崩掉 —— 所以 `scripts/build-dock-watch.mjs`
 * 打包后会扫产物里有没有 `obsidian`，有就删产物报错。
 *
 * 判据、执行、记账、一拍调度**全在这里面**：值守不实现任何调度逻辑，
 * 它只负责「什么时候调一次 `tickOnce`」以及「把本机状态写下来」。
 */

// ==================== 契约常量与形状 ====================
export * from './types';

// ==================== 解析（全部值到形状的唯一入口） ====================
export {
  buildArgs,
  findByRunId,
  latestRun,
  makeRunId,
  parseIntent,
  parseManifest,
  parseRegistry,
  parseRunLines,
  parseRuntime,
  parseSettingsText,
  runSignature,
  secretEnvOf,
} from './parse';

// ==================== 判据（纯函数） ====================
export { actionText, isEventTrigger, nextDueOf, ruleDue, ruleName, triggerText } from './rules';

// ==================== 视图 ====================
export { displayNameOf, loadToolView, loadToolViews, type TrustMap } from './view';

// ==================== 内核 ====================
export {
  clearBreaker,
  MAX_ATTEMPTS,
  missingParams,
  planTick,
  reclaimStale,
  runTick,
  settle,
  type Decision,
  type SkipReason,
} from './kernel';

/** 一拍（插件与值守共用这一处） */
export { KEEP_ALIVE_MS, tickOnce, type TickOnceOpts, type TickOnceResult } from './tick-once';

// ==================== 执行权 ===
export { acquireLock, inspectLock, withLock, type LockHandle, type LockInfo } from './lock';

// ==================== 执行与判定 ====================
export {
  hintOf,
  judgeRun,
  liveAll,
  liveOf,
  runToolNow,
  setExecDeps,
  statusText,
  type LiveRun,
} from './exec';

// ==================== 文件缝 ====================
export {
  currentFs,
  dirOf,
  dockVaultRootNow,
  isPortablePath,
  joinPath,
  pathOf,
  portableToolPath,
  readTextOf,
  resolveToolPath,
  setDockFs,
  setDockVaultRoot,
  writeAtomic,
  type DockFs,
} from './files';

// ==================== 登记表（纯读写） ====================
export { readRegistryAt, removeToolAt, setSwitchAt, upsertToolAt, writeRegistryAt } from './registry-file';

// ==================== 数据目录口径（与插件同源） ====================
export { DEFAULT_STORAGE_DIR, normalizeStorageDir, storageFileIn } from '../core/storage-path';
