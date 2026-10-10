import { getAdStats, type AdStats } from "../clients/ad.client";
import { getOrderStats, type OrderStats } from "../clients/order.client";
import { getTopProducts, type ProductRank } from "../clients/product.client";
import { withCache } from "../utils/cache";
import { BizError, ErrorCode } from "../utils/response";

function fenToYuan(fen: number) {
  return Number((fen / 100).toFixed(2));
}

// 分母为 0 时返回 0，避免前端显示 NaN 或 Infinity
function ratio(a: number, b: number) {
  return b === 0 ? 0 : Number((a / b).toFixed(4));
}

function formatSales(order: OrderStats) {
  return {
    gmv: fenToYuan(order.gmv),
    orderCount: order.orderCount,
    refundCount: order.refundCount,
    conversionRate: ratio(order.orderCount, order.visitorCount),
  };
}

function formatTopProducts(products: ProductRank[]) {
  return products.map((item) => ({
    id: item.productId,
    name: item.productName,
    salesCount: item.salesCount,
    salesAmount: fenToYuan(item.salesAmount),
  }));
}

function formatAd(ad: AdStats) {
  return {
    cost: fenToYuan(ad.cost),
    impressions: ad.impressions,
    clicks: ad.clicks,
    ctr: ratio(ad.clicks, ad.impressions),
    roi: ratio(ad.adGmv, ad.cost),
  };
}

// 每个模块单独返回成功或失败，前端失败的模块显示“加载失败，点击重试”，其他模块照常展示
// 失败时 data 给 null 而不是空数组或 0，否则前端分不清是“没有数据”还是“加载失败”
function toModule<T>(result: PromiseSettledResult<T>, failMsg: string) {
  if (result.status === "fulfilled") {
    return { status: "success" as const, data: result.value };
  }
  return { status: "failed" as const, data: null, msg: failMsg };
}

// 服务器和 Docker 默认是 UTC 时间，必须按北京时间算“今天”，否则早上 8 点前会算成昨天
function getToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
}

// 历史日期的数据不会再变，缓存 1 小时；当天的数据一直在变，按各模块的更新频率缓存
function getTtl(date: string, todayTtl: number) {
  return date < getToday() ? 3600 : todayTtl;
}

// key 格式：bff:版本:业务:页面:区块:shopId:日期
// 返回结构改了就把 v1 改成 v2，旧缓存自然失效；有筛选条件时在最后加上筛选条件的 md5
function cacheKey(block: string, shopId: string, date: string) {
  return `bff:v1:bi:overview:${block}:${shopId}:${date}`;
}

export async function getShopOverview(shopId: string, date: string) {
  // Promise.all 只要一个失败就整体失败；allSettled 会等全部结束，分别告诉你每个是成功还是失败
  // 每个模块单独缓存：哪个模块失败了，只是它不写缓存，不影响其他模块的缓存
  const [sales, topProducts, ad] = await Promise.allSettled([
    withCache(cacheKey("sales", shopId, date), getTtl(date, 60), async () => {
      return formatSales(await getOrderStats(shopId, date));
    }),
    withCache(cacheKey("top-products", shopId, date), getTtl(date, 300), async () => {
      return formatTopProducts(await getTopProducts(shopId, date));
    }),
    withCache(cacheKey("ad", shopId, date), getTtl(date, 300), async () => {
      return formatAd(await getAdStats(shopId, date));
    }),
  ]);

  if (sales.status === "rejected" && topProducts.status === "rejected" && ad.status === "rejected") {
    throw new BizError(ErrorCode.DOWNSTREAM_ERROR, "数据加载失败，请稍后重试", 502);
  }

  return {
    sales: toModule(sales, "销售数据加载失败"),
    topProducts: toModule(topProducts, "商品排行加载失败"),
    ad: toModule(ad, "广告数据加载失败"),
  };
}
