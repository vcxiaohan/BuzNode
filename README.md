# BuzNode

电商运营中台的 BFF（Backend For Frontend）服务。前端只调这一层，由它负责鉴权、限流、并发调用下游的订单 / 商品 / 广告服务，把数据聚合、换算成前端直接能用的格式，并加上缓存和熔断，保证某个下游出问题时页面其他部分照常可用。

## 技术栈

| 用途 | 选型 |
| --- | --- |
| 运行时 | Node.js 24，TypeScript |
| Web 框架 | Express 5 |
| 参数 / 环境变量校验 | zod |
| 鉴权 | jose（RS256 + JWKS 验签） |
| 缓存、分布式限流 | Redis（ioredis + express-rate-limit + rate-limit-redis） |
| 下游调用 | axios + opossum 熔断器 |
| 日志 | pino（线上输出 JSON 到标准输出，由 Logtail 采集到 SLS） |
| 部署 | Docker 多阶段构建、阿里云 ACR、GitHub Actions、ECS |

## 目录结构

```
BuzNode
├── src
│   ├── server.ts            # 入口：启动服务、优雅退出、兜底异常处理
│   ├── app.ts               # Express 实例和中间件挂载顺序
│   ├── config/              # 环境变量校验、下游服务地址和超时
│   ├── routes/              # 路由：/health、/ready、/api/*
│   ├── middlewares/         # traceId、访问日志、鉴权、限流、错误处理
│   ├── controllers/         # 参数校验，调用 service
│   ├── services/            # 业务聚合：并发调下游、格式化、按模块缓存
│   ├── clients/             # 下游服务调用封装（超时、熔断、透传 traceId 和 token）
│   ├── utils/               # logger、redis、缓存、请求上下文、统一响应
│   └── types/               # Express 类型扩展
├── mock/server.ts           # 模拟下游：订单 4001、商品 4002、广告 4003、认证 4004
├── scripts/deploy.sh        # ECS 上执行的部署脚本，失败自动回滚
├── .github/workflows/deploy.yml
├── Dockerfile
└── docker-compose.yml       # 服务器上用的编排文件
```

## 本地开发

### 准备

- Node.js 24、Yarn 1.x
- 一个本地 Redis，没有的话可以用 Docker 起一个：

```bash
docker run -d --name redis -p 6379:6379 redis:7
```

### 启动

```bash
yarn install
cp .env.example .env

# 终端 1：启动模拟的下游服务（订单、商品、广告、认证）
yarn mock

# 终端 2：启动 BFF，默认 http://localhost:3000
yarn dev
```

开发环境的日志会在控制台格式化输出，同时以 JSON 格式写一份到 `logs/app.log`，方便按 traceId 过滤。

### 调一下接口

mock 认证服务内置了两个测试账号：`merchant_a` / `123456`（店铺 1001）和 `merchant_b` / `123456`（店铺 1002）。

```bash
# 登录拿 token
TOKEN=$(curl -s -X POST http://127.0.0.1:4004/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"merchant_a","password":"123456"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')

# 查询经营概览
curl -s "http://localhost:3000/api/bi/overview?date=2026-10-13" -H "Authorization: Bearer $TOKEN"
```

登录时加上 `?expiresIn=5s` 可以签发一个很快过期的 token，用来测试过期处理。mock 认证服务每次重启都会重新生成密钥，之前的 token 会全部失效。

### 故障注入

每个 mock 服务都有 `/__chaos` 接口，可以注入延迟和失败率，用来验证超时、熔断和模块降级：

```bash
# 订单服务每个请求额外延迟 3 秒（BFF 对订单服务的超时是 1 秒）
curl -X POST "http://127.0.0.1:4001/__chaos?delay=3000&failRate=0"

# 广告服务一半请求返回 500
curl -X POST "http://127.0.0.1:4003/__chaos?delay=0&failRate=0.5"

# 恢复正常
curl -X POST "http://127.0.0.1:4001/__chaos?delay=0&failRate=0"
```

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `yarn dev` | 开发模式启动，改代码自动重启 |
| `yarn mock` | 启动 mock 下游服务 |
| `yarn typecheck` | 类型检查 |
| `yarn build` | 编译到 `dist/` |
| `yarn start` | 运行编译后的代码 |

## 环境变量

