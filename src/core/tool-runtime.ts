/* ============================================================
 * bz · 外部工具的运行时解析（core/tool-runtime.ts）
 *
 * 问题：此前三个外部工具全靠「PATH 上有个全局安装的命令」——
 *   `bili-dl`（知识盒）、`bz-face`（脸谱）、`node`（值守）。自用机器上装好了，
 *   别人机器上就是「找不到命令 / 没装 Node」，而安装指引写的是 `npm install -g <仓库路径>`
 *   —— 对外分发等于没有指引。
 *
 * 现在两件事分开：
 *   1. **包**从在线资源下载进插件目录（`downloads/tools/<id>/`，见 core/bundle-asset.ts）；
 *   2. **解释器**按「插件内便携 node → 系统 node」的顺序探测。
 *
 * 为什么不用 Obsidian 自己的 exe 当 node：**实测不可行**（2026-10-28）。Obsidian 关掉了
 * Electron 的 `runAsNode` fuse，`ELECTRON_RUN_AS_NODE=1 obsidian.exe script.js` 会把它
 * 当成 Obsidian 自己的 CLI 命令，回一句 `Command "…" not found`。所以解释器只能另找。
 *
 * 回落链是刻意的：**本地包优先，PATH 兜底**。已经全局装过工具的老用户一个字都不用改
 * （行为和以前完全一样）；新用户下了包就自动走本地，不必再碰终端。
 *
 * 附带的好处：本地包走 `shell:false` + 参数数组。此前 `.cmd` shim 必须 `shell:true`，
 * 而 cmd 对引号、空格、中文、`&` 的解析规则是 Windows 上最经典的一类坑（vault 路径带
 * 空格或中文是常态）。数组参数没有这一层，路径原样到达进程。
 * ============================================================ */
import { DOWNLOADS_DIR, downloadsVaultPath } from './remote-asset';
import { bundledNodeFile, NODE_RUNTIME_DIR } from './node-runtime-install';
import { pluginDirOf, vaultBasePathOf } from './plugin-path';
import { getApp } from './app';

/** 工具 id（= online 资源 id = downloads/tools/ 下的目录名） */
export type ToolId = 'bili-downloader' | 'obsidian-face' | 'dock-watch';

/** 包内的入口脚本（相对包根）与命令名（PATH 回落时用的那个） */
export interface ToolEntry {
  /** 包内入口脚本（相对 downloads/tools/<id>/） */
  script: string;
  /** PATH 回落用的命令名（老用户的全局安装） */
  command: string;
  /** 人话名字（错误消息里用） */
  label: string;
}

export const TOOL_ENTRIES: Record<ToolId, ToolEntry> = {
  'bili-downloader': { script: 'cli.js', command: 'bili-dl', label: 'B站下载器' },
  'obsidian-face': { script: 'bin/bz-face.js', command: 'bz-face', label: '脸谱工具包' },
  'dock-watch': { script: 'cli.js', command: 'bz-dock-watch', label: '工具坞值守' },
};

/** Node 运行时探测结果 */
export interface NodeRuntime {
  /** `bundled` = 插件目录下的便携 node；`system` = PATH 上的；`none` = 都没有 */
  kind: 'bundled' | 'system' | 'none';
  /** 可执行文件绝对路径（none 时为空串） */
  path: string;
  /** 版本串（拿到才填；探测不到不影响可用性判断） */
  version: string;
}

/** 解析结果：直接喂给 runExternalTool 的 spec 片段 */
export interface ResolvedToolCommand {
  cmd: string;
  args: string[];
  /** true = 经 shell 启动（只有 PATH 回落那条路需要：Windows 的 .cmd shim） */
  shell: boolean;
  /** 这次走的是本地包还是 PATH（调用方据此说人话） */
  via: 'bundle' | 'path';
}

function isWindows(): boolean {
  return typeof process !== 'undefined' && process.platform === 'win32';
}

/** 便携 node 的落位目录（与 node-runtime-install 同一常量，避免两处各写一份） */
const BUNDLED_NODE_DIR = NODE_RUNTIME_DIR;

// vaultBasePathOf / pluginDirOf 的唯一实现在 core/plugin-path（插件目录名由用户决定，
// 写死 `plugins/bz` 会让「下载落位」与「探测口径」错位，表现为下载成功但功能不可用）——
// 这里 re-export，既有导入路径不变。
export { pluginDirOf, vaultBasePathOf };

/** 已下载的包目录（相对 downloads/） */
export function toolBundleDir(id: ToolId): string {
  return `${DOWNLOADS_DIR}/tools/${id}`;
}

