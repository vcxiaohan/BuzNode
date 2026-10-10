export const ErrorCode = {
  SUCCESS: 0,
  PARAM_ERROR: 40001,
  UNAUTHORIZED: 40100,
  TOKEN_EXPIRED: 40101,
  NOT_FOUND: 40400,
  TOO_MANY_REQUESTS: 42900,
  INTERNAL_ERROR: 50000,
  DOWNSTREAM_ERROR: 50201,
  DOWNSTREAM_TIMEOUT: 50401,
  DOWNSTREAM_CIRCUIT_OPEN: 50301,
  AUTH_SERVICE_ERROR: 50302,
};

export function success<T>(data: T) {
  return { code: ErrorCode.SUCCESS, msg: "ok", data };
}

// 业务里主动抛出的错误，全局错误处理会按 code 和 status 返回给前端
export class BizError extends Error {
  code: number;
  status: number;

  constructor(code: number, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
