import app from "./app";
import { config } from "./config";
import { lifecycle } from "./utils/lifecycle";
import { logger } from "./utils/logger";
import { redis } from "./utils/redis";

const server = app.listen(config.PORT, () => {
  logger.info(`BFF 已启动：http://localhost:${config.PORT}（${config.NODE_ENV}）`);
});

// 线上先等几秒，让负载均衡通过 /ready 发现这台机器要下线，把流量切走；本地开发不用等
const DRAIN_DELAY = config.NODE_ENV === "production" ? 5000 : 0;
// 正在处理的请求最多等这么久，超时强制退出，不能一直卡着发布流程
const FORCE_EXIT_TIMEOUT = 15000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(reason: string, exitCode = 0) {
  if (lifecycle.shuttingDown) return;
  lifecycle.shuttingDown = true;
  logger.info({ reason }, "开始优雅退出");

  setTimeout(() => {
    logger.error("等待请求处理完超时，强制退出");
    process.exit(1);
  }, FORCE_EXIT_TIMEOUT).unref();

  await sleep(DRAIN_DELAY);

  // 不再接受新连接，等正在处理的请求都返回后才执行回调
  server.close(async () => {
    logger.info("请求已全部处理完，关闭 Redis 连接");
    // quit 会等已经发出的命令执行完再断开，disconnect 是直接断开
    await redis.quit().catch(() => {});
    logger.info("退出完成");
    process.exit(exitCode);
  });
}

// docker stop、发布新版本时会发 SIGTERM；本地 Ctrl+C 是 SIGINT
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// 代码里漏掉的异常：进程状态可能已经不对了，记日志后退出，交给 Docker 重启一个干净的进程
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "未捕获的异常");
  shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason instanceof Error ? reason : new Error(String(reason)) }, "未处理的 Promise 拒绝");
  shutdown("unhandledRejection", 1);
});
