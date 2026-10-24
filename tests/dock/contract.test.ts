// @vitest-environment node
/**
 * 契约层测试：解析、参数下发、判定、锁。
 *
 * 重点不是覆盖率，是**三条会被用户感觉到的性质**：
 *  - 脏数据只丢那一条，不连累整个面板；
 *  - 凭据不上命令行；
 *  - 「这次干成没有」只由 runId 决定。
 */

import { describe, expect, it } from 'vitest';
import {
  buildArgs,
  findByRunId,
  parseIntent,
  parseManifest,
  parseRegistry,
  parseHeartbeat,
  parseRunLines,
  parseRunRecord,
  secretEnvOf,
  runSignature,
} from '../../src/dock/parse';
import { judgeRun } from '../../src/dock/exec';
import { acquireLock, lockPathOf } from '../../src/dock/lock';
import { fakeFs } from './_fake-fs';
import type { DockRunRecord } from '../../src/dock/types';

describe('声明解析', () => {
  const good = {
    v: 2,
    id: 'demo',
    name: '演示',
    entry: { cmd: 'node', args: ['main.mjs'] },
    params: [{ key: 'cookie', type: 'secret' }],
  };

  it('认 v2', () => {
    const m = parseManifest(good);
    expect(m?.id).toBe('demo');
    expect(m?.entry?.cmd).toBe('node');
  });

  it('不认 v1（不做兼容）', () => {
    expect(parseManifest({ ...good, v: 1 })).toBeNull();
  });

  it('没有 entry 也能读出来 —— 但只是看得见，跑不了', () => {
    const m = parseManifest({ ...good, entry: undefined });
    expect(m).not.toBeNull();
    expect(m?.entry).toBeUndefined();
  });

  it('choice 没有候选就整条丢掉，不渲染空下拉', () => {
    const m = parseManifest({ ...good, params: [{ key: 'x', type: 'choice' }] });
    expect(m?.params).toBeUndefined();
  });

  it('坏的参数只丢那一条', () => {
    const m = parseManifest({
      ...good,
      params: [{ key: 'ok', type: 'text' }, { key: 'bad key!', type: 'text' }],
    });
    expect(m?.params?.map((p) => p.key)).toEqual(['ok']);
  });
});

