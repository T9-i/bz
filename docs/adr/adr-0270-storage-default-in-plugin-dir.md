# ADR-0270：数据目录缺省搬到插件目录下的 `storage`

- 状态：已采纳
- 日期：2026-10-29
- 相关：ADR-0009（设置模型与共享数据路径）、ADR-0242（值守进程）、ADR-0268（按库引导）

## 背景

`storagePath` 的缺省一直是 vault 根下的 `CONFIG/STORAGE`（ADR-0009）。这个位置有两个毛病：

1. **它长在用户眼皮底下**。`CONFIG/` 是个包仔自己的黑话目录，vault 顶层平白多一个不认识的
   文件夹；用户手滑改名/移动一次，插件就找不到数据，症状是「数据全没了」。
2. **它跟着同步盘走，却没人真的想让它走**。iCloud / OneDrive 同步 `CONFIG/STORAGE` 时，
   `dock.lock`、`*.tmp`、每次写盘的中间态都会被同步一遍，冲突副本直接落进数据目录。

同时，把数据放到**插件目录内**（`.obsidian/plugins/<插件名>/storage`）的好处是现成的：
数据跟着插件本身走，卸载/备份插件就是整体搬走，不污染 vault 根。

## 决策

**缺省数据目录 = `<插件目录>/storage`（小写）。`CONFIG/STORAGE` 只作为老库的既有落位保留，
不再是任何场合的缺省值。老库（`data.json` 里已经有 `storagePath`）一个字不动。**

```ts
// core/storage-path.ts
export const DEFAULT_STORAGE_DIR = '.obsidian/plugins/bz/storage'; // 没有 app 可问时的兜底
export const LEGACY_STORAGE_DIR = 'CONFIG/STORAGE';                // 只用于「没值时认领老库」
export function initialStorageDir(pluginRelDir?: string) {
  return `${pluginRelDir || '.obsidian/plugins/bz'}/storage`;      // 落盘时按真实插件目录现算
}
```

`normalizeStorageDir()` 的兜底换成新目录，已是显式值的一律原样透传（老 `CONFIG/STORAGE`
也一样）——路径在这里改名叫「搬家」，不干。

`core/storage.bootstrapStorageDir()` 在启动、`loadData` 之后跑一次，只负责**给还没设过的库
写一个显式值**：

| 盘上事实 | 结果 |
|---|---|
| `data.json` 里已有 `storagePath`（含值正好是老缺省） | 什么都不做 |
| 盘上已有 `<插件目录>/storage` | 认它（清过一次 `data.json` 的库照旧接回原处） |
| 盘上已有老 `CONFIG/STORAGE` | 认老目录（清过设置的老库，数据在那儿；不复制、不搬运） |
| 都没有 | 写 `<插件目录>/storage` |

**不做迁移**。曾经试过「值等于老缺省就视为没设过 → 复制文件到新目录」，那是多余的：
`CONFIG/STORAGE` 是老库数据的实际位置，迁移的每一步失败都在拿全部数据冒险，收益却只是
「目录好看一点」。用户要的是新装的人落在对的地方，不是让已经装好的人搬一遍家。

`DEFAULT_SETTINGS.storagePath` 是空串 `''`（"还没定过"），首次引导的「存放」一屏因此读到
`initialStorageDir()` 作为初值，允许改；用户点「下一步」时才写探针（顺带建目录）、写回设置。
**目录与数据文件都在引导走到那一步之后才产生**，不是启动就建。

## 为什么不用「现算缺省」

一度试过把缺省做成 `normalizeStorageDir(v, { defaultDir: defaultStorageDir(app) })`，即
调用方按需现算。放弃的原因：**签名一变，138 个用例一起红**，而且新缺省要在二十多个域
（每个域自己拼 `storageFile(..., settings.storagePath || 'CONFIG/STORAGE')`）同时生效——
那是一处改动、全仓联动，收益却只是「省一次写盘」。

常量兜底 + 启动写一次显式值，代价只有一条：首启多一次 `saveSettings()`。换来的是**用户能看见、
能改、值守也读得到**的一行设置值（设置面板「数据存储路径」直接显示真落位），排查时不用
再猜「这个库里到底算的哪个缺省」。

## 后果

- 新库首启后 `data.json` 里有 `"storagePath": ".obsidian/plugins/<插件名>/storage"`；
  插件目录被改名时这条值会失配——这是显式值的固有代价，改目录的人要同时改这一行
  （通知文案已提示「改动仅改路径不迁移旧数据」）。
- 老库升级：`storagePath` 已有值，`bootstrapStorageDir` 直接返回，行为与改动前逐字节一致；
  数据仍在 `CONFIG/STORAGE`。缺省值换成什么，对老库没有任何影响。
- 引导页「数据存放在哪」一屏的初值 = 缺省目录；用户在该屏选的目录照旧写回设置项。
- 各域代码里写死的 `CONFIG/STORAGE/xxx.json`（旧文件迁移读取、checkup 兜底显示）保持原义：
  它们指的是**老库落位**，不是缺省值；新库的当前路径一律经 `storageFile()` 走设置。
