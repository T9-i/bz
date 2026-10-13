// @vitest-environment node
/**
 * 值守接口测试（`watchdog.ts`）。
 *
 * 这一层全部价值在**两个进程之间的约定**上：插件写的东西值守进程要认得出，反之亦然。
 * 所以除了常规的「坏输入不抛」，这里还有一类别处没有的用例 —— **两侧同口径**：
 * `toWatchdogDir` 的推导要与 `tools/dock-watch/runtime.js` 那个 JS 实现逐字一致
 * （对不上 = 租约谁也看不见谁 = 两个调度者同时拍 = 记录翻倍，而症状要等到用户机器上才出现）。
 * 直接 require 那个文件来比，比读源码文本断言硬。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import {
  WATCHDOG_CONFIG_FILENAME,
  WATCHDOG_DIRNAME,
  WATCHDOG_LEASE_FILENAME,
  WATCHDOG_LEASE_TTL_MS,
  WATCHDOG_QUEUE_FILENAME,
  WATCHDOG_STATUS_FILENAME,
  clearWatchdogLease,
  consumeWatchdogQueue,
  isWatchdogAlive,
  isWatchdogInstalled,
  readWatchdogLease,
  readWatchdogQueue,
  readWatchdogStatus,
  watchdogDirOf,
  watchdogPathOf,
  writeWatchdogLease,
  type WatchdogEnv,
  type WatchdogStatus,
} from '../../src/dock/watchdog';
import { setDockFs, type DockFs } from '../../src/dock/declaration';

const require = createRequire(import.meta.url);

/** 内存 fs（含 mkdir —— 值守目录可能整个不存在） */
function memFs(files: Record<string, string> = {}): DockFs & { files: Record<string, string>; made: string[] } {
  const store: Record<string, string> = { ...files };
  const made: string[] = [];
  return {
    files: store,
    made,
    readText: (p) => (p in store ? store[p] : null),
    writeText: (p, d) => {
      store[p] = d;
    },
    rename: (a, b) => {
      store[b] = store[a];
      delete store[a];
    },
    exists: (p) => p in store,
    unlink: (p) => {
      delete store[p];
    },
    mkdir: (p) => {
      made.push(p);
    },
  };
}

const ENV: WatchdogEnv = { LOCALAPPDATA: 'C:/LocalAppData' };
const norm = (s: string): string => s.replace(/\\/g, '/');

afterEach(() => {
  setDockFs(undefined); // 复原真身，别把缝留给别的用例
});

describe('路径推导（两侧必须同口径）', () => {
  it('Windows 取 LOCALAPPDATA', () => {
    expect(norm(watchdogDirOf(ENV))).toBe('C:/LocalAppData/bz-dock-watch');
    expect(norm(watchdogPathOf(WATCHDOG_LEASE_FILENAME, ENV))).toBe('C:/LocalAppData/bz-dock-watch/lease.json');
  });

  it('没有 LOCALAPPDATA 时按 USERPROFILE\\AppData\\Local 拼', () => {
    expect(norm(watchdogDirOf({ USERPROFILE: 'C:/Users/me' }))).toBe('C:/Users/me/AppData/Local/bz-dock-watch');
    expect(norm(watchdogDirOf({ HOME: '/home/me' }))).toBe('/home/me/AppData/Local/bz-dock-watch');
  });

  it('四个文件名与目录名是契约，改一个就是两侧同时对不上', () => {
    expect(WATCHDOG_DIRNAME).toBe('bz-dock-watch');
    expect(WATCHDOG_LEASE_FILENAME).toBe('lease.json');
    expect(WATCHDOG_STATUS_FILENAME).toBe('status.json');
    expect(WATCHDOG_QUEUE_FILENAME).toBe('pending.json');
    expect(WATCHDOG_CONFIG_FILENAME).toBe('config.json');
  });

  it('与值守进程那个 JS 实现的推导逐字相同', () => {
    // require 真身：这是「约定」而不是「两份恰好一样的代码」的唯一证明方式
    const runtime = require('../../tools/dock-watch/runtime.js') as {
      watchdogDir(env: Record<string, string | undefined>): string;
    };
    for (const env of [ENV, { USERPROFILE: 'C:/Users/me' }, { HOME: '/home/me' }]) {
      expect(norm(runtime.watchdogDir(env))).toBe(norm(watchdogDirOf(env)));
    }
  });
});

