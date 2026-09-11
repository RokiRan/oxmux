#!/usr/bin/env bash
# 部署 oxmux 控制面到树莓派（或任意 arm64 Linux 主机）：纯 HTTP 自托管，无 Caddy/TLS。
#
# 流程：确保基础镜像 → 构建 control-plane → 灌入目标机 → compose 起栈 → 健康检查
# → host worker 升级（若目标机装有 host worker，从刚部署的 server 拉 package.tgz
# 按 /install/worker.sh 的标准 tar 换包路径刷新并重启服务；server 重部署不会带 host worker）。
# 幂等：可反复运行；首次运行会在目标机生成 ~/oxmux/.env.production（随机 secrets，只生成一次），
# 之后每次运行强制对齐 HTTP 对外配置项并同步 compose 模板。
#
# 配置（环境变量优先，否则读 deploy/host/.env.pi——该文件被 .gitignore 忽略）：
#   PI_HOST       目标机地址（必填，如 10.0.0.191）
#   PI_USER       SSH 用户（默认 ubuntu）
#   PI_SSH_PASS   SSH + sudo 密码（必填；若已配 SSH key 可置空并自行去掉 sshpass）
#   SERVER_PORT   对外端口（默认 8989）
#
# 前置：本机 docker + sshpass；目标机已装 docker 且与构建机同架构（arm64）。
# 目标机拉不到 docker.io 时，基础镜像（postgres/minio/mc）会从本机缓存灌入；
# 本机也没有则先经 docker.m.daocloud.io 拉取。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_PI="$REPO_ROOT/deploy/host/.env.pi"
# shellcheck disable=SC1090
[[ -f "$ENV_PI" ]] && source "$ENV_PI"

PI_HOST="${PI_HOST:-}"
PI_USER="${PI_USER:-ubuntu}"
PI_SSH_PASS="${PI_SSH_PASS:-}"
SERVER_PORT="${SERVER_PORT:-8989}"
IMAGE="oxmux/control-plane:local"
COMPOSE_FILE="$REPO_ROOT/deploy/host/docker-compose.http.yml"
REMOTE_DIR="oxmux"

[[ -n "$PI_HOST" ]] || { echo "错误: 缺少 PI_HOST（写入 deploy/host/.env.pi 或走环境变量）" >&2; exit 1; }
[[ -n "$PI_SSH_PASS" ]] || { echo "错误: 缺少 PI_SSH_PASS" >&2; exit 1; }
command -v sshpass >/dev/null || { echo "错误: 需要 sshpass（brew install hudochenkov/sshpass/sshpass）" >&2; exit 1; }
command -v docker >/dev/null || { echo "错误: 需要 docker" >&2; exit 1; }

SSH=(sshpass -p "$PI_SSH_PASS" ssh -o StrictHostKeyChecking=no "$PI_USER@$PI_HOST")
SCP=(sshpass -p "$PI_SSH_PASS" scp -o StrictHostKeyChecking=no)

