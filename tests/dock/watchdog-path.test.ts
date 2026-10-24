// @vitest-environment node
/**
 * 值守目录的**两侧一致性**守卫。
 *
 * 插件读 `status.json` 说「值守在不在跑」，值守写它说「我还活着」。两边的目录推导
 * 一旦不一致，症状是「值守明明在跑，设置页说它从没启动过」—— 而且没有任何报错提示你。
 *
 * 两边没法共享代码（一边是 TS 插件，一边是要能单独拿走的 node 包），所以在这里钉死：
 * **拿同一组环境变量各算一遍，结果必须逐字相同。**
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { watchdogDirOf, WATCHDOG_DIRNAME, WATCHDOG_STALE_MS } from '../../src/dock/watchdog-status';

const require = createRequire(import.meta.url);
// 值守侧的真相源（也是要单独发布出去的那个文件）
const rt = require('../../tools/dock-watch/runtime.js') as {
  watchdogDir(env?: Record<string, string>): string;
  CONTRACT_VERSION: number;
};

const norm = (p: string): string => String(p).replace(/\\/g, '/').replace(/\/+$/, '');

describe('值守目录：插件与值守算的是同一个地方', () => {
  const cases: Record<string, string>[] = [
    { LOCALAPPDATA: 'C:\\Users\\somebody\\AppData\\Local' },
    { LOCALAPPDATA: 'C:\\Users\\somebody\\AppData\\Local\\' }, // 尾部斜杠
    { USERPROFILE: 'C:\\Users\\somebody' }, // 没有 LOCALAPPDATA
    { HOME: '/home/somebody' }, // 非 Windows
  ];

  for (const env of cases) {
    it(`环境 ${JSON.stringify(env)} 下两侧一致`, () => {
      expect(norm(watchdogDirOf(env))).toBe(norm(rt.watchdogDir(env)));
    });
  }

  it('目录名与插件侧常量同源', () => {
    expect(norm(watchdogDirOf({ LOCALAPPDATA: 'C:/x' })).endsWith(`/${WATCHDOG_DIRNAME}`)).toBe(true);
  });

  it('心跳保鲜期足够宽（值守一拍 30 秒，等网最长 5 分钟不计心跳）', () => {
    // 这条不是「大于某个魔数」，而是提醒：改小它会让「值守在等网」被误判成「值守死了」
    expect(WATCHDOG_STALE_MS).toBeGreaterThanOrEqual(90_000);
  });
});
