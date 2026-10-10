// 给 Express 的 req 加上 user 字段的类型，auth 中间件验签通过后写入
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        shopId: string;
      };
    }
  }
}

export {};
