// @vitest-environment node
/**
 * 「下次预计」的边界：今天过点了但还没跑，**不能显示成明天**。
 *
 * 这个值不只给人看 —— 值守的 `plan()` 拿它算下一次唤醒。上一版在这里直接跳到明天，
 * 面板上写着「明天 09:00」，看着像今天不跑了。
 */
import { describe, expect, it } from 'vitest';
import { nextDueOf } from '../../src/dock/rules';
import type { DockRule } from '../../src/dock/types';

const daily = (at = '09:00'): DockRule => ({ id: 'r', trigger: { kind: 'daily', at }, action: { kind: 'run' } });

/** 2026-01-05 的某个时刻（本地时区） */
const at = (hour: number, minute = 0): number => new Date(2026, 0, 5, hour, minute, 0, 0).getTime();

describe('nextDueOf / daily', () => {
  it('还没到点 → 今天那个时刻', () => {
    expect(nextDueOf(daily(), { now: at(8) })).toBe(at(9));
  });

  it('已过点、今天还没跑 → 仍然是今天那个时刻（欠着一次，该补跑）', () => {
    expect(nextDueOf(daily(), { now: at(10), lastFiredAt: at(9) - 86_400_000 })).toBe(at(9));
  });

  it('已过点、从没跑过 → 今天那个时刻，不是明天', () => {
    expect(nextDueOf(daily(), { now: at(10) })).toBe(at(9));
  });

  it('今天已经跑过 → 明天', () => {
    expect(nextDueOf(daily(), { now: at(10), lastFiredAt: at(9, 1) })).toBe(at(9) + 86_400_000);
  });

  it('时间写坏了 → 算不出来，不假装到点', () => {
    expect(nextDueOf(daily('25:00'), { now: at(10) })).toBeNull();
  });
});
