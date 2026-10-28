/* ============================================================
 * bz · 目录包资源（core/bundle-asset.ts）
 *
 * 在线资源的第二种形态（2026-10-28 对外分发）：`kind='bundle'` 的条目指向一个
 * `.tar.gz`，下载 → 校验字节 sha256 → 解包到 `<插件目录>/downloads/<去掉后缀的目录>/`
 * → 写就绪标记。外部工具（b站下载器 / 值守 / 脸谱）走这条路。
 *
 * 与单文件资源（core/remote-asset.ts）的关系：下载通道、双源、sha256 拒收、落盘事件
 * 全部共用，**唯一不同的只有落盘那一步**（一个是 write 文本，一个是解包 + writeBinary）。
 * 所以这里只实现「落盘那一步」，其余调用 remote-asset 的现有函数。
 *
 * 为什么就绪判定看标记文件而不是逐文件 hash：一个包里 224 个文件，每次开面板都算 224 次
 * sha256 是纯浪费（脸谱包 3MB 能算到 200ms 以上）。标记文件记着「这份目录是从哪个 sha256
 * 的归档解出来的」——清单变了，标记就对不上，状态自动变「有更新」。代价是**解包中途崩溃**
 * 会留下半份目录 + 没有标记，下次照样判「未装」并重解，这一层是自愈的。
 * ============================================================ */
import { requestUrl } from 'obsidian';
import { downloadRemotesFor } from './remote-base';
import { sha256Bytes } from './sha256';
import { untar, type TarFile } from './tar';
import {
  DOWNLOADS_CHANGED_EVENT,
  downloadsVaultPath,
  ensureDir,
  readAsset,
} from './remote-asset';
import { emitDomainEvent } from './domain-bus';
import type { DocStatus, ManifestDocEntry } from './download-manifest';

/** 就绪标记文件名（住在解包目录根部；点前缀避开「工具自己会读到什么」这类意外） */
export const BUNDLE_MARKER = '.bz-bundle.json';

/** 标记体（写得尽量少：id / 归档 sha256 / 文件数 / 落盘时刻） */
export interface BundleMarker {
  id: string;
  sha256: string;
  files: number;
  at: number;
}

/** 解包目录（相对 downloads/）：`tools/bili-downloader.tar.gz` → `tools/bili-downloader` */
export function bundleDirOf(file: string): string {
  return String(file || '').replace(/\.tar\.gz$/i, '');
}

/** 解包目录在 vault 里的绝对路径（诊断/展示给用户看的那条） */
export function bundleVaultDir(app: unknown, file: string): string {
  return downloadsVaultPath(app, bundleDirOf(file));
}

/** 注入点（测试打桩：环境里没有 window.require('zlib')） */
export interface BundleDeps {
  /** 解 gzip；缺省走桌面端 Node 的 zlib */
  gunzip?: (bytes: Uint8Array) => Uint8Array;
  /** 下载二进制（缺省 requestUrl） */
  fetchBytes?: (url: string) => Promise<Uint8Array>;
}

