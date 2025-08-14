#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/data"
OUT="$ROOT/agents/out"
mkdir -p "$DATA" "$OUT"

echo "[run] try agents…"
ok=0
try() { echo "+ $*"; (cd "$ROOT" && eval "$@") && ok=1 || true; }

# 1) 가장 흔한 파이썬 엔트리
try "python3 agents/pipeline.py"
try "python3 -m agents.pipeline"
try "bash agents/run.sh"

# 2) 노드 기반 가능성
try "node agents/index.js"
try "npm run agent"
try "npm run scrape"

if [ "$ok" -eq 0 ]; then
  echo "ERR: no agent entry worked"; exit 2
fi

echo "[run] copy outputs → data/"
# 후보 위치에서 data로 브리지
for f in \
  "$OUT"/*.json \
  "$ROOT"/agents/*.json \
  "$ROOT"/config/*.json \
  "$ROOT"/data/*.json; do
  [ -f "$f" ] || continue
  bn="$(basename "$f")"
  case "$bn" in
    platform_rankings.json|platform_rankings.prev.json|news_snapshots.json|news_current.json|gh_repos.json|ai_note.json)
      cp -f "$f" "$DATA/$bn"
      ;;
  esac
done

# 최소 파일 체크
need=(platform_rankings.json platform_rankings.prev.json)
for n in "${need[@]}"; do
  [ -s "$DATA/$n" ] || { echo "ERR: data/$n missing or empty"; exit 3; }
done

echo "[run] agents done."
