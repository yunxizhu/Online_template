#!/bin/bash
# 联机大厅 — macOS 一键启动（双击本文件即可）
# 若提示无法打开：在终端执行  chmod +x "启动.command"
set -e
cd "$(dirname "$0")"

PORT="${PORT:-39200}"
export PORT
export OPEN_BROWSER="${OPEN_BROWSER:-1}"

echo "[lianji] 工作目录: $(pwd)"

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  if [ "$(printf '%s' "$major" | tr -cd '0-9')" -lt 18 ] 2>/dev/null; then
    return 0
  fi
  return 1
}

if need_node; then
  echo
  echo "[lianji] 需要 Node.js >= 18，当前未安装或版本过低。"
  if command -v brew >/dev/null 2>&1; then
    echo "[lianji] 检测到 Homebrew，正在安装 node…"
    brew install node
  else
    echo "[ERROR] 请先安装 Node.js 18+："
    echo "  1) 官网: https://nodejs.org/"
    echo "  2) 或安装 Homebrew 后执行: brew install node"
    echo
    read -r -p "按回车键退出…" _
    exit 1
  fi
  if need_node; then
    echo "[ERROR] 安装后仍无法使用 node，请重新打开终端后再试。"
    read -r -p "按回车键退出…" _
    exit 1
  fi
fi

echo "[lianji] Node.js $(node -v) ready"

if [ ! -d node_modules ]; then
  echo "[lianji] 正在安装依赖 (npm install)…"
  npm install
fi

if [ ! -f mqtt.off ]; then
  echo "[lianji] 跨网联机：默认启用 MQTT 广播（创建 mqtt.off 可关闭）"
fi

echo "[lianji] 检查端口 ${PORT}…"
if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "[lianji] 端口 ${PORT} 被占用，正在结束: ${pids}"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
fi

echo "[lianji] 启动 http://localhost:${PORT} …"
echo "（关闭本窗口即停止服务）"
echo
npm start
code=$?
echo
if [ "$code" -ne 0 ]; then
  echo "[lianji] 启动失败 (exit ${code})"
fi
read -r -p "按回车键退出…" _
exit "$code"