/** 缺省 gunzip：桌面端 `window.require('zlib')`；非桌面端没有 zlib，直接给一句人话 */
function defaultGunzip(bytes: Uint8Array): Uint8Array {
  const w = typeof window !== 'undefined' ? (window as any) : null;
  let zlib: any = null;
  try {
    zlib = w?.require?.('zlib');
  } catch {
    zlib = null;
  }
  if (!zlib?.gunzipSync) throw new Error('当前环境不支持解压（目录包需要桌面端）');
  let Buf: any = typeof Buffer !== 'undefined' ? Buffer : null;
  if (!Buf) {
    try {
      Buf = w?.require?.('buffer')?.Buffer;
    } catch {
      Buf = null;
    }
  }
  if (!Buf) throw new Error('当前环境不支持解压（缺少 Buffer）');
  const out = zlib.gunzipSync(Buf.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/** 缺省下载：requestUrl 的 arrayBuffer（别用 text——二进制过一遍 UTF-8 会当场坏掉） */
async function defaultFetchBytes(url: string): Promise<Uint8Array> {
  const res = await requestUrl({ url, method: 'GET', throw: true });
  const ab = (res as { arrayBuffer?: ArrayBuffer }).arrayBuffer;
  if (!ab) throw new Error('响应没有二进制体');
  return new Uint8Array(ab);
}

/** 读一份相对 downloads/ 的文本（不存在/坏读 → null） */
async function readTextRel(app: unknown, rel: string): Promise<string | null> {
  return readAsset(app, rel);
}

/**
 * 目录包状态：`missing`（没装过） / `updated`（标记的 hash 与清单不符） / `ready`。
 * 与单文件资源的 `docStatus` 同三态，UI 状态机不必分叉。
 */
export async function bundleStatus(app: unknown, entry: ManifestDocEntry): Promise<DocStatus> {
  const dir = bundleDirOf(entry.file);
  const text = await readTextRel(app, `${dir}/${BUNDLE_MARKER}`);
  if (text === null) return 'missing';
  try {
    const m = JSON.parse(text) as BundleMarker;
    const got = String(m?.sha256 || '').toLowerCase();
    if (!got) return 'updated';
    return got === String(entry.sha256 || '').toLowerCase() ? 'ready' : 'updated';
  } catch {
    return 'updated'; // 标记坏 = 这份目录来路不明，重装一遍最省事
  }
}

/** 读标记（展示用：装了哪个版本、什么时候装的）；没有 → null */
export async function readBundleMarker(app: unknown, entry: ManifestDocEntry): Promise<BundleMarker | null> {
  const text = await readTextRel(app, `${bundleDirOf(entry.file)}/${BUNDLE_MARKER}`);
  if (text === null) return null;
  try {
    return JSON.parse(text) as BundleMarker;
  } catch {
    return null;
  }
}

/** 取归档字节：先看本地缓存（hash 对得上就复用，省一次流量），否则双源下载 */
async function fetchArchive(app: unknown, entry: ManifestDocEntry, deps: BundleDeps): Promise<Uint8Array> {
  const want = String(entry.sha256 || '').toLowerCase();
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;

  // 本地归档缓存（downloads/<file>）——上次装成功留下的那份，可直接复用
  try {
    const adapter = (app as { vault?: { adapter?: { readBinary?: (p: string) => Promise<ArrayBuffer> } } }).vault?.adapter;
    if (adapter?.readBinary && want) {
      const ab = await adapter.readBinary(downloadsVaultPath(app, entry.file));
      const cached = new Uint8Array(ab);
      if (cached.byteLength > 0 && sha256Bytes(cached) === want) return cached;
    }
  } catch {
    /* 没有缓存 / 读失败：走下载 */
  }

  let lastErr = '';
  for (const url of downloadRemotesFor(entry.file)) {
    try {
      const bytes = await fetchBytes(url);
      if (bytes.byteLength === 0) {
        lastErr = `${url} 返回空内容`;
        continue;
      }
      if (want && sha256Bytes(bytes) !== want) {
        lastErr = `${url} 内容 sha256 不匹配（可能被篡改或版本错位）`;
        continue;
      }
      // 存一份归档缓存（写失败不算错：解包已经拿在手里了）
      try {
        await ensureDir(app, entry.file);
        await (app as { vault?: { adapter?: { writeBinary?: (p: string, d: ArrayBuffer) => Promise<void> } } })
          .vault?.adapter?.writeBinary?.(
            downloadsVaultPath(app, entry.file),
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          );
      } catch {
        /* 缓存失败不影响安装 */
      }
      return bytes;
    } catch (e) {
      lastErr = `${url} → ${(e as Error)?.message || String(e)}`;
    }
  }
  throw new Error(`${entry.name}下载失败：${lastErr}`);
}

/** 清空旧解包目录（更新时防「上版删掉的文件」残留）；不支持 rmdir 的环境静默跳过 */
async function clearBundleDir(app: unknown, dir: string): Promise<void> {
  const adapter = (app as { vault?: { adapter?: { rmdir?: (p: string, recursive?: boolean) => Promise<void> } } }).vault?.adapter;
  if (!adapter?.rmdir) return;
  try {
    await adapter.rmdir(downloadsVaultPath(app, dir), true);
  } catch {
    /* 不存在 / 不支持递归：都交给逐文件覆盖 */
  }
}

export interface BundleInstallResult {
  /** 解包目录（相对 downloads/） */
  dir: string;
  files: number;
  /** 解包后总字节 */
  bytes: number;
}

/**
 * 下载并解包一个目录包（覆盖安装）。
 * 失败一律抛错（含清单 hash 不符 / 归档损坏 / 路径不安全），由调用方转成人话通知。
 */
/**
 * 同一个包的并发安装合并（引导的队列、在线资源组的「全部更新」、域面板的下载按钮是三条入口，
 * 同时点会两个进程同时 clearBundleDir + 解包同一个目录 → 互相删对方刚写进去的文件）。
 * 这里按**包文件路径**做单飞：同一时刻同一个包只跑一次，后来者复用同一个 Promise。
 */
const inFlight = new Map<string, Promise<BundleInstallResult>>();

export async function installBundle(
  app: unknown,
  entry: ManifestDocEntry,
  deps: BundleDeps = {},
): Promise<BundleInstallResult> {
  const key = String(entry.file || '');
  const running = key ? inFlight.get(key) : undefined;
  if (running) return running;
  const job = installBundleOnce(app, entry, deps).finally(() => {
    if (key) inFlight.delete(key);
  });
  if (key) inFlight.set(key, job);
  return job;
}

async function installBundleOnce(
  app: unknown,
  entry: ManifestDocEntry,
  deps: BundleDeps = {},
): Promise<BundleInstallResult> {
  const dir = bundleDirOf(entry.file);
  if (!dir || dir === entry.file) throw new Error(`${entry.name} 的包名不是 .tar.gz`);
  const gunzip = deps.gunzip ?? defaultGunzip;

  const archive = await fetchArchive(app, entry, deps);
  const files: TarFile[] = untar(gunzip(archive));

  await clearBundleDir(app, dir);

  const adapter = (app as {
    vault?: {
      adapter?: {
        writeBinary?: (p: string, d: ArrayBuffer) => Promise<void>;
        write?: (p: string, d: string) => Promise<void>;
      };
    };
  }).vault?.adapter;
  if (!adapter?.writeBinary) throw new Error('当前环境无法写入二进制文件（目录包需要桌面端）');

  let bytes = 0;
  for (const f of files) {
    const rel = `${dir}/${f.path}`;
    await ensureDir(app, rel);
    const copy = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer;
    await adapter.writeBinary(downloadsVaultPath(app, rel), copy);
    bytes += f.data.byteLength;
  }

  const marker: BundleMarker = {
    id: entry.id,
    sha256: String(entry.sha256 || '').toLowerCase(),
    files: files.length,
    at: Date.now(),
  };
  await ensureDir(app, `${dir}/${BUNDLE_MARKER}`);
  const markerPath = downloadsVaultPath(app, `${dir}/${BUNDLE_MARKER}`);
  const markerText = JSON.stringify(marker, null, 2);
  if (adapter.write) {
    await adapter.write(markerPath, markerText);
  } else {
    // 极端实现（只有 writeBinary）：编码成字节写下去。标记本身是纯 ASCII，不会因编码坏掉。
    const bytes = new TextEncoder().encode(markerText);
    await adapter.writeBinary(markerPath, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }

  // 与单文件资源同一条事件：在线资源组的行态同步、各域面板的「工具已就绪」都靠它
  emitDomainEvent(DOWNLOADS_CHANGED_EVENT, { fileName: entry.file });
  return { dir, files: files.length, bytes };
}
