/**
 * tar 解包（core/tar.ts）：目录包下载通道的唯一解析器。
 *
 * 测的是三件事：
 *  1. 正常包能解出「路径 → 内容」（用自造的 ustar 字节，不依赖仓库里的产物）；
 *  2. **危险路径必拒**（绝对路径 / 盘符 / `..`）——远端内容不可信，这条不能靠"我们不打这种包"；
 *  3. 上限（条目数 / 总字节）与畸形归档（magic 不符 / 截断）一律抛错，不返回半份结果。
 */
import { describe, it, expect } from 'vitest';
import { safeTarPath, untar } from '../../src/core/tar';

const BLOCK = 512;

function octal(value: number, len: number): string {
  return value.toString(8).padStart(len - 1, '0') + '\0';
}

/** 造一个 ustar 文件头（与 scripts/build-tools-pack.mjs 同口径） */
function header(name: string, size: number): Buffer {
  const buf = Buffer.alloc(BLOCK);
  buf.write(name, 0, 100, 'utf8');
  buf.write(octal(0o644, 8), 100, 'ascii');
  buf.write(octal(0, 8), 108, 'ascii');
  buf.write(octal(0, 8), 116, 'ascii');
  buf.write(octal(size, 12), 124, 'ascii');
  buf.write(octal(0, 12), 136, 'ascii');
  buf.write('        ', 148, 'ascii');
  buf.write('0', 156, 'ascii');
  buf.write('ustar', 257, 5, 'ascii');
  buf.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return buf;
}

function makeTar(entries: Array<{ name: string; body: string }>): Uint8Array {
  const chunks: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.body, 'utf8');
    chunks.push(header(e.name, data.length), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(BLOCK * 2));
  return new Uint8Array(Buffer.concat(chunks));
}

const textOf = (u: Uint8Array): string => Buffer.from(u).toString('utf8');

describe('untar：正常解包', () => {
  it('多文件：路径与内容逐一还原，尾部填充不影响下一条', () => {
    const files = untar(makeTar([
      { name: 'cli.js', body: 'console.log(1)' },
      { name: 'lib/a.js', body: 'x'.repeat(1000) }, // 跨 512 块边界
      { name: 'lib/b.js', body: '' },
    ]));
    expect(files.map((f) => f.path)).toEqual(['cli.js', 'lib/a.js', 'lib/b.js']);
    expect(textOf(files[0].data)).toBe('console.log(1)');
    expect(files[1].data.byteLength).toBe(1000);
    expect(files[2].data.byteLength).toBe(0);
  });

  it('空归档（只有结束块）→ 抛错（解出 0 个文件不是「成功」，是包坏了）', () => {
    expect(() => untar(new Uint8Array(Buffer.alloc(BLOCK * 2)))).toThrow(/没有文件/);
  });

  it('magic 不符（不是 ustar）→ 抛错，不尝试猜格式', () => {
    const bad = makeTar([{ name: 'a.js', body: 'hi' }]);
    bad[257] = 0x58; // 把 magic 首字节改成 'X'
    expect(() => untar(bad)).toThrow(/ustar/);
  });

  it('截断（声明 size 超过实际字节）→ 抛错', () => {
    const full = makeTar([{ name: 'a.js', body: 'hello world' }]);
    const cut = full.subarray(0, BLOCK + 4); // 头 + 4 字节内容
    expect(() => untar(cut)).toThrow(/越界|截断/);
  });
});

describe('untar：安全线', () => {
  it('路径穿越 ../ 整包拒收（不是跳过这一条）', () => {
    expect(() => untar(makeTar([{ name: 'ok.js', body: '1' }, { name: '../evil.js', body: '2' }]))).toThrow(
      /路径不安全/,
    );
  });

  it('绝对路径 / 盘符 拒收', () => {
    expect(() => untar(makeTar([{ name: '/etc/passwd', body: 'x' }]))).toThrow(/路径不安全/);
    expect(() => untar(makeTar([{ name: 'C:/win.ini', body: 'x' }]))).toThrow(/路径不安全/);
  });

  it('条目数超限 → 抛错（防解包炸弹的条目维度）', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.js`, body: 'x' }));
    expect(() => untar(makeTar(many), { maxEntries: 5, maxTotalBytes: 1 << 20 })).toThrow(/条目过多/);
  });

  it('总字节超限 → 抛错（防解包炸弹的体积维度）', () => {
    expect(() =>
      untar(makeTar([{ name: 'big.bin', body: 'x'.repeat(2048) }]), { maxEntries: 10, maxTotalBytes: 1024 }),
    ).toThrow(/总大小超限/);
  });
});

describe('safeTarPath：归一与拒绝', () => {
  it('前导 ./ 与重复斜杠归一；反斜杠视作分隔符', () => {
    expect(safeTarPath('./a//b.js')).toBe('a/b.js');
    expect(safeTarPath('a\\b\\c.js')).toBe('a/b/c.js');
  });

  it('空串 / 纯点 / 穿越 / 绝对 / 盘符 → null', () => {
    for (const bad of ['', '.', './', '../x', 'a/../../b', '/abs', 'D:file', '\\\\share\\x']) {
      expect(safeTarPath(bad), bad).toBeNull();
    }
  });
});
