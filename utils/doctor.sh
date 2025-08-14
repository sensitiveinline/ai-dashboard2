set -euo pipefail

echo "== 1) 데이터 파일 존재/유효성 체크 =="
need_fix=0
mkdir -p public/data
for f in public/data/news_current.json public/data/news_snapshots.json; do
  if [ ! -s "$f" ]; then
    echo " -> $f 없음(또는 비어있음)"
    need_fix=1
  else
    node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('$f','utf8')); if('$f'.includes('current')){ if(!Array.isArray(j)||j.length===0){process.exit(2)} }" \
      && echo " -> $f OK" \
      || { echo " -> $f 구조 이상"; need_fix=1; }
  fi
done

echo "== 2) 에이전트 스크립트 쓰기 경로/로직 확인 =="
grep -q "news_snapshots.json" scripts/agent_conversation.mjs && echo " -> snapshots write OK" || need_fix=1
grep -q "news_current.json"    scripts/agent_conversation.mjs && echo " -> current write OK"   || need_fix=1

echo "== 3) UI fetch 경로 확인(상대경로 + no-store 권장) =="
if grep -q "./data/news_current.json" app.js; then echo " -> app.js 경로 OK"; else echo " -> app.js 경로 수정 필요"; need_fix=1; fi

echo "== 4) 워크플로 환경/가드 확인 =="
wf=.github/workflows/m8-news.yml
if [ -f "$wf" ]; then
  grep -q "GEMINI_API_KEY" "$wf" && echo " -> env 주입 OK" || { echo " -> env 주입 누락"; need_fix=1; }
  grep -q "upload-artifact@v4" "$wf" && echo " -> artifact 업로드 OK" || echo " -> artifact 업로드 없음(선택)"
else
  echo " -> $wf 없음"
  need_fix=1
fi

echo "== 5) talk 워크플로 확인(수동/저비용) =="
tw=.github/workflows/agents_talk.yml
if [ -f "$tw" ]; then
  grep -q "workflow_dispatch" "$tw" && echo " -> talk는 수동 실행 OK" || echo " -> talk 자동 스케줄? 확인 필요"
  grep -q "m8:talk-once" "$tw" && echo " -> single-call 사용 OK" || echo " -> talk 스크립트 확인 필요"
fi

if [ "$need_fix" -eq 0 ]; then
  echo "✅ 기본 진단 OK — 데이터가 있어야 UI에 바로 떠요."
  exit 0
fi

echo "== 자동 수정 진행 =="

# 3-1) app.js 경로를 상대경로로 강제
sed -i.bak 's|/data/news_current.json|./data/news_current.json|g' app.js || true
sed -i.bak 's|/data/ai_note.json|./data/ai_note.json|g' app.js || true

# 3-2) news_current.json이 없으면 오늘자 더미라도 채워 UI 경로 검증
if [ ! -s public/data/news_current.json ]; then
  echo '[{"title":"probe","url":"https://example.com","summary":"ok","source":"example.com","ts":"'"$(date -u +%FT%TZ)"'"}]' > public/data/news_current.json
  echo " -> news_current.json probe 작성"
fi
if [ ! -s public/data/news_snapshots.json ]; then
  day=$(date -u +%F)
  echo '{ "'"$day"'": [{"title":"probe","url":"https://example.com","summary":"ok","source":"example.com","ts":"'"$(date -u +%FT%TZ)"'"}] }' > public/data/news_snapshots.json
  echo " -> news_snapshots.json probe 작성"
fi

echo "== 마무리 안내 =="
echo "1) git add -A && git commit -m 'doctor: fix paths and ensure data' && git push"
echo "2) 페이지 하드 리로드(Cmd/Ctrl+Shift+R)로 'probe' 보이면 UI 경로 OK"
echo "3) 이후엔 Actions의 M8 Fetch News를 실행해서 실제 데이터로 덮으면 됩니다."
