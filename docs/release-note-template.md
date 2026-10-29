# Release note 模板

每次发版，`gh release create --notes-file` 用的正文 = **本版更新日志** + 下面这三节，顺序不变。
三节是固定件，直接照抄，别每次重写措辞（措辞一飘，用户就得重新读一遍）。

正文开头放更新日志：从 `docs/changelog.md` 里取本版本那一段，或用 `pnpm changelog` 产物。

---

## 安装

1. 到 [Releases](https://github.com/yeshimei/bz/releases) 下载最新的 `bz-<版本>.zip`
2. 解压到 `<你的 vault>/.obsidian/plugins/` 下，得到一个 `bz/` 文件夹
3. 重启 Obsidian → 设置 → 第三方插件 → 找到「bz」→ 启用

## 离线资源包

在线资源（皮肤、工具包、手册、影视索引）下不动时，用 `bz-offline-<版本>.zip`。解压出的 `downloads/` 整个放进插件目录，再回插件点一次下载——本地校验通过就直接用，不联网。

```text
.obsidian/plugins/bz/
├── main.js
├── manifest.json
├── styles.css
└── downloads/
    ├── manifest.json
    ├── skins/
    └── tools/
```

## 反馈

问题与建议请提到 [Issues](https://github.com/yeshimei/bz/issues)。
