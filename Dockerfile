# 多阶段构建：前面几个阶段负责安装依赖和编译，最终镜像里只有编译后的代码和生产依赖

# 国内访问 yarn 官方源很慢，默认用 npmmirror；公司里一般换成内部私有源
ARG NPM_REGISTRY=https://registry.npmmirror.com

# 1. 安装全部依赖（包括 TypeScript、tsx 这些开发依赖）
FROM node:24-alpine AS deps
ARG NPM_REGISTRY
WORKDIR /app
# 先只复制 package.json 和 yarn.lock，依赖没变时这一层直接用缓存，不用每次重新安装
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --registry "$NPM_REGISTRY"

# 2. 把 TypeScript 编译成 JavaScript
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN yarn build

# 3. 只安装生产依赖，不要 TypeScript、pino-pretty 这些
FROM node:24-alpine AS prod-deps
ARG NPM_REGISTRY
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --registry "$NPM_REGISTRY" && yarn cache clean

# 4. 模拟的下游服务，直接用 tsx 跑 TypeScript，只在没有真实下游时使用
FROM deps AS mock
COPY mock ./mock
USER node
CMD ["node", "--import", "tsx", "mock/server.ts"]

# 5. 最终运行的 BFF 镜像
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# 不用 root 运行，万一被攻破，攻击者拿到的权限也有限；node 用户是官方镜像自带的
USER node
EXPOSE 3000

# alpine 镜像里没有 curl，用 Node 自带的 fetch 请求 /health
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# 必须直接用 node 启动，不能用 yarn start：用 yarn 启动的话，docker stop 发的 SIGTERM 到不了 node 进程，优雅退出不会执行
CMD ["node", "dist/server.js"]
