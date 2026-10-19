# 555 · 影院保存后面板不生效，必须重开面板

- 状态：处理中（2026-10-19，worktree `cinema-refresh`）
- 提出：2026-10-19 用户反馈「影院修改后，面板不会生效，必须重新打开一次才会生效」
- 证据：`我的/影视/《我的团长我的团》.md` 于 23:26:27 被面板表单改写（状态 想看 → 在看、观影日期刷成带秒的当前时刻、补在看日期），57 秒后用户报此问题

## 根因

面板的写盘路径是「内存先行 → 改内存 → `processFrontMatter` 落盘 → `renderAll`」，本来已经当场渲成新值；
但同一时刻 `vault` 的 `modify` 事件也到了，`registerAutoRefresh` 的 300ms 防抖到点后走
`rebuildItems(app)`——它读的是 **`app.metadataCache.getFileCache`**。

Obsidian 的 metadataCache 重新解析是**异步**的：`vault` 事件先到、缓存后到。300ms 不保证解析已完成，
于是这次重建拿到的仍是**写前那份 frontmatter**，把内存里的新值原样盖回旧值。
下次再打开面板（缓存早已就绪）才看到正确结果 —— 这就是「必须重开一次」。

测试夹具 `tests/mock-vault.ts` 的 `metadataCache.getFileCache` 是**每次现算**的（读 `vault.files`），
永远没有滞后，所以单测与集成测试一直是绿的，这个竞态测不出来。

## 落地

1. **自写登记**（`state.ts`）：`noteSelfWrite(path)` / `isRecentSelfWrite(path)`，窗口 `SELF_WRITE_GUARD_MS = 1500ms`。
2. **写盘统一入口**（`ui.ts`）：新增 `writeFm(app, file, cb)` = `processFrontMatter` + 成功后登记自写；
   面板内 7 处直接写盘（重温 +1、片单归入/移出、合集归入、片单改名、批量收纳、建档补字段、编辑保存）
   全部改走它。
3. **后台刷新跳过自写文件**（`index.ts` 的 `schedule`）：命中窗口就不重建 —— 写盘路径已 renderAll，
   重建不但白做还会回灌旧缓存；外部编辑（非自写）照旧重建。
4. **顺手补改名通道**：适配层对 rename 只发 `renamed` 一条、不补发 created/deleted，影院原先三个通道
   都不含它 —— 在文件管理器里给影片改名，面板会一直顶着旧名。现订阅 `vault:md-renamed` /
   `cinema:file-renamed`，oldPath 与 newPath 都喂进同一个防抖（盖住「移入」与「移出」两个方向）。

## 测试

- `自写回灌守卫`：保存后把 `getFileCache` 钉在写前快照上，发 `vault:md-modified`，等过防抖窗口，
  断言内存状态仍是新值 —— **先证伪**：把守卫注释掉这条必红。
- `外部改名不重开也刷新`：改文件路径 + 发 `vault:md-renamed`，断言卡片按新名重建。
- `自写窗口语义`：窗口内命中、过期失效、别家文件不受影响。
