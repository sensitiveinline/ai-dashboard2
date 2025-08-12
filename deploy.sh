#!/bin/bash
set -e

# 변경사항 스테이징
git add -A

# 커밋할 변경이 없으면 바로 종료
if git diff --cached --quiet; then
  echo "ℹ️ 변경 없음 (nothing to commit)"
  exit 0
fi

# 커밋 + 푸시
git commit -m "업데이트: AI Dashboard Agents ($(date -u +'%Y-%m-%dT%H:%MZ'))"
git push origin main
echo "🚀 GitHub에 변경사항이 푸시되었습니다."
