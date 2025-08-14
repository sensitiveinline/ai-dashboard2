import os, json, time, math, re, hashlib
from datetime import datetime, timezone
from urllib.parse import urlparse, quote
import requests, feedparser
from dateutil import parser as dtp

OUT = "data"
os.makedirs(OUT, exist_ok=True)
NOW = datetime.now(timezone.utc)

def iso(dt): 
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def domain(u):
    try:
        h = urlparse(u).hostname or ""
        return re.sub(r"^www\.", "", h)
    except: 
        return ""

def rss(url, limit=40):
    d = feedparser.parse(url)
    out=[]
    for e in d.entries[:limit]:
        link = getattr(e, "link", "") or getattr(e, "id","")
        title = (getattr(e,"title","") or "").strip()
        if not (link or title): 
            continue
        ts = None
        for k in ("published","updated"):
            val = getattr(e,k,None)
            if val:
                try: 
                    ts = dtp.parse(val); 
                    break
                except: 
                    pass
        out.append({
            "id": hashlib.md5((link or title).encode()).hexdigest()[:12],
            "title": title or "(no title)",
            "url": link,
            "summary": (getattr(e,"summary","") or getattr(e,"description","")).strip(),
            "source": domain(link),
            "ts": iso(ts or NOW),
            "score": 0
        })
    return out

def hn_top(n=40):
    try:
        ids = requests.get("https://hacker-news.firebaseio.com/v0/topstories.json", timeout=12).json()[:n]
        out=[]
        for i in ids:
            it = requests.get(f"https://hacker-news.firebaseio.com/v0/item/{i}.json", timeout=12).json()
            if not it or "url" not in it: 
                continue
            out.append({
                "id": f"hn-{i}",
                "title": it.get("title",""),
                "url": it["url"],
                "summary": "",
                "source": domain(it.get("url","")),
                "ts": iso(datetime.fromtimestamp(it.get("time", time.time()), tz=timezone.utc)),
                "score": it.get("score",0)
            })
        return out
    except Exception as e:
        print("WARN hn_top:", e); 
        return []
def arxiv_csai(n=30):
    u = "http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=50"
    return rss(u, limit=n)

SOURCES = [
    "https://openai.com/blog/rss.xml",
    "https://deepmind.google/discover/blog/rss/",
    "https://ai.googleblog.com/feeds/posts/default?alt=rss",
    "https://engineering.fb.com/feed/",
    "https://aws.amazon.com/blogs/machine-learning/feed/",
    "https://azure.microsoft.com/en-us/blog/topics/ai-machine-learning/feed/",
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
]

def dedupe(items):
    seen=set(); out=[]
    for it in items:
        k=(it.get("url") or it.get("title","")).strip()
        k=re.sub(r"https?://(www\.)?","",k)
        if k in seen: 
            continue
        seen.add(k); 
        out.append(it)
    return out

def score(items):
    for it in items:
        trust=1.0
        s=(it.get("source") or "").lower()
        if any(x in s for x in ["openai","deepmind","google","anthropic","microsoft","meta","arxiv"]): 
            trust=1.3
        elif any(x in s for x in ["techcrunch","verge","venturebeat","ft","semafor"]): 
            trust=1.1
        try:
            age_h=max(1,(NOW - dtp.parse(it.get("ts"))).total_seconds()/3600)
        except: 
            age_h=999
        rec = 100*math.exp(-age_h/48)  # 2일 감쇠
        it["score"]=round(trust*(it.get("score",0)*0.6 + rec),2)
    items.sort(key=lambda x:(x["score"], x.get("ts","")), reverse=True)
    return items

def save(name, obj):
    p=os.path.join(OUT,name)
    with open(p,"w",encoding="utf-8") as f: 
        json.dump(obj,f,ensure_ascii=False,indent=2)
    print("WROTE", p)
    return p

def github_repos():
    token=os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN")
    headers={"Accept":"application/vnd.github+json"}
    if token: 
        headers["Authorization"]=f"Bearer {token}"
    q="topic:ai OR topic:machine-learning OR topic:llm"
    url=f"https://api.github.com/search/repositories?q={quote(q)}&sort=stars&order=desc&per_page=50"
    try:
        r=requests.get(url, headers=headers, timeout=15); r.raise_for_status()
        data=r.json()
        for it in data.get("items",[]):
            it["stars7d"]=it.get("stargazers_count",0)  # 훅(추후 실제 7d로 교체)
        return data
    except Exception as e:
        print("WARN github_repos:", e); 
        return {"items":[]}
def ai_note_from_llm(news, repos):
    # LLM 키 있으면 사용; 없으면 규칙 기반 인사이트
    top = news[:8]
    bullets = "\n".join(f"- {i['title']} ({i.get('source','')})" for i in top)
    prompt = f"You are an AI industry analyst. From the headlines below, write 5-8 actionable insights (not a summary) with why-it-matters.\n{bullets}"
    o=os.getenv("OPENAI_API_KEY"); g=os.getenv("GEMINI_API_KEY")
    if o:
        try:
            import json,urllib.request
            req=urllib.request.Request("https://api.openai.com/v1/chat/completions",
                headers={"Authorization":f"Bearer {o}","Content-Type":"application/json"},
                data=json.dumps({"model":"gpt-4o-mini","messages":[{"role":"user","content":prompt}],"temperature":0.3}).encode())
            res=urllib.request.urlopen(req, timeout=25)
            out=json.loads(res.read().decode())
            c=out["choices"][0]["message"]["content"]
            return {"markdown": c}
        except Exception as e:
            print("WARN openai:", e)
    if g:
        try:
            import google.generativeai as genai
            genai.configure(api_key=g)
            m=genai.GenerativeModel("gemini-1.5-flash")
            r=m.generate_content(prompt)
            return {"markdown": r.text}
        except Exception as e:
            print("WARN gemini:", e)
    return {"markdown": "Insights (fallback):\n"+bullets}

def main():
    # 1) 뉴스
    items=[]
    for s in SOURCES: items+=rss(s, limit=40)
    items+=hn_top(40)
    items+=arxiv_csai(30)
    items=dedupe(items)

    # 도메인별 최대 3개
    cnt={}; trimmed=[]
    for it in items:
        d=it.get("source","")
        cnt[d]=cnt.get(d,0)+1
        if cnt[d]<=3: trimmed.append(it)

    items=score(trimmed)
    save("news_current.json", {"items": items})

    # 2) 깃허브 스냅샷
    repos=github_repos()
    save("snapshots.json", repos)

    # 3) 오늘의 노트
    note=ai_note_from_llm(items, repos.get("items",[]))
    save("ai_note.json", note)

if __name__=="__main__":
    main()
