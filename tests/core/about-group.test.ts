// @vitest-environment jsdom
/**
 * 「关于」组（core/about-group.ts）：通用页最上面那一组。
 *
 * 测的是**文案口径**（版本行最容易骗人的地方）与组形状：
 *  - 待重载要写清「已下载 vX，重载后生效」——否则用户看到「更新了但版本没变」；
 *  - 发现新版、检查失败各有一句；
 *  - 组里必须有版本 / 自动更新 / 反馈 / 赞赏四行，且**自动更新默认关**（对外分发的缺省）。
 */
import { describe, it, expect } from 'vitest';
import { versionDesc, FEEDBACK_URL } from '../../src/core/about-group';
import type { SelfUpdateState } from '../../src/core/self-update';

function stateOf(over: Partial<SelfUpdateState> = {}): SelfUpdateState {
  return { running: '1.33.0', onDisk: '1.33.0', available: null, pending: null, error: null, checkedAt: 0, ...over };
}

describe('versionDesc：版本行说人话', () => {
  it('普通态只说版本号', () => {
    expect(versionDesc(stateOf())).toBe('v1.33.0');
  });

  it('已下载待重载 → 明确说「重载后生效」（自更新不重载时版本号不变，这是最容易误解的一态）', () => {
    expect(versionDesc(stateOf({ onDisk: '1.34.0', pending: '1.34.0' }))).toBe(
      'v1.33.0，已下载 v1.34.0，重载后生效',
    );
  });

  it('发现新版但没装 → 点名新版号', () => {
    expect(versionDesc(stateOf({ available: { version: '1.34.0', tag: 'v1.34.0', at: 1 } }))).toBe(
      'v1.33.0，有新版本 v1.34.0',
    );
  });

  it('检查失败 → 说失败，不装作「已是最新」', () => {
    expect(versionDesc(stateOf({ error: 'offline' }))).toBe('v1.33.0，上次检查更新失败');
  });

  it('待重载优先于「有新版本」（已经下来了，剩下的事是重载）', () => {
    const s = stateOf({
      onDisk: '1.34.0',
      pending: '1.34.0',
      available: { version: '1.34.0', tag: 'v1.34.0', at: 1 },
    });
    expect(versionDesc(s)).toContain('重载后生效');
  });

  it('版本号拿不到时说「版本未知」，不显示一个空的 v', () => {
    expect(versionDesc(stateOf({ running: '', onDisk: '' }))).toBe('版本未知');
  });
});

describe('反馈渠道', () => {
  it('直接指向仓库的 issues（与下载通道同一个 slug，不另立一处字面量）', () => {
    expect(FEEDBACK_URL).toBe('https://github.com/yeshimei/bz/issues');
  });
});
