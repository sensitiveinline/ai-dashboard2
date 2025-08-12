import argparse, json, time
from pathlib import Path
from utils.bus import publish_inbox, publish_review, consume

OUT = Path("public/data")
OUT.mkdir(parents=True, exist_ok=True)

PLATFORMS = ["OpenAI","Anthropic","Google","Meta","Mistral","xAI","Perplexity","Cohere"]

def publish_tasks(window="7d"):
    for p in PLATFORMS:
        topic = f"{p}-{window}"
        thread = topic
        publish_inbox({
            "from":"manager","to":"news","type":"collect","topic":topic,
            "payload":{"platform":p,"window":window,"min_credibility":0.6},
            "thread":thread,"p2p":False
        })
        publish_inbox({
            "from":"manager","to":"github","type":"collect","topic":topic,
            "payload":{"platform":p,"window":window},
            "thread":thread,"p2p":False
        })
    print(f"✅ published collect tasks for {len(PLATFORMS)} platforms")

def merge_to_snapshot():
    # outbox 에 모인 result를 모두 수집
    outbox = Path("agents_bus/outbox")
    results = consume(outbox, agent="manager", delete=True)  # 모두 가져와 비움
    snapshot = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(results),
        "results": results
    }
    with open(OUT/"snapshots.json", "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    print(f"✅ snapshot written → {OUT/'snapshots.json'} (items: {len(results)})")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["publish","merge","both"], default="both")
    ap.add_argument("--window", default="7d")
    args = ap.parse_args()

    if args.mode in ("publish","both"):
        publish_tasks(args.window)
    if args.mode in ("merge","both"):
        merge_to_snapshot()
