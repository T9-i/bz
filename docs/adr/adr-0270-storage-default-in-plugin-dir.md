# ADR-0270：数据目录缺省 = 插件目录下的 `storage`

- 状态：已采纳（2026-10-29 当天修订过一版，见「修订」）
- 日期：2026-10-29
- 相关：ADR-0009（设置模型与共享数据路径）、ADR-0242（值守进程）、ADR-0268（按库引导）

## 背景

`storagePath` 的缺省一直是 vault 根下的 `CONFIG/STORAGE`（ADR-0009）。这个位置有两个毛病：

1. **它长在用户眼皮底下**。`CONFIG/` 是个包仔自己的黑话目录，vault 顶层平白多一个不认识的
   文件夹；用户手滑改名/移动一次，插件就找不到数据，症状是「数据全没了」。
2. **它跟着同步盘走，却没人真的想让它走**。iCloud / OneDrive 同步 `CONFIG/STORAGE` 时，
   `dock.lock`、`*.tmp`、每次写盘的中间态都会被同步一遍，冲突副本直接落进数据目录。

同时，把数据放到**插件目录内**（`.obsidian/plugins/<插件名>/storage`）的好处是现成的：
数据跟着插件本身体走，卸载/备份插件就是整体搬走，不污染 vault 根。

## 决策

**缺省数据目录 = `<插件目录>/storage`（小写）。`CONFIG/STORAGE` 不再是任何场合的缺省值，
只作为迁移来源保留（`LEGACY_STORAGE_DIR`）。**

```ts
// core/storage-path.ts
export const DEFAULT_STORAGE_DIR = '.obsidian/plugins/bz/storage'; // 没有 app 可问时的兜底
export const LEGACY_STORAGE_DIR = 'CONFIG/STORAGE';                // 只用于迁移，别拿来算路径
export function initialStorageDir(pluginRelDir?: string) {
  return `${pluginRelDir || '.obsidian/plugins/bz'}/storage`;
}
```

`normalizeStorageDir()` 的兜底仍是一个**常量** —— 值守进程（`tools/dock-watch/`）、纯函数单测、
极早期调用都在没有 `app` 的地方调它，签名不能带 `defaultDir`。常量本身换成了上面那个
`.obsidian/plugins/bz/storage`：真正的落盘路径由 `core/storage.bootstrapStorageDir()` 在启动时
**写一次显式值**，用的是 `initialStorageDir(pluginRelDirOf(app))`，插件文件夹叫什么就落在哪。

四条判据（顺序即优先级）：

| 盘上事实 | 结果 |
|---|---|
| `data.json` 里的值不是老的 `CONFIG/STORAGE` | 用户自己定的，一个字不动 |
| 盘上已有 `<插件目录>/storage` | 认它（删过一次 `data.json` 的库照旧接回原处） |
| 盘上已有 `CONFIG/STORAGE` | **复制**到 `<插件目录>/storage`，再改设置（原目录保留） |
| 都没有 | 直接写 `<插件目录>/storage` |

`DEFAULT_SETTINGS.storagePath` 是空串 `''`（"还没定过"），由启动那一次写成实际值。

## 修订（2026-10-29 当天，v1.34.0 发布后）

初版只解决「**新库**」，老库按「已有显式值就什么都不做」处理。实际问题出在这儿：
`CONFIG/STORAGE` 从来不是用户选的，而是**插件早期自己写进 data.json 的默认值** ——
任何一次 `saveSettings()` 都会把它固化下来。于是「提前生成的 data.json」把老缺省值冻在了
设置里，`bootstrapStorageDir` 见到非空值直接返回，用户看到的仍是 `CONFIG/STORAGE`。

改动：把「值正好等于老缺省」视为**没设过**，走迁移。迁移是**复制**不是搬运（整个目录
`adapter.list` 递归、逐文件 `readBinary` → `writeBinary`），复制成功才改设置，原目录留着让用户
自己删 —— 搬一半失败等于丢数据，而那个目录里可能是这个库的全部数据。复制 0 个文件则**不改路径**
（把设置指向一个空目录比留在旧路径更糟）。

`normalizeStorageDir` 对 `CONFIG/STORAGE` 原样透传（不在这里偷改）：它是升级上来的库的真实
数据位置，藏起来只会变成「设置显示一处、文件在另一处」。改路径是 bootstrap 的职责，它带迁移。

## 为什么不用「现算缺省」

一度试过把缺省做成 `normalizeStorageDir(v, { defaultDir: defaultStorageDir(app) })`，即
调用方按需现算。放弃的原因：**签名一变，138 个用例一起红**，而且新缺省要在二十多个域
（每个域自己拼 `storageFile(..., settings.storagePath || 'CONFIG/STORAGE')`）同时生效。

而「写一次显式值」的代价只有一条：首启多一次 `saveSettings()`。换来的是**用户能看见、
能改、值守也读得到**的一行设置值（设置面板「数据存储路径」直接显示真落位），排查时不用
再猜「这个库里到底算的哪个缺省」。

## 后果

- 新库首启后 `data.json` 里有 `"storagePath": ".obsidian/plugins/<插件名>/storage"`；
  插件目录被改名时这条值会失配 —— 这是显式值的固有代价，改目录的人要同时改这一行
  （设置行已提示「改动仅改路径不迁移旧数据」）。
- 老库升级：`CONFIG/STORAGE` 里的文件被复制到 `<插件目录>/storage`，设置改成新路径，
  旧目录保留（并弹一次通知说明）。想回到旧目录的，把设置改回去即可，两边内容一致。
- 引导页「数据存放在哪」一屏读 `storageDir()`，看到的就是真落位；用户在该屏选的目录照旧写回设置项。
- 域代码里 `settings.storagePath || 'CONFIG/STORAGE'` 这类兜底仍存在，但启动后 `storagePath`
  恒有值，它们只是「设置还没注入」时的最后一道栏 —— 不是缺省。
- `CONTEXT.md` 里各域写的 `CONFIG/STORAGE/xxx.json` 是**老库的落位**；新库把前缀换成
  `<插件目录>/storage/`，文件名与结构不变。
