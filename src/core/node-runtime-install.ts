/* ============================================================
 * bz · 便携 Node 运行时安装（core/node-runtime-install.ts）
 *
 * 为什么需要它：对外分发时**不能假设别人的电脑装了 Node**。而 Obsidian 自己不能当
 * Node 用（实测：`runAsNode` fuse 被关，`ELECTRON_RUN_AS_NODE=1 obsidian.exe x.js`
 * 会被当成 Obsidian 自己的 CLI 命令）。所以三个外部工具（B站下载器 / 值守 / 脸谱）
 * 在干净机器上唯一的出路是：**把一份 Node 下下来，放进插件目录**。
 *
 * 落位：`<插件目录>/downloads/tools/node-runtime/`（Windows = `node.exe`，
 * macOS / Linux = `bin/node`）——与 core/tool-runtime 的探测口径逐字对应。
 *
 * 取包：官方发布页双源——npmmirror 镜像（国内快）→ nodejs.org 官方（兜底）。
 *  - Windows 官方只发 `.zip` → 走 core/zip.ts；
 *  - macOS / Linux 发 `.tar.gz` → 走 core/tar.ts（现成的）。
 *
 * 三道验证，缺一不可：归档内条目 crc32（zip）/ 字节数（tar）→ 落盘后跑一次
 * `-v` 拿到版本串。跑不起来就删掉并抛错——留一个坏 exe 在盘上，下次探测会
 * 判「已有运行时」，症状变成「工具装了但一启动就失败」，比没有更难查。
 * ============================================================ */
import { requestUrl } from 'obsidian';
import { DOWNLOADS_DIR, downloadsVaultPath, ensureDir } from './remote-asset';
import { pluginDirOf } from './plugin-path';
import { extractZipEntry, findZipEntry, readZipEntries } from './zip';
import { untar } from './tar';
import type { TarFile } from './tar';

/** 便携运行时的版本（LTS 线；升级时改这一个常量，双源的目录名都跟着变） */
export const PORTABLE_NODE_VERSION = 'v24.14.1';

/** 落位目录（相对 downloads/；adapter 的 ensureDir / downloadsVaultPath 都吃这个口径） */
export const NODE_RUNTIME_REL = 'tools/node-runtime';

/** 落位目录（**插件目录相对**，含 downloads/ 前缀）——tool-runtime 拼绝对路径时用这个，
 *  两处必须一致，否则「写在这里、找在那里」。 */
export const NODE_RUNTIME_DIR = `${DOWNLOADS_DIR}/${NODE_RUNTIME_REL}`;

/** 入口文件的 downloads 相对路径（写盘用） */
export function portableNodeDownloadsRel(platform: string = currentPlatform()): string {
  return `${NODE_RUNTIME_REL}/${bundledNodeFile(platform)}`;
}

/** 解包后入口文件名（相对 NODE_RUNTIME_DIR） */
export function bundledNodeFile(platform: string = currentPlatform()): string {
  return platform === 'win32' ? 'node.exe' : 'bin/node';
}

/** 运行时体积的量级护栏（下载/解压异常大的包直接拒收） */
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MIN_NODE_BYTES = 5 * 1024 * 1024;

function currentPlatform(): string {
  return typeof process !== 'undefined' && process.platform ? process.platform : 'win32';
}

function currentArch(): string {
  return typeof process !== 'undefined' && process.arch ? process.arch : 'x64';
}

/** 一份可选的归档（同一版本可能有多个候选 URL / 多种归档格式） */
export interface NodeArchivePlan {
  version: string;
  /** 归档文件名（双源同名） */
  file: string;
  /** 归档内要取的条目（尾部匹配） */
  member: string;
  kind: 'zip' | 'tar.gz';
  /** 依次尝试的下载地址 */
  urls: string[];
}

/**
 * 列出该平台可用的归档。空数组 = 这个平台/架构没有官方产物（调用方如实报「不支持」）。
 * @param platform process.platform
 * @param arch process.arch（x64 / arm64）
 */
export function nodeArchivePlans(
  platform: string = currentPlatform(),
  arch: string = currentArch(),
  version: string = PORTABLE_NODE_VERSION,
): NodeArchivePlan[] {
  const supported = ['x64', 'arm64'];
  if (!supported.includes(arch)) return [];
  if (platform === 'win32') {
    const file = `node-${version}-win-${arch}.zip`;
    return [{ version, file, member: 'node.exe', kind: 'zip', urls: archiveUrls(version, file) }];
  }
  if (platform === 'darwin' || platform === 'linux') {
    const file = `node-${version}-${platform}-${arch}.tar.gz`;
    return [{ version, file, member: 'bin/node', kind: 'tar.gz', urls: archiveUrls(version, file) }];
  }
  return [];
}

