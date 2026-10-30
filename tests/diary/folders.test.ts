import { afterEach, describe, expect, it, vi } from 'vitest';
import { setApp } from '../../src/core/app';
import { setSettingsProvider } from '../../src/core/settings-provider';
import { applyDirectories } from '../../src/diary/config';
import { ensureDiaryFolders } from '../../src/diary/folders';
import { diarySettingsSchema } from '../../src/diary/settings';
import { MockVault, mockAppWithVault } from '../mock-vault';

afterEach(() => applyDirectories({}));

describe('ensureDiaryFolders', () => {
  it('首次使用时按设置逐级创建日记与信件目录，且可重复调用', async () => {
    const vault = new MockVault();
    const app = mockAppWithVault(vault);
    setApp(app);

    await ensureDiaryFolders(app, { diaryDirectory: '自定义/日记', letterDirectory: '自定义/信件' });
    expect(vault.dirs.has('自定义')).toBe(true);
    expect(vault.dirs.has('自定义/日记')).toBe(true);
    expect(vault.dirs.has('自定义/信件')).toBe(true);

    const before = vault.dirs.size;
    await ensureDiaryFolders(app, { diaryDirectory: '自定义/日记', letterDirectory: '自定义/信件' });
    expect(vault.dirs.size).toBe(before);
  });

  it('修改路径后按新设置创建，不依赖用户事先建目录', async () => {
    const vault = new MockVault();
    const app = mockAppWithVault(vault);
    setApp(app);

    await ensureDiaryFolders(app, { diaryDirectory: '新库/日记', letterDirectory: '新库/信' });
    expect(vault.dirs.has('新库/日记')).toBe(true);
    expect(vault.dirs.has('新库/信')).toBe(true);
  });

  it('设置面板修改目录后立即按新路径补建目录', async () => {
    const vault = new MockVault();
    const app = mockAppWithVault(vault);
    setApp(app);
    const settings = { diaryDirectory: '后改的/日记', letterDirectory: '后改的/信' };
    setSettingsProvider(() => settings as any);

    const groups = diarySettingsSchema().groups;
    const row = groups.find((g: any) => g.name === '目录')!.rows.find((r: any) => r.name === '日记文件夹') as any;
    row.onChange();

    await vi.waitFor(() => {
      expect(vault.dirs.has('后改的')).toBe(true);
      expect(vault.dirs.has('后改的/日记')).toBe(true);
      expect(vault.dirs.has('后改的/信')).toBe(true);
    });
  });
});