启动时会用 zod 校验全部环境变量，配错了直接打印错误并退出。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | 否 | `development` | `development` / `test` / `production` |
| `PORT` | 否 | `3000` | 监听端口 |
| `LOG_LEVEL` | 否 | `info` | `debug` / `info` / `warn` / `error`，本地建议 `debug` |
| `TRUST_PROXY` | 否 | `0` | 前面有几层代理就填几（只有 Nginx 填 1，Nginx 前面还有七层 CLB 填 2），否则按 IP 限流会失效 |
| `REDIS_URL` | 是 | | `redis://:密码@地址:6379/0`，密码里的特殊字符要做 URL 编码 |
| `AUTH_JWKS_URL` | 是 | | 认证服务公钥地址 |
| `AUTH_ISSUER` | 是 | | token 的签发方，需要和认证服务一致 |
| `AUTH_AUDIENCE` | 是 | | token 的接收方，需要和认证服务一致 |
| `ORDER_SERVICE_URL` | 是 | | 订单服务地址 |
| `PRODUCT_SERVICE_URL` | 是 | | 商品服务地址 |
| `AD_SERVICE_URL` | 是 | | 广告服务地址 |

本地用 `.env`，线上用 `.env.production`，两个文件都不提交到 git，模板分别是 `.env.example` 和 `.env.production.example`。

## 接口

### 统一响应格式

```json
{ "code": 0, "msg": "ok", "data": {} }
```

出错时 `data` 为 `null`，HTTP 状态码和 `code` 同时生效。每个响应头里都带有 `x-trace-id`，排查问题时拿它去日志里搜。

### `GET /api/bi/overview`

店铺经营概览。需要登录，店铺 ID 从 token 里取，不接受前端传入。

| 参数 | 位置 | 说明 |
| --- | --- | --- |
| `date` | query | 日期，格式 `YYYY-MM-DD` |

响应示例：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "sales": {
      "status": "success",
      "data": { "gmv": 52380.5, "orderCount": 432, "refundCount": 12, "conversionRate": 0.0833 }
    },
    "topProducts": {
      "status": "success",
      "data": [{ "id": 10001, "name": "纯棉短袖T恤", "salesCount": 268, "salesAmount": 21440 }]
    },
    "ad": {
      "status": "failed",
      "data": null,
      "msg": "广告数据加载失败"
    }
  }
}
```

- 金额单位是元（下游返回的是分，BFF 统一换算）。
- 三个模块各自返回成功或失败，某个下游挂了只影响对应模块，前端可以只在这一块显示“加载失败，点击重试”。三个模块全部失败时整个接口返回 502。

### `GET /health`、`GET /ready`

- `/health`：存活检查，进程能响应就返回 200，给 Docker `HEALTHCHECK` 用。
- `/ready`：就绪检查，给负载均衡和部署脚本用。进程开始退出后返回 503，让负载均衡把流量切走。Redis 状态只做展示，Redis 挂了也不会返回 503。

这两个接口不鉴权、不限流、不记访问日志。

### 错误码

| code | HTTP 状态码 | 含义 |
| --- | --- | --- |
| `0` | 200 | 成功 |
| `40001` | 400 | 参数错误 |
| `40100` | 401 | 未登录或 token 无效 |
| `40101` | 401 | 登录已过期 |
| `40400` | 404 | 接口不存在 |
| `42900` | 429 | 请求太频繁 |
| `50000` | 500 | 服务器内部错误 |
| `50201` | 502 | 下游服务调用失败或返回业务错误 |
| `50301` | 503 | 下游服务熔断中 |
| `50302` | 503 | 认证服务不可用（拉取公钥失败），不需要重新登录 |
| `50401` | 504 | 下游服务超时 |

## 关键设计

### 请求处理链路

```
/health、/ready  →  trace（生成 traceId）→ 访问日志 → JSON 解析
  → /api：IP 限流 → JWT 鉴权 → 用户限流 → controller → service → clients → 下游
  → 404 → 全局错误处理