/** 双源：npmmirror 镜像优先（国内直连快），nodejs.org 官方兜底 */
function archiveUrls(version: string, file: string): string[] {
  return [
    `https://registry.npmmirror.com/-/binary/node/${version}/${file}`,
    `https://nodejs.org/dist/${version}/${file}`,
  ];
}

/** 下载依赖（测试注入；缺省 requestUrl 的 arrayBuffer） */
export interface NodeInstallDeps {
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  inflateRaw?: (data: Uint8Array) => Uint8Array;
  gunzip?: (data: Uint8Array) => Uint8Array;
  platform?: string;
  arch?: string;
  /** 阶段回调（「正在下载」「正在解压」这类人话，UI 拿去显示） */
  onStage?: (stage: string) => void;
}

export interface NodeInstallResult {
  /** 实际版本串（`-v` 的输出，如 v24.14.1） */
  version: string;
  /** 落盘的入口绝对路径 */
  path: string;
  /** 写入字节数 */
  bytes: number;
}

async function defaultFetchBytes(url: string): Promise<Uint8Array> {
  const res = await requestUrl({ url, method: 'GET', throw: true });
  const ab = (res as { arrayBuffer?: ArrayBuffer }).arrayBuffer;
  if (!ab) throw new Error('响应没有二进制体');
  return new Uint8Array(ab);
}

