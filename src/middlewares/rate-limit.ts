import type { Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { logger } from "../utils/logger";
import { redis } from "../utils/redis";
import { ErrorCode } from "../utils/response";

// 计数存在 Redis 里，多台机器共用一份；存在内存里的话，两台机器各算各的，实际放行的是限额的两倍
function createStore(prefix: string) {
  return new RedisStore({
    prefix,
    sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
  });
}

function onLimited(req: Request, res: Response) {
  logger.warn({ type: "rate_limit", path: req.path, userId: req.user?.userId }, "触发限流");
  res.status(429).json({ code: ErrorCode.TOO_MANY_REQUESTS, msg: "请求太频繁，请稍后再试", data: null });
}

const common = {
  windowMs: 60 * 1000, // 按 1 分钟统计
  standardHeaders: "draft-8" as const, // 响应头里告诉前端还剩多少次、多久后重置
  legacyHeaders: false,
  // Redis 挂了就不限流，放行请求；限流是保护手段，不能因为它让接口不可用
  passOnStoreError: true,
  handler: onLimited,
};

// 按 IP 限流，放在鉴权前面：挡住没登录的人刷接口、批量试 token
// 部署在 Nginx 后面时要配置 trust proxy，否则拿到的都是 Nginx 的 IP，所有人共用一个额度
export const ipLimiter = rateLimit({
  ...common,
  limit: 300,
  store: createStore("bff:rl:ip:"),
});

// 按用户限流，放在鉴权后面：同一个公司的人可能共用一个出口 IP，按用户算更准确
export const userLimiter = rateLimit({
  ...common,
  limit: 60,
  keyGenerator: (req) => req.user!.userId,
  store: createStore("bff:rl:user:"),
});
