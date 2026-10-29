/**
 * 归物本类型（issue 231/ADR-0102：分类升格为「纯文字名 + 独立 icon 字段」，载入时迁移）
 * ticket 189（ADR-0089，推翻 ADR-0083「转卖不填价」）加法扩展两个可选字段：
 * 旧数据无字段 = 未出离/未记售价，照常可读（对齐 favorites archived 可选字段先例）。
 */
export interface BelongingsItem {
  id: string;
  name: string;
  category: string;          // 纯文字分类名（issue 231 起 emoji 前缀退役，载入时自动剥离）
  icon?: string | null;      // 分类 lucide 图标名（可选；未设 = 渲染走遗留 emoji/首字兜底）
  purchase_price: number;
  purchase_date: string;
  current_status: string; // 使用中/闲置/已转卖/已丢弃
  description: string;
  created_date: string;
  last_updated: string;
  exit_date?: string | null;  // 出离时刻（转卖/丢弃时写入；陪伴天数封口锚点；回在用/闲置清空）。
                                // 老记录是 'YYYY-MM-DD'，新记录带时分秒——解析一律走 parseLocalDay / parseWhen，别按定长切
  status_at?: string | null;  // 进入当前状态的时刻（ISO）：首页时间线靠它把「挂成闲置 / 转卖」排进当天

  sold_price?: number | null; // 转卖售价（可选；统计回本 = Σ售价扣减日均成本）
}

export interface BelongingsDatabase {
  version: string;
  last_updated: string;
  items: Record<string, BelongingsItem>;
  categories: string[];
  categoryIcons: Record<string, string>;
}