/** 缺省 gunzip（tar.gz 走这里；与 bundle-asset 同源） */
function defaultGunzip(bytes: Uint8Array): Uint8Array {
  const w = typeof window !== 'undefined' ? (window as any) : null;
  const zlib = w?.require?.('zlib');
  if (!zlib?.gunzipSync) throw new Error('当前环境不支持解压（便携 Node 需要桌面端）');
  const Buf: any = typeof Buffer !== 'undefined' ? Buffer : w?.require?.('buffer')?.Buffer;
  if (!Buf) throw new Error('当前环境不支持解压（缺少 Buffer）');
  const out = zlib.gunzipSync(Buf.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/** 从归档里取出入口文件字节 */
function extractMember(archive: Uint8Array, plan: NodeArchivePlan, deps: NodeInstallDeps): Uint8Array {
  if (plan.kind === 'zip') {
    const entries = readZipEntries(archive);
    const entry = findZipEntry(entries, plan.member);
    if (!entry) throw new Error(`${plan.file} 里没有 ${plan.member}`);
    return extractZipEntry(archive, entry, { inflateRaw: deps.inflateRaw });
  }
  // 官方 tar.gz 展开后含 include/node 头文件与 npm，整体 150MB 上下——远超 core/tar 的
  // 默认上限（128MB，那个值是给插件自己的小包用的）。这里单独放宽，别让「包太大」这种
  // 与安全无关的理由把 macOS / Linux 用户挡在门外。
  const files: TarFile[] = untar((deps.gunzip ?? defaultGunzip)(archive), {
    maxEntries: 50000,
    maxTotalBytes: 512 * 1024 * 1024,
  });
  const want = `/${plan.member}`;
  const hit = files.find((f) => f.path === plan.member || f.path.endsWith(want));
  if (!hit) throw new Error(`${plan.file} 里没有 ${plan.member}`);
  return hit.data;
}

/** `node -v`：跑得起来才算装好（这步不过，前面的字节校验都只是形式） */
function runNodeVersion(binPath: string): string {
  if (typeof window === 'undefined') return '';
  try {
    const cp = (window as any).require?.('child_process');
    if (!cp?.spawnSync) return '';
    // 30s 而不是 8s：第一次执行一个 90MB 的 exe 时，Windows Defender 会当场全量扫一遍，
    // 冷机上实测能卡十几秒。卡住被 kill → status 为 null → 会被误判成「装了但跑不起来」，
    // 然后我们把一个好好的 node.exe 删掉，用户看到的是「下载失败」。
    const r = cp.spawnSync(binPath, ['-v'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    if (r?.status === 0) return String(r.stdout || '').trim();
    if (r?.error) console.warn('[bz] 便携 Node 验证失败：', (r.error as Error)?.message || r.error);
    return '';
  } catch {
    return '';
  }
}

/** 删掉半成品（失败收尾；删不掉也无所谓，探测会因为跑不起来而继续回落） */
async function removeQuietly(app: unknown, rel: string): Promise<void> {
  try {
    const adapter = (app as { vault?: { adapter?: { remove?: (p: string) => Promise<void> } } }).vault?.adapter;
    await adapter?.remove?.(downloadsVaultPath(app, rel));
  } catch {
    /* 不存在 / 不支持：忽略 */
  }
}

/**
 * 下载并安装便携 Node 到插件目录。
 * 失败一律抛错（含平台不支持 / 双源都不通 / 解出来的可执行跑不起来）。
 */
export async function installPortableNode(app: unknown, deps: NodeInstallDeps = {}): Promise<NodeInstallResult> {
  const platform = deps.platform ?? currentPlatform();
  const arch = deps.arch ?? currentArch();
  const plans = nodeArchivePlans(platform, arch);
  if (!plans.length) {
    throw new Error(`本平台没有官方 Node 产物（${platform}/${arch}）：请自行安装 Node.js 后重试`);
  }
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
  const member = bundledNodeFile(platform);

  let lastErr = '';
  for (const plan of plans) {
    for (const url of plan.urls) {
      try {
        deps.onStage?.(`正在下载 Node 运行时（约 36 MB）`);
        const archive = await fetchBytes(url);
        if (!archive.byteLength) {
          lastErr = `${url} 返回空内容`;
          continue;
        }
        if (archive.byteLength > MAX_ARCHIVE_BYTES) {
          lastErr = `${url} 体积异常（${archive.byteLength} 字节），拒收`;
          continue;
        }
        deps.onStage?.('正在解压');
        const bin = extractMember(archive, plan, deps);
        if (bin.byteLength < MIN_NODE_BYTES) {
          lastErr = `${url} 解出的 ${member} 太小（${bin.byteLength} 字节），不像运行时`;
          continue;
        }

        deps.onStage?.('正在写入插件目录');
        // 注意：这里是 **downloads 相对**路径——ensureDir / downloadsVaultPath 都会自己加
        // `downloads/` 前缀。早前用 NODE_RUNTIME_DIR（已含该前缀）会写成
        // `downloads/downloads/tools/...`：文件确实写成功了，但探测永远找不到它。
        const rel = portableNodeDownloadsRel(platform);
        await ensureDir(app, rel);
        const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
        const adapter = (app as { vault?: { adapter?: { writeBinary?: (p: string, d: ArrayBuffer) => Promise<void> } } })
          .vault?.adapter;
        if (!adapter?.writeBinary) throw new Error('当前环境无法写入二进制文件（便携 Node 需要桌面端）');
        await adapter.writeBinary(downloadsVaultPath(app, rel), ab);

        // POSIX 需要可执行位（adapter 不管这个，只能走真实文件系统）
        if (platform !== 'win32') {
          try {
            const abs = `${pluginDirOf(app)}/${rel}`;
            (window as any).require?.('fs')?.chmodSync?.(abs, 0o755);
          } catch {
            /* 权限位失败交给下面 -v 判定 */
          }
        }

        deps.onStage?.('正在验证');
        // 验证用的是**插件目录相对**路径（含 downloads/），别拿写盘那条 downloads 相对路径
        const version = runNodeVersion(`${pluginDirOf(app)}/${portableNodeRelPath(platform)}`);
        if (!version) {
          await removeQuietly(app, rel);
          lastErr = '下载的 Node 无法运行（可能是网络中断或文件被拦截）';
          continue;
        }
        return { version, path: `${pluginDirOf(app)}/${rel}`, bytes: bin.byteLength };
      } catch (e) {
        lastErr = `${url} → ${(e as Error)?.message || String(e)}`;
      }
    }
  }
  throw new Error(`Node 运行时安装失败：${lastErr}`);
}

/** 便携 Node 是否已就位（只看文件在不在；能不能跑由 tool-runtime 的 -v 探测负责） */
/** 插件目录相对路径（诊断/展示用；探测口径同 tool-runtime） */
export function portableNodeRelPath(platform: string = currentPlatform()): string {
  return `${NODE_RUNTIME_DIR}/${bundledNodeFile(platform)}`;
}
