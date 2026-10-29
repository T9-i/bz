# ADR-0270：新库的数据目录初值搬到插件目录下的 `storage`

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
数据跟着插件本身体走，卸载/备份插件就是整体搬走，不污染 vault 根。

## 决策

**新库的初值 = `<插件目录>/storage`（小写），老库原样不动。**

关键在于它是**初值**，不是**缺省**：

```ts
// core/storage-path.ts
export const DEFAULT_STORAGE_DIR = 'CONFIG/STORAGE';   // 归一函数的兜底，仍是常量
export function initialStorageDir(pluginRelDir?: string) {
  return `${pluginRelDir || '.obsidian/plugins/bz'}/storage`;
}
```

`normalizeStorageDir()` 的兜底必须是一个**常量** —— 值守进程（`tools/dock-watch/`）、纯函数
单测、极早期调用都在没有 `app` 的地方调它。所以归一规则一个字没改，另加一条
`core/storage.bootstrapStorageDir()`：插件启动、`loadData` 之后**写一次**显式值。

四条判据（顺序即优先级）：

| 盘上事实 | 结果 |
|---|---|
| `data.json` 里已有 `storagePath` | 什么都不做（那是用户的值） |
| 盘上已有 `<插件目录>/storage` | 认它（清过一次 `data.json` 的库照旧接回原处） |
| 盘上已有 `CONFIG/STORAGE` | 认老目录（升级上来的库，数据在那儿） |
| 都没有 | 写 `<插件目录>/storage` |

`DEFAULT_SETTINGS.storagePath` 因此改成空串 `''`（"还没定过"），不再是 `'CONFIG/STORAGE'`。

## 为什么不用「现算缺省」

一度试过把缺省做成 `normalizeStorageDir(v, { defaultDir: defaultStorageDir(app) })`，即
调用方按需现算。放弃的原因：**签名一变，138 个用例一起红**，而且新缺省要在二十多个域
（每个域自己拼 `storageFile(..., settings.storagePath || 'CONFIG/STORAGE')`）同时生效——
那是一处改动、全仓联动，收益却只是「省一次写盘」。

而「写一次显式值」的代价只有一条：首启多一次 `saveSettings()`。换来的是**用户能看见、
能改、值守也读得到**的一行设置值（设置面板「数据存储路径」直接显示真落位），排查时不用
再猜「这个库里到底算的哪个缺省」。

## 后果

- 新库首启后 `data.json` 里有 `"storagePath": ".obsidian/plugins/<插件名>/storage"`；
  插件目录被改名时这条值会失配——这是显式值的固有代价，改目录的人要同时改这一行
  （通知文案已提示「改动仅改路径不迁移旧数据」）。
- 老库升级：`bootstrapStorageDir` 认领 `CONFIG/STORAGE` 成显式值，之后行为与改动前逐字节一致。
- 引导页「数据存放在哪」一屏读到的就是这条值；用户在该屏选的目录仍然照旧写回设置项。
- `CONTEXT.md` 里各域写的 `CONFIG/STORAGE/xxx.json` 是**老库的落位**；新库把前缀换成
  `storage/`，文件名与结构不变。
