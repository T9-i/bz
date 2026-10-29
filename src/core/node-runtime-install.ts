/* ============================================================
 * bz · 便携 Node 运行时安装（core/node-runtime-install.ts）
 *
 * 为什么需要它：对外分发时**不能假设别人的电脑装了 Node**。而 Obsidian 自己不能当
 * Node 用（实测：`runAsNode` fuse 被关，`ELECTRON_RUN_AS_NODE=1 obsidian.exe x.js`
 * 会被当成 Obsidian 自己的 CLI 命令）。所以三个外部工具（知识盒工具包 / 工具坞工具包 / 脸谱工具包）
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
import { readOfflineBytes } from './offline-source';
import { fetchBytesWithProgress } from './net-progress';
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
  /** 进度回调（已收 / 总字节；总字节 0 = 未知）。只有走流式下载时才有中间值 */
  onProgress?: (received: number, total: number) => void;
}

export interface NodeInstallResult {
  /** 实际版本串（`-v` 的输出，如 v24.14.1） */
  version: string;
  /** 落盘的入口绝对路径 */
  path: string;
  /** 写入字节数 */
  bytes: number;
}

async function defaultFetchBytes(url: string, onProgress?: (r: number, t: number) => void): Promise<Uint8Array> {
  // 先试流式（能显示百分比）；拿不到就回落 requestUrl（绕 CORS、必通但不带进度）
  const streamed = await fetchBytesWithProgress(url, onProgress);
  if (streamed && streamed.byteLength) return streamed;
  const res = await requestUrl({ url, method: 'GET', throw: true });
  const ab = (res as { arrayBuffer?: ArrayBuffer }).arrayBuffer;
  if (!ab) throw new Error('响应没有二进制体');
  return new Uint8Array(ab);
}

/* ---------- 归档缓存（Defender 删掉 node.exe 之后不必重下 36MB） ---------- */

/**
 * 归档缓存目录（**downloads 相对**）。
 *
 * 为什么留一份 36MB 的 zip 在盘上：Windows Defender 见到一个刚下下来的、无签名的大 exe，
 * 有相当概率直接隔离。被隔离后 `node.exe` 不见了 → 探测判「没有运行时」→ 用户再点一次，
 * 又从网上拉 36MB。慢网下这一来一回是灾难，而归档还在盘上时，重装只要解一次压。
 *
 * 代价说明：多占 36MB。缓存只在**同一版本**有效（文件名带版本号），换版本时旧缓存
 * 靠 `pruneNodeCache` 顺手清掉。
 */
export const NODE_CACHE_REL = 'tools/.cache';

function cacheRelOf(plan: NodeArchivePlan): string {
  return `${NODE_CACHE_REL}/${plan.file}`;
}

interface AdapterLike {
  readBinary?: (p: string) => Promise<ArrayBuffer>;
  writeBinary?: (p: string, d: ArrayBuffer) => Promise<void>;
  remove?: (p: string) => Promise<void>;
}

function adapterOf(app: unknown): AdapterLike | null {
  return (app as { vault?: { adapter?: AdapterLike } })?.vault?.adapter ?? null;
}

/** 读缓存归档（读不到 / 空 → null） */
async function readCachedArchive(app: unknown, plan: NodeArchivePlan): Promise<Uint8Array | null> {
  const adapter = adapterOf(app);
  if (!adapter?.readBinary) return null;
  try {
    const ab = await adapter.readBinary(downloadsVaultPath(app, cacheRelOf(plan)));
    const bytes = new Uint8Array(ab);
    // 归档是压缩包，几十 MB；只要不是空/半截就给一次机会 —— 真正的把关在「解出的 node.exe
    // 够不够大」和「-v 跑不跑得起来」那两步，这里卡体积只会把合法的归档拦在门外
    return bytes.byteLength > 1024 ? bytes : null;
  } catch {
    return null;
  }
}

