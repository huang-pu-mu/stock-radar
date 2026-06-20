#!/bin/sh
set -eu

cd /app

mkdir -p /app/logs

echo "===================================="
echo "Stock Radar Docker 排程啟動"
echo "時間：$(date '+%Y-%m-%d %H:%M:%S')"
echo "工作目錄：$(pwd)"
echo "Node：$(node -v)"
echo "NPM：$(npm -v)"
echo "===================================="

npm run scheduled:daily

EXIT_CODE=$?
echo "===================================="
echo "Stock Radar Docker 排程結束"
echo "時間：$(date '+%Y-%m-%d %H:%M:%S')"
echo "Exit Code：${EXIT_CODE}"
echo "===================================="

exit ${EXIT_CODE}
