import Redis from "ioredis";
import { config } from "../config";
import { logger } from "./logger";

export const redis = new Redis(config.REDIS_URL, {
  // Redis 只是加速和计数用的，它慢了或挂了，不能拖慢接口
  // 这个超时对断线期间排队的命令也生效：启动时还没连上的命令会排队等连接，真断了最多等 200ms 就报错
  commandTimeout: 200,
  maxRetriesPerRequest: 1,
  // ioredis 6 默认用 RESP3，连接时发 HELLO 命令；阿里云 Redis 读写分离实例的代理不支持 HELLO，会一直连不上
  protocol: 2,
});

redis.on("ready", () => logger.info({ type: "redis" }, "Redis 已连接"));
redis.on("error", (err) => logger.warn({ type: "redis", errMsg: err.message }, "Redis 连接异常"));
