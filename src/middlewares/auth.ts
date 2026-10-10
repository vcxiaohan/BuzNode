import type { RequestHandler } from "express";
import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { config } from "../config";
import { requestContext } from "../utils/context";
import { logger } from "../utils/logger";
import { BizError, ErrorCode } from "../utils/response";

// 进程启动时创建一次。第一次验签时去认证服务拉公钥，之后缓存在内存里，不是每个请求都去拉
// 遇到没见过的 kid（认证服务换了密钥）会自动重新拉一次
const jwks = createRemoteJWKSet(new URL(config.AUTH_JWKS_URL), {
  timeoutDuration: 1000, // 拉公钥超时
  cooldownDuration: 30000, // 两次拉取至少间隔 30 秒，防止有人用乱写的 kid 刷认证服务
  cacheMaxAge: 10 * 60 * 1000, // 公钥最多缓存 10 分钟
});

export const auth: RequestHandler = async (req, _res, next) => {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new BizError(ErrorCode.UNAUTHORIZED, "未登录", 401);
  }
  const token = header.slice("Bearer ".length);

  try {
    const { payload } = await jwtVerify(token, jwks, {
      // 必须写死算法，否则攻击者可以把 header 改成 alg: none 或 HS256 绕过验签
      algorithms: ["RS256"],
      // 校验签发方和接收方，防止拿别的系统签发的 token 来用
      issuer: config.AUTH_ISSUER,
      audience: config.AUTH_AUDIENCE,
    });

    if (typeof payload.sub !== "string" || typeof payload.shopId !== "string") {
      throw new BizError(ErrorCode.UNAUTHORIZED, "token 无效", 401);
    }

    // shopId 只能从验签通过的 token 里取，不能信任前端传的参数，否则改个参数就能看别人店铺的数据
    req.user = { userId: payload.sub, shopId: payload.shopId };
  } catch (err) {
    if (err instanceof BizError) throw err;

    if (err instanceof errors.JWTExpired) {
      throw new BizError(ErrorCode.TOKEN_EXPIRED, "登录已过期，请重新登录", 401);
    }

    // 拉公钥失败是认证服务的问题，不是用户 token 的问题，不能返回 401 让用户重新登录
    if (err instanceof errors.JWKSTimeout || !(err instanceof errors.JOSEError)) {
      logger.error({ type: "auth", errMsg: (err as Error).message }, "获取认证服务公钥失败");
      throw new BizError(ErrorCode.AUTH_SERVICE_ERROR, "认证服务暂不可用", 503);
    }

    // 签名不对、被篡改、算法不对、签发方不对等，具体原因只记日志，不返回给前端
    logger.warn({ type: "auth", reason: err.code }, "token 校验失败");
    throw new BizError(ErrorCode.UNAUTHORIZED, "token 无效", 401);
  }

  const context = requestContext.getStore();
  if (context) context.token = token;
  next();
};
