#!/usr/bin/env bash
# 在 ECS 上执行：拉取指定版本的镜像，替换容器，等健康检查通过；失败自动回滚到上一个版本
# 用法：bash deploy.sh <镜像仓库地址> <命名空间> <镜像版本>
set -euo pipefail

REGISTRY="$1"
NAMESPACE="$2"
IMAGE_TAG="$3"
DEPLOY_DIR=/opt/buz-node

cd "$DEPLOY_DIR"

# 上一个版本号存在 .env 里，失败时用它回滚
PREVIOUS_TAG=$(grep -s '^IMAGE_TAG=' .env | cut -d= -f2 || true)

write_env() {
  cat > .env <<EOF
REGISTRY=$REGISTRY
NAMESPACE=$NAMESPACE
IMAGE_TAG=$1
EOF
}

# 最多等 60 秒，/ready 返回 200 才算部署成功
wait_ready() {
  for _ in $(seq 1 30); do
    if curl -sf http://127.0.0.1:3001/ready > /dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

echo "开始部署：$IMAGE_TAG（上一个版本：${PREVIOUS_TAG:-无}）"
# 先拉镜像，成功后再把新版本号写进 .env；拉取失败时脚本直接退出，.env 里仍是正在运行的旧版本
# 命令前面直接写的变量比 .env 文件里的优先，所以这里拉的是新版本
REGISTRY="$REGISTRY" NAMESPACE="$NAMESPACE" IMAGE_TAG="$IMAGE_TAG" docker compose pull
write_env "$IMAGE_TAG"
docker compose up -d

if wait_ready; then
  echo "部署成功：$IMAGE_TAG"
  # 只清理没有标签的悬空镜像，旧版本镜像保留着，回滚时不用重新拉
  docker image prune -f > /dev/null
  exit 0
fi

echo "新版本健康检查失败，最近的日志："
docker compose logs --tail 50 bff

if [ -n "$PREVIOUS_TAG" ]; then
  echo "回滚到上一个版本：$PREVIOUS_TAG"
  write_env "$PREVIOUS_TAG"
  docker compose up -d
  if wait_ready; then
    echo "回滚成功"
  else
    echo "回滚后仍然不健康，需要人工处理"
  fi
fi

exit 1
