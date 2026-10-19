# ADR-0245：笔记删除一律进 Obsidian 库内回收站（.trash）

日期：2026-10-19 ～ 状态：Accepted ～ 关联：issue 554、ADR-0149（剪藏 trash 前 source 降级）、ADR-0017（日记加密）

## 背景

用户反馈：影院里删掉《我的团长我的团》，在 Obsidian 回收站里找不到（2026-10-19）。

查下来的事实是：**代码里没有一个删除口是「进 vault 内 `.trash`」**。

| 域 | 原实现 | 真实落点 |
|---|---|---|
| 影院 | `vault.trash(item.file, true)` | Windows 系统回收站 |
| 剪藏本 | `vault.trash(note.file, true)` | 系统回收站 |
| 收藏 | `vault.trash(file, true)`（伴生 json） | 系统回收站 |
| 日记 | `vault.delete(file)` | **硬删，进不了任何回收站** |

根因是 Obsidian API 的布尔名不直观：`Vault.trash(file, system)` 里 `system = true` 才是**系统**回收站，
`false` 才是**库内**回收站。仓里所有调用点都按直觉写了 `true`，`tests/mock-vault.ts` 又按反语义打桩
（`system=true` 时把文件挪进 `.trash/`），于是「进回收站」的断言长期给系统回收站背书，测试全绿、行为不符预期。
用户的心智模型（也是更合理的产品口径）是「bz 里删的东西，在库里的回收站能翻回来」。

## Decision

1. **唯一入口**：新建 `src/core/note-trash.ts::trashNote(app, file)`，内部固定 `vault.trash(file, false)`。
   删除**笔记**只许经它，域里不再直接出现 `vault.trash` / `vault.delete`。
2. **覆盖范围**：影院详情删除、剪藏本删除、日记条目删除（`removeDiaryEntries`）。
   文案同步改口径（「已移入 Obsidian 回收站」），日记删除确认框不再写「永久删除 / 不可撤销」。
3. **例外一（加密）**：明文收进保险库后摘除原文件（`src/encrypt/data.ts::deleteVaultFile`、
   日记 `removeDiaryEntries({ purge: true })`）保持**硬删**——回收站里留一份明文等于加密白做。
   `purge` 是显式开关，只有加密流程传；默认路径永远是回收站。
4. **例外二（非笔记）**：`CONFIG/STORAGE/*.json` 伴生文件、`.bak`、临时文件、密文镜像不进回收站
   （收藏标签迁移退役旧 json 仍走系统回收站，语义是「退役数据文件」而不是「删笔记」）。
5. **夹具对齐真实 API**：`tests/mock-vault.ts` 的 `trash(file, system)` 改成 `true` = 系统回收站（文件离开
   vault，不模拟 OS 回收站）、`false` = 迁入 `.trash/`。断言从 `t.system` 改 `t.system === false`，
   并补「文件确实出现在 `.trash/`」的用例。

## Options

- **O1 改调 `fileManager.trashFile(file)`**（跟随用户设置）——✅ 语义最正，但结果取决于设置；
  用户要的是「进 Obsidian 回收站」，设置若为「永久删除」就成了硬删。故取 `vault.trash(file, false)` 明确指定库内。
- **O2 维持系统回收站，只改文案**——❌ 用户的实际痛点就是「找不到」，Windows 回收站里混着整机所有删除，
  移动端更是完全看不到（Android/iOS 没有统一系统回收站）。
- **O3 自建回收站目录（如 `归档/bz-回收站`）**——❌ 与 Obsidian 原生回收站功能重复，用户得学两套入口；
  且原生 `.trash` 有「还原」动作，自建目录没有。

## Consequences

- 删错了能翻回来，但 `.trash` 会随删除累积（Obsidian 不自动清）；这是回收站的本分，不是缺陷。
- `.trash` 在库内，会被同步/备份带走——加密例外正是为此而设。
- 测试夹具语义与真实 API 对齐后，「进哪个回收站」从此是可断言的行为，不再靠注释保证。
- 影院删除确认框文案由「系统回收站」改为「Obsidian 回收站（.trash）」；剪藏撤销通知文案同步。
