import { callService } from "./call-service";

// 金额单位都是分
export type OrderStats = {
  visitorCount: number;
  orderCount: number;
  gmv: number;
  refundCount: number;
};

export function getOrderStats(shopId: string, date: string) {
  return callService<OrderStats>("order", "/api/order/stats", { shopId, date });
}
