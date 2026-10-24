// @vitest-environment node
/** 内存 fs —— 行为与真身一致（写 tmp 再换名、排他创建）。测试专用，文件名不匹配 *.test.ts */
import type { DockFs } from '../../src/dock/files';

/** 内存 fs：够 kernel / lock / files 用，行为与真身一致（写 tmp 再换名） */
export function fakeFs(seed: Record<string, string> = {}): DockFs & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed));
  return {
    files,
    readText: (p) => files.get(p) ?? null,
    writeText: (p, d) => {
      files.set(p, d);
    },
    rename: (a, b) => {
      const v = files.get(a);
      if (v === undefined) throw new Error(`no such file: ${a}`);
      files.delete(a);
      files.set(b, v);
    },
    createExclusive: (p, d) => {
      if (files.has(p)) return false;
      files.set(p, d);
      return true;
    },
    unlink: (p) => {
      files.delete(p);
    },
    exists: (p) => files.has(p),
    mkdir: () => undefined,
  };
}