# docker.io 直连超时时的镜像源：无命名空间的官方镜像加 library/ 前缀
mirror_of() {
  local ref="$1" repo tag
  if [[ "$ref" == *:* ]]; then repo="${ref%:*}"; tag="${ref##*:}"; else repo="$ref"; tag="latest"; fi
  [[ "$repo" != */* ]] && repo="library/$repo"
  echo "docker.m.daocloud.io/$repo:$tag"
}

# 确保本机有该镜像（没有则经镜像源拉取并 retag 回原名）
ensure_local_image() {
  local ref="$1"
  docker image inspect "$ref" >/dev/null 2>&1 && return 0
  local mirror; mirror="$(mirror_of "$ref")"
  echo "    本机缺少 ${ref}，经 $mirror 拉取"
  docker pull "$mirror" >/dev/null
  docker tag "$mirror" "$ref"
}

# 确保目标机有该镜像（没有则从本机灌入）
ensure_remote_image() {
  local ref="$1"
  if "${SSH[@]}" "echo '$PI_SSH_PASS' | sudo -S docker image inspect '$ref' >/dev/null 2>&1"; then
    return 0
  fi
  echo "    目标机缺少 ${ref}，从本机灌入"
  ensure_local_image "$ref"
  docker save "$ref" | gzip -1 | "${SSH[@]}" "cat > /tmp/oxmux-img.tar.gz && echo '$PI_SSH_PASS' | sudo -S docker load -i /tmp/oxmux-img.tar.gz && rm -f /tmp/oxmux-img.tar.gz"
}

echo "==> [1/6] 确保 node:22-bookworm-slim 构建基础镜像"
ensure_local_image node:22-bookworm-slim

echo "==> [2/6] 构建 $IMAGE"
docker build -f "$REPO_ROOT/deploy/docker/Dockerfile.control-plane" --target runtime -t "$IMAGE" "$REPO_ROOT"

echo "==> [3/6] 确保目标机基础镜像（postgres / minio / mc）"
ensure_remote_image postgres:16-alpine
ensure_remote_image minio/minio:latest
ensure_remote_image minio/mc:latest

echo "==> [4/6] 传输 $IMAGE 到 $PI_HOST"
docker save "$IMAGE" | gzip -1 | "${SSH[@]}" 'cat > /tmp/oxmux-cp.tar.gz'

echo "==> [5/6] 同步 compose 并重建栈"
"${SCP[@]}" "$COMPOSE_FILE" "$PI_USER@$PI_HOST:/tmp/oxmux-compose.yml"
"${SSH[@]}" "DEPLOY_SUDO_PASS='$PI_SSH_PASS' PI_HOST='$PI_HOST' SERVER_PORT='$SERVER_PORT' REMOTE_DIR='$REMOTE_DIR' bash -s" <<'REMOTE'
set -euo pipefail
mkdir -p "$HOME/$REMOTE_DIR"
mv /tmp/oxmux-compose.yml "$HOME/$REMOTE_DIR/docker-compose.pi.yml"
cd "$HOME/$REMOTE_DIR"

if [[ ! -f .env.production ]]; then
  echo "    首次部署：生成 .env.production（随机 secrets，仅此一次）"
  cat > .env.production <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
OBJECT_STORAGE_SECRET_ACCESS_KEY=$(openssl rand -hex 32)
OBJECT_STORAGE_BUCKET=oxmux
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
TOKEN_SECRET=$(openssl rand -hex 32)
SECRET_ENCRYPTION_KEY=$(openssl rand -hex 32)
EOF
  chmod 600 .env.production
fi

# 幂等强制纯 HTTP 对外配置
sed -i '/^OXMUX_PUBLIC_BASE_URL=/d;/^OXMUX_PROJECT_PREVIEW_SCHEME=/d;/^SERVER_PORT=/d;/^OXMUX_VERSION=/d' .env.production
cat >> .env.production <<EOF
SERVER_PORT=$SERVER_PORT
OXMUX_VERSION=local
OXMUX_PUBLIC_BASE_URL=http://$PI_HOST:$SERVER_PORT
OXMUX_PROJECT_PREVIEW_SCHEME=http
EOF

echo "$DEPLOY_SUDO_PASS" | sudo -S docker load -i /tmp/oxmux-cp.tar.gz
rm -f /tmp/oxmux-cp.tar.gz
# --remove-orphans：清掉已从 compose 移除的服务残留容器（如老 TLS 部署的 caddy）
echo "$DEPLOY_SUDO_PASS" | sudo -S docker compose -f docker-compose.pi.yml --env-file .env.production up -d --remove-orphans
REMOTE

echo "==> [6/7] 健康检查 http://$PI_HOST:$SERVER_PORT/api/ready"
ready=""
for _ in $(seq 1 30); do
  if curl -sf --max-time 5 "http://$PI_HOST:$SERVER_PORT/api/ready" 2>/dev/null | grep -q '"ok":true'; then
    ready=1
    break
  fi
  sleep 5
done
if [[ -z "$ready" ]]; then
  echo "错误: 健康检查超时。查看日志: ssh $PI_USER@$PI_HOST 'sudo docker logs oxmux-server-1'" >&2
  exit 1
fi

echo "==> [7/7] 升级目标机 host worker（标准 tar 换包，与 /install/worker.sh 同路径）"
# server 重部署不会带 host 上的 worker；worker 版本号不变时自动更新也不会触发。
# 这里直接从刚部署的 server 拉 package.tgz，按 worker.sh 的标准做法 tar 解压换目录，
# 不走 npm install -g（慢、且 npm 生命周期对自包含包无意义）。
"${SSH[@]}" "SERVER_PORT='$SERVER_PORT' bash -s" <<'REMOTE'
set -euo pipefail

PKG_NAME="oxmux-worker-preview"
INSTALL_DIR="$HOME/.oxmux-preview-worker"
PKG_DIR="$INSTALL_DIR/lib/node_modules/$PKG_NAME"
SERVICE=""

if [[ ! -d "$PKG_DIR" ]]; then
  echo "    目标机未安装 host worker（无 $PKG_DIR），跳过"
  exit 0
fi
if systemctl --user is-active --quiet oxmux-worker-preview.service 2>/dev/null; then
  SERVICE="oxmux-worker-preview.service"
elif systemctl --user is-active --quiet oxmux-worker.service 2>/dev/null; then
  SERVICE="oxmux-worker.service"
fi

TMP_DIR="$(mktemp -d /tmp/oxmux-worker-upgrade.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "    从本机 server 拉取 worker 包"
curl -fsSL --max-time 120 "http://127.0.0.1:$SERVER_PORT/install/worker/package.tgz" -o "$TMP_DIR/package.tgz"
mkdir -p "$TMP_DIR/extract"
tar -xzf "$TMP_DIR/package.tgz" -C "$TMP_DIR/extract"
[[ -f "$TMP_DIR/extract/$PKG_NAME/package.json" ]] || { echo "错误: worker 包缺 package.json" >&2; exit 1; }
NEW_VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version||'?')" "$TMP_DIR/extract/$PKG_NAME/package.json" 2>/dev/null || echo '?')"
OLD_VERSION="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version||'?')" "$PKG_DIR/package.json" 2>/dev/null || echo '?')"

if [[ -n "$SERVICE" ]]; then
  systemctl --user stop "$SERVICE"
fi
BACKUP_DIR="$INSTALL_DIR/lib/node_modules/.$PKG_NAME.bak-$(date +%s)"
mv "$PKG_DIR" "$BACKUP_DIR"
if ! mv "$TMP_DIR/extract/$PKG_NAME" "$PKG_DIR"; then
  mv "$BACKUP_DIR" "$PKG_DIR"
  [[ -n "$SERVICE" ]] && systemctl --user start "$SERVICE"
  echo "错误: worker 包换入失败，已回滚" >&2
  exit 1
fi
# 自包含包直出时恢复可执行位（与 worker.sh 一致）
chmod +x "$PKG_DIR/bin/"*.mjs 2>/dev/null || true
rm -rf "$BACKUP_DIR"

if [[ -n "$SERVICE" ]]; then
  systemctl --user start "$SERVICE"
  sleep 4
  systemctl --user is-active --quiet "$SERVICE" || { echo "错误: worker 服务重启后未激活" >&2; exit 1; }
  echo "    worker 服务已重启: $SERVICE"
else
  echo "    worker 包已换新（服务未在运行，未重启）"
fi
echo "    host worker: $OLD_VERSION -> $NEW_VERSION（内容按本次部署刷新）"
REMOTE

echo "部署完成: http://$PI_HOST:$SERVER_PORT"
echo "提示: worker 会用 Postgres 里已有的 executor token 自动重连，无需重新配对"
