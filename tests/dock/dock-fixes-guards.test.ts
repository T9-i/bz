// @vitest-environment node
/**
 * 文本守卫：几条「做法本身」就是修复的，行为测不出来，只能钉住形状。
 *
 *  - 手动运行不能把执行权锁霸占到跑完（否则整坞停摆十分钟）；
 *  - 卸载必须先注销自启动再杀进程（计划任务带 RestartCount，反了会留孤儿）；
 *  - 安装写下的契约版本要与 runtime 对齐；
 *  - `--once` 的 tick 必须有 catch（不然排障时挂住不退）；
 *  - 值守心跳必须写「当前模式」，不能把 wait-net 刷回 watch。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** 截一段：从 from 起到 to（都用 indexOf，找不到直接失败） */
function slice(text: string, from: string, to: string): string {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + from.length);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return text.slice(a, b);
}

describe('工具坞 · 修复的形状', () => {
  it('手动运行的锁只罩「起进程」，不 await live.done', () => {
    const src = read('src/dock/host.ts');
    const body = slice(src, 'const attempt = (): Promise<LiveRun | null> =>', 'let live: LiveRun | null = null;');
    expect(body).not.toContain('live.done');
    // 但收尾仍然等它跑完，并在 finally 摘标记
    expect(src).toContain('outcome = await live.done');
    expect(src).toContain('clearRunning(view)');
  });

  it('卸载脚本先注销自启动、再杀进程', () => {
    const src = read('tools/dock-watch/uninstall.ps1');
    const unregister = src.indexOf('Unregister-ScheduledTask');
    const stop = src.indexOf('Stop-Process');
    expect(unregister).toBeGreaterThanOrEqual(0);
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(unregister).toBeLessThan(stop);
  });

  it('安装写下的契约版本与 runtime 的 CONTRACT_VERSION 一致', () => {
    const ps = read('tools/dock-watch/install.ps1');
    const rt = read('tools/dock-watch/runtime.js');
    const m = /CONTRACT_VERSION\s*=\s*(\d+)/.exec(rt);
    expect(m).toBeTruthy();
    expect(ps).toContain(`v             = ${m![1]}`);
  });

  it('--once 的 tick 有 catch，出错也会退出', () => {
    const src = read('tools/dock-watch/cli.js');
    const once = slice(src, 'if (once) {', 'return 0;');
    expect(once).toContain('.catch(');
    expect(once).toContain("shutdown('--once");
  });

  it('值守心跳写当前模式，pid 复用的重探窗口存在', () => {
    const src = read('tools/dock-watch/watch.js');
    expect(src).toContain('state.mode || ');
    expect(src).not.toContain("state.lastOutcome || 'watch'");
    expect(src).toContain('PROBE_FULL_MS');
    expect(slice(src, 'function probeObsidian(state) {', 'const pids = listObsidianPids();')).toContain('PROBE_FULL_MS');
  });
});
