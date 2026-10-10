import { logger } from "./logger";
import { redis } from "./redis";

// 正在回源的请求，key 相同的并发请求共用同一个 Promise
const loading = new Map<string, Promise<unknown>>();

// 在 TTL 基础上随机多加 0～10%，避免同一批 key 同时过期、请求一起打到下游（缓存雪崩）
function withJitter(ttl: number) {
  return ttl + Math.floor(Math.random() * ttl * 0.1);
}

async function getCache<T>(key: string) {
  try {
    const value = await redis.get(key);
    return value === null ? null : (JSON.parse(value) as T);
  } catch (err) {
    // Redis 出问题时当作没命中，接口照样能用，只是变慢
    logger.warn({ type: "cache", key, errMsg: (err as Error).message }, "读缓存失败，直接查下游");
    return null;
  }
}

async function setCache(key: string, value: unknown, ttl: number) {
  try {
    await redis.set(key, JSON.stringify(value), "EX", withJitter(ttl));
  } catch (err) {
    logger.warn({ type: "cache", key, errMsg: (err as Error).message }, "写缓存失败");
  }
}

// cache-aside：先查缓存，没有再调 load 去下游拿，拿到后写回缓存
// load 失败时直接抛出，不会写缓存，否则接下来几分钟所有人看到的都是失败
export async function withCache<T>(key: string, ttl: number, load: () => Promise<T>) {
  const cached = await getCache<T>(key);
  if (cached !== null) {
    logger.debug({ type: "cache", key, hit: true }, "命中缓存");
    return cached;
  }

  // 热点 key 刚过期时，同一时刻可能有很多请求进来，只让第一个去下游，其他的等它的结果（防缓存击穿）
  const running = loading.get(key);
  if (running) {
    logger.debug({ type: "cache", key, hit: false }, "已有请求在回源，等待结果");
    return running as Promise<T>;
  }

  logger.debug({ type: "cache", key, hit: false }, "未命中缓存，回源");
  const promise = load()
    .then((data) => {
      void setCache(key, data, ttl);
      return data;
    })
    .finally(() => loading.delete(key));

  loading.set(key, promise);
  return promise;
}