/** 写缓存（失败不影响安装：缓存是加速手段，不是正确性的一部分） */
async function writeCachedArchive(app: unknown, plan: NodeArchivePlan, bytes: Uint8Array): Promise<void> {
  const adapter = adapterOf(app);
  if (!adapter?.writeBinary) return;
  try {
    await ensureDir(app, cacheRelOf(plan));
    await adapter.writeBinary(
      downloadsVaultPath(app, cacheRelOf(plan)),
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  } catch {
    /* 缓存写不进去就算了 */
  }
}

async function dropCachedArchive(app: unknown, plan: NodeArchivePlan): Promise<void> {
  try {
    await adapterOf(app)?.remove?.(downloadsVaultPath(app, cacheRelOf(plan)));
  } catch {
    /* 本来就没了 */
  }
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
  const fetchBytes = deps.fetchBytes;
  const member = bundledNodeFile(platform);

  let lastErr = '';
  for (const plan of plans) {
    // ① 归档缓存：上次装成功留下的那份。Defender 隔离了 node.exe 时，这一步能免掉重下
    const cached = await readCachedArchive(app, plan);
    if (cached) {
      try {
        deps.onStage?.('用上次下载的归档重装（不联网）');
        const r = await installFromArchive(app, cached, plan, deps);
        return r;
      } catch (e) {
        // 缓存坏了（下了一半 / 版本错位）：删掉，继续往下走
        lastErr = `缓存归档不可用：${(e as Error)?.message || String(e)}`;
        await dropCachedArchive(app, plan);
      }
    }

    // ② 离线包（`<vault>/bz-offline/node/<归档>`）：封闭网络里它是唯一来源
    try {
      const offline = await readOfflineBytes(app, `node/${plan.file}`);
      if (offline && offline.byteLength > 0) {
        deps.onStage?.('用离线包安装 Node 运行时');
        const r = await installFromArchive(app, offline, plan, deps);
        await writeCachedArchive(app, plan, offline); // 下次重装连解压前的读盘都省
        return r;
      }
    } catch {
      /* 没有离线包 */
    }

    // ③ 双源下载
    for (const url of plan.urls) {
      try {
        deps.onStage?.(`正在下载 Node 运行时（约 36 MB）`);
        const archive = fetchBytes
          ? await fetchBytes(url)
          : await defaultFetchBytes(url, (got, total) => deps.onProgress?.(got, total));
        if (!archive.byteLength) {
          lastErr = `${url} 返回空内容`;
          continue;
        }
        if (archive.byteLength > MAX_ARCHIVE_BYTES) {
          lastErr = `${url} 体积异常（${archive.byteLength} 字节），拒收`;
          continue;
        }
        const r = await installFromArchive(app, archive, plan, deps);
        await writeCachedArchive(app, plan, archive);
        return r;
      } catch (e) {
        lastErr = `${url} → ${(e as Error)?.message || String(e)}`;
      }
    }
  }
  throw new Error(`Node 运行时安装失败：${lastErr}`);
}

/**
 * 从一份归档装出运行时（解包 → 落盘 → 跑一次 `-v`）。
 * 缓存、离线包、网络三条来源共用这一步 —— 三种来源的「装」必须完全一样，
 * 否则会出现「从网上下的能跑、从缓存装的不能跑」这种只在特定用户身上复现的问题。
 */
async function installFromArchive(
  app: unknown,
  archive: Uint8Array,
  plan: NodeArchivePlan,
  deps: NodeInstallDeps,
): Promise<NodeInstallResult> {
  const platform = plan.kind === 'zip' ? (deps.platform ?? currentPlatform()) : (deps.platform ?? currentPlatform());
  const member = bundledNodeFile(platform);

  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`归档体积异常（${archive.byteLength} 字节）`);
  }

  deps.onStage?.('正在解压');
  const bin = extractMember(archive, plan, deps);
  if (bin.byteLength < MIN_NODE_BYTES) {
    throw new Error(`解出的 ${member} 太小（${bin.byteLength} 字节），不像运行时`);
  }

  deps.onStage?.('正在写入插件目录');
  // 注意：这里是 **downloads 相对**路径——ensureDir / downloadsVaultPath 都会自己加
  // `downloads/` 前缀。早前用 NODE_RUNTIME_DIR（已含该前缀）会写成
  // `downloads/downloads/tools/...`：文件确实写成功了，但探测永远找不到它。
  const rel = portableNodeDownloadsRel(platform);
  await ensureDir(app, rel);
  const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
  const adapter = (app as { vault?: { adapter?: { writeBinary?: (p: string, d: ArrayBuffer) => Promise<void> } } }).vault
    ?.adapter;
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
    throw new Error('下载的 Node 无法运行（可能是网络中断或文件被拦截）');
  }
  return { version, path: `${pluginDirOf(app)}/${rel}`, bytes: bin.byteLength };
}

/** 便携 Node 是否已就位（只看文件在不在；能不能跑由 tool-runtime 的 -v 探测负责） */
/** 插件目录相对路径（诊断/展示用；探测口径同 tool-runtime） */
export function portableNodeRelPath(platform: string = currentPlatform()): string {
  return `${NODE_RUNTIME_DIR}/${bundledNodeFile(platform)}`;
}