/** 本地 node 与工具入口在文件系统上的绝对路径（相对路径拼在插件目录后面） */
function fsPath(app: unknown, rel: string): string {
  const dir = pluginDirOf(app);
  return dir ? `${dir}/${rel}` : '';
}

/** spawn 用子进程模块（桌面端才有；移动端 → null） */
function childProcess(): any {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  if (!w?.require) return null;
  try {
    return w.require('child_process');
  } catch {
    return null;
  }
}

/** 文件是否存在（用 fs 直查——这条路径在插件目录里，不走 vault 索引）。
 *  测试环境没有 `window.require`，用 `setFsProbe` 注入一个假的。 */
let fsProbe: ((p: string) => boolean) | null = null;

/** 注入文件探测（仅测试用；生产恒走桌面端 fs） */
export function setFsProbe(fn: ((p: string) => boolean) | null): void {
  fsProbe = fn;
  cachedNode = null;
}

function existsOnDisk(p: string): boolean {
  if (!p) return false;
  if (fsProbe) return fsProbe(p);
  const w = typeof window !== 'undefined' ? (window as any) : null;
  try {
    const fs = w?.require?.('fs');
    if (fs?.existsSync) return !!fs.existsSync(p);
  } catch {
    /* 移动端 / 无 node integration */
  }
  return false;
}

/** 会话级缓存：node 探测每次开面板都跑一遍 spawnSync 没必要 */
let cachedNode: NodeRuntime | null = null;

/** 重置探测缓存（测试用 / 用户刚下载完便携 node） */
export function resetNodeRuntimeCache(): void {
  cachedNode = null;
}

/**
 * 探测 Node 运行时（带会话缓存）。
 * 顺序：插件目录里的便携 node → PATH 上的 node → none。
 * **不抛错**：探测不到是正常结局（调用方据此给「去下载」的指引）。
 */
export function probeNodeRuntime(app: unknown, opts: { fresh?: boolean } = {}): NodeRuntime {
  if (!opts.fresh && cachedNode) return cachedNode;

  const bundled = fsPath(app, `${BUNDLED_NODE_DIR}/${bundledNodeFile()}`);
  if (existsOnDisk(bundled)) {
    const v = nodeVersionOf(bundled);
    cachedNode = { kind: 'bundled', path: bundled, version: v };
    return cachedNode;
  }

  const cp = childProcess();
  const sysPath = findOnPath(cp, 'node');
  if (sysPath) {
    cachedNode = { kind: 'system', path: sysPath, version: nodeVersionOf(sysPath) };
    return cachedNode;
  }

  cachedNode = { kind: 'none', path: '', version: '' };
  return cachedNode;
}

