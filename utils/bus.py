import json, uuid, time, os
from pathlib import Path

BASE = Path(__file__).resolve().parents[1] / "agents_bus"
INBOX = BASE / "inbox"
OUTBOX = BASE / "outbox"
REVIEWS = BASE / "reviews"
LOGS = BASE / "logs"

for p in (INBOX, OUTBOX, REVIEWS, LOGS):
    p.mkdir(parents=True, exist_ok=True)

def _ts():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def _write(folder: Path, msg: dict):
    msg.setdefault("id", str(uuid.uuid4()))
    msg.setdefault("ts", _ts())
    path = folder / f"{msg['ts']}__{msg['id']}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(msg, f, ensure_ascii=False, indent=2)
    with open(LOGS / "bus.log", "a", encoding="utf-8") as f:
        f.write(json.dumps(msg, ensure_ascii=False) + "\n")
    return path

def publish_inbox(msg: dict):
    return _write(INBOX, msg)

def publish_outbox(msg: dict):
    return _write(OUTBOX, msg)

def publish_review(msg: dict):
    return _write(REVIEWS, msg)

def consume(folder: Path, agent: str, delete=True, limit=None):
    files = sorted(folder.glob("*.json"))
    items = []
    for fp in files:
        with open(fp, "r", encoding="utf-8") as f:
            m = json.load(f)
        if m.get("to") not in (agent, "*"):
            continue
        items.append((fp, m))
        if limit and len(items) >= limit:
            break
    if delete:
        for fp, _ in items:
            os.remove(fp)
    return [m for _, m in items]
