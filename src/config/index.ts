import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // 前面有几层代理（Nginx、七层 CLB）就填几，Express 才能从 X-Forwarded-For 里取到用户真实 IP
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  REDIS_URL: z.string().startsWith("redis://"),
  AUTH_JWKS_URL: z.url(),
  AUTH_ISSUER: z.string().min(1),
  AUTH_AUDIENCE: z.string().min(1),
  ORDER_SERVICE_URL: z.url(),
  PRODUCT_SERVICE_URL: z.url(),
  AD_SERVICE_URL: z.url(),
});

// 启动时就校验环境变量，配错了直接退出，不要等到请求进来才报错
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("环境变量配置错误：\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const config = parsed.data;

// timeout 按各服务平时的耗时来定，一般取它 P99 的 2～3 倍，单位毫秒
export const services = {
  order: { name: "订单服务", baseURL: config.ORDER_SERVICE_URL, timeout: 1000 },
  product: { name: "商品服务", baseURL: config.PRODUCT_SERVICE_URL, timeout: 800 },
  ad: { name: "广告服务", baseURL: config.AD_SERVICE_URL, timeout: 1500 },
};

export type ServiceName = keyof typeof services;
