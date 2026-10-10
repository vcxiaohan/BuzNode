import { Router } from "express";
import { lifecycle } from "../utils/lifecycle";
import { redis } from "../utils/redis";

const router = Router();

// 存活检查：给 Docker 的 HEALTHCHECK 用，进程还能响应就返回 200
// 单机 Docker 连续失败只会把容器标记为 unhealthy，不会自动重启；K8s 的存活探针失败才会重启
// 不检查 Redis、下游这些依赖，否则 Redis 一抖，所有容器都被判定为不健康
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 就绪检查：给负载均衡用，返回 503 时负载均衡不再往这台机器转发请求
router.get("/ready", (_req, res) => {
  if (lifecycle.shuttingDown) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  // Redis 挂了接口照样能用（只是没缓存），所以不因为它返回 503，只是展示状态方便排查
  // 否则 Redis 一挂，负载均衡会把所有机器都摘掉，整个服务不可用
  res.json({ status: "ok", redis: redis.status === "ready" ? "ok" : "down" });
});

export default router;
