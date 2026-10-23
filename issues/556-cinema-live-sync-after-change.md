# 556 · 影院新增和更新都不同步，必须关掉面板重开

- 状态：已交付（2026-10-23，worktree `cinema-live-sync`）
- 提出：2026-10-23 用户反馈「影院，新增和更新面板数据都不会同步，需要关掉面板再打开才会同步」
- 证据：`我的/影视/《赛博朋克：边缘行者 第二季》.md` 于 13:32:24 被面板表单改写（在看 → 已看、评分 5.6、观影日期刷成 13:32:22），磁盘已是新值，面板仍顶着旧卡

## 根因

555 只堵了「面板自己写盘」那一半（自写登记 + 后台重建跳过），**重建的触发源本身还是错的**。

`registerAutoRefresh` 把重建挂在 `vault` 的 `create/modify` 上。Obsidian 的文件事件早于
metadataCache 解析：事件到点后 300ms 的 `rebuildItems` 读 `getFileCache`，拿到的还是**写前那份
frontmatter**，于是

- 更新：回读旧值，覆盖掉内存里的新值（555 的守卫只对「自写路径」那一个文件生效，外部写与
  导入进来的改法照旧中招）；
- 新增：新文件还没解析完，`parseMovieFile` 返回 null，条目被整体重建丢掉，卡就不见了。

真机表现统一是「面板不动，关掉重开才同步」——重开时缓存早已就绪。

## 落地

1. **缓存就绪通道**（`src/core/obsidian-adapter.ts`）：另订阅 `metadataCache` 的 `changed`，
   发通用通道 `vault:md-indexed`（载荷 `{ path }`）。这一刻 `getFileCache` 必是新内容。
   事件引用改成 `{ host, ref }` 记账，detach 时 vault / metadataCache 各归各家 offref。
2. **影院认新通道**（`src/cinema/index.ts`）：`vault:md-indexed` 触发重建；删除 / 改名仍走
   `vault:md-*`（这两件事不依赖 frontmatter 解析）。`created / modified` 四条订阅撤掉。
3. **自写登记提前**（`src/cinema/ui.ts`）：`writeFm` 改成**写盘前后各登记一拍**——vault 的
   modify 是在 `processFrontMatter` 内部、`await` 返回之前发出去的，等 resolve 再登记，防抖
   定时器可能已经跑过，守卫等于没装。建档路径（`vault.create`）同样先登记。

副产品：豆瓣补抓（`vault.process` 直写）落盘后现在也会经 `md-indexed` 回到面板，卡片字段不再
停在抓取前。

## 测试

- `外部更新：缓存就绪信号后重扫` —— 改盘 + 发 `md-indexed`，卡片显示新状态（撤掉通道即红，已验）。
- `外部新增：文件落地 + 缓存就绪后新片进面板`。
- `保存时事件抢先到也不回灌` —— 桩里先发事件再落盘，复刻写盘未返回的竞态。
- 适配层：`metadataCache changed → vault:md-indexed`、非 md 零派发、detach 后静默、无
  metadataCache 的宿主只挂 vault 四件套。
- 门禁：受影响 604 文件 / 9310 例通过，tsc 干净；主仓四步产物已重出。
