/**
 * 分卷（ADR-0259）纯函数：卷界落在月界、容量收卷、单月超容量、跨卷月份、书口年份占比。
 *
 * 这些是整个「一册只摊开一卷」的规则所在，抽成纯函数就是为了脱开 DOM 与磁盘直接测。
 */
import { describe, expect, it } from 'vitest';
import { splitVolumes, volumeOf, monthSpans, yearBands, firstVolumeClosedAt } from '../../src/diary/volume';

/** 按「月-日」造一串降序日期 */
const dates = (...items: string[]): string[] => items;

describe('splitVolumes（卷界落在月界）', () => {
  it('没有条目就没有卷', () => {
    expect(splitVolumes([], 50)).toEqual([]);
  });

  it('装得下就是一整卷', () => {
    const d = dates('2026-08-19', '2026-08-01', '2026-07-02');
    expect(splitVolumes(d, 50)).toEqual([{ start: 0, end: 3 }]);
  });

  it('凑够容量就在**这一月的末尾**收卷：整月不被切开', () => {
    const d = dates(
      '2026-08-19',
      '2026-08-01',
      '2026-07-02',
      '2026-07-01',
      '2026-06-30',
      '2026-06-05'
    );
    // 容量 3：八月(2) 不够，加上七月(2) 够了 ⇒ 卷一到七月底（4 则）；六月另起卷二
    expect(splitVolumes(d, 3)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 6 },
    ]);
  });

  it('单月自己就超过容量：月内按容量硬切，余数并入下一卷继续凑月', () => {
    const big = Array.from({ length: 60 }, (_, i) => `2026-08-${String((i % 28) + 1).padStart(2, '0')}`);
    const d = [...big, ...Array.from({ length: 10 }, () => '2026-07-01')];
    expect(splitVolumes(d, 50)).toEqual([
      { start: 0, end: 50 },
      { start: 50, end: 70 },
    ]);
  });

  it('一个月装下两个容量还多：切成三卷，最后那截继续往后凑', () => {
    const d = Array.from({ length: 120 }, () => '2026-08-19');
    expect(splitVolumes(d, 50)).toEqual([
      { start: 0, end: 50 },
      { start: 50, end: 100 },
      { start: 100, end: 120 },
    ]);
  });

  it('容量非法时按 1 兜底，不会死循环也不会空卷', () => {
    const d = dates('2026-08-19', '2026-07-02');
    expect(splitVolumes(d, 0)).toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }]);
  });

  it('卷号 1 = 最新那一卷（条目序是降序）', () => {
    const vols = splitVolumes(dates('2026-08-19', '2026-07-02', '2026-06-05'), 1);
    expect(vols[0].start).toBe(0);
    expect(volumeOf(vols, 0)).toBe(1);
    expect(volumeOf(vols, 2)).toBe(3);
    expect(volumeOf(vols, 9)).toBe(-1);
  });
});

describe('monthSpans（册页索引的一行）', () => {
  it('按月汇总条数、记下首页那条的下标与所在卷', () => {
    const d = dates('2026-08-19', '2026-08-01', '2026-07-02', '2026-07-01', '2026-06-30', '2026-06-05');
    const vols = splitVolumes(d, 3);
    expect(monthSpans(d, vols)).toEqual([
      { key: '2026-08', n: 2, vols: [1], first: 0 },
      { key: '2026-07', n: 2, vols: [1], first: 2 },
      { key: '2026-06', n: 2, vols: [2], first: 4 },
    ]);
  });

  it('一个月被容量切开时记两个卷号（索引那一行要写「卷 1–2」）', () => {
    const d = [...Array.from({ length: 60 }, () => '2026-08-19'), ...Array.from({ length: 10 }, () => '2026-07-01')];
    const vols = splitVolumes(d, 50);
    const spans = monthSpans(d, vols);
    expect(spans[0]).toMatchObject({ key: '2026-08', n: 60, vols: [1, 2] });
    expect(spans[1]).toMatchObject({ key: '2026-07', n: 10, vols: [2] });
  });
});

describe('yearBands（书口年份色带按全册则数占比）', () => {
  it('按年聚条数，顺序与条目序一致（新的年份在前）', () => {
    const d = dates('2026-08-19', '2026-01-02', '2025-12-31', '2025-01-01', '2024-06-01');
    expect(yearBands(d)).toEqual([
      { year: '2026', n: 2 },
      { year: '2025', n: 2 },
      { year: '2024', n: 1 },
    ]);
  });
});

describe('firstVolumeClosedAt（开册读到哪算「整」）', () => {
  it('还没看到第二卷 ⇒ -1（继续读）', () => {
    const d = dates('2026-08-19', '2026-08-01', '2026-07-02', '2026-07-01');
    expect(firstVolumeClosedAt(d, 3)).toBe(-1);
  });

  it('看到第二卷才认卷一的边界（多读一条是有意的：边界由数据本身确认）', () => {
    const d = dates('2026-08-19', '2026-08-01', '2026-07-02', '2026-07-01', '2026-06-30');
    expect(firstVolumeClosedAt(d, 3)).toBe(4);
  });
});
