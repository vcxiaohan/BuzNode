import type { RequestHandler } from "express";
import { logger } from "../utils/logger";

// 每个请求结束时记一条访问日志，SLS 里算 P95、统计错误率都靠它
export const accessLog: RequestHandler = (req, res, next) => {
  const start = performance.now();

  res.on("finish", () => {
    const data = {
      type: "access",
      method: req.method,
      // 不用 req.path，它是相对挂载点的路径，会丢掉 /api 前缀；也不记 query，里面可能有敏感参数
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      duration: Math.round(performance.now() - start),
      ip: req.ip,
      // 鉴权通过才有，SLS 里可以按店铺统计访问量、排查某个商家的问题
      userId: req.user?.userId,
      shopId: req.user?.shopId,
    };

    if (res.statusCode >= 500) logger.error(data, "请求完成");
    else if (res.statusCode >= 400) logger.warn(data, "请求完成");
    else logger.info(data, "请求完成");
  });

  next();
};
