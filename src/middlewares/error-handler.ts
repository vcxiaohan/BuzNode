import type { ErrorRequestHandler, RequestHandler } from "express";
import { logger } from "../utils/logger";
import { BizError, ErrorCode } from "../utils/response";

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ code: ErrorCode.NOT_FOUND, msg: `接口不存在：${req.method} ${req.path}`, data: null });
};

// Express 5 里 async 函数抛出的错误会自动交给这里，不用再包 try/catch
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof BizError) {
    logger.warn({ code: err.code, path: req.path }, err.message);
    res.status(err.status).json({ code: err.code, msg: err.message, data: null });
    return;
  }

  // 用 err 这个字段名，pino 会自动把错误类型、message、堆栈都记下来
  logger.error({ err, path: req.path }, "未处理的异常");
  // 未知错误不能把 err.message 返回给前端，里面可能有内部地址、SQL 等信息
  res.status(500).json({ code: ErrorCode.INTERNAL_ERROR, msg: "服务器内部错误", data: null });
};
