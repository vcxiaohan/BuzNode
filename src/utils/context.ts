import { AsyncLocalStorage } from "node:async_hooks";

type RequestContext = {
  traceId: string;
  // 鉴权通过后才有，调下游时透传
  token?: string;
};

// 每个请求一份独立的上下文，同一个请求里的任何异步代码都能取到，不用把 req 一层层往下传
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getTraceId() {
  return requestContext.getStore()?.traceId;
}

export function getToken() {
  return requestContext.getStore()?.token;
}
