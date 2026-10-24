// @vitest-environment node
/**
 * 值守的**唤醒节奏**守卫。
 *
 * 这里钉的不是「实现细节」，是三条会安静出错的规矩：
 *
 *  1. **到点即醒**：定点任务睡到那一刻，不是「最多晚一个扫描间隔」。退回去就是「19:00 的任务
 *     19:00:29 才跑」，而这件事没有任何报错，只有用户觉得「怎么慢半拍」。
 *  2. **绝不打转**：`at` 落在过去（规则被跳过、冷却中、参数没填）时必须退到扫描间隔。
 *     少了这条，conditionMs=1 秒 × 到期时刻在过去 = 每秒跑一拍，日志和 CPU 一起炸。
 *  3. **条件层不拖慢定点**：同时有事件在盯时取两者更早的那个，而不是互相排队。
 *
 * 另外守一下 tasklist 的解析：它认错一个字符，就等于「没看到 Obsidian」，
 * 而「没看到」= 条件永远不成立 = 关闭后不同步，且完全没有症状。
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { exitTransition, nextDelay, parseObsidianPids } = require('../../tools/dock-watch/watch.js') as {
  nextDelay(now: number, o: { at: number | null; scanMs: number; cond: boolean; condMs: number }): number;
  parseObsidianPids(text: string): number[];
  exitTransition(pids: number[], alive: number[]): { next: number[]; changed: boolean; fire: boolean };
};

const SCAN = 30_000;
const COND = 1_000;
const NOW = 1_700_000_000_000;

const delay = (o: { at?: number | null; cond?: boolean; scanMs?: number; condMs?: number }) =>
  nextDelay(NOW, { at: null, scanMs: SCAN, cond: false, condMs: COND, ...o });

describe('nextDelay：什么时候醒', () => {
  it('没有钟点规则时按扫描间隔醒', () => {
    expect(delay({ at: null })).toBe(SCAN);
  });

  it('到期时刻在未来 → 睡到那一刻（这是「准时」的唯一来源）', () => {
    expect(delay({ at: NOW + 12_345 })).toBe(12_345);
  });

  it('到期时刻在过去 → 退到扫描间隔，绝不原地打转', () => {
    expect(delay({ at: NOW - 5 })).toBe(SCAN);
    expect(delay({ at: NOW })).toBe(SCAN);
  });

  it('远期到期被扫描间隔封顶（别睡过头看不见规则表改动）', () => {
    expect(delay({ at: NOW + 3 * 3600_000 })).toBe(SCAN);
  });

  it('条件层在盯 → 取更早的那个', () => {
    expect(delay({ at: NOW + 3 * 3600_000, cond: true })).toBe(COND);
    expect(delay({ at: NOW + 400, cond: true })).toBe(400);
    expect(delay({ at: null, cond: true })).toBe(COND);
  });

  it('永不为 0 或负数（`at` 恰好等于 now 时也一样）', () => {
    for (const at of [NOW, NOW + 1, NOW - 1, null]) {
      expect(delay({ at, cond: true })).toBeGreaterThanOrEqual(200);
      expect(delay({ at, cond: false })).toBeGreaterThanOrEqual(200);
    }
  });

  it('扫描间隔配得再小也不会变成忙等', () => {
    expect(delay({ at: null, scanMs: 1 })).toBeGreaterThanOrEqual(200);
    expect(delay({ at: null, scanMs: 0 })).toBeGreaterThanOrEqual(200);
  });
});

describe('parseObsidianPids：认错就等于永远不触发', () => {
  it('标准 CSV（多进程：Electron 有主进程 + 渲染 + GPU + utility）', () => {
    const text = [
      '"Obsidian.exe","25872","Console","1","123,456 K"',
      '"Obsidian.exe","13728","Console","1","99,000 K"',
    ].join('\r\n');
    expect(parseObsidianPids(text)).toEqual([25872, 13728]);
  });

  it('没有匹配时 tasklist 吐的是一句中文提示，不是表', () => {
    expect(parseObsidianPids('信息: 没有运行的任务匹配指定标准。')).toEqual([]);
    expect(parseObsidianPids('INFO: No tasks are running which match the specified criteria.')).toEqual([]);
  });

  it('空输入 / 垃圾输入不抛', () => {
    expect(parseObsidianPids('')).toEqual([]);
    expect(parseObsidianPids('\r\n\r\n')).toEqual([]);
    expect(parseObsidianPids('随便一行没有引号的文本')).toEqual([]);
  });

  it('只认带引号的 pid 字段（别的进程名里带数字不会被误认）', () => {
    expect(parseObsidianPids('"Obsidian.exe","0"')).toEqual([0]);
    expect(parseObsidianPids('Obsidian.exe 1234 Console')).toEqual([]);
  });
});

describe('exitTransition：「关闭」是怎么判出来的', () => {
  // Electron 是主进程 + 渲染 + GPU + utility 一串。用户关掉的是**整个应用**，
  // 所以「少一个」不能算，「一个不剩」才算。
  const all = [100, 200, 300];

  it('全都活着 → 不变化、不触发', () => {
    expect(exitTransition(all, all)).toEqual({ next: all, changed: false, fire: false });
  });

  it('少了一部分（多开 / 辅助进程先退）→ 只缩快照，不触发', () => {
    expect(exitTransition(all, [100, 200])).toEqual({ next: [100, 200], changed: true, fire: false });
  });

  it('一个不剩 → 触发，且快照清空（边沿触发：不会每秒再投一次）', () => {
    expect(exitTransition(all, [])).toEqual({ next: [], changed: true, fire: true });
    // 清空之后再判一次：没有快照 = 没有可观测的关闭，不该再投
    expect(exitTransition([], [])).toEqual({ next: [], changed: false, fire: false });
  });

  it('两次都死… 快照里只剩一个、它死了 → 这一次才触发', () => {
    expect(exitTransition([300], [])).toEqual({ next: [], changed: true, fire: true });
  });
});