```

中间件顺序不能随意调整：trace 必须在最前面，后面所有日志才能带上 traceId；IP 限流在鉴权之前，挡住没登录的人刷接口和批量试 token。

### 鉴权

- 认证服务用私钥签发 RS256 token，BFF 通过 JWKS 地址拉公钥验签，公钥在内存中缓存 10 分钟，遇到新的 `kid` 自动重新拉取。
- 验签时固定算法为 RS256，并校验 `issuer` 和 `audience`。
- `shopId` 只从验签通过的 token 里取，防止改参数看别人店铺的数据。
- 拉公钥失败返回 503（`50302`），不让用户误以为需要重新登录。

### 限流

计数存在 Redis 里，多台机器共享额度。

| 维度 | 额度 | Redis key 前缀 |
| --- | --- | --- |
| IP | 300 次 / 分钟 | `bff:rl:ip:` |
| 用户 | 60 次 / 分钟 | `bff:rl:user:` |

Redis 不可用时直接放行，不因为限流组件故障导致接口不可用。

### 下游调用

所有下游请求都走 `src/clients/call-service.ts` 里的 `callService`：

- 超时：订单 1000ms、商品 800ms、广告 1500ms，在 `src/config/index.ts` 里调整。
- 熔断：每个下游一个熔断器，10 秒内至少 5 个请求且失败率超过 50% 时打开，10 秒后放一个请求试探。下游返回业务错误（`code !== 200`）不算失败。
- 请求头里透传 `x-trace-id` 和用户的 `Authorization`。

### 缓存

采用 cache-aside 模式，每个模块单独缓存，key 格式为 `bff:v1:bi:overview:{模块}:{shopId}:{date}`。

- 历史日期缓存 1 小时；当天的销售数据缓存 60 秒，商品排行和广告数据缓存 300 秒。“今天”按北京时间计算。
- TTL 随机多加 0～10%，避免同一批 key 同时过期（缓存雪崩）。
- 同一个 key 的并发请求只有一个去下游，其他的等它的结果（缓存击穿）。
- 下游失败时不写缓存。
- Redis 命令超时 200ms，读写失败都当作未命中，接口只是变慢，不会报错。
- 修改了返回结构时，把 key 里的 `v1` 改成 `v2`，旧缓存会自然失效。

### 优雅退出

收到 `SIGTERM` / `SIGINT` 后：

1. `/ready` 开始返回 503，响应头加上 `Connection: close`。
2. 线上等待 5 秒，让负载均衡把流量切走。
3. 停止接受新连接，等正在处理的请求完成后关闭 Redis 并退出。
4. 超过 15 秒还没处理完就强制退出。

因此容器内必须直接用 `node dist/server.js` 启动（不能用 `yarn start`，否则信号到不了 node 进程），compose 里的 `stop_grace_period` 也要大于 15 秒。

## 部署

### 流程

推送到 `main` 分支后，GitHub Actions 自动执行：

1. **check**：`yarn typecheck`，不通过则停止。
2. **build**：构建 `buz-node`（BFF）和 `buz-node-mock`（模拟下游）两个镜像，以 commit SHA 作为标签推送到阿里云 ACR。
3. **deploy**：通过跳板机 SSH 到各台 ECS，逐台执行 `scripts/deploy.sh`。每台都等 `/ready` 返回 200 后再等 15 秒，让 CLB 判定为健康，才开始部署下一台。

`deploy.sh` 会拉取新镜像、替换容器，60 秒内健康检查不通过就自动回滚到上一个版本，流水线在这一台停下，后面的机器不会继续部署。

### 回滚

在 GitHub 的 Actions 页面手动运行“构建并部署”，`image_tag` 填要回滚到的完整 40 位 commit 号。这时会跳过检查和构建，先确认 ACR 里有这个版本，再逐台部署。

### GitHub Secrets

| 名称 | 说明 |
| --- | --- |
| `ACR_USERNAME` / `ACR_PASSWORD` | 阿里云镜像仓库账号 |
| `BASTION_HOST` | 跳板机公网 IP |
| `ECS_HOSTS` | 应用服务器内网 IP，多台用空格分开 |
| `SSH_USER` | SSH 用户名 |
| `SSH_PRIVATE_KEY` | SSH 私钥，跳板机和应用服务器共用 |

### 服务器准备

每台 ECS 需要：

- 安装 Docker、Docker Compose 插件和 curl。
- 创建 `/opt/buz-node` 目录，放入根据 `.env.production.example` 修改好的 `.env.production`。
- `docker-compose.yml` 每次部署时由流水线自动复制过去，`.env`（镜像地址和版本号）由部署脚本自动生成，都不需要手动维护。

线上 Redis 使用阿里云 Redis，compose 里没有 Redis 服务。在接入真实的订单、商品、广告服务之前，下游先指向 compose 里的 mock 容器；接入后从 `docker-compose.yml` 中去掉 `mock` 服务，并修改 `.env.production` 里的下游地址。

### 服务器上常用操作

```bash
cd /opt/buz-node
docker compose ps              # 查看容器状态
docker compose logs -f bff     # 查看 BFF 日志
docker compose restart bff     # 重启（使用 .env 里记录的当前版本）
curl http://127.0.0.1:3000/ready
```

容器日志单个文件最大 100MB，最多保留 3 个，不会写满磁盘。
