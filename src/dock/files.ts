/**
 * 工具目录的读写层 —— **谁写哪个文件，在这一层钉死**。
 *
 * | 文件 | 写函数 | 谁调 |
 * |---|---|---|
 * | `manifest.json` | 无（只读） | 工具作者手写 |
 * | `data.json` | `writeSettings` | 面板表单 |
 * | `dock.intent.json` | `writeIntent` | 面板（人） |
 * | `dock.runtime.json` | `writeRuntime` | 调度内核（**必须在执行权锁内**） |
 * | `runs.jsonl` | 无（只读） | 工具自己追加 |
 * | `heartbeat.json` | 无（只读） | 工具自己写 |
 * | `panel.html` | 无（只读） | 工具自己写 |
 *
 * 这里刻意**没有**写 `runs.jsonl` 的函数。一旦 bz 能写它，记录就有了两个作者，
 * 「这次到底干成没有」立刻变成一场辩论。
 */

import {
  DECLARATION_FILENAME,
  HEARTBEAT_FILENAME,
  INTENT_FILENAME,
  INTENT_VERSION,
  PANEL_FILENAME,
  RUNTIME_FILENAME,
  RUNTIME_VERSION,
  SETTINGS_FILENAME,
  SETTINGS_VERSION,
  RUNS_FILENAME,
} from './types';
import type { DockIntent, DockRuntime } from './types';

// ==================== fs 缝 ====================

/**
 * 本域需要的最小 fs 面。插件侧走 `window.require('fs')`；移动端为 null（只读面板靠预取）；
 * 测试与评审壳注入假件。
 */
export interface DockFs {
  readText(path: string): string | null;
  writeText(path: string, data: string): void;
  /** 原子换名；缺省实现有，测试桩可以不给 */
  rename?(from: string, to: string): void;
  /** 排他创建（执行权锁用）；已存在返回 false */
  createExclusive?(path: string, data: string): boolean;
  unlink?(path: string): void;
  exists?(path: string): boolean;
  mkdir?(path: string): void;
  /** 读文件尾部若干字节（runs.jsonl 只读尾部） */
  readTail?(path: string, bytes: number): string | null;
  /** 文件大小（判「记录文件太旧」用） */
  size?(path: string): number | undefined;
}

let injected: DockFs | null | undefined;

export function setDockFs(fs: DockFs | null | undefined): void {
  injected = fs;
}

function defaultFs(): DockFs | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { require?: (id: string) => unknown };
  if (!w.require) return null;
  try {
    const fs = w.require('fs') as {
      readFileSync(p: string, enc: string): string;
      writeFileSync(p: string, d: string): void;
      renameSync?(a: string, b: string): void;
      openSync?(p: string, flags: string): number;
      writeSync?(fd: number, d: string): number;
      closeSync?(fd: number): void;
      unlinkSync?(p: string): void;
      existsSync?(p: string): boolean;
      statSync?(p: string): { isFile(): boolean; size: number };
      mkdirSync?(p: string, o?: { recursive?: boolean }): void;
    };
    return {
      readText: (p) => {
        try {
          return fs.readFileSync(p, 'utf8');
        } catch {
          return null;
        }
      },
      writeText: (p, d) => fs.writeFileSync(p, d),
      rename: typeof fs.renameSync === 'function' ? (a, b) => fs.renameSync!(a, b) : undefined,
      createExclusive:
        typeof fs.openSync === 'function'
          ? (p, d) => {
              try {
                const fd = fs.openSync!(p, 'wx');
                if (typeof fs.writeSync === 'function') fs.writeSync!(fd, d);
                if (typeof fs.closeSync === 'function') fs.closeSync!(fd);
                return true;
              } catch {
                return false;
              }
            }
          : undefined,
      unlink: typeof fs.unlinkSync === 'function' ? (p) => fs.unlinkSync!(p) : undefined,
      exists: (() => {
        const existsSync = fs.existsSync;
        if (typeof existsSync !== 'function') return undefined;
        return (p: string) => {
          try {
            if (!existsSync(p)) return false;
            return fs.statSync ? fs.statSync(p).isFile() : true;
          } catch {
            return false;
          }
        };
      })(),
      mkdir:
        typeof fs.mkdirSync === 'function'
          ? (p) => {
              try {
                fs.mkdirSync!(p, { recursive: true });
              } catch {
                /* 已存在 / 无权 —— 让随后的写去暴露真问题 */
              }
            }
          : undefined,
      readTail: (p, bytes) => {
        try {
          const size = fs.statSync!(p).size;
          const start = Math.max(0, size - bytes);
          const readSync = (fs as unknown as { readSync?: (fd: number, b: unknown, o: number, l: number, pos: number) => number }).readSync;
          // 没有 readSync / 没有 Buffer（渲染进程关掉 node 集成时）就整份读 —— 读得慢总比读不到好
          if (typeof readSync !== 'function' || typeof Buffer === 'undefined') return fs.readFileSync(p, 'utf8');
          const fd = fs.openSync!(p, 'r');
          try {
            const buf = Buffer.alloc(size - start);
            readSync(fd, buf, 0, buf.length, start);
            return buf.toString('utf8');
          } finally {
            fs.closeSync!(fd);
          }
        } catch {
          return null;
        }
      },
      size: (p) => {
        try {
          return fs.statSync!(p).size;
        } catch {
          return undefined;
        }
      },
    };
  } catch {
    return null;
  }
}

