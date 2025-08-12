import json, os, math, time
from pathlib import Path
from collections import defaultdict

IN = Path("public/data/snapshots.json")
OUT = Path("public/data/platform_rankings.json")
HIST = Path("public/data/platform_rankings.prev.json")  # 단순 전회 비교용

WEIGHTS = {"interest": 0.40, "community": 0.35, "updates": 0.25}

def rescale_0_100(vals):
    if not vals: return []
    mn, mx = min(vals), max(vals)
    if mx == mn: return [50.0 for _ in vals]
    return [(v - mn) * 100.0 / (mx - mn) for v in vals]

def main():
    if not IN.exists():
        raise SystemExit("snapshots.json not found. Run orchestrator publish/merge first.")

    snap = json.loads(IN.read_text(encoding="utf-8"))
    per = defaultdict(lambda: {"news_cnt":0,"news_cred_sum":0.0,"news_release":0,
                               "stars_delta":0,"prs_merged":0,"gh_releases":0})

    for r in snap.get("results", []):
        topic = r.get("topic","")
        platform = topic.split("-",1)[0] if "-" in topic else "Unknown"
        items = r.get("items", [])
        if r.get("from") == "news":
            for x in items:
                per[platform]["news_cnt"] += 1
                per[platform]["news_cred_sum"] += float(x.get("credibility",0.7))
                if x.get("signals",{}).get("release"): per[platform]["news_release"] += 1
        elif r.get("from") == "github":
            # 간이 집계(합계)
            for x in items:
                per[platform]["stars_delta"] += int(x.get("stars_delta",0))
                per[platform]["prs_merged"] += int(x.get("prs_merged",0))
                per[platform]["gh_releases"] += int(x.get("releases",0))

    # 원시 점수 계산
    raw_interest, raw_comm, raw_updates, order = [], [], [], []
    for plat, m in per.items():
        order.append(plat)
        avg_cred = (m["news_cred_sum"]/m["news_cnt"]) if m["news_cnt"] else 0.7
        interest = m["news_cnt"] * avg_cred * 10.0
        community = m["stars_delta"] + m["prs_merged"]*2 + m["gh_releases"]*5
        updates = m["news_release"]*4 + m["gh_releases"]*6
        raw_interest.append(interest)
        raw_comm.append(community)
        raw_updates.append(updates)

    # 0~100 스케일
    sc_interest = rescale_0_100(raw_interest)
    sc_comm = rescale_0_100(raw_comm)
    sc_updates = rescale_0_100(raw_updates)

    # 최종 점수 결합
    items = []
    prev = {}
    if OUT.exists():
        try: prev = {x["platform"]: x for x in json.loads(OUT.read_text()).get("items",[])}
        except: prev = {}
    elif HIST.exists():  # 최초 실행 직후 비교용
        try: prev = {x["platform"]: x for x in json.loads(HIST.read_text()).get("items",[])}
        except: prev = {}

    for i, plat in enumerate(order):
        score = (sc_interest[i]*WEIGHTS["interest"] +
                 sc_comm[i]*WEIGHTS["community"] +
                 sc_updates[i]*WEIGHTS["updates"])
        last = prev.get(plat, {})
        delta = round(score - float(last.get("score", score)), 2)  # 전회 대비
        items.append({
            "platform": plat,
            "score": round(score, 2),
            "delta_7d": delta,     # 히스토리 체계 붙이기 전에는 전회 대비로 사용
            "delta_30d": None,
            "breakdown": {
                "interest": round(sc_interest[i],2),
                "community": round(sc_comm[i],2),
                "updates": round(sc_updates[i],2)
            },
            "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        })

    # 점수순 정렬
    items.sort(key=lambda x: x["score"], reverse=True)

    # 이전 결과 백업
    if OUT.exists():
        OUT.replace(HIST)

    OUT.write_text(json.dumps({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                               "items": items}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ wrote {OUT} (platforms: {len(items)})")

if __name__ == "__main__":
    main()
