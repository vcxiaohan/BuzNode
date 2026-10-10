import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { requestContext } from "../utils/context";

// 上游（网关、Nginx、前端）传了就沿用，没传就新生成
// 只接受字母、数字、短横线，防止有人往 header 里塞换行伪造日志
const TRACE_ID_PATTERN = /^[\w-]{1,64}$/;

export const trace: RequestHandler = (req, res, next) => {
  const incoming = req.get("x-trace-id");
  const traceId = incoming && TRACE_ID_PATTERN.test(incoming) ? incoming : randomUUID().replaceAll("-", "");

  // 返回给前端，用户反馈问题时可以带上这个 id 去查日志
  res.setHeader("x-trace-id", traceId);
  requestContext.run({ traceId }, next);
};