export function currentFs(): DockFs | null {
  return injected !== undefined ? injected : defaultFs();
}

// ==================== 路径 ====================

/** 取目录（统一 `/`） */
export function dirOf(p: string): string {
  const s = p.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  if (i < 0) return '';
  if (i === 0) return '/';
  if (s[i - 1] === ':') return s.slice(0, i + 1);
  return s.slice(0, i);
}

export function joinPath(dir: string, name: string): string {
  const d = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  return d === '' ? name : `${d}/${name}`;
}

export const pathOf = {
  manifest: (declPath: string): string => declPath,
  settings: (declPath: string): string => joinPath(dirOf(declPath), SETTINGS_FILENAME),
  runs: (declPath: string): string => joinPath(dirOf(declPath), RUNS_FILENAME),
  heartbeat: (declPath: string): string => joinPath(dirOf(declPath), HEARTBEAT_FILENAME),
  panel: (declPath: string): string => joinPath(dirOf(declPath), PANEL_FILENAME),
  intent: (declPath: string): string => joinPath(dirOf(declPath), INTENT_FILENAME),
  runtime: (declPath: string): string => joinPath(dirOf(declPath), RUNTIME_FILENAME),
};

export function manifestPathIn(dir: string): string {
  return joinPath(dir, DECLARATION_FILENAME);
}

// ==================== 原子写 ====================

let writeSeq = 0;

function pidText(): string {
  try {
    return String((globalThis as { process?: { pid?: number } }).process?.pid ?? 0);
  } catch {
    return '0';
  }
}

/**
 * 原子写：先写同目录 tmp，再换名。
 *
 * tmp 名带 pid + 序号 —— 两个进程同时写各自的 tmp，换名是原子的，谁后换谁赢，
 * 但**绝不会读到半截文件**。
 */
export function writeAtomic(fs: DockFs, target: string, text: string): boolean {
  try {
    if (fs.rename) {
      const tmp = `${target}.${pidText()}.${writeSeq++}.tmp`;
      fs.writeText(tmp, text);
      fs.rename(tmp, target);
    } else {
      fs.writeText(target, text);
    }
    return true;
  } catch {
    return false;
  }
}

/** 内容没变就不写（避免每拍刷 mtime 让 Syncthing 一直有活干） */
function writeIfChanged(fs: DockFs, target: string, text: string): boolean {
  if (fs.readText(target) === text) return false;
  return writeAtomic(fs, target, text);
}

// ==================== 读 ====================

export function readTextOf(path: string, fs: DockFs | null = currentFs()): string | null {
  return fs ? fs.readText(path) : null;
}

/** 运行记录原文：优先读尾部（大文件不整份读进内存） */
export function readRunsText(path: string, fs: DockFs | null = currentFs(), tailBytes = 0): string | null {
  if (!fs) return null;
  if (tailBytes > 0 && fs.readTail) return fs.readTail(path, tailBytes);
  return fs.readText(path);
}

/** 展示板：只有空白 = 没有（那一块整块不出现，不留空框） */
export function readPanelText(path: string, fs: DockFs | null = currentFs()): string | null {
  if (!fs) return null;
  const t = fs.readText(path);
  return t === null || t.trim() === '' ? null : t;
}

// ==================== 写 ====================

export function writeSettings(
  declPath: string,
  toolId: string,
  values: Record<string, unknown>,
  fs: DockFs | null = currentFs(),
): boolean {
  if (!fs) return false;
  return writeAtomic(fs, pathOf.settings(declPath), JSON.stringify({ v: SETTINGS_VERSION, tool: toolId, values }, null, 2));
}

export function writeIntent(declPath: string, intent: DockIntent, fs: DockFs | null = currentFs()): boolean {
  if (!fs) return false;
  const payload: DockIntent = { ...intent, v: INTENT_VERSION };
  return writeAtomic(fs, pathOf.intent(declPath), JSON.stringify(payload, null, 2));
}

export function writeRuntime(declPath: string, runtime: DockRuntime, fs: DockFs | null = currentFs()): boolean {
  if (!fs) return false;
  const payload: DockRuntime = { ...runtime, v: RUNTIME_VERSION, updatedAt: new Date().toISOString() };
  return writeIfChanged(fs, pathOf.runtime(declPath), JSON.stringify(payload, null, 2));
}
