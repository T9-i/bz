// scripts/build-tools-pack.mjs — 外部工具包产出（2026-10-28 对外分发）
//
// 把 `tools/` 下三个**运行时真正需要的**工具打成 `downloads/tools/<id>.tar.gz`，
// 由 pnpm manifest 登记进下载清单（kind='bundle'），插件端在设置面板「在线资源」里
// 一键下载 + 解包到 `<插件目录>/downloads/tools/<id>/`（core/bundle-asset.ts）。
//
// 为什么要打包：这些工具此前靠「PATH 上全局装一个命令」，自用顺手、给别人用等于没有。
// 打成一个包而不是逐文件登记的理由（以及为什么是 tar.gz 而不是 zip）见 src/core/tar.ts 头注。
//
// 三个包的白名单是**显式**的：
//   - bili-downloader：cli/core/config + package.json（零 npm 依赖，纯 Node）
//   - dock-watch：值守进程的全部运行时文件 + 两个 ps1（装/卸计划任务）
//   - obsidian-face：整棵 bin/ lib/ python/（递归），排除 __pycache__ / *.pyc / test
// 显式白名单而不是「排除法」：排除法会把某天新加的 test/ 或 node_modules/ 悄悄打进去，
// 而包一旦发出去就是所有人的磁盘。
//
// 发布顺序：pnpm tools-pack → pnpm manifest（manifest 对产物算字节 sha256）。
// 用法：
//   node scripts/build-tools-pack.mjs           # 产出
//   node scripts/build-tools-pack.mjs --check   # 只校验产物是否与源同步（守卫测试用）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'downloads/tools');
const CHECK_ONLY = process.argv.includes('--check');

/** ---------- tar 写入（ustar；解析侧在 src/core/tar.ts） ---------- */

const BLOCK = 512;

function octal(value, len) {
  return value.toString(8).padStart(len - 1, '0') + '\0';
}

function tarHeader(name, size, mtime) {
  if (Buffer.byteLength(name, 'utf8') > 100) throw new Error(`路径超过 100 字节（ustar name 字段）：${name}`);
  const buf = Buffer.alloc(BLOCK);
  buf.write(name, 0, 100, 'utf8');
  buf.write(octal(0o644, 8), 100, 'ascii'); // mode
  buf.write(octal(0, 8), 108, 'ascii'); // uid
  buf.write(octal(0, 8), 116, 'ascii'); // gid
  buf.write(octal(size, 12), 124, 'ascii'); // size
  buf.write(octal(mtime, 12), 136, 'ascii'); // mtime
  buf.write('        ', 148, 'ascii'); // chksum 占位（8 空格）
  buf.write('0', 156, 'ascii'); // typeflag：普通文件
  buf.write('ustar', 257, 5, 'ascii'); // magic（第 6 字节留 0）
  buf.write('00', 263, 'ascii'); // version
  buf.write('bz', 265, 'ascii'); // uname
  buf.write('bz', 297, 'ascii'); // gname
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii'); // chksum：6 位八进制 + NUL + 空格
  return buf;
}

/** 文件数组 → tar 字节（顺序即入包顺序，保持稳定：清单 hash 才不会每次构建都变） */
function buildTar(entries) {
  const chunks = [];
  const mtime = 0; // 固定时间戳：同样内容 → 同样字节（sha256 稳定，清单不会无故变）
  for (const { name, data } of entries) {
    chunks.push(tarHeader(name, data.length, mtime));
    chunks.push(data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(BLOCK * 2)); // 归档结束：两个全零块
  return Buffer.concat(chunks);
}

/** 递归收集目录下的文件（返回 [相对路径, Buffer]，按路径排序保证稳定） */
function collectDir(absDir, relDir, out, skip) {
  for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
    if (skip(rel, ent)) continue;
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) collectDir(abs, rel, out, skip);
    else if (ent.isFile()) out.push({ name: rel, data: fs.readFileSync(abs) });
  }
}

/** 非 ASCII 文件名（python/ 下可能有）：统一成 / 分隔的相对路径 */
function normName(p) {
  return p.replace(/\\/g, '/');
}

/** ---------- 三个包的白名单 ---------- */

const PY_SKIP = (rel, ent) =>
  ent.name === '__pycache__' || ent.name.endsWith('.pyc') || ent.name === '.gitignore' || rel.split('/').includes('node_modules');

const PACKS = [
  {
    id: 'bili-downloader',
    name: 'B站下载器',
    build() {
      const dir = path.join(ROOT, 'tools/bili-downloader');
      const files = ['cli.js', 'core.js', 'config.js', 'package.json'];
      return files.map((f) => ({ name: f, data: fs.readFileSync(path.join(dir, f)) }));
    },
  },
  {
    id: 'dock-watch',
    name: '工具坞值守',
    build() {
      const dir = path.join(ROOT, 'tools/dock-watch');
      const files = [
        'cli.js',
        'core-version.json',
        'dock-core.cjs',
        'net.js',
        'node-fs.js',
        'package.json',
        'runtime.js',
        'watch.js',
        'install.ps1',
        'uninstall.ps1',
      ];
      return files.map((f) => ({ name: f, data: fs.readFileSync(path.join(dir, f)) }));
    },
  },
  {
    id: 'obsidian-face',
    name: '脸谱工具包',
    build() {
      const dir = path.join(ROOT, 'tools/obsidian-face');
      const out = [];
      for (const entry of ['bin', 'lib', 'python']) collectDir(path.join(dir, entry), entry, out, PY_SKIP);
      out.push({ name: 'package.json', data: fs.readFileSync(path.join(dir, 'package.json')) });
      return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },
  },
];

/** ---------- 主流程 ---------- */

fs.mkdirSync(OUT_DIR, { recursive: true });

let problems = 0;
const summary = [];

for (const pack of PACKS) {
  const entries = pack.build().map((e) => ({ name: normName(e.name), data: e.data }));
  const tar = buildTar(entries);
  const gz = zlib.gzipSync(tar, { level: 9 });
  const rel = `downloads/tools/${pack.id}.tar.gz`;
  const out = path.join(ROOT, rel);
  const prev = fs.existsSync(out) ? fs.readFileSync(out) : null;
  const same = prev && prev.equals(gz);

  if (!same) {
    if (CHECK_ONLY) {
      console.error(`✗ ${rel} 与源不同步——跑 pnpm tools-pack 重出`);
      problems++;
    } else {
      fs.writeFileSync(out, gz);
      console.log(`✓ ${rel}（${entries.length} 文件，${(gz.length / 1024).toFixed(1)} KB）`);
    }
  }
  summary.push({
    id: pack.id,
    name: pack.name,
    file: `tools/${pack.id}.tar.gz`,
    files: entries.length,
    size: gz.length,
    sha256: createHash('sha256').update(gz).digest('hex'),
  });
}

if (CHECK_ONLY && problems > 0) process.exit(1);
if (!CHECK_ONLY && problems === 0) {
  console.log(`外部工具包就绪：${summary.map((s) => `${s.id} ${(s.size / 1024).toFixed(0)}KB`).join(' / ')}`);
}
