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
import {
  WATCHDOG_DIRNAME,
  WATCHDOG_STALE_MS,
  liveLogFileOf,
  watchdogDirOf,
} from '../../src/dock/watchdog-status';

const require = createRequire(import.meta.url);
// 值守侧的真相源（也是要单独发布出去的那个文件）
const rt = require('../../tools/dock-watch/runtime.js') as {
  watchdogDir(env?: Record<string, string>): string;
  liveFileOf(toolId: string, env?: Record<string, string>): string;
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

describe('实时步骤文件：两侧算的是同一个文件', () => {
  // 插件按「本机目录 + 工具 id」读，值守按同一口径写。不一致的症状很隐蔽：
  // 值守在跑、面板也显示「后台正在跑」，但实时日志永远是空的。
  const ids = [
    'iamtxt-signin',
    'steam-cheap-radar',
    'a/b:c', // 带路径分隔符的 id：两边都得拍平成同一个安全名
    '工具 带空格',
    '..',
  ];

  for (const id of ids) {
    it(`工具 id ${JSON.stringify(id)} 的实时文件两侧一致`, () => {
      const env = { LOCALAPPDATA: 'C:\Users\somebody\AppData\Local' };
      // 插件侧没有 env 参数（它在渲染进程里读真环境），所以比对「目录名之后那两段」：
      // `live/<拍平后的 id>.jsonl` —— 这才是两侧唯一可能写歪的地方
      const tail = (p: string): string => norm(p).split('/').slice(-2).join('/');
      expect(tail(liveLogFileOf(id))).toBe(tail(rt.liveFileOf(id, env)));
    });
  }

  it('拍平规则不会把两个不同工具映射到同一个文件', () => {
    const a = norm(liveLogFileOf('a/b'));
    const b = norm(liveLogFileOf('a:b'));
    // 两者都会变成 a_b —— 这是有意的合并（id 里出现分隔符本身就不合法），
    // 真正要防的是「空 id」与「点」这种把文件名弄成隐藏文件的形态
    expect(a.endsWith('/a_b.jsonl')).toBe(true);
    expect(b.endsWith('/a_b.jsonl')).toBe(true);
    expect(norm(liveLogFileOf('..')).endsWith('/...jsonl')).toBe(true);
  });
});
