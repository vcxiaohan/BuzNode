import express from "express";
import { config } from "./config";
import { accessLog } from "./middlewares/access-log";
import { errorHandler, notFound } from "./middlewares/error-handler";
import { trace } from "./middlewares/trace";
import router from "./routes";
import healthRouter from "./routes/health";
import { lifecycle } from "./utils/lifecycle";

const app = express();

app.disable("x-powered-by");
// 不配置的话，部署在 Nginx 后面时 req.ip 全是 Nginx 的地址，按 IP 限流时所有人共用一个额度
// 也不能随便设成 true，否则用户自己伪造 X-Forwarded-For 就能绕过 IP 限流
app.set("trust proxy", config.TRUST_PROXY);

// 健康检查放在最前面：不需要 traceId、不记访问日志（每几秒探测一次，会刷屏）、不鉴权、不限流
app.use(healthRouter);

// trace 必须第一个挂，后面所有中间件和路由打的日志才能带上 traceId
app.use(trace);
app.use(accessLog);

// 退出期间告诉客户端这次响应后断开长连接，下次请求会重新建连接，被负载均衡转到别的机器
app.use((_req, res, next) => {
  if (lifecycle.shuttingDown) res.set("Connection", "close");
  next();
});

app.use(express.json());

app.use("/api", router);

// 这两个必须放在所有路由后面
app.use(notFound);
app.use(errorHandler);

export default app;
