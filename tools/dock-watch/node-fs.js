/**
 * 值守侧的文件缝 —— 把 `core.DockFs` 接到真文件系统上。
 *
 * **唯一要解决的问题是相对路径**：插件侧走 vault 适配器，`CONFIG/STORAGE/dock.json`
 * 这样写就够；值守是个普通 node 进程，拿到手必须自己拼成绝对路径。
 * 而工具目录登记的是绝对路径（用户在文件选择器里选的），不能拼 —— 所以按 `isAbsolute` 分流。
 *
 * 这一层不做任何容错策略：读不到返回 null（`DockFs` 的约定），写失败就抛。
 * 「读不到算什么」是上层的事，这里替它做主会让两边读出两种结论。
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** 文件尾部读取的滑窗（记录文件可能很大，只读尾巴） */
function tailOf(file, bytes) {
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - bytes);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * 造一个绑在某个 vault 根上的 fs。
 *
 * @param {string} vaultRoot vault 的绝对路径（`config.json` 里的 `vault`）
 */
function makeNodeFs(vaultRoot) {
  const root = String(vaultRoot || '').replace(/[\\/]+$/, '');

  /** 相对路径按 vault 根解析；绝对路径原样用 */
  const resolve = (p) => {
    const s = String(p || '');
    return path.isAbsolute(s) ? s : path.join(root, s);
  };

  return {
    readText(p) {
      try {
        return fs.readFileSync(resolve(p), 'utf8');
      } catch {
        return null;
      }
    },
    writeText(p, data) {
      const file = resolve(p);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
    },
    rename(from, to) {
      fs.renameSync(resolve(from), resolve(to));
    },
    /** 排他创建（执行权锁靠它，内核保证只有一个能成功） */
    createExclusive(p, data) {
      const file = resolve(p);
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const fd = fs.openSync(file, 'wx');
        try {
          fs.writeSync(fd, data);
        } finally {
          fs.closeSync(fd);
        }
        return true;
      } catch {
        return false;
      }
    },
    unlink(p) {
      fs.unlinkSync(resolve(p));
    },
    exists(p) {
      try {
        return fs.statSync(resolve(p)).isFile();
      } catch {
        return false;
      }
    },
    mkdir(p) {
      try {
        fs.mkdirSync(resolve(p), { recursive: true });
      } catch {
        /* 已存在 / 无权 —— 让随后的写去暴露真问题 */
      }
    },
    readTail(p, bytes) {
      return tailOf(resolve(p), bytes);
    },
    size(p) {
      try {
        return fs.statSync(resolve(p)).size;
      } catch {
        return undefined;
      }
    },
  };
}

module.exports = { makeNodeFs };