/** `node -v` 拿版本串（失败 → 空串；不阻断可用性判断） */
function nodeVersionOf(nodePath: string): string {
  const cp = childProcess();
  if (!cp?.spawnSync) return '';
  try {
    const r = cp.spawnSync(nodePath, ['-v'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return String(r?.stdout || '').trim();
  } catch {
    return '';
  }
}

/** PATH 上找一个可执行（`where` / `which`）；找不到 → 空串 */
function findOnPath(cp: any, name: string): string {
  if (!cp?.spawnSync) return '';
  const cmd = isWindows() ? 'where' : 'which';
  try {
    const r = cp.spawnSync(cmd, [name], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (r?.status !== 0) return '';
    const first = String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
    return first;
  } catch {
    return '';
  }
}

/** 只解析「用谁跑」（不涉及业务参数）——域侧自己拼 args 时用这个 */
export interface ToolCommandBase {
  cmd: string;
  /** true = 经 shell 启动（只有 PATH 回落那条路需要：Windows 的 .cmd shim） */
  shell: boolean;
  via: 'bundle' | 'path';
}

/**
 * 解析工具的命令行（不含业务参数）。
 *
 * - 本地包在（`downloads/tools/<id>/<script>` 存在）**且**有 node → 绝对路径 + `shell:false`；
 * - 否则回落 PATH 上的命令名（`shell:true`，Windows 的 `.cmd` shim 需要）。
 *
 * 域侧拼参数时**必须看 `shell`**：走 shell 的那条路要给含空格的路径包引号，走数组参数的
 * 那条路包了引号反而会把引号当路径的一部分（core/tool-runtime 不替它们决定这件事）。
 */
export function resolveToolBase(app: unknown, id: ToolId): ToolCommandBase {
  const entry = TOOL_ENTRIES[id];
  const script = fsPath(app, `${toolBundleDir(id)}/${entry.script}`);
  const node = probeNodeRuntime(app);
  if (script && node.kind !== 'none' && existsOnDisk(script)) {
    return { cmd: node.path, shell: false, via: 'bundle' };
  }
  return { cmd: entry.command, shell: true, via: 'path' };
}

/**
 * `resolveToolBase` 的**不抛版**：app 还没初始化（单测 / 早期调用）时回落 PATH 口径。
 *
 * 存在的理由：域侧那几个 `buildXxxSpec` 是纯函数、被单测直接调（没有 app），但它们
 * 又确实需要知道「这台机器上该用哪条命令」。让它们全部多一个 `command` 参数，会把
 * 「谁负责解析运行时」这件事散到每个调用点；这里集中收口一次，纯函数内部调它即可。
 */
export function safeToolBase(id: ToolId): ToolCommandBase {
  try {
    return resolveToolBase(getApp(), id);
  } catch {
    return { cmd: TOOL_ENTRIES[id].command, shell: true, via: 'path' };
  }
}

/**
 * 解析一条完整的工具命令（业务参数接在入口脚本/命令名之后）。
 *
 * @param args 业务参数（本地包路径下它们会原样进 spawn 的 argv 数组）
 */
export function resolveToolCommand(app: unknown, id: ToolId, args: string[] = []): ResolvedToolCommand {
  const entry = TOOL_ENTRIES[id];
  const base = resolveToolBase(app, id);
  if (base.via === 'bundle') {
    const script = fsPath(app, `${toolBundleDir(id)}/${entry.script}`);
    return { cmd: base.cmd, args: [script, ...args], shell: false, via: 'bundle' };
  }
  return { cmd: base.cmd, args, shell: true, via: 'path' };
}

/** 工具是否已就绪（本地包在，或 PATH 上有命令）——用于面板「装没装」的一句话 */
export function toolReadyState(app: unknown, id: ToolId): { ready: boolean; via: 'bundle' | 'path' | 'none' } {
  const entry = TOOL_ENTRIES[id];
  const script = fsPath(app, `${toolBundleDir(id)}/${entry.script}`);
  if (script && existsOnDisk(script) && probeNodeRuntime(app).kind !== 'none') return { ready: true, via: 'bundle' };
  const cp = childProcess();
  if (findOnPath(cp, entry.command)) return { ready: true, via: 'path' };
  return { ready: false, via: 'none' };
}

/**
 * 工具没装时给人看的那句话。
 * 引导语必须指向**用户真能点的地方**（设置面板的在线资源组），而不是一条终端命令——
 * 对外分发的第一原则：不要让人复制粘贴。
 */
export function toolInstallHint(id: ToolId): string {
  const entry = TOOL_ENTRIES[id];
  return `未找到${entry.label}：到「设置 → 通用 → 在线资源」里下载它，下载完即可用`;
}

/** 装了包但没有 Node 时的指引（比「未找到工具」更精确，少让人白试一遍） */
export function nodeMissingHint(id: ToolId): string {
  const entry = TOOL_ENTRIES[id];
  // Node 不在在线资源清单里（它没有仓库产物，是运行时现下的），所以指向「环境自检」——
  // 那里有「一键补齐」，也是首次引导走完后的常驻入口。
  return `${entry.label}已下载，但本机没有可用的 Node 运行时：到「设置 → 通用 → 关于 → 环境自检」一键补齐后重试`;
}

/** 诊断用：把「这台机器上到底探到了什么」摊平成几行（面板/报障截图用） */
export function runtimeDiagnostics(app: unknown): Array<{ key: string; value: string }> {
  const node = probeNodeRuntime(app);
  const rows: Array<{ key: string; value: string }> = [
    { key: '插件目录', value: pluginDirOf(app) || '(取不到 vault 路径)' },
    {
      key: 'Node 运行时',
      value:
        node.kind === 'none'
          ? '未找到'
          : `${node.kind === 'bundled' ? '插件内' : '系统'}${node.version ? ` ${node.version}` : ''}（${node.path}）`,
    },
  ];
  for (const id of Object.keys(TOOL_ENTRIES) as ToolId[]) {
    const st = toolReadyState(app, id);
    rows.push({
      key: TOOL_ENTRIES[id].label,
      value: st.via === 'bundle' ? '已下载' : st.via === 'path' ? '用系统里已装的命令' : '未安装',
    });
  }
  return rows;
}

/** 供 UI 显示解包目录（「装在哪」这类问题一句话答完） */
export function toolVaultDir(app: unknown, id: ToolId): string {
  return downloadsVaultPath(app, toolBundleDir(id));
}
