// @vitest-environment jsdom
/**
 * 远端资产取文本（core/remote-asset.ts）：通道怎么试。
 *
 * 钉住 2026-10-28 那次报障的根因——**串行 + 无单通道超时**：raw 一旦卡住，
 * 调用方（`fetchManifestWithTimeout` 只等 12 s）就把整件事判成「资源清单没拉到」，
 * 后面几条本来能用的通道根本没被试到。所以：
 *  1. 清单这类小文件**并发**试，谁先通过校验用谁；
 *  2. jsDelivr 的 403 正文要带出来（本仓库超 50 MB 被它停发，不是「网络不通」）；
 *  3. 成功过的通道记下来，下次排到队首。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import { fetchAssetText, remotesFor, resetChannelPreferenceForTests } from '../../src/core/remote-asset';

/** 一个最小的「通道应答」：按 URL 分派 */
function route(handler: (url: string) => { status: number; text: string } | Promise<never>): void {
  vi.mocked(requestUrl).mockImplementation(((opts: { url: string }) => {
    const r = handler(opts.url);
    return r instanceof Promise ? r : Promise.resolve(r);
  }) as never);
}

const ok = (text: string) => ({ status: 200, text });
const delay = (ms: number): Promise<never> => new Promise((_, reject) => setTimeout(() => reject(new Error('ERR_CONNECTION_RESET')), ms));

describe('fetchAssetText：通道选择', () => {
  beforeEach(() => {
    vi.mocked(requestUrl).mockReset();
    resetChannelPreferenceForTests();
  });

  it('并发模式：队首卡住/慢死，后面通道的内容照样先到位', async () => {
    route((url) => (url.includes('raw.githubusercontent.com') ? delay(80) : ok('LIST')));
    const t0 = Date.now();
    const text = await fetchAssetText('manifest.json', (t) => t === 'LIST', '下载清单', '', undefined, {
      concurrent: true,
    });
    expect(text).toBe('LIST');
    // 没等第一条（80 ms）就回来了：并发不是「排队等最慢的」
    expect(Date.now() - t0).toBeLessThan(70);
  });

  it('串行模式（下载正文）：某条失败后换下一条，不整份放弃', async () => {
    route((url) => (url.includes('raw.githubusercontent.com') ? { status: 500, text: '' } : ok('DOC')));
    const text = await fetchAssetText('manual.html', (t) => t === 'DOC', '使用手册', '页');
    expect(text).toBe('DOC');
  });

  it('内容校验不过 → 换下一条（不把 CDN 的错误页当正文）', async () => {
    route((url) => (url.includes('raw.githubusercontent.com') ? ok('<html>404</html>') : ok('DOC')));
    const text = await fetchAssetText('manual.html', (t) => t === 'DOC', '使用手册', '页');
    expect(text).toBe('DOC');
  });

  it('jsDelivr 403 的正文带出来：是「仓库超 50 MB 停发」，不是「网络不通」', async () => {
    route((url) =>
      url.includes('jsdelivr')
        ? { status: 403, text: 'Package size exceeded the configured limit of 50 MB. Try https://github.com/...' }
        : { status: 502, text: '' },
    );
    await expect(
      fetchAssetText('manifest.json', () => true, '下载清单', '', undefined, { concurrent: true }),
    ).rejects.toThrow(/超过 50 MB/);
  });

  it('成功过的通道排到队首（下次不再先撞死的那条）', async () => {
    route((url) => (url.includes('testingcf.jsdelivr.net') ? ok('LIST') : { status: 500, text: '' }));
    await fetchAssetText('manifest.json', (t) => t === 'LIST', '下载清单', '', undefined, { concurrent: true });
    expect(remotesFor('manifest.json')[0]).toContain('testingcf.jsdelivr.net');
  });

  it('全失败 → 错误里带每一条的原因（主机名 + 原因，不糊整串 URL）', async () => {
    route(() => ({ status: 403, text: 'Package size exceeded the configured limit of 50 MB.' }));
    await expect(
      fetchAssetText('manifest.json', () => true, '下载清单', '', undefined, { concurrent: true }),
    ).rejects.toThrow(/下载清单下载失败：.*jsdelivr\.net/);
  });
});
