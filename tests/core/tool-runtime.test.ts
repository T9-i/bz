/**
 * 运行时解析（core/tool-runtime.ts）：外部工具「用谁跑」的唯一判据。
 *
 * 三条不变式（对应用户能感知的三种状态）：
 *  1. 没下载包 → 回落 PATH 上的命令（老用户全局装过，行为一个字不变）；
 *  2. 下载了包但机器上没有 Node → **仍然回落 PATH**（不能拿一个跑不起来的本地路径硬上，
 *     那会让错误从「找不到命令」变成更难懂的 ELF/ENOENT）；
 *  3. 包 + Node 都在 → 绝对路径 + `shell:false`（路径里的空格/中文/& 不再经过 cmd 解析）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveToolBase,
  resolveToolCommand,
  setFsProbe,
  resetNodeRuntimeCache,
  probeNodeRuntime,
  toolReadyState,
  toolInstallHint,
  TOOL_ENTRIES,
} from '../../src/core/tool-runtime';

const VAULT = 'E:/vault';
const PLUGIN = 'E:/vault/.obsidian/plugins/bz';

/** 精确命中清单：只让这几条路径「存在」（不能用 startsWith(PLUGIN)——便携 node 也住在 PLUGIN 下） */
function fsWith(paths: string[]): (p: string) => boolean {
  const set = new Set(paths);
  return (p) => set.has(p);
}

function appOf(): unknown {
  return { vault: { adapter: { getBasePath: () => VAULT }, configDir: '.obsidian' } };
}

/** 造一个假的 window.require：`where node` 命中给定路径，`node -v` 回版本串 */
function stubNodeOnPath(nodePath: string | null): void {
  const cp = {
    spawnSync: (cmd: string, args: string[]) => {
      if (cmd === 'where' || cmd === 'which') {
        return nodePath ? { status: 0, stdout: `${nodePath}\n` } : { status: 1, stdout: '' };
      }
      if (args?.[0] === '-v') return { status: 0, stdout: 'v22.22.2\n' };
      return { status: 1, stdout: '' };
    },
  };
  // jsdom 的 window 不可重定义：直接挂 require（tool-runtime 只读这一个属性）
  (window as unknown as { require: (m: string) => unknown }).require = (m: string) => (m === 'child_process' ? cp : null);
}

beforeEach(() => {
  resetNodeRuntimeCache();
  // 缺省：磁盘上什么都没有
  setFsProbe(() => false);
});

afterEach(() => {
  setFsProbe(null);
  resetNodeRuntimeCache();
  delete (window as unknown as { require?: unknown }).require;
});

describe('resolveToolBase：回落与本地包优先', () => {
  it('没包 → PATH 口径（cmd = 命令名，shell = true）', () => {
    stubNodeOnPath('C:/nodejs/node.exe');
    const base = resolveToolBase(appOf(), 'bili-downloader');
    expect(base).toMatchObject({ cmd: TOOL_ENTRIES['bili-downloader'].command, shell: true, via: 'path' });
  });

  it('包在但没 Node → 仍回落 PATH（不拿跑不了的本地路径硬上）', () => {
    stubNodeOnPath(null);
    setFsProbe(fsWith([`${PLUGIN}/downloads/tools/bili-downloader/cli.js`]));
    const base = resolveToolBase(appOf(), 'bili-downloader');
    expect(base.via).toBe('path');
    expect(base.shell).toBe(true);
  });

  it('包 + Node 都在 → 绝对路径 + shell:false', () => {
    stubNodeOnPath('C:/nodejs/node.exe');
    setFsProbe(fsWith([`${PLUGIN}/downloads/tools/obsidian-face/bin/bz-face.js`, 'C:/nodejs/node.exe']));
    const base = resolveToolBase(appOf(), 'obsidian-face');
    expect(base).toMatchObject({ cmd: 'C:/nodejs/node.exe', shell: false, via: 'bundle' });
  });
});

describe('resolveToolCommand：业务参数接在入口脚本之后', () => {
  it('本地包：参数数组 = [入口脚本绝对路径, ...业务参数]', () => {
    stubNodeOnPath('C:/nodejs/node.exe');
    setFsProbe(fsWith([`${PLUGIN}/downloads/tools/obsidian-face/bin/bz-face.js`, 'C:/nodejs/node.exe']));
    const r = resolveToolCommand(appOf(), 'obsidian-face', ['sync', '--data-root', 'E:/微信 数据']);
    expect(r.shell).toBe(false);
    expect(r.args[0]).toBe(`${PLUGIN}/downloads/tools/obsidian-face/bin/bz-face.js`);
    // 带空格的路径原样作为**一个** argv 元素（这条正是 shell 口径做不到的）
    expect(r.args.slice(1)).toEqual(['sync', '--data-root', 'E:/微信 数据']);
  });

  it('PATH 回落：参数原样、shell=true（老用户行为不变）', () => {
    stubNodeOnPath(null);
    const r = resolveToolCommand(appOf(), 'bili-downloader', ['--batch', 'b64:xx']);
    expect(r).toMatchObject({ cmd: 'bili-dl', shell: true, via: 'path' });
    expect(r.args).toEqual(['--batch', 'b64:xx']);
  });
});

describe('probeNodeRuntime / toolReadyState', () => {
  it('系统 node 可用 → kind=system 且带版本', () => {
    stubNodeOnPath('C:/nodejs/node.exe');
    setFsProbe((p) => p === 'C:/nodejs/node.exe');
    const rt = probeNodeRuntime(appOf(), { fresh: true });
    expect(rt).toMatchObject({ kind: 'system', path: 'C:/nodejs/node.exe', version: 'v22.22.2' });
  });

  it('插件内便携 node 优先于系统 node', () => {
    stubNodeOnPath('C:/nodejs/node.exe');
    const bundled = `${PLUGIN}/downloads/tools/node-runtime/node.exe`;
    setFsProbe((p) => p === bundled || p === 'C:/nodejs/node.exe');
    const rt = probeNodeRuntime(appOf(), { fresh: true });
    expect(rt.kind).toBe('bundled');
    expect(rt.path).toBe(bundled);
  });

  it('都没有 → none（探测失败不抛错，这是一条正常结局）', () => {
    stubNodeOnPath(null);
    const rt = probeNodeRuntime(appOf(), { fresh: true });
    expect(rt).toMatchObject({ kind: 'none', path: '' });
  });

  it('toolReadyState：已下载 → via=bundle；都没有 → via=none', () => {
    stubNodeOnPath('C:/nodejs/node.exe');
    setFsProbe(fsWith([`${PLUGIN}/downloads/tools/dock-watch/cli.js`, 'C:/nodejs/node.exe']));
    expect(toolReadyState(appOf(), 'dock-watch')).toEqual({ ready: true, via: 'bundle' });

    resetNodeRuntimeCache();
    stubNodeOnPath(null);
    setFsProbe(() => false);
    expect(toolReadyState(appOf(), 'dock-watch')).toEqual({ ready: false, via: 'none' });
  });
});

describe('引导文案', () => {
  it('未安装的指引指向设置面板，而不是一条终端命令', () => {
    const hint = toolInstallHint('obsidian-face');
    expect(hint).toContain('在线资源');
    expect(hint).not.toContain('npm install');
  });
});
