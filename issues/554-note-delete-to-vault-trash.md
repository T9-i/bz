# 554 · 笔记删除一律进 Obsidian 库内回收站（.trash）

- 状态：已交付（2026-10-19，worktree `note-trash` 合并回主仓）
- 提出：2026-10-19 用户口头反馈（影院删《我的团长我的团》后在 Obsidian 回收站里找不到）
- 关联：ADR-0245

## 现象

用户以为「bz 里删的笔记都在 Obsidian 回收站」，实际：

- 影院 / 剪藏本 / 收藏：`vault.trash(file, true)` → **Windows 系统回收站**（移动端等于看不见）
- 日记条目：`vault.delete(file)` → **硬删**，谁都救不回来

《我的团长我的团》最后是靠 vault 的 git 历史捞回来的，`.trash` 里没有。

## 根因

`Vault.trash(file, system)` 的布尔是「是否用**系统**回收站」，全仓按直觉写了 `true`；
`tests/mock-vault.ts` 又把语义写反（`true` → `.trash/`），测试给错行为背书。

## 落地

1. 新增 `src/core/note-trash.ts`：`trashNote(app, file)` = `vault.trash(file, false)`，笔记删除的唯一入口。
2. 接入：`cinema/ui.ts`（详情删除）、`clipbook/ui.ts`（删除剪藏）、`diary/store.ts`（`removeDiaryEntries`）。
3. 例外：加密摘明文（`encrypt/data.ts`、日记 `purge: true`）保持硬删，防明文进回收站（ADR-0245 §3）。
4. 文案：影院确认框「移入 Obsidian 回收站（.trash）」；剪藏撤销通知「已移入 Obsidian 回收站」；
   日记确认框去掉「永久删除 / 不可撤销」（加密条目分支保持「永久销毁」）。
5. 夹具：`tests/mock-vault.ts` 按真实 API 语义重写；剪藏四处断言改 `system === false`，
   日记补「落进 `.trash/`」与「`purge` 硬删」两条用例。
