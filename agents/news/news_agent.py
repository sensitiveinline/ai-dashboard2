import json
from pathlib import Path
from utils.bus import consume, publish_outbox

ME = "news"

tasks = consume(Path("agents_bus/inbox"), agent=ME, delete=True)
items = []

for t in tasks:
    if t.get("type") != "collect":
        continue
    # 샘플 데이터 생성 (실제 구현 시 RSS/API 호출)
    items.append({
        "title": f"Sample news for {t['topic']}",
        "url": "https://example.com",
        "summary": "요약(샘플)",
        "credibility": 0.85,
        "signals": {"release": True}
    })

if items:
    publish_outbox({
        "from": ME, "to": "manager", "type": "result", "status": "ok",
        "topic": tasks[0]["topic"], "thread": tasks[0]["thread"], "items": items
    })
