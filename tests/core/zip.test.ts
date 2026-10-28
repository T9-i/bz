/**
 * core/zip：便携 Node 官方包是 zip，读法必须自己实现。
 * 这里现造 zip（stored + deflate 两种），验：条目表、按尾部找条目、解出字节、
 * 长度/crc 两道校验能把坏包拦住。
 */
import { describe, it, expect } from 'vitest';
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { crc32, extractZipEntry, findZipEntry, readZipEntries } from '../../src/core/zip';

interface FileSpec {
  name: string;
  data: Uint8Array;
  method: 0 | 8;
}

/** 现造一个 zip（只为测试；字段全部小端） */
function makeZip(files: FileSpec[]): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.from(f.data);
    const body = f.method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(f.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(f.method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(f.method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);

    chunks.push(local, name, body);
    central.push(cen, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, cd, eocd]));
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** 测试环境没有 window.require('zlib')：解压能力注入进来（生产走桌面端 zlib） */
const inflateRaw = (d: Uint8Array): Uint8Array => new Uint8Array(inflateRawSync(d));

describe('zip：读条目表', () => {
  it('crc32 与已知值一致（"123456789" → 0xCBF43926）', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
  });

  it('列出全部条目，字段（方式/长度/偏移）对得上', () => {
    const zip = makeZip([
      { name: 'node-v24.14.1-win-x64/node.exe', data: text('BINARY'), method: 8 },
      { name: 'node-v24.14.1-win-x64/LICENSE', data: text('MIT'), method: 0 },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual([
      'node-v24.14.1-win-x64/node.exe',
      'node-v24.14.1-win-x64/LICENSE',
    ]);
    expect(entries[0].method).toBe(8);
    expect(entries[0].size).toBe(6);
    expect(entries[1].method).toBe(0);
  });

  it('不是 zip → 抛错（不是返回空表）', () => {
    expect(() => readZipEntries(text('definitely not a zip file at all'))).toThrow(/zip/);
  });
});

describe('zip：取条目', () => {
  const zip = makeZip([
    { name: 'pkg/bin/node', data: text('#!/bin/sh\n'), method: 8 },
    { name: 'pkg/readme.md', data: text('# hi'), method: 0 },
  ]);

  it('按尾部匹配（官方包带一层版本目录，不能写全路径）', () => {
    const entry = findZipEntry(readZipEntries(zip), 'bin/node');
    expect(entry?.name).toBe('pkg/bin/node');
  });

  it('deflate 解出原始字节', () => {
    const entries = readZipEntries(zip);
    const out = extractZipEntry(zip, findZipEntry(entries, 'bin/node')!, { inflateRaw });
    expect(new TextDecoder().decode(out)).toBe('#!/bin/sh\n');
  });

  it('stored 原样取出', () => {
    const entries = readZipEntries(zip);
    const out = extractZipEntry(zip, findZipEntry(entries, 'readme.md')!);
    expect(new TextDecoder().decode(out)).toBe('# hi');
  });

  it('长度不符 → 抛错（半截文件不许落盘）', () => {
    const entries = readZipEntries(zip);
    const entry = { ...findZipEntry(entries, 'readme.md')!, size: 999 };
    expect(() => extractZipEntry(zip, entry)).toThrow(/大小不符/);
  });

  it('crc 不符 → 抛错', () => {
    const entries = readZipEntries(zip);
    const entry = { ...findZipEntry(entries, 'readme.md')!, crc: 1 };
    expect(() => extractZipEntry(zip, entry)).toThrow(/校验失败/);
  });

  it('找不到条目 → null（调用方给「包里没这个文件」）', () => {
    expect(findZipEntry(readZipEntries(zip), 'node.exe')).toBeNull();
  });
});
