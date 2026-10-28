/* ============================================================
 * bz · 极简 zip 读取（core/zip.ts）
 *
 * 只为一件事存在：**便携 Node 运行时的官方包是 .zip**（Windows 侧 nodejs.org 只发
 * .zip / .msi，没有 .tar.gz），而仓库里原本只有 tar.gz 的读法（core/tar.ts）。
 *
 * 范围刻意压到最小：
 *  - 只读，不写；只解**指定的一条**，不整包展开（node zip 里 npm/npx/corepack 一堆，
 *    我们只需要 node.exe，展开全部等于凭空多写 60MB）；
 *  - 支持 stored(0) 与 deflate(8) 两种方式（官方包就是这两种）；
 *  - 不支持 zip64 / 加密 / 分卷——遇到直接抛错，让人看到「不支持」而不是解出错文件。
 *
 * 解压用桌面端 Node 的 zlib.inflateRawSync（与 bundle-asset 的 gunzip 同一套路），
 * 测试可注入 `inflateRaw`。
 *
 * 校验：解出来的字节先比**声明长度**再比 **crc32**。两者都对才返回——少了这层，
 * 一个坏包会写成半截 node.exe，症状是「下载完成但一跑就崩」，几乎无法归因。
 * ============================================================ */

/** 中央目录条目（只留解析与解压要用的字段） */
export interface ZipEntry {
  /** 归档内路径（正斜杠） */
  name: string;
  /** 压缩方式：0 = stored，8 = deflate */
  method: number;
  /** 源文件 crc32 */
  crc: number;
  /** 压缩后字节数 */
  compressedSize: number;
  /** 解压后字节数 */
  size: number;
  /** 本地文件头偏移 */
  localOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function u16(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8)) >>> 0;
}

function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** crc32（IEEE 多项式，查表法；一次建表，模块级复用） */
let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  const t = crcTable;
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = t[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 读中央目录。包尾签名从后往前找（EOCD 在末尾，后面可能挂最多 64KB 注释）。
 * 找不到 / zip64 / 分卷 → 抛错（不是返回空表：空表会让上面误判「包里没这个文件」）。
 */
export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const len = bytes.length;
  if (len < 22) throw new Error('不是有效的 zip（文件太小）');
  const floor = Math.max(0, len - 22 - 0xffff);
  let eocd = -1;
  for (let i = len - 22; i >= floor; i--) {
    if (u32(bytes, i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到目录尾）');

  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error('不支持 zip64 格式的压缩包');
  }
  if (cdOffset + cdSize > len) throw new Error('zip 目录越界（文件可能未下载完整）');

  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > len || u32(bytes, p) !== SIG_CEN) throw new Error('zip 目录结构损坏');
    const method = u16(bytes, p + 10);
    const crc = u32(bytes, p + 16);
    const compressedSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOffset = u32(bytes, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, crc, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 缺省 inflateRaw：桌面端 Node 的 zlib（与 bundle-asset 的 gunzip 同源） */
function defaultInflateRaw(data: Uint8Array): Uint8Array {
  const w = typeof window !== 'undefined' ? (window as any) : null;
  let zlib: any = null;
  try {
    zlib = w?.require?.('zlib');
  } catch {
    zlib = null;
  }
  if (!zlib?.inflateRawSync) throw new Error('当前环境不支持解压（zip 需要桌面端）');
  const Buf: any = typeof Buffer !== 'undefined' ? Buffer : w?.require?.('buffer')?.Buffer;
  if (!Buf) throw new Error('当前环境不支持解压（缺少 Buffer）');
  const out = zlib.inflateRawSync(Buf.from(data.buffer, data.byteOffset, data.byteLength));
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/** 解压依赖（测试注入） */
export interface ZipDeps {
  inflateRaw?: (data: Uint8Array) => Uint8Array;
}

/**
 * 解出**一条**条目。长度与 crc32 都校验通过才返回；否则抛错（宁可重下，不写坏文件）。
 */
export function extractZipEntry(bytes: Uint8Array, entry: ZipEntry, deps: ZipDeps = {}): Uint8Array {
  const o = entry.localOffset;
  if (o + 30 > bytes.length || u32(bytes, o) !== SIG_LOC) throw new Error(`zip 条目头损坏：${entry.name}`);
  const nameLen = u16(bytes, o + 26);
  const extraLen = u16(bytes, o + 28);
  const start = o + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new Error(`zip 条目越界：${entry.name}`);
  const raw = bytes.subarray(start, end);

  let out: Uint8Array;
  if (entry.method === 0) out = raw.slice();
  else if (entry.method === 8) out = (deps.inflateRaw ?? defaultInflateRaw)(raw);
  else throw new Error(`不支持的压缩方式 ${entry.method}（${entry.name}）`);

  if (entry.size && out.byteLength !== entry.size) {
    throw new Error(`${entry.name} 解压后大小不符（期望 ${entry.size}，实际 ${out.byteLength}）`);
  }
  if (entry.crc && crc32(out) !== entry.crc) throw new Error(`${entry.name} 校验失败（crc32 不符）`);
  return out;
}

/**
 * 按路径尾部找条目（`node.exe` / `bin/node`）。
 * 用「尾部匹配」而不是全等：官方包里带一层 `node-vX-win-x64/` 顶级目录，且各平台
 * 顶级目录名不同——写全路径等于把版本号硬编码进代码。
 */
export function findZipEntry(entries: ZipEntry[], suffix: string): ZipEntry | null {
  const want = `/${suffix}`;
  for (const e of entries) {
    if (e.name === suffix || e.name.endsWith(want)) return e;
  }
  return null;
}
