# Release note 样例（v1.34.1 的真实内容）

下次发版把上面「新增 / 修复 / 优化」换成本版条目，下面「安装 / 离线资源包 / 反馈」三节不要动。

---

## 新增

- **插件显示名** 对外名称改作 bz
- **设置面板** 外部工具组补上全部更新，工具包改名

## 修复

- **移动端** 能启动了，`manifest.json` 不再限制桌面端
- **首次引导** 第一次打开先弹引导，走完再开首页；不再自动认领老数据目录
- **首次引导** 「存放」和「AI」两屏去掉说明文字，每屏只留要你做的那个动作
- **数据目录** 缺省位置改到插件目录下的 `storage/`，老库位置不受影响

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
