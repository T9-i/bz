/**
 * 工具坞设置页 —— **只放全域开关**，一行一个能按的东西。
 *
 * 三条纪律（ADR-0256）：
 *  1) **没有开关的行不进来**。设置页不是看板：值守在不在跑、登记了几个工具、锁在谁手里，
 *     这些「只能看不能改」的现状都归面板，摆在这里只会把真开关挤到看不见的地方。
 *  2) **每个开关都得有行为**。开关写了没人读 = 假开关，比没有更糟（`notifyMissed` 的死因）。
 *     所以这里的每一行，都能在 `announce` / `statusbar` / `settle` 里找到读它的地方。
 *  3) **描述只管「关掉会怎样」**，一句说完。原理、路径、装法不进设置页。
 *
 * 单个工具的规矩（规则表、停用、参数）在面板里改 —— 设置页是全插件的总目录，
 * 把「某个工具几点跑」塞进来，等于让两块界面各说一半话。
 */

import { Setting } from 'obsidian';
import type { SettingsSchema } from '../core/settings-schema';
import { readRegistry, setSwitch } from './registry';
import { refreshDockStatusBar } from './statusbar';
import type { DockSwitchKey } from './types';

/** 一行开关：读 `dock.json` 里的那个键，改完立刻落盘（调度器下一拍就读到） */
function switchRow(
  name: string,
  key: DockSwitchKey,
  desc?: string,
  after?: () => void,
): { type: 'custom'; name: string; desc?: string; render: (body: HTMLElement) => void } {
  return {
    type: 'custom',
    name,
    desc,
    render: (body) => {
      const { registry } = readRegistry();
      const setting = new Setting(body).setName(name);
      if (desc) setting.setDesc(desc);
      setting.addToggle((t) =>
        t.setValue(registry[key]).onChange((v) => {
          setSwitch(key, v);
          after?.();
        }),
      );
    },
  };
}

export function dockSettingsSchema(): SettingsSchema {
  return {
    groups: [
      {
        icon: 'play',
        name: '工具坞运行',
        rows: [
          switchRow('自动运行', 'autoRun', '按每条规则的时刻自己跑；关掉只能手动点'),
          switchRow('连续失败就暂停', 'breaker', '连挂 3 次就停手，在面板里手动恢复才继续'),
        ],
      },
      {
        icon: 'bell',
        name: '提醒与显示',
        rows: [
          switchRow('跑成功也提醒', 'notifySuccess', '关掉后只报失败（手动点的那次照报）'),
          switchRow('状态栏显示在跑几个', 'statusbar', '关掉后状态栏不留这一块', () =>
            refreshDockStatusBar(),
          ),
        ],
      },
      {
        icon: 'moon',
        name: '关闭 Obsidian 之后',
        rows: [
          switchRow('也继续跑自动任务', 'watchdog', '交给后台值守进程；关掉它，Obsidian 一关就全停'),
        ],
      },
    ],
  };
}
