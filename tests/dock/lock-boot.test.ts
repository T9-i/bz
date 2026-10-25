// @vitest-environment node
/**
 * 执行权锁：重启后 pid 被复用留下的「尸体」不该把调度卡到 90 秒。
 *
 * `bootId` 从写下那天起就没人参与判据（一直是空串），锁里那行注释承诺的
 * 「pid 会被复用」防护等于不存在。这里钉住：开机标识对不上就立刻可抢。
 */
import { describe, expect, it } from 'vitest';
import { acquireLock, lockPathOf } from '../../src/dock/lock';
import { fakeFs } from './_fake-fs';

const DIR = '/data';

describe('执行权锁 / bootId', () => {
  it('同一个开机标识、持有者还活着 → 抢不到', () => {
    const fs = fakeFs();
    const now = Date.now();
    const first = acquireLock(DIR, 'watchdog', { fs, now, bootId: 'boot-a' });
    expect(first).not.toBeNull();

    const second = acquireLock(DIR, 'plugin', { fs, now: now + 1000, bootId: 'boot-a' });
    expect(second).toBeNull();
  });

  it('开机标识对不上（重启后 pid 撞上了别人）→ 立刻可抢，不必等 90 秒', () => {
    const fs = fakeFs();
    const now = Date.now();
    const first = acquireLock(DIR, 'watchdog', { fs, now, bootId: 'boot-a' });
    expect(first).not.toBeNull();
    first?.release();
    // release 会删锁；重新造一把「上一轮开机留下的」锁（pid 就是本进程，活着）
    fs.writeText(
      lockPathOf(DIR),
      JSON.stringify({ owner: 'watchdog', pid: process.pid, bootId: 'boot-a', at: new Date(now).toISOString(), token: 'old' }),
    );

    const second = acquireLock(DIR, 'plugin', { fs, now: now + 1000, bootId: 'boot-b' });
    expect(second).not.toBeNull();
  });

  it('老锁没有 bootId → 不参与这条判断，仍按 pid / 时间走', () => {
    const fs = fakeFs();
    const now = Date.now();
    fs.writeText(
      lockPathOf(DIR),
      JSON.stringify({ owner: 'watchdog', pid: process.pid, bootId: '', at: new Date(now).toISOString(), token: 'old' }),
    );
    expect(acquireLock(DIR, 'plugin', { fs, now: now + 1000, bootId: 'boot-b' })).toBeNull();
    // 时间一过照样能抢
    expect(acquireLock(DIR, 'plugin', { fs, now: now + 91_000, bootId: 'boot-b' })).not.toBeNull();
  });
});
