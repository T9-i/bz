// @vitest-environment node
/**
 * 进度回调必须写回 `LiveRun` 那个**对象**。
 *
 * 上一版在 `runToolRef` 建对象时把 `phase` / `pct` 按值拷了进去，`onProgress` 之后只改
 * 局部变量 —— 于是面板（`ui.ts` 读 `live.phase` / `live.pct`）永远看到 `null`，
 * 工具的 `[bz-p]` 输出等于白写。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { runToolNow, setExecDeps } from '../../src/dock/exec';

const ENTRY = { cmd: process.execPath, args: [] as string[] };

function runScript(code: string) {
  setExecDeps({ cp: { spawn: spawn as never } });
  return runToolNow({
    toolId: 'demo',
    declPath: '/tools/demo/manifest.json',
    entry: { ...ENTRY, args: ['-e', code], cwd: process.cwd() },
    manifest: { params: [] },
    values: {},
    records: () => [],
  });
}

afterEach(() => setExecDeps(undefined));

describe('外部工具 · 进度回传', () => {
  it('工具报了阶段与百分比 → 运行对象上读得到', async () => {
    const run = runScript(`console.log('[bz-p] {"phase":"抓取","pct":42}'); setTimeout(() => process.exit(0), 30);`);
    expect(run.phase).toBeNull(); // 还没报
    const outcome = await run.done;
    expect(outcome.code).toBe(0);
    expect(run.phase).toBe('抓取');
    expect(run.pct).toBe(42);
  });

  it('只报阶段不报百分比 → pct 保持 null，不假报 0', async () => {
    const run = runScript(`console.log('[bz-p] {"phase":"分析"}'); setTimeout(() => process.exit(0), 30);`);
    await run.done;
    expect(run.phase).toBe('分析');
    expect(run.pct).toBeNull();
  });

  it('没报进度 → 两个字段都是 null', async () => {
    const run = runScript(`setTimeout(() => process.exit(0), 30);`);
    await run.done;
    expect(run.phase).toBeNull();
    expect(run.pct).toBeNull();
  });
});
