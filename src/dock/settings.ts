/**
 * 工具坞设置页 —— 只放**全域开关**与一句诊断。
 *
 * 单个工具的规矩（规则表、停用、参数）都在面板里改，不放设置页：设置页是全插件的总目录，
 * 把「某个工具几点跑」塞进来，等于让两块界面各说一半话。
 */

import { Setting } from 'obsidian';
import type { SettingsSchema } from '../core/settings-schema';
import { dockLockState } from './host';
import { readRegistry, setSwitch } from './registry';

function switchRow(
  name: string,
  desc: string,
  key: 'autoRun' | 'watchdog' | 'notifyMissed',
): { type: 'custom'; name: string; desc: string; render: (body: HTMLElement) => void } {
  return {
    type: 'custom',
    name,
    desc,
    render: (body) => {
      const { registry } = readRegistry();
      new Setting(body)
        .setName(name)
        .setDesc(desc)
        .addToggle((t) =>
          t.setValue(registry[key]).onChange((v) => {
            setSwitch(key, v);
          }),
        );
    },
  };
}

export function dockSettingsSchema(): SettingsSchema {
  return {
    groups: [
      {
        icon: 'layout-grid',
        name: '工具坞',
        rows: [
          switchRow('自动运行', '按各工具的规则到点自动跑。关掉之后只能手动点', 'autoRun'),
          {
            // 契约 v2 起值守进程还没迁到新账本。这一行留着是**为了说清楚**，不是为了给开关 ——
            // 给一个开着却不起作用的开关，比没有这个开关更糟。
            type: 'custom',
            name: '关掉 Obsidian 也让自动任务跑',
            desc: '本版暂不支持：值守进程正在迁到新账本，Obsidian 关着时不会跑',
            render: (body) => body.createDiv({ cls: 'bz-dock-lock-line', text: '暂不可用' }),
          },
          switchRow('漏跑提醒', '该跑的时候没跑（比如电脑在睡觉），下次打开时告诉你一声', 'notifyMissed'),
          {
            type: 'custom',
            name: '已登记工具',
            desc: '在面板里导入与移除；这里只看个数',
            render: (body) => {
              const { registry } = readRegistry();
              body.createDiv({
                cls: 'bz-dock-lock-line',
                text: registry.tools.length ? `${registry.tools.length} 个工具在册` : '还没有登记任何工具',
              });
            },
          },
          {
            type: 'custom',
            name: '当前调度锁',
            desc: '谁在负责调度。正常情况下插件开着就是插件，关掉就是后台值守',
            render: (body) => {
              const lock = dockLockState();
              body.createDiv({
                cls: 'bz-dock-lock-line',
                text: lock
                  ? `${lock.owner === 'plugin' ? '插件' : '后台值守'} 持有（${new Date(lock.at).toLocaleTimeString()}）`
                  : '当前没有人在调度',
              });
            },
          },
        ],
      },
    ],
  };
}
