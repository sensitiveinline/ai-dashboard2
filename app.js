(() => {
  // ---------- Util ----------
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const fmt = n => Intl.NumberFormat('en', {notation:'compact'}).format(n);
  const todayISO = () => new Date().toISOString().slice(0,10);
  const nowISO = () => new Date().toISOString();

  // Detect base path for GitHub Pages (/user/repo/) and local (/)
  const seg = location.pathname.split("/").filter(Boolean)[0];
  const BASE = seg ? `/${seg}/` : "/";
  const DATA = `${BASE}data/`;

  // localStorage helper with TTL
  const store = {
    get(k){ try{ const o=JSON.parse(localStorage.getItem(k)||"null"); if(!o) return null;
      if (o.exp && Date.now()>o.exp) { localStorage.removeItem(k); return null; }
      return o.val; }catch(e){return null}},
    set(k,v,ttlMs){ const o={val:v}; if(ttlMs) o.exp=Date.now()+ttlMs; localStorage.setItem(k,JSON.stringify(o)); },
    del(k){ localStorage.removeItem(k); }
  };

  async function getJSON(url, {ttl=5*60_000, bust=false, key=url}={}){
    if(!bust){
      const cached = store.get(key);
      if(cached) return cached;
    }
    const res = await fetch(url, {cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const data = await res.json();
    store.set(key, data, ttl);
    return data;
  }

  // ---------- Memory (user prefs) ----------
  const MEMKEY = "ai_dash_prefs_v1";
  const prefs = Object.assign({
    repoSort: "stars",
    q: "",
    hiddenNews: {},   // {id: true}
    bookmarked: {},   // {id: true}
    seenNews: {},     // {id: ISO}
  }, store.get(MEMKEY) || {});
  const savePrefs = () => store.set(MEMKEY, prefs);

  // ---------- DOM refs ----------
  const elPlatform = $("#platformList");
  const elRepo = $("#repoList");
  const elNews = $("#newsList");
  const elNote = $("#noteBox");
  const elNoteDate = $("#noteDate");
  const elRepoSort = $("#repoSort");
  const elQ = $("#q");

  // init controls from memory
  elRepoSort.value = prefs.repoSort;
  elQ.value = prefs.q;

  // ---------- Data loaders ----------
  const loadAll = async (opts={}) => {
    const bust = !!opts.bust;

    const [
      platforms, platformsPrev, newsCurrent, newsSnaps, aiNote,
      // optional data your updater may produce:
      ghRepos
    ] = await Promise.all([
      getJSON(`${DATA}platform_rankings.json`, {ttl:30*60_000, bust}),
      getJSON(`${DATA}platform_rankings.prev.json`, {ttl:30*60_000, bust}).catch(()=>null),
      getJSON(`${DATA}news_current.json`, {ttl:10*60_000, bust}),
      getJSON(`${DATA}news_snapshots.json`, {ttl:6*60_000, bust}).catch(()=>({items:[]})),
      getJSON(`${DATA}ai_note.json`, {ttl:10*60_000, bust}).catch(()=>null),
      getJSON(`${DATA}snapshots.json`, {ttl:30*60_000, bust}).catch(()=>null),
    ]);

    return {platforms, platformsPrev, newsCurrent, newsSnaps, aiNote, ghRepos};
  };

  // ---------- Platform scoring & render ----------
  function scorePlatform(p){
    // Flexible scoring: use provided score if exists; otherwise compute
    if (typeof p.score === "number") return p.score;
    // Heuristic from common fields
    const stars7d = p.stars7d ?? 0;
    const webTrend = p.webTrend ?? 0;   // e.g., Google trends delta
    const ghTrend = p.ghTrend ?? 0;     // e.g., repo trend/composite
    // weights can be tuned
    return Math.round(stars7d*0.6 + ghTrend*0.3 + webTrend*0.1);
  }
  function deltaFromPrev(cur, prevMap){
    if(!prevMap) return null;
    const prev = prevMap.get(cur.id||cur.name);
    if(!prev) return null;
    const d = (scorePlatform(cur) - scorePlatform(prev));
    if (d===0) return {dir:"flat", val:0};
    return {dir: d>0?"up":"down", val: Math.abs(d)};
  }
  function renderPlatforms(platforms, platformsPrev){
    const prevMap = platformsPrev ? new Map(platformsPrev.map(p=>[(p.id||p.name), p])) : null;
    const ranked = platforms
      .map(p=>({ ...p, _score: scorePlatform(p), _delta: deltaFromPrev(p, prevMap) }))
      .sort((a,b)=>b._score-a._score)
      .slice(0, 20);

    elPlatform.innerHTML = ranked.map((p,i)=>{
      const d = p._delta;
      const arrow = d?.dir==="up" ? upIcon : d?.dir==="down" ? downIcon : flatIcon;
      const delta = d ? `<span class="change ${d.dir}">${arrow}<span> ${d.val}</span></span>` : "";
      const sub = [p.desc||p.tagline||"", p.url?new URL(p.url).hostname:""].filter(Boolean).join(" · ");
      return `
        <li class="rank-item">
          <div class="rank-left">
            <div class="rank-num">${i+1}</div>
            <div class="rank-texts">
              <div class="rank-title"><a href="${p.url||'#'}" target="_blank" rel="noopener">${p.name||p.id}</a></div>
              <div class="rank-sub">${sub}</div>
            </div>
          </div>
          <div>
            <div class="kpi" title="score">${p._score}</div>
            ${delta}
          </div>
        </li>
      `;
    }).join("");
  }

  // ---------- GitHub AI (repos) ----------
  function computeRepoScore(r, mode){
    if (mode==="commits") return r.commits30d ?? 0;
    if (mode==="releases") return r.releases90d ?? 0;
    // default: stars in last 7d if present else total
    return r.stars7d ?? r.stargazers_count ?? 0;
  }
  function renderRepos(repos, mode, q){
    if (!repos || !Array.isArray(repos.items||repos)) {
      elRepo.innerHTML = `<div class="mut">데이터가 없습니다.</div>`;
      return;
    }
    const arr = repos.items || repos;
    const normQ = (q||"").trim().toLowerCase();
    const filtered = arr.filter(r=>{
      if(!normQ) return true;
      const hay = [r.full_name, r.name, r.description, (r.topics||[]).join(" ")].join(" ").toLowerCase();
      return hay.includes(normQ);
    });
    const sorted = filtered
      .map(r=>({ ...r, _score: computeRepoScore(r, mode)}))
      .sort((a,b)=>b._score-a._score)
      .slice(0, 30);

    elRepo.innerHTML = sorted.map(r=>{
      const meta = [
        r.language,
        r.license?.spdx_id,
        r._score ? `${prefs.repoSort}:${fmt(r._score)}` : null
      ].filter(Boolean).join(" · ");
      const url = r.html_url || r.url || "#";
      return `
        <article class="card" style="padding:12px; border:none; border-top:1px solid var(--bd); border-radius:0;">
          <div class="row">
            <a href="${url}" target="_blank" rel="noopener"><strong>${r.full_name||r.name}</strong></a>
            <span class="mut">${meta}</span>
          </div>
          <div class="mut" style="margin-top:6px;">${r.description||""}</div>
          <div class="mut" style="margin-top:6px;">⭐ ${fmt(r.stargazers_count||0)} · ⑂ ${fmt(r.forks_count||0)} · ⧗ ${fmt(r.open_issues_count||0)}</div>
        </article>
      `;
    }).join("");
  }

  // ---------- AI NEWS ----------
  function uniqueBy(arr, keyer){
    const set=new Set(); const out=[];
    for(const x of arr){ const k=keyer(x); if(set.has(k)) continue; set.add(k); out.push(x); }
    return out;
  }
  function domainOf(url){ try{ return new URL(url).hostname.replace(/^www\./,''); }catch(e){ return ""; } }

  function normalizeNews(news){
    // expect {items:[{id,title,url,summary,source,ts}]}
    const items = news.items || news || [];
    return items.map((n,i)=>({
      id: n.id || n.url || `n${i}`,
      title: n.title || n.headline || "(제목 없음)",
      url: n.url,
      summary: n.summary || n.desc || "",
      source: n.source || domainOf(n.url),
      ts: n.ts || n.date || n.published_at || null,
      score: n.score ?? 0
    }));
  }

  function renderNews(news, q){
    const items0 = normalizeNews(news);

    // 1) 중복 제거: 같은 URL, 같은 도메인 과도한 반복 제거
    const byUrl = uniqueBy(items0, x=>x.url||x.id);
    // 도메인별 최대 3개로 제한
    const domainCount = {};
    const items1 = [];
    for(const it of byUrl){
      const d = it.source || domainOf(it.url);
      domainCount[d] = (domainCount[d]||0) + 1;
      if (domainCount[d] <= 3) items1.push(it);
    }

    // 2) 검색
    const normQ = (q||"").trim().toLowerCase();
    let arr = items1.filter(n=>{
      if(!normQ) return true;
      const hay = [n.title, n.summary, n.source].join(" ").toLowerCase();
      return hay.includes(normQ);
    });

    // 3) 사용자 메모리 반영(숨김/북마크/보기순서)
    arr = arr.filter(n => !prefs.hiddenNews[n.id]);

    // 4) 정렬: 점수/시간 우선
    arr.sort((a,b)=> (b.score - a.score) || ((b.ts||"") > (a.ts||"") ? 1 : -1));

    elNews.innerHTML = arr.map(n=>{
      const bookmarked = !!prefs.bookmarked[n.id];
      const seen = prefs.seenNews[n.id];
      const meta = [
        n.source,
        n.ts ? new Date(n.ts).toLocaleString() : null
      ].filter(Boolean).join(" · ");
      return `
        <article class="card" style="padding:12px; border:none; border-top:1px solid var(--bd); border-radius:0;">
          <div class="row">
            <a href="${n.url}" target="_blank" rel="noopener"><strong>${n.title}</strong></a>
            <div class="row" style="gap:8px;">
              <button class="btn" data-act="bookmark" data-id="${n.id}">${bookmarked?"★":"☆"}</button>
              <button class="btn" data-act="hide" data-id="${n.id}">숨김</button>
            </div>
          </div>
          <div class="mut" style="margin-top:6px;">${n.summary||""}</div>
          <div class="mut" style="margin-top:6px;">${meta}${seen?` · viewed ${new Date(seen).toLocaleTimeString()}`:""}</div>
        </article>
      `;
    }).join("");

    // click actions
    elNews.onclick = (e)=>{
      const btn = e.target.closest("button[data-act]");
      if(!btn) return;
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if(act==="hide"){ prefs.hiddenNews[id]=true; savePrefs(); renderNews(news, elQ.value); }
      if(act==="bookmark"){ prefs.bookmarked[id]=!prefs.bookmarked[id]; savePrefs(); renderNews(news, elQ.value); }
    };
    // mark seen on link click
    elNews.addEventListener("click", (e)=>{
      const a = e.target.closest("a[href]");
      if(!a) return;
      const card = a.closest("article");
      const id = card?.querySelector('button[data-id]')?.dataset.id;
      if(id){ prefs.seenNews[id]=nowISO(); savePrefs(); }
    }, {capture:true});
  }

  // ---------- AI NOTE ----------
  function renderNote(aiNote, news, repos){
    elNoteDate.textContent = todayISO();
    // 1) server-generated ai_note.json 우선
    if (aiNote && (aiNote.html || aiNote.markdown || aiNote.text)){
      if (aiNote.html) { elNote.innerHTML = aiNote.html; return; }
      const text = aiNote.markdown || aiNote.text;
      elNote.innerHTML = `<pre style="white-space:pre-wrap">${text}</pre>`;
      return;
    }
    // 2) fallback: 클라이언트에서 간단한 인사이트 생성(요약 아님, 신호 중심)
    const items = normalizeNews(news).slice(0,8);
    const bullets = items.map(n=>`- ${n.title} (${n.source})`).join("\n");
    elNote.innerHTML = `
      <div class="mut">서버 AI 노트가 없어 임시로 생성된 클라이언트 노트입니다.</div>
      <h3>오늘의 핵심 신호</h3>
      <pre style="white-space:pre-wrap">${bullets}</pre>
    `;
  }

  // ---------- Icons ----------
  const upIcon = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 4l6 6h-4v6H10V10H6l6-6z"/></svg>`;
  const downIcon = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="trend down"><path d="M12 20l-6-6h4V8h4v6h4l-6 6z"/></svg>`;
  const flatIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 12h16v2H4z"/></svg>`;

  // ---------- Wire up ----------
  function applyFilters(state){
    const {platforms, platformsPrev, newsCurrent, ghRepos} = state;
    renderPlatforms(platforms, platformsPrev);
    renderRepos(ghRepos||[], elRepoSort.value, elQ.value);
    renderNews(newsCurrent, elQ.value);
    renderNote(state.aiNote, state.newsCurrent, state.ghRepos);
  }

  // initial load
  let state = null;
  (async () => {
    try{
      state = await loadAll({bust:false});
      applyFilters(state);
    }catch(e){
      console.error(e);
      $("#grid").insertAdjacentHTML("afterbegin", `<div class="card" style="grid-column:1/-1;color:#dc2626;">데이터 로드 오류: ${e.message}</div>`);
    }
  })();

  // UI events
  elRepoSort.onchange = () => { prefs.repoSort = elRepoSort.value; savePrefs(); applyFilters(state); };
  elQ.oninput = (e) => { prefs.q = e.target.value; savePrefs(); applyFilters(state); };

  // Refresh button already in HTML → full bust on reload
  window.addEventListener('keydown', (e)=>{
    if((e.ctrlKey||e.metaKey) && e.key==='k'){ e.preventDefault(); elQ.focus(); }
  });
})();