describe('租约（bz 写、值守进程读）', () => {
  it('写出来的是值守进程认得的那一份', () => {
    const fs = memFs();
    setDockFs(fs);
    expect(writeWatchdogLease({ vault: 'E:/vault/', env: ENV, fs, now: Date.parse('2026-10-14T07:00:00Z') })).toBe(true);
    const raw = JSON.parse(fs.files[watchdogPathOf(WATCHDOG_LEASE_FILENAME, ENV)]);
    expect(raw).toMatchObject({ v: 1, owner: 'bz-plugin', tickMs: 60_000 });
    expect(raw.vault).toBe('E:/vault'); // 尾斜杠剥掉（两边的归一化一起成立才比得上）
    expect(typeof raw.pid).toBe('number');
    expect(new Date(raw.at).getTime()).toBe(Date.parse('2026-10-14T07:00:00Z'));
  });

  it('目录不存在时会先建出来', () => {
    const fs = memFs();
    expect(writeWatchdogLease({ env: ENV, fs })).toBe(true);
    expect(fs.made).toContain('C:/LocalAppData/bz-dock-watch');
  });

  it('写不进去不抛（写不进去只意味着值守可能多跑一次，不该炸插件）', () => {
    const fs = memFs();
    fs.writeText = () => {
      throw new Error('EPERM');
    };
    expect(writeWatchdogLease({ env: ENV, fs })).toBe(false);
  });

  it('读回来是归一后的形状；坏文件/版本不认识当没有', () => {
    const fs = memFs();
    setDockFs(fs);
    writeWatchdogLease({ vault: 'E:/vault', env: ENV, fs });
    expect(readWatchdogLease({ env: ENV, fs })).toMatchObject({ owner: 'bz-plugin', vault: 'E:/vault' });

    fs.files[watchdogPathOf(WATCHDOG_LEASE_FILENAME, ENV)] = '{ 不是 JSON';
    expect(readWatchdogLease({ env: ENV, fs })).toBeNull();
    fs.files[watchdogPathOf(WATCHDOG_LEASE_FILENAME, ENV)] = JSON.stringify({ v: 9, owner: 'bz-plugin', at: 'x', pid: 1 });
    expect(readWatchdogLease({ env: ENV, fs })).toBeNull();
  });

  it('撤票（卸载时）—— 撤掉即「已离场」，值守下一拍立刻接管', () => {
    const fs = memFs();
    writeWatchdogLease({ env: ENV, fs });
    expect(isWatchdogInstalled({ env: ENV, fs })).toBe(false); // 只有租约不算装过
    clearWatchdogLease({ env: ENV, fs });
    expect(readWatchdogLease({ env: ENV, fs })).toBeNull();
    clearWatchdogLease({ env: ENV, fs }); // 幂等
  });
});

