/**
 * 内置浏览器空状态的精选站点入口（specs/ui/browser-quick-sites.md）。
 *
 * 站点清单是编译期静态常量，唯一来源就是这份列表；组件与单测都从这里读。
 * tint 是主题无关的品牌近似色，只允许用于尺寸固定的品牌图块，
 * 不参与主题 token，也不作为背景/文本/强调色（DESIGN.md 的文件图标同款豁免口径）。
 */

export interface BrowserQuickSite {
  /** 与 locale key `browser.quickSites.<id>` 一一对应，也是 TID 动态后缀。 */
  id: string;
  url: string;
  /** 展示用域名（小卡片副行）。 */
  domain: string;
  /** 品牌图块上的单字。 */
  monogram: string;
  /** 品牌图块底色（7 位 HEX）。 */
  tint: string;
  group: "content" | "search";
}

export const BROWSER_QUICK_SITE_GROUPS = [
  { id: "content", messageId: "browser.quickSites.group.content" },
  { id: "search", messageId: "browser.quickSites.group.search" },
] as const;

export function getBrowserQuickSitesByGroup(group: BrowserQuickSite["group"]): BrowserQuickSite[] {
  return BROWSER_QUICK_SITES.filter((site) => site.group === group);
}

export const BROWSER_QUICK_SITES: readonly BrowserQuickSite[] = [
  {
    id: "xiaohongshu",
    url: "https://www.xiaohongshu.com",
    domain: "xiaohongshu.com",
    monogram: "红",
    tint: "#ff2442",
    group: "content",
  },
  {
    id: "douyin",
    url: "https://www.douyin.com",
    domain: "douyin.com",
    monogram: "抖",
    tint: "#161823",
    group: "content",
  },
  {
    id: "bilibili",
    url: "https://www.bilibili.com",
    domain: "bilibili.com",
    monogram: "B",
    tint: "#00aeec",
    group: "content",
  },
  {
    id: "baidu",
    url: "https://www.baidu.com",
    domain: "baidu.com",
    monogram: "百",
    tint: "#2932e1",
    group: "search",
  },
  {
    id: "weibo",
    url: "https://weibo.com",
    domain: "weibo.com",
    monogram: "微",
    tint: "#e6162d",
    group: "search",
  },
  {
    id: "zhihu",
    url: "https://www.zhihu.com",
    domain: "zhihu.com",
    monogram: "知",
    tint: "#0084ff",
    group: "search",
  },
  {
    id: "36kr",
    url: "https://www.36kr.com",
    domain: "36kr.com",
    monogram: "氪",
    tint: "#1f3bb3",
    group: "search",
  },
];
