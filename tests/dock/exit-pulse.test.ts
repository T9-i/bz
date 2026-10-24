// @vitest-environment node
/**
 * 「关闭 Obsidian 时」这条触发 —— 只验四件事：
 *
 *  1) 脉冲写得出、读得回（时间 + 进程号）；
 *  2) **重载插件不算关闭**（进程号相同）；
 *  3) **旧进程还活着不算关闭**（多个窗口只卸载了一个 / 判不出就不跑）；
 *  4) 真关闭（旧进程已死）才算，而且判据层认这个事件。
 *
 * 第 2、3 条是这套机制最容易搞错的地方：判宽了，每重载一次插件就同步一遍仓库；
 * 判窄了，功能等于不存在。所以宁可漏一次（等下回关闭），也不误报。
 */

import { describe, expect, it } from 'vitest';
import {
  EXIT_PULSE_FILENAME,
  clearExitPulse,
  exitPulseFires,
  exitPulsePath,
  readExitPulse,
  writeExitPulse,
} from '../../src/dock/exit-pulse';
import { parseRule } from '../../src/dock/parse';
import { ruleDue, triggerText } from '../../src/dock/rules';
import { fakeFs } from './_fake-fs';

const DIR = '/vault/CONFIG/STORAGE';
/** 一个几乎不可能存在的进程号（Windows 的 pid 是 4 的倍数且远小于它） */
const DEAD_PID = 999999;

describe('关闭脉冲', () => {
  it('写下去能读回来，带时间与进程号', () => {
    const fs = fakeFs();
    expect(writeExitPulse(DIR, fs, Date.parse('2026-10-24T08:00:00Z'))).toBe(true);
    const pulse = readExitPulse(DIR, fs);
    expect(pulse?.at).toBe('2026-10-24T08:00:00.000Z');
    expect(pulse?.pid).toBe(process.pid);
    expect(fs.files.has(exitPulsePath(DIR))).toBe(true);
    expect(exitPulsePath(DIR).endsWith(EXIT_PULSE_FILENAME)).toBe(true);
  });

  it('没有脉冲 → 不算关闭', () => {
    expect(exitPulseFires(readExitPulse(DIR, fakeFs()))).toBe(false);
  });

  it('时间坏了 → 不算（判不出就不跑）', () => {
    const fs = fakeFs({ [exitPulsePath(DIR)]: JSON.stringify({ at: '不是时间', pid: DEAD_PID }) });
    expect(readExitPulse(DIR, fs)).toBeNull();
    expect(exitPulseFires({ at: '不是时间', pid: DEAD_PID })).toBe(false);
  });

  it('进程号缺失 → 不算（判不出就不跑）', () => {
    expect(exitPulseFires({ at: new Date().toISOString(), pid: 0 })).toBe(false);
  });

  it('同一个进程号 → 那只是重载/禁用插件，不算关闭', () => {
    const pulse = { at: new Date().toISOString(), pid: process.pid };
    expect(exitPulseFires(pulse, process.pid)).toBe(false);
  });

  it('旧进程还活着 → 不算关闭', () => {
    // 拿本进程当「还活着的旧进程」，只在 self 不是它的时候才该进入存活判断
    const pulse = { at: new Date().toISOString(), pid: process.pid };
    expect(exitPulseFires(pulse, 1)).toBe(false);
  });

  it('旧进程已经不在 → 算一次关闭', () => {
    const pulse = { at: new Date().toISOString(), pid: DEAD_PID };
    expect(exitPulseFires(pulse, process.pid)).toBe(true);
  });

  it('消费即删', () => {
    const fs = fakeFs();
    writeExitPulse(DIR, fs);
    clearExitPulse(DIR, fs);
    expect(readExitPulse(DIR, fs)).toBeNull();
    // 删第二次也不炸
    expect(() => clearExitPulse(DIR, fs)).not.toThrow();
  });
});

describe('契约与判据', () => {
  it('规则文件里存得下这种触发', () => {
    const rule = parseRule({ id: 'r-exit', trigger: { kind: 'obsidian-exit' }, action: { kind: 'run' } });
    expect(rule?.trigger).toEqual({ kind: 'obsidian-exit' });
  });

  it('只有「关闭」那枚事件能让它响', () => {
    const rule = { id: 'r', trigger: { kind: 'obsidian-exit' as const }, action: { kind: 'run' as const } };
    expect(ruleDue(rule, { now: Date.now(), event: { kind: 'obsidian-exit' } })).toBe(true);
    expect(ruleDue(rule, { now: Date.now(), event: { kind: 'panel-open' } })).toBe(false);
    expect(ruleDue(rule, { now: Date.now() })).toBe(false);
  });

  it('人话是「关闭 Obsidian 后」', () => {
    expect(triggerText({ kind: 'obsidian-exit' })).toBe('关闭 Obsidian 后');
  });
});