describe('状态（值守进程写、bz 读）', () => {
  const good = {
    v: 1,
    pid: 4242,
    startedAt: '2026-10-14T07:00:00.000Z',
    at: '2026-10-14T07:05:00.000Z',
    vault: 'E:/vault',
    mode: 'watch',
    runsSinceBoot: 3,
    core: '1.33.0',
    lastRun: { toolId: 'iamtxt-signin', name: '签到', at: '2026-10-14T04:00:00.000Z', ok: false, message: 'cookie 过期', kind: 'auth' },
  };

  it('读得到，且 lastRun 一句话带出来', () => {
    const fs = memFs({ [watchdogPathOf(WATCHDOG_STATUS_FILENAME, ENV)]: JSON.stringify(good) });
    const st = readWatchdogStatus({ env: ENV, fs })!;
    expect(st).toMatchObject({ mode: 'watch', runsSinceBoot: 3, core: '1.33.0' });
    expect(st.lastRun).toMatchObject({ toolId: 'iamtxt-signin', ok: false, kind: 'auth' });
  });

  it('脏字段逐个丢，核心字段缺了就当没有（面板不能因为可选件坏掉而报错）', () => {
    const fs = memFs({
      [watchdogPathOf(WATCHDOG_STATUS_FILENAME, ENV)]: JSON.stringify({
        v: 1,
        pid: 1,
        at: '2026-10-14T07:05:00.000Z',
        mode: '莫名其妙的模式',
        runsSinceBoot: -5,
        lastRun: { toolId: '', at: '' },
      }),
    });
    const st = readWatchdogStatus({ env: ENV, fs })!;
    expect(st.mode).toBe('off'); // 不认识的模式不猜，按「没在拍」显示
    expect(st.runsSinceBoot).toBe(0);
    expect(st.lastRun).toBeUndefined();
  });

  it('版本不认识 / 没有 at → null', () => {
    const fs = memFs({
      [watchdogPathOf(WATCHDOG_STATUS_FILENAME, ENV)]: JSON.stringify({ ...good, v: 2 }),
    });
    expect(readWatchdogStatus({ env: ENV, fs })).toBeNull();
    fs.files[watchdogPathOf(WATCHDOG_STATUS_FILENAME, ENV)] = JSON.stringify({ v: 1, pid: 1 });
    expect(readWatchdogStatus({ env: ENV, fs })).toBeNull();
  });

  it('心跳新鲜度：三拍内算活着', () => {
    const now = Date.parse('2026-10-14T07:05:00.000Z');
    const st = { ...good, at: new Date(now - 60_000).toISOString() } as WatchdogStatus;
    expect(isWatchdogAlive(st, now)).toBe(true);
    expect(isWatchdogAlive({ ...st, at: new Date(now - 10 * 60_000).toISOString() }, now)).toBe(false);
    expect(isWatchdogAlive({ ...st, at: '不是时间' }, now)).toBe(false);
  });

  it('装没装看 config.json（安装脚本写的那个），不看 status', () => {
    const empty = memFs();
    expect(isWatchdogInstalled({ env: ENV, fs: empty })).toBe(false);
    const installed = memFs({ [watchdogPathOf(WATCHDOG_CONFIG_FILENAME, ENV)]: '{"v":1}' });
    expect(isWatchdogInstalled({ env: ENV, fs: installed })).toBe(true);
  });

  it('TTL 是「三拍」量级（插件每 60 秒续一次票，不能比一拍还短）', () => {
    expect(WATCHDOG_LEASE_TTL_MS).toBeGreaterThanOrEqual(120_000);
  });
});

describe('待播报队列', () => {
  const q = (items: unknown[]): string => JSON.stringify({ v: 1, items });
  const note = (toolId: string, at: string, ok = true): Record<string, unknown> => ({ toolId, at, ok, name: toolId });

  it('按时刻升序读出来（补报顺序=发生顺序），坏条目丢掉', () => {
    const fs = memFs({
      [watchdogPathOf(WATCHDOG_QUEUE_FILENAME, ENV)]: q([
        note('b', '2026-10-14T02:00:00.000Z'),
        { 没有: 'toolId' },
        note('a', '2026-10-14T01:00:00.000Z', false),
      ]),
    });
    const items = readWatchdogQueue({ env: ENV, fs });
    expect(items.map((i) => i.toolId)).toEqual(['a', 'b']);
  });

  it('补报后只删自己播过的那几条 —— 值守进程正追加的新条目必须留着', () => {
    const playedNote = note('a', '2026-10-14T01:00:00.000Z');
    const fs = memFs({
      [watchdogPathOf(WATCHDOG_QUEUE_FILENAME, ENV)]: q([playedNote, note('b', '2026-10-14T02:00:00.000Z')]),
    });
    consumeWatchdogQueue([{ toolId: 'a', at: '2026-10-14T01:00:00.000Z', ok: true }], { env: ENV, fs });
    expect(readWatchdogQueue({ env: ENV, fs }).map((i) => i.toolId)).toEqual(['b']);
  });

  it('队列文件不在 / 坏的：返回空、消费静默', () => {
    const fs = memFs();
    expect(readWatchdogQueue({ env: ENV, fs })).toEqual([]);
    consumeWatchdogQueue([{ toolId: 'a', at: 'x', ok: true }], { env: ENV, fs });
    fs.files[watchdogPathOf(WATCHDOG_QUEUE_FILENAME, ENV)] = '半截 JSON';
    expect(readWatchdogQueue({ env: ENV, fs })).toEqual([]);
    consumeWatchdogQueue([{ toolId: 'a', at: 'x', ok: true }], { env: ENV, fs });
  });
});
