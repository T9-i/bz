/**
 * 日记域目录初始化。
 *
 * 用户可把日记/信目录改成任意多层路径；Obsidian 的 vault.create 不会替目标文件补父目录。
 * 启动、修改设置和真正落笔三处统一走这里，逐级建目录且可重复调用。
 */
import type { App } from 'obsidian';
import { diskPathExists } from '../core/storage';
import { applyDirectories, DIARY_DIRECTORY, LETTER_DIRECTORY } from './config';

export interface DiaryFolderSettings {
  diaryDirectory?: string;
  letterDirectory?: string;
}

/** 逐级确保一个 vault 目录存在；返回本次是否新建过至少一级目录。 */
export async function ensureVaultFolder(app: App, folderPath: string): Promise<boolean> {
  const parts = String(folderPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return false;

  let current = '';
  let created = false;
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (app.vault.getAbstractFileByPath(current) || (await diskPathExists(app, current))) continue;
    try {
      await app.vault.createFolder(current);
      created = true;
    } catch (error) {
      // 索引滞后或并发初始化时目录可能刚被另一条路径创建；只有磁盘上仍不存在才算失败。
      if (!(await diskPathExists(app, current))) throw error;
    }
  }
  return created;
}

/** 按当前设置初始化日记与信件目录；设置本身不变，用户之后仍可随意修改路径。 */
export async function ensureDiaryFolders(app: App, settings: DiaryFolderSettings): Promise<boolean> {
  applyDirectories(settings);
  const diaryCreated = await ensureVaultFolder(app, DIARY_DIRECTORY);
  const letterCreated = await ensureVaultFolder(app, LETTER_DIRECTORY);
  return diaryCreated || letterCreated;
}
