import json
from pathlib import Path
from utils.bus import consume, publish_outbox

ME = "github"

# 모든 collect 작업을 소비하고, 각 작업별로 개별 result를 outbox에 기록
tasks = consume(Path("agents_bus/inbox"), agent=ME, delete=True)
for t in tasks:
    if t.get("type") != "collect":
        continue
    platform = t.get("payload", {}).get("platform", "unknown")
    # TODO: 실제 GitHub API 연결. 지금은 샘플 신호
    items = [{
        "repo": f"{platform.lower()}/sample-repo",
        "stars_delta": 42,
        "prs_merged": 7,
        "releases": 1
    }]
    publish_outbox({
        "from": ME, "to": "manager", "type": "result", "status": "ok",
        "topic": t["topic"],          # ★ 작업의 topic 유지
        "thread": t["thread"],        # ★ 작업의 thread 유지
        "items": items
    })
