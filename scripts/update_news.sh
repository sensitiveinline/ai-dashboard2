#!/usr/bin/env bash
set -euo pipefail

# 여기에 실제 갱신 로직을 넣으면 됨 (예: JSON 갱신 등)
# ...

# 마지막 업데이트 타임스탬프 생성 (커밋 대상)
mkdir -p public/data
date -u +"%Y-%m-%dT%H:%M:%SZ" > public/data/last_update.txt

# 디버그용 변경 목록
git status --porcelain
