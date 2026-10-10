import pino from "pino";
import { config } from "../config";
import { getTraceId } from "./context";

const isDev = config.NODE_ENV === "development";

// 开发环境：控制台格式化成人能看的，同时写一份 JSON 到 logs/app.log，方便按 traceId 过滤
// 线上：不传 transport，pino 默认一行一个 JSON 输出到标准输出，由 Docker 接管，再由 Logtail 采集到 SLS
const transport = isDev
  ? pino.transport({
      targets: [
        { target: "pino/file", level: config.LOG_LEVEL, options: { destination: "logs/app.log", mkdir: true } },
        {
          target: "pino-pretty",
          level: config.LOG_LEVEL,
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname,app" },
        },
      ],
    })
  : undefined;

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    base: { app: "buz-node" },
    timestamp: pino.stdTimeFunctions.isoTime,
    // axios 的错误对象里有完整的请求配置，包括请求头里的 token，不能原样写进日志
    serializers: {
      err: (err: Error & { code?: string }) => ({
        type: err.name,
        code: err.code,
        message: err.message,
        stack: err.stack,
      }),
    },
    // 每打一条日志都会调用，自动带上当前请求的 traceId
    mixin() {
      const traceId = getTraceId();
      return traceId ? { traceId } : {};
    },
  },
  transport,
);
