// @vitest-environment node
/**
 * 后台运行的实时步骤 —— 值守把 `[bz-step]` 落到本机文件，面板轮询它。
 *
 * 这一组测的是「读的那半边」：追加式文件在崩掉时会留半截行，一行坏掉不该让整块日志消失；
 * 上一轮的步骤也不该混进这一轮。
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { parseLiveLog } from '../../src/dock/watchdog-status';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const rt = require('../../tools/dock-watch/runtime.js') as {
  appendLive(toolId: string, runId: string, text: string, env?: Record<string, string>): void;
  liveFileOf(toolId: string, env?: Record<string, string>): string;
  writeStatus(patch: Record<string, unknown>, env?: Record<string, string>): Record<string, unknown>;
  fileOf(name: string, env?: Record<string, string>): string;
  CONTRACT_VERSION: number;
};

const line = (o: Record<string, unknown>): string => `${JSON.stringify(o)}\n`;

describe('解析实时步骤', () => {
  it('正常几行按顺序读出来', () => {
    const text =
      line({ runId: 'r1', at: '2026-10-24T08:00:00.000Z', text: '打开登录页' }) +
      line({ runId: 'r1', at: '2026-10-24T08:00:02.000Z', text: '提交签到' });
    expect(parseLiveLog(text)).toEqual([
      { runId: 'r1', at: '2026-10-24T08:00:00.000Z', text: '打开登录页' },
      { runId: 'r1', at: '2026-10-24T08:00:02.000Z', text: '提交签到' },
    ]);
  });

  it('最后一行半截（进程被杀）—— 前面几行照读', () => {
    const text = line({ runId: 'r1', text: '第一步' }) + '{"runId":"r1","text":"第二';
    expect(parseLiveLog(text).map((s) => s.text)).toEqual(['第一步']);
  });

  it('没有正文的行跳过（空步骤不占一行位置）', () => {
    const text = line({ runId: 'r1' }) + line({ runId: 'r1', text: '' }) + line({ runId: 'r1', text: '有内容' });
    expect(parseLiveLog(text).map((s) => s.text)).toEqual(['有内容']);
  });

  it('limit 从尾部取（面板只看最近几条）', () => {
    const text = ['a', 'b', 'c', 'd'].map((t) => line({ text: t })).join('');
    expect(parseLiveLog(text, 2).map((s) => s.text)).toEqual(['c', 'd']);
  });

  it('空 / 不存在 —— 空数组，不抛', () => {
    expect(parseLiveLog(null)).toEqual([]);
    expect(parseLiveLog('')).toEqual([]);
  });
});

describe('值守侧的写入约定', () => {
  it('换一轮就重写：上一轮的步骤不会混进来', () => {
    const env = { LOCALAPPDATA: mkdtempSync(join(tmpdir(), 'bz-live-')) };
    const file = rt.liveFileOf('demo', env);
    try {
      rt.appendLive('demo', 'r1', '旧的一步', env);
      rt.appendLive('demo', 'r1', '旧的又一步', env);
      expect(parseLiveLog(readFileSync(file, 'utf8')).length).toBe(2);

      rt.appendLive('demo', 'r2', '新的一轮第一步', env);
      const steps = parseLiveLog(readFileSync(file, 'utf8'));
      expect(steps.map((s) => s.text)).toEqual(['新的一轮第一步']);
      expect(steps[0]?.runId).toBe('r2');
    } finally {
      rmSync(env.LOCALAPPDATA, { recursive: true, force: true });
    }
  });

  it('状态快照：旧错误能被清掉，版本号不被旧值盖住', () => {
    // 这两个坑都在真机上出现过：错误恢复后面板还挂着几小时前的 lastError；
    // 以及上一版写下的 v:1 一直盖住新契约版本号。
    const env = { LOCALAPPDATA: mkdtempSync(join(tmpdir(), 'bz-st-')) };
    try {
      mkdirSync(join(env.LOCALAPPDATA, 'bz-dock-watch'), { recursive: true });
      writeFileSync(rt.fileOf('status.json', env), JSON.stringify({ v: 1, lastError: '读不到面板数据', mode: 'defer' }));
      const next = rt.writeStatus({ mode: 'watch', lastError: undefined }, env);

      expect(next.v).toBe(rt.CONTRACT_VERSION);
      expect(next.mode).toBe('watch');
      expect('lastError' in next).toBe(false);

      // 真的落盘了才算数（不是只在返回值里删了）
      const onDisk = JSON.parse(readFileSync(rt.fileOf('status.json', env), 'utf8'));
      expect(onDisk.v).toBe(rt.CONTRACT_VERSION);
      expect('lastError' in onDisk).toBe(false);
    } finally {
      rmSync(env.LOCALAPPDATA, { recursive: true, force: true });
    }
  });

  it('状态快照：别的字段照常保留（合并写，不是整体替换）', () => {
    const env = { LOCALAPPDATA: mkdtempSync(join(tmpdir(), 'bz-st-')) };
    try {
      mkdirSync(join(env.LOCALAPPDATA, 'bz-dock-watch'), { recursive: true });
      writeFileSync(rt.fileOf('status.json', env), JSON.stringify({ pid: 4242, runsSinceBoot: 7 }));
      const next = rt.writeStatus({ mode: 'busy' }, env);
      expect(next.pid).toBe(4242);
      expect(next.runsSinceBoot).toBe(7);
      expect(next.mode).toBe('busy');
    } finally {
      rmSync(env.LOCALAPPDATA, { recursive: true, force: true });
    }
  });

  it('同一轮里是追加，不是覆盖', () => {
    const env = { LOCALAPPDATA: mkdtempSync(join(tmpdir(), 'bz-live-')) };
    try {
      rt.appendLive('demo', 'r1', '一', env);
      rt.appendLive('demo', 'r1', '二', env);
      rt.appendLive('demo', 'r1', '三', env);
      expect(parseLiveLog(readFileSync(rt.liveFileOf('demo', env), 'utf8')).map((s) => s.text)).toEqual([
        '一',
        '二',
        '三',
      ]);
    } finally {
      rmSync(env.LOCALAPPDATA, { recursive: true, force: true });
    }
  });
});
