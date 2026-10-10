import { callService } from "./call-service";

export type ProductRank = {
  productId: number;
  productName: string;
  salesCount: number;
  salesAmount: number;
};

export function getTopProducts(shopId: string, date: string, limit = 5) {
  return callService<ProductRank[]>("product", "/api/product/top", { shopId, date, limit });
}
