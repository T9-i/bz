/**
 * 分卷（ADR-0259）：一本册子只摊开**一卷**，DOM 里的条目数由卷容量封顶。
 *
 * 卷界**落在月界**：从最新往前整月累加，凑够 ≥ 容量即收卷。
 * 月度是册页索引的行单位——一个月被切在两卷里，索引一行就得写「卷 3–4」，目录自己先乱。
 * 只有「单月自身就超过容量」时，才在月内按容量硬切（那一天写了上百条的日子）。
 *
 * 纯函数，不碰 DOM 也不碰数据层：入参只要「按日期降序排好的 `YYYY-MM-DD` 串」。
 */

/** 一卷：条目下标区间 `[start, end)`，0 = 最新那一则 */
export interface Volume {
  start: number;
  end: number;
}

/** 卷容量的回落值（设置项未注入 / 非法时） */
export const VOLUME_CAPACITY_FALLBACK = 50;

/** 每月一行（册页索引用）：这一个月有几则、落在哪些卷、第一则在整册里的下标 */
export interface MonthSpan {
  /** `YYYY-MM` */
  key: string;
  /** 这个月共几则 */
  n: number;
  /** 涉及的卷号（1 起；单月跨卷时会有两个） */
  vols: number[];
  /** 这个月第一则在整册里的下标（0 起） */
  first: number;
}

/**
 * 切卷。`dates` 必须是按日期降序排好的（与册子的条目序一致）。
 * `capacity` 为容量目标，卷实际大小落在 `[capacity, capacity + 该月则数)` 之间。
 */
export function splitVolumes(dates: string[], capacity: number): Volume[] {
  const n = dates.length;
  if (!n) return [];
  const cap = Math.max(1, Math.floor(capacity) || 1);
  const out: Volume[] = [];
  let start = 0;
  let i = 0;
  while (i < n) {
    const month = dates[i].slice(0, 7);
    let j = i;
    while (j < n && dates[j].slice(0, 7) === month) j++;
    if (j - i >= cap) {
      /* 单月自己就装不下：先收掉前面攒的，再在月内按容量切（余数留给下一卷继续凑月） */
      if (i > start) {
        out.push({ start, end: i });
        start = i;
      }
      while (j - start >= cap) {
        out.push({ start, end: start + cap });
        start += cap;
      }
    } else if (j - start >= cap) {
      /* 含这一月刚好够容量：在这一月的**末尾**收卷，整月不被切开 */
      out.push({ start, end: j });
      start = j;
    }
    i = j;
  }
  if (start < n) out.push({ start, end: n });
  return out;
}

/** 某一则在第几卷（1 起）；越界返回 -1 */
export function volumeOf(volumes: Volume[], index: number): number {
  for (let v = 0; v < volumes.length; v++) {
    const { start, end } = volumes[v];
    if (index >= start && index < end) return v + 1;
  }
  return -1;
}

/** 每月一行的索引数据（顺序与条目序一致：新月份在前） */
export function monthSpans(dates: string[], volumes: Volume[]): MonthSpan[] {
  const out: MonthSpan[] = [];
  let cur: MonthSpan | null = null;
  for (let i = 0; i < dates.length; i++) {
    const key = dates[i].slice(0, 7);
    if (!cur || cur.key !== key) {
      cur = { key, n: 0, vols: [], first: i };
      out.push(cur);
    }
    cur.n++;
    const v = volumeOf(volumes, i);
    if (v > 0 && cur.vols[cur.vols.length - 1] !== v) cur.vols.push(v);
  }
  return out;
}

/** 书口年份色带：每年几则（按全册算，见 ADR-0259 决策 5） */
export function yearBands(dates: string[]): { year: string; n: number }[] {
  const out: { year: string; n: number }[] = [];
  for (const d of dates) {
    const year = d.slice(0, 4);
    const last = out[out.length - 1];
    if (last && last.year === year) last.n++;
    else out.push({ year, n: 1 });
  }
  return out;
}

/**
 * 第 1 卷收到哪一条才算「整」（开册读到这儿为止）；还没收卷返回 -1。
 *
 * 判据是「已经看到第 2 卷了」而不是「第 1 卷的 end 恰好等于已读条数」——
 * 后者分不清「这一月刚好装够、卷尾正好是数据尾」和「后面可能还有同月的条目」。
 * 看到第 2 卷就意味着第 1 卷的边界已被数据本身确认。
 */
export function firstVolumeClosedAt(dates: string[], capacity: number): number {
  const vols = splitVolumes(dates, capacity);
  return vols.length >= 2 ? vols[0].end : -1;
}