describe('参数下发', () => {
  const manifest = {
    params: [
      { key: 'name', type: 'text' as const },
      { key: 'flag', type: 'bool' as const },
      { key: 'cookie', type: 'secret' as const },
    ],
  };

  it('凭据不上命令行', () => {
    const args = buildArgs(manifest, { name: 'a', flag: true, cookie: 'very-secret' });
    expect(args).toEqual(['--name=a', '--flag']);
    expect(args.join(' ')).not.toContain('very-secret');
  });

  it('凭据走独立环境变量', () => {
    const env = secretEnvOf(manifest, { cookie: 'very-secret' });
    expect(env.BZ_DOCK_SECRET_COOKIE).toBe('very-secret');
  });

  it('信任签名含 shell 与 cwd —— 改了哪一项都算换了命令', () => {
    const a = runSignature({ cmd: 'node', args: ['x'], shell: false, cwd: '/a' });
    const b = runSignature({ cmd: 'node', args: ['x'], shell: true, cwd: '/a' });
    const c = runSignature({ cmd: 'node', args: ['x'], shell: false, cwd: '/b' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('记录解析', () => {
  it('缺 runId 的行走丢 —— 它无法被对账', () => {
    expect(parseRunRecord({ status: 'ok' })).toBeNull();
  });

  it('坏行跳过，好行留下', () => {
    const text = ['{"runId":"r1","tool":"t","status":"ok","startedAt":"2026-01-01T00:00:00Z"}', 'not json', ''].join('\n');
    expect(parseRunLines(text, 't')).toHaveLength(1);
  });

  it('tool 对不上的行不算这个工具的', () => {
    const text = '{"runId":"r1","tool":"other","status":"ok","startedAt":"2026-01-01T00:00:00Z"}';
    expect(parseRunLines(text, 't')).toHaveLength(0);
  });
});

describe('心跳', () => {
  it('有合法 at 才算心跳', () => {
    expect(parseHeartbeat({ at: '2026-10-24T08:00:00.000Z', runId: 'r1', step: '正在抓' })).toEqual({
      at: '2026-10-24T08:00:00.000Z',
      runId: 'r1',
      step: '正在抓',
    });
  });

  it('没有 at / at 不是时间 —— 一律当没有（说不清什么时候的心跳不能用来判断在不在跑）', () => {
    expect(parseHeartbeat(null)).toBeNull();
    expect(parseHeartbeat({})).toBeNull();
    expect(parseHeartbeat({ at: '不是时间' })).toBeNull();
    expect(parseHeartbeat({ runId: 'r1' })).toBeNull();
  });

  it('多出来的字段丢掉，不往视图里带', () => {
    const hb = parseHeartbeat({ at: '2026-10-24T08:00:00.000Z', pct: 40, junk: {} });
    expect(hb).toEqual({ at: '2026-10-24T08:00:00.000Z' });
  });
});

describe('判定：这次到底干成没有', () => {
  const base = {
    runId: 'r-run',
    toolId: 't',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:01:00Z',
    durationMs: 60_000,
    code: 0,
    stopped: false,
    timedOut: false,
    error: null,
    stderr: '',
  };

  const rec = (over: Partial<DockRunRecord>): DockRunRecord => ({
    runId: 'r-run',
    tool: 't',
    trigger: 'manual',
    status: 'ok',
    startedAt: '2026-01-01T00:00:00Z',
    ...over,
  });

  it('记录说成功，退出码却不干净 —— 以记录为准', () => {
    const o = judgeRun({ ...base, code: 1 }, [rec({ status: 'ok' })]);
    expect(o.ok).toBe(true);
    expect(o.status).toBe('ok');
  });

  it('记录说失败，退出码是 0 —— 也以记录为准', () => {
    const o = judgeRun(base, [rec({ status: 'failed', error: { kind: 'auth' } })]);
    expect(o.ok).toBe(false);
    expect(o.kind).toBe('auth');
  });

  it('找不到同 runId 的记录，就明说「没记录」，不拿上一条充数', () => {
    const other = rec({ runId: 'r-old', status: 'ok' });
    const o = judgeRun({ ...base, code: 1 }, [other]);
    expect(o.ok).toBe(false);
    expect(o.recordMissing).toBeTruthy();
  });

  it('人掐的优先于一切', () => {
    const o = judgeRun({ ...base, stopped: true }, [rec({ status: 'ok' })]);
    expect(o.status).toBe('stopped');
    expect(o.ok).toBe(false);
  });

  it('进程结束了记录还写着 running —— 判「没收尾」', () => {
    const o = judgeRun(base, [rec({ status: 'running' })]);
    expect(o.status).toBe('abandoned');
    expect(o.ok).toBe(false);
  });

  it('精确按 runId 找，别拿最新的顶包', () => {
    const list = [rec({ runId: 'a' }), rec({ runId: 'b' })];
    expect(findByRunId(list, 'a')?.runId).toBe('a');
    expect(findByRunId(list, 'zzz')).toBeUndefined();
  });
});

describe('登记表', () => {
  it('不认 v2 的登记表', () => {
    const { registry, errors } = parseRegistry({ v: 2, tools: [{ id: 'a', path: '/x/manifest.json' }] });
    expect(registry.tools).toHaveLength(0);
    expect(errors[0]).toContain('版本');
  });

  it('认 v3，重复 id 只留第一条', () => {
    const { registry, errors } = parseRegistry({
      v: 3,
      tools: [
        { id: 'a', path: '/x/manifest.json' },
        { id: 'a', path: '/y/manifest.json' },
      ],
    });
    expect(registry.tools).toHaveLength(1);
    expect(registry.tools[0].path).toBe('/x/manifest.json');
    expect(errors.length).toBe(1);
  });
});

describe('意图文件', () => {
  it('tool 对不上就当没写过（整目录被复制后不会串台）', () => {
    const intent = parseIntent({ v: 1, tool: 'other', rules: [] }, 'mine');
    expect(intent.rules).toBeUndefined();
  });
});

describe('执行权锁', () => {
  it('同一时刻只有一个能拿到', () => {
    const fs = fakeFs();
    const a = acquireLock('/data', 'plugin', { fs, now: 1000 });
    const b = acquireLock('/data', 'watch', { fs, now: 1000 });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    a?.release();
    expect(acquireLock('/data', 'watch', { fs, now: 1001 })).not.toBeNull();
  });

  it('持有者过期后可以被接手', () => {
    const fs = fakeFs();
    const a = acquireLock('/data', 'plugin', { fs, now: 1000, staleMs: 100 });
    expect(a).not.toBeNull();
    const b = acquireLock('/data', 'watch', { fs, now: 1200, staleMs: 100 });
    expect(b).not.toBeNull();
    expect(fs.files.get(lockPathOf('/data'))).toContain('watch');
  });

  it('续期之后别人抢不走', () => {
    const fs = fakeFs();
    const a = acquireLock('/data', 'plugin', { fs, now: 1000, staleMs: 100 });
    expect(a?.renew()).toBe(true);
    const b = acquireLock('/data', 'watch', { fs, now: 1050, staleMs: 100 });
    expect(b).toBeNull();
  });

  it('锁被别人抢走后，旧的续期会失败（不会两边都以为自己有）', () => {
    const fs = fakeFs();
    const a = acquireLock('/data', 'plugin', { fs, now: 1000, staleMs: 100 });
    const b = acquireLock('/data', 'watch', { fs, now: 1300, staleMs: 100 });
    expect(b).not.toBeNull();
    expect(a?.renew()).toBe(false);
  });
});
