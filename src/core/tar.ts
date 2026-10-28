/* ============================================================
 * bz · tar 解包（core/tar.ts，零依赖叶子模块）
 *
 * 只做一件事：把**未压缩的 tar 字节**读成「路径 → 内容」。gzip 那一步不在这里——
 * 插件 bundle 的 external 列表里没有 `zlib`（builtin 一律走 `window.require`），
 * 而本模块要被 vitest 直接 import，所以 gunzip 由调用方（remote-asset）用
 * `window.require('zlib').gunzipSync` 做完再把裸 tar 交进来。
 *
 * 为什么是 tar.gz 而不是 zip：在线资源是「几百个文件的包」（脸谱包 224 个文件），逐文件
 * 登记会让清单爆炸、下载变成几百次请求；而 Node 内置只有 gzip，没有 zip 解包。tar 的头
 * 就是一个 512 字节的定长结构，解析器不到百行、可单测；zip 要中央目录 + deflate 流 + CRC，
 * 同一个目标下代码量与出错面都更大。
 *
 * 安全线（远端内容不可信，这几条不能省）：
 *  - **拒绝路径穿越**：绝对路径、盘符、`..` 段一律拒收（整包失败，不做「跳过这一条」——
 *    一个恶意条目说明整包不可信）；
 *  - **条目数 / 总字节上限**：防 zip-bomb 类的「一张 4KB 的包解出 40GB」；
 *  - **只收普通文件与目录**：符号链接、硬链接、设备节点一概忽略（我们不打包这类东西，
 *    出现了就是被换过）。
 * ============================================================ */

/** 解出的一条文件（目录不产出条目——调用方按路径自行建目录） */
export interface TarFile {
  /** 归一后的相对路径（`/` 分隔，无前导 `./`） */
  path: string;
  data: Uint8Array;
}

/** 解包上限（缺省值按「脸谱包 224 文件 / 3MB」再留两个数量级余量） */
export interface UntarLimits {
  maxEntries: number;
  maxTotalBytes: number;
}
export const UNTAR_LIMITS: UntarLimits = {
  maxEntries: 5000,
  maxTotalBytes: 128 * 1024 * 1024,
};

const BLOCK = 512;

/** 读定长字段到 NUL 或字段尾（tar 的 name/linkname 用 NUL 填充） */
function cstr(bytes: Uint8Array, start: number, len: number): string {
  let end = start;
  const stop = Math.min(start + len, bytes.length);
  while (end < stop && bytes[end] !== 0) end++;
  return new TextDecoder('utf-8').decode(bytes.subarray(start, end));
}

/** 八进制字段（tar 的 size/mode 等；允许前后空格与 NUL 结尾；坏值 → -1） */
function octal(bytes: Uint8Array, start: number, len: number): number {
  let s = '';
  const stop = Math.min(start + len, bytes.length);
  for (let i = start; i < stop; i++) {
    const c = bytes[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  s = s.trim();
  if (!s) return 0;
  if (!/^[0-7]+$/.test(s)) return -1;
  return parseInt(s, 8);
}

/**
 * 路径归一 + 安全判定。
 * @returns 安全路径；不安全（绝对 / 盘符 / `..` / 空）→ null
 */
export function safeTarPath(raw: string): string | null {
  let p = String(raw || '').replace(/\\/g, '/').trim();
  while (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/\/+/g, '/');
  if (!p) return null;
  if (p.startsWith('/')) return null;
  if (/^[A-Za-z]:/.test(p)) return null;
  const segs = p.split('/').filter((s) => s && s !== '.');
  if (segs.some((s) => s === '..')) return null;
  if (segs.length === 0) return null;
  return segs.join('/');
}

/**
 * 解一个裸 tar。畸形（头损坏 / size 越界 / 不安全路径 / 超限）一律抛错——
 * 半解出来的包比没解更危险（缺文件却能跑起来，症状出现在很远的后面）。
 */
export function untar(bytes: Uint8Array, limits: UntarLimits = UNTAR_LIMITS): TarFile[] {
  const out: TarFile[] = [];
  let total = 0;
  let off = 0;

  while (off + BLOCK <= bytes.length) {
    // 全零块 = 归档结束（有的写入器会补两个，遇到第一个就停）
    let zero = true;
    for (let i = 0; i < BLOCK; i++) {
      if (bytes[off + i] !== 0) {
        zero = false;
        break;
      }
    }
    if (zero) break;

    const magic = cstr(bytes, off + 257, 5);
    if (magic !== 'ustar') throw new Error('不是 ustar 格式的 tar（头部 magic 不符）');

    const size = octal(bytes, off + 124, 12);
    if (size < 0) throw new Error('tar 头部 size 字段损坏');
    const typeflag = String.fromCharCode(bytes[off + 156] || 48); // 0 字节按 '0' 处理

    // ustar 的长路径：prefix + '/' + name
    const prefix = cstr(bytes, off + 345, 155);
    const name = cstr(bytes, off + 0, 100);
    const rawPath = prefix ? `${prefix}/${name}` : name;

    const dataStart = off + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new Error('tar 条目越界（归档被截断）');

    // 目录 / 只认普通文件；其余（链接、设备）静默忽略
    if (typeflag === '5') {
      off = dataStart + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    if (typeflag !== '0' && typeflag !== '\0') {
      off = dataStart + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }

    const path = safeTarPath(rawPath);
    if (!path) throw new Error(`tar 条目路径不安全：${rawPath || '(空)'}`);

    total += size;
    if (out.length + 1 > limits.maxEntries) throw new Error(`tar 条目过多（>${limits.maxEntries}）`);
    if (total > limits.maxTotalBytes) throw new Error(`tar 解包总大小超限（>${limits.maxTotalBytes} 字节）`);

    out.push({ path, data: bytes.subarray(dataStart, dataEnd) });
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  if (out.length === 0) throw new Error('tar 里没有文件');
  return out;
}
