import axios from "axios";
import CircuitBreaker from "opossum";
import { services, type ServiceName } from "../config";
import { logger } from "../utils/logger";
import { BizError, ErrorCode } from "../utils/response";
import { getToken, getTraceId } from "../utils/context";

// 下游 Java 服务统一返回 { code: 200, message, data }
type JavaResponse<T> = {
  code: number;
  message: string;
  data: T;
};

async function request(name: ServiceName, path: string, params: Record<string, unknown>) {
  const service = services[name];
  const res = await axios.get<JavaResponse<unknown>>(path, {
    baseURL: service.baseURL,
    params,
    // 超时用 axios 的，到时间会真正断开连接；Promise.race 那种只是不等了，请求还在跑
    timeout: service.timeout,
    headers: {
      // 把 traceId 传给下游，下游打日志也带上它，一个请求经过的所有服务就能串起来查
      "x-trace-id": getTraceId(),
      // 透传用户的 token，下游可以自己再校验一次，按用户做权限控制
      authorization: getToken() ? `Bearer ${getToken()}` : undefined,
    },
  });

  if (res.data.code !== 200) {
    throw new BizError(ErrorCode.DOWNSTREAM_ERROR, `${service.name}返回错误：${res.data.message}`, 502);
  }
  return res.data.data;
}

// 每个下游一个熔断器，进程启动时创建一次，所有请求共用，这样才能统计出这个服务最近的失败率
function createBreaker(name: ServiceName) {
  const breaker = new CircuitBreaker((path: string, params: Record<string, unknown>) => request(name, path, params), {
    timeout: false, // 超时交给 axios
    rollingCountTimeout: 10000, // 统计最近 10 秒的请求
    volumeThreshold: 5, // 10 秒内至少 5 个请求才判断，避免请求很少时失败一两次就熔断
    errorThresholdPercentage: 50, // 失败率超过 50% 就打开熔断器
    resetTimeout: 10000, // 打开 10 秒后进入半开，放一个请求过去试探
    // 下游返回了业务错误，说明服务本身是通的，不算失败
    errorFilter: (err) => err instanceof BizError,
  });

  const serviceName = services[name].name;
  breaker.on("open", () => logger.error({ type: "circuit", service: name }, `${serviceName}熔断器打开，后续请求直接失败`));
  breaker.on("halfOpen", () => logger.warn({ type: "circuit", service: name }, `${serviceName}熔断器半开，放一个请求试探`));
  breaker.on("close", () => logger.info({ type: "circuit", service: name }, `${serviceName}已恢复，熔断器关闭`));

  return breaker;
}

const breakers = {
  order: createBreaker("order"),
  product: createBreaker("product"),
  ad: createBreaker("ad"),
};

// 所有下游调用都走这个函数
export async function callService<T>(name: ServiceName, path: string, params: Record<string, unknown>) {
  const service = services[name];
  const start = performance.now();
  const log = { type: "downstream", service: name, path };

  try {
    const data = await breakers[name].fire(path, params);
    logger.info({ ...log, duration: Math.round(performance.now() - start) }, `调用${service.name}成功`);
    return data as T;
  } catch (err) {
    const duration = Math.round(performance.now() - start);

    if (err instanceof BizError) {
      logger.warn({ ...log, duration }, err.message);
      throw err;
    }

    // axios 的错误对象里带着整个请求对象，直接打会非常大，只记错误码和信息
    const { code, message } = err as { code?: string; message: string };

    if (code === "EOPENBREAKER") {
      logger.warn({ ...log, duration, reason: "circuit_open" }, `${service.name}熔断中，未发起请求`);
      throw new BizError(ErrorCode.DOWNSTREAM_CIRCUIT_OPEN, `${service.name}暂不可用`, 503);
    }

    if (code === "ECONNABORTED" || code === "ETIMEDOUT") {
      logger.error({ ...log, duration, reason: "timeout" }, `调用${service.name}超时（${service.timeout}ms）`);
      throw new BizError(ErrorCode.DOWNSTREAM_TIMEOUT, `${service.name}超时`, 504);
    }

    logger.error({ ...log, duration, reason: "error", errCode: code, errMsg: message }, `调用${service.name}失败`);
    throw new BizError(ErrorCode.DOWNSTREAM_ERROR, `${service.name}调用失败`, 502);
  }
}
