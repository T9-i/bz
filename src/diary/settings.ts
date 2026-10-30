/**
 * 日记本设置 schema（ADR-0115：旧 diary 12 键按消费面收编为 3 键 + 2 跨域读）。
 * 「外观」沿用 issue 246 范式（diarySkin 布局行「媒体墙」+ diarySkinTheme 主题行「画廊白」layoutKey 联动）；
 * 「目录」仅日记/信两键（影视走影院域 cinemaFolderPath、书库走书架墙域 resolveFolderPath，跨域读）；
 * 「显示」useFileDateTime（写日记弹窗时间口径）。
 * 「维护」组与「日记格式体检」弹窗按用户拍板退役（2026-09-25）——格式 lint 仍留在
 * src/diary/repair.ts（store 写入路径消费），只是不再有手动体检入口。
 * ⚙️ 弹窗 / 设置面板「日记本」页共用本 schema。
 */
import type { SettingsSchema } from '../core/settings-schema';
import { getApp } from '../core/app';
import { notice } from '../core/notice';
import { getSettings } from '../core/settings-provider';
import { applyDirectories } from './config';
import { ensureDiaryFolders } from './folders';

function applyAndEnsureDirectories(): void {
  const settings = getSettings();
  applyDirectories(settings);
  let app;
  try {
    app = getApp();
  } catch {
    return; // 设置 schema 的纯函数测试/极早调用尚无 app：运行时常量已更新，真实启动后会再自动补目录
  }
  void ensureDiaryFolders(app, settings).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[diary] 创建目录失败:', e);
    notice(`目录创建失败：${msg}`, 'error');
  });
}

/** 日记本设置 schema */
export function diarySettingsSchema(): SettingsSchema {
  return {
    groups: [
      {
        // 外观组（issue 246 范式）：布局/主题各一档，域 UI 消费待皮肤设计时接入
        icon: 'palette',
        name: '外观',
        rows: [
          { type: 'choiceCards', name: '面板布局', binding: { key: 'diarySkin' }, options: [{ value: 'default', label: '媒体墙', prevClass: 'bz-sp-prev-panel' }] },
          { type: 'choiceCards', name: '面板主题', binding: { key: 'diarySkinTheme' }, layoutKey: 'diarySkin', options: [{ value: 'gallery', label: '画廊白', layout: 'default', prevClass: 'bz-sp-prev-gallery' }] },
        ],
      },
      {
        icon: 'folder-open',
        name: '目录',
        rows: [
          { type: 'path', mode: 'single', name: '日记文件夹', desc: '存放日记文件的文件夹', binding: { key: 'diaryDirectory' }, onChange: applyAndEnsureDirectories },
          { type: 'path', mode: 'single', name: '信件文件夹', desc: '存放信件的文件夹', binding: { key: 'letterDirectory' }, onChange: applyAndEnsureDirectories },
        ],
      },
      {
        icon: 'eye',
        name: '显示',
        rows: [
          { type: 'toggle', name: '默认日期取自文件', desc: '默认日期取自当前打开的日记文件', binding: { key: 'useFileDateTime' } },
          {
            type: 'number',
            name: '每卷装多少则',
            desc: '一册只摊开一卷，凑够这么多则就另装一卷',
            binding: { key: 'diaryPageSize' },
            min: 10,
            max: 500,
            step: 10,
          },
        ],
      },
    ],
  };
}
