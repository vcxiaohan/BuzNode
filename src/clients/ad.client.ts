import { callService } from "./call-service";

// cost 是广告花费，adGmv 是广告带来的成交额，单位都是分
export type AdStats = {
  cost: number;
  impressions: number;
  clicks: number;
  adGmv: number;
};

export function getAdStats(shopId: string, date: string) {
  return callService<AdStats>("ad", "/api/ad/stats", { shopId, date });
}
