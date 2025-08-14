/* app.js — client-only, single file
   - 데이터 경로: /data/*.json  (리포의 public/data/* 가 Pages에선 /<repo>/data/* 로 노출)
   - 파일이 404면 화면에서만 보이는 임시 데이터로 대체 (저장은 안 함)
   - 기능: 플랫폼 스코어링/전일대비, GitHub 정렬/검색, 뉴스 dedupe/북마크/숨김, 오늘의 노트, 로컬 캐시
*/
(() => {
  // ========== Utilities ==========
  const $ = (s, el = document) => el.querySelector(s);
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const nowISO = () => new Date().toISOString();
  const fmt = n => Intl.NumberFormat('en', { notation: 'compact' }).format(n ?? 0);

  // GitHub Pages 서브패스 자동 인식(/user/repo/) + 로컬(/)
  const seg = location.pathname.split("/").filter(Boolean)[0];
  const BASE = seg ? `/${seg}/` : "/";
  const DATA = `${BASE}data/`;

  // localStorage (TTL 캐시)
  const cache = {
    get(k) { try{ const o = JSON.parse(localStorage.getItem(k) || "null"); if(!o) return null; if (o.exp && Date.now() > o.exp) { localStorage.removeItem(k); return null; } return o.val; } catch { return null; } },
    set(k, v, ttlMs) { const o = { val: v }; if (ttlMs) o.exp = Date.now() + ttlMs; localStorage.setItem(k, JSON.stringify(o)); },
    del(k){ localStorage.removeItem(k); }
  };

  async function getJSON(url, { ttl = 5 * 60_000, bust = false, key = url, fallback = null } = {}) {
    if (!bust) {
      const c = cache.get(key);
      if (c) return c;
    }
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cache.set(key, data, ttl);
      return data;
    } catch (e) {
      console.warn(`⚠️ ${url} 로드 실패 → fallback 사용`, e.message);
      return fallback;
    }
  }

  // ========== Prefs (메모리) ==========
  const MEMKEY = "ai_dash_prefs_v1";
  const prefs = Object.assign({
    repoSort: "stars",
    q: "",
    hiddenNews: {},   // {id:true}
    bookmarked: {},   // {id:true}
    seenNews: {}      // {id: ISO}
  }, cache.get(MEMKEY) || {});
  const savePrefs = () => cache.set(MEMKEY, prefs);

  // ========== DOM refs ==========
  const elPlatform = $("#platformList");
  const elRepo = $("#repoList");
  const elNews = $("#newsList");
  const elNote = $("#noteBox");
  const elNoteDate = $("#noteDate");
  const elRepoSort = $("#repoSort");
  const elQ = $("#q");

  elRepoSort.value = prefs.repoSort;
  elQ.value = prefs.q;

  // ========== Load all data ==========
  async function loadAll({ bust = false } = {}) {
    // 404일 때 화면만 보이는 임시 데이터
    const fallbackPlatforms = [
      { id:"OpenAI", name:"OpenAI", url:"https://openai.com", stars7d: 0, ghTrend: 0, webTrend: 0, score: 87, tagline:"Frontier model & API" },
      { id:"Anthropic", name:"Anthropic", url:"https://www.anthropic.com", score: 79, tagline:"Claude family" },
      { id:"Google", name:"Google DeepMind", url:"https://deepmind.google", score: 76, tagline:"Gemini, Veo" }
    ];
    const fallbackNews = { items: [
      { id:"ex1", title:"Sample: AI industry roundup", url:"#", summary:"데이터 파일이 없어 화면 임시 데이터로 렌더링 중입니다.", source:"sample.local", ts: nowISO(), score:1 },
      { id:"ex2", title:"Sample: New model release spotted", url:"#", summary:"워크플로가 news_current.json을 생성하면 자동 대체됩니다.", source:"sample.local", ts: nowISO(), score:1 }
    ]};

    const [
      platforms,
      platformsPrev,
      newsCurrent,
      newsSnaps,
      aiNote,
      ghRepos // 선택사항: 수집 파이프라인에서 생성 시 사용
    ] = await Promise.all([
      getJSON(`${DATA}platform_rankings.json`, { ttl: 30*60_000, bust, fallback: fallbackPlatforms }),
      getJSON(`${DATA}platform_rankings.prev.json`, { ttl: 30*60_000, bust, fallback: null }),
      getJSON(`${DATA}news_current.json`, { ttl: 10*60_000, bust, fallback: fallbackNews }),
      getJSON(`${DATA}news_snapshots.json`, { ttl: 6*60_000, bust, fallback: {items:[]} }),
      getJSON(`${DATA}ai_note.json`, { ttl: 10*60_000, bust, fallback: null }),
      getJSON(`${DATA}snapshots.json`, { ttl: 30*60_000, bust, fallback: null }),
    ]);

    return { platforms, platformsPrev, newsCurrent, newsSnaps, aiNote, ghRepos };
  }

  // ========== Platform ranking ==========
  const upIcon   = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 4l6 6h-4v6H10V10H6l6-6z"/></svg>`;
  const downIcon = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="transform:scaleY(-1)"><path d="M12 4l6 6h-4v6H10V10H6l6-6z"/></svg>`;
  const flatIcon = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M4 12h16v2H4z"/></svg>`;

  const scorePlatform = p => typeof p.score === "number"
    ? p.score
    : Math.round((p.stars7d ?? 0)*0.6 + (p.ghTrend ?? 0)*0.3 + (p.webTrend ?? 0)*0.1);

  function deltaFromPrev(cur, prevMap){
    if(!prevMap) return null;
    const key = cur.id || cur.name;
    const prev = prevMap.get(key);
    if(!prev) return null;
    const d = scorePlatform(cur) - scorePlatform(prev);
    if (d === 0) return { dir:"flat", val:0 };
    return { dir: d>0 ? "up" : "down", val: Math.abs(d) };
  }

  function renderPlatforms(platforms, platformsPrev){
    const prevMap = platformsPrev ? new Map(platformsPrev.map(p=>[(p.id||p.name), p])) : null;
    const ranked = (platforms||[])
      .map(p => ({ ...p, _score: scorePlatform(p), _delta: deltaFromPrev(p, prevMap)}))
      .sort((a,b)=> b._score - a._score)
      .slice(0, 20);

    elPlatform.innerHTML = ranked.map((p,i)=>{
      const d = p._delta;
      const arrow = d?.dir==="up" ? upIcon : d?.dir==="down" ? downIcon : flatIcon;
      const delta = d ? `<span class="change ${d.dir}">${arrow}<span> ${d.val}</span></span>` : "";
      const sub = [p.tagline || p.desc || "", p.url ? new URL(p.url).hostname : ""].filter(Boolean).join(" · ");
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
            <div class="kpi">${p._score}</div>
            ${delta}
          </div>
        </li>
      `;
    }).join("");
  }

  // ========== GitHub AI (프론트 표시 전용; 실제 데이터는 수집 파이프라인에서) ==========
  function computeRepoScore(r, mode){
    if (mode==="commits") return r.commits30d ?? 0;
    if (mode==="releases") return r.releases90d ?? 0;
    return r.stars7d ?? r.stargazers_count ?? 0; // default
  }

  function renderRepos(repos, mode, q){
    const list = (repos && (repos.items || repos)) || [];
    const normQ = (q||"").trim().toLowerCase();
    const filtered = list.filter(r=>{
      if(!normQ) return true;
      const hay = [r.full_name, r.name, r.description, (r.topics||[]).join(" ")].join(" ").toLowerCase();
      return hay.includes(normQ);
    });
    const sorted = filtered
      .map(r => ({...r, _score: computeRepoScore(r, mode)}))
      .sort((a,b)=> b._score - a._score)
      .slice(0, 30);

    $("#repoList").innerHTML = sorted.length
      ? sorted.map(r=>{
          const meta = [
            r.language,
            r.license?.spdx_id,
            r._score ? `${mode}:${fmt(r._score)}` : null
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
        }).join("")
      : `<div class="mut">수집된 GitHub 데이터가 없습니다.</div>`;
  }

  // ========== AI NEWS ==========
  const by = (arr, keyer) => { const s=new Set(), out=[]; for(const x of arr){ const k=keyer(x); if(s.has(k)) continue; s.add(k); out.push(x);} return out; };
  const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ""; } };

  function normalizeNews(news){
    const items = (news && (news.items||news)) || [];
    return items.map((n,i)=>({
      id: n.id || n.url || `n${i}`,
      title: n.title || n.headline || "(제목 없음)",
      url: n.url || "#",
      summary: n.summary || n.desc || "",
      source: n.source || domainOf(n.url || ""),
      ts: n.ts || n.date || n.published_at || "",
      score: n.score ?? 0
    }));
  }

  function renderNews(news, q){
    const items0 = normalizeNews(news);
    // 1) URL 중복 제거
    const byUrl = by(items0, x=>x.url||x.id);
    // 2) 도메인별 최대 3건
    const domainCount = {};
    const trimmed = [];
    for(const it of byUrl){
      const d = it.source || domainOf(it.url);
      domainCount[d] = (domainCount[d]||0) + 1;
      if (domainCount[d] <= 3) trimmed.push(it);
    }
    // 3) 검색
    const normQ = (q||"").trim().toLowerCase();
    let arr = trimmed.filter(n=>{
      if(!normQ) return true;
      const hay = [n.title, n.summary, n.source].join(" ").toLowerCase();
      return hay.includes(normQ);
    });
    // 4) 숨김 적용
    arr = arr.filter(n => !prefs.hiddenNews[n.id]);
    // 5) 정렬: score > 최신
    arr.sort((a,b) => (b.score - a.score) || String(b.ts).localeCompare(String(a.ts)));

    elNews.innerHTML = arr.map(n=>{
      const bookmarked = !!prefs.bookmarked[n.id];
      const seen = prefs.seenNews[n.id];
      const meta = [ n.source, n.ts ? new Date(n.ts).toLocaleString() : "" ].filter(Boolean).join(" · ");
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

    // 액션
    elNews.onclick = (e)=>{
      const btn = e.target.closest("button[data-act]");
      if(!btn) return;
      const { act, id } = btn.dataset;
      if(act==="hide"){ prefs.hiddenNews[id]=true; savePrefs(); renderNews(news, elQ.value); }
      if(act==="bookmark"){ prefs.bookmarked[id]=!prefs.bookmarked[id]; savePrefs(); renderNews(news, elQ.value); }
    };
    elNews.addEventListener("click", (e)=>{
      const a = e.target.closest("a[href]");
      if(!a) return;
      const card = a.closest("article");
      const id = card?.querySelector('button[data-id]')?.dataset.id;
      if(id){ prefs.seenNews[id]=nowISO(); savePrefs(); }
    }, {capture:true});
  }

  // ========== AI NOTE ==========
  function renderNote(aiNote, news, repos){
    elNoteDate.textContent = todayISO();
    // 서버 생성 노트가 있으면 우선 사용
    if (aiNote && (aiNote.html || aiNote.markdown || aiNote.text)){
      if (aiNote.html){ elNote.innerHTML = aiNote.html; return; }
      const txt = aiNote.markdown || aiNote.text;
      elNote.innerHTML = `<pre style="white-space:pre-wrap">${txt}</pre>`;
      return;
    }
    // 임시 인사이트 (요약 아님: 신호 나열)
    const items = normalizeNews(news).slice(0,8);
    const bullets = items.map(n=>`- ${n.title} (${n.source})`).join("\n");
    elNote.innerHTML = `
      <div class="mut">서버 AI 노트(ai_note.json)가 없어 임시로 생성된 클라이언트 노트입니다.</div>
      <h3>오늘의 핵심 신호</h3>
      <pre style="white-space:pre-wrap">${bullets}</pre>
    `;
  }

  // ========== Glue ==========
  function apply(state){
    renderPlatforms(state.platforms, state.platformsPrev);
    renderRepos(state.ghRepos||[], elRepoSort.value, elQ.value);
    renderNews(state.newsCurrent, elQ.value);
    renderNote(state.aiNote, state.newsCurrent, state.ghRepos);
  }

  let state = null;
  (async () => {
    try{
      state = await loadAll({ bust:false });
      apply(state);
    }catch(e){
      console.error(e);
      $("#grid").insertAdjacentHTML("afterbegin",
        `<div class="card" style="grid-column:1/-1;color:#dc2626;">데이터 로드 오류: ${e.message}</div>`);
    }
  })();

  // 이벤트
  elRepoSort.onchange = () => { prefs.repoSort = elRepoSort.value; savePrefs(); apply(state); };
  elQ.oninput = (e) => { prefs.q = e.target.value; savePrefs(); apply(state); };

  // 새로고침 버튼은 HTML에서 location.reload 사용
  // 단축키: CMD/CTRL+K → 검색창 포커스
  window.addEventListener('keydown', (e)=>{
    if((e.ctrlKey||e.metaKey) && e.key==='k'){ e.preventDefault(); elQ.focus(); }
  });
})();
/* app.js — client-only, single file
   - 데이터 경로: /data/*.json  (리포의 public/data/* 가 Pages에선 /<repo>/data/* 로 노출)
   - 파일이 404면 화면에서만 보이는 임시 데이터로 대체 (저장은 안 함)
   - 기능: 플랫폼 스코어링/전일대비, GitHub 정렬/검색, 뉴스 dedupe/북마크/숨김, 오늘의 노트, 로컬 캐시
*/
(() => {
  // ========== Utilities ==========
  const $ = (s, el = document) => el.querySelector(s);
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const nowISO = () => new Date().toISOString();
  const fmt = n => Intl.NumberFormat('en', { notation: 'compact' }).format(n ?? 0);

  // GitHub Pages 서브패스 자동 인식(/user/repo/) + 로컬(/)
  const seg = location.pathname.split("/").filter(Boolean)[0];
  const BASE = seg ? `/${seg}/` : "/";
  const DATA = `${BASE}data/`;

  // localStorage (TTL 캐시)
  const cache = {
    get(k) { try{ const o = JSON.parse(localStorage.getItem(k) || "null"); if(!o) return null; if (o.exp && Date.now() > o.exp) { localStorage.removeItem(k); return null; } return o.val; } catch { return null; } },
    set(k, v, ttlMs) { const o = { val: v }; if (ttlMs) o.exp = Date.now() + ttlMs; localStorage.setItem(k, JSON.stringify(o)); },
    del(k){ localStorage.removeItem(k); }
  };

  async function getJSON(url, { ttl = 5 * 60_000, bust = false, key = url, fallback = null } = {}) {
    if (!bust) {
      const c = cache.get(key);
      if (c) return c;
    }
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cache.set(key, data, ttl);
      return data;
    } catch (e) {
      console.warn(`⚠️ ${url} 로드 실패 → fallback 사용`, e.message);
      return fallback;
    }
  }

  // ========== Prefs (메모리) ==========
  const MEMKEY = "ai_dash_prefs_v1";
  const prefs = Object.assign({
    repoSort: "stars",
    q: "",
    hiddenNews: {},   // {id:true}
    bookmarked: {},   // {id:true}
    seenNews: {}      // {id: ISO}
  }, cache.get(MEMKEY) || {});
  const savePrefs = () => cache.set(MEMKEY, prefs);

  // ========== DOM refs ==========
  const elPlatform = $("#platformList");
  const elRepo = $("#repoList");
  const elNews = $("#newsList");
  const elNote = $("#noteBox");
  const elNoteDate = $("#noteDate");
  const elRepoSort = $("#repoSort");
  const elQ = $("#q");

  elRepoSort.value = prefs.repoSort;
  elQ.value = prefs.q;

  // ========== Load all data ==========
  async function loadAll({ bust = false } = {}) {
    // 404일 때 화면만 보이는 임시 데이터
    const fallbackPlatforms = [
      { id:"OpenAI", name:"OpenAI", url:"https://openai.com", stars7d: 0, ghTrend: 0, webTrend: 0, score: 87, tagline:"Frontier model & API" },
      { id:"Anthropic", name:"Anthropic", url:"https://www.anthropic.com", score: 79, tagline:"Claude family" },
      { id:"Google", name:"Google DeepMind", url:"https://deepmind.google", score: 76, tagline:"Gemini, Veo" }
    ];
    const fallbackNews = { items: [
      { id:"ex1", title:"Sample: AI industry roundup", url:"#", summary:"데이터 파일이 없어 화면 임시 데이터로 렌더링 중입니다.", source:"sample.local", ts: nowISO(), score:1 },
      { id:"ex2", title:"Sample: New model release spotted", url:"#", summary:"워크플로가 news_current.json을 생성하면 자동 대체됩니다.", source:"sample.local", ts: nowISO(), score:1 }
    ]};

    const [
      platforms,
      platformsPrev,
      newsCurrent,
      newsSnaps,
      aiNote,
      ghRepos // 선택사항: 수집 파이프라인에서 생성 시 사용
    ] = await Promise.all([
      getJSON(`${DATA}platform_rankings.json`, { ttl: 30*60_000, bust, fallback: fallbackPlatforms }),
      getJSON(`${DATA}platform_rankings.prev.json`, { ttl: 30*60_000, bust, fallback: null }),
      getJSON(`${DATA}news_current.json`, { ttl: 10*60_000, bust, fallback: fallbackNews }),
      getJSON(`${DATA}news_snapshots.json`, { ttl: 6*60_000, bust, fallback: {items:[]} }),
      getJSON(`${DATA}ai_note.json`, { ttl: 10*60_000, bust, fallback: null }),
      getJSON(`${DATA}snapshots.json`, { ttl: 30*60_000, bust, fallback: null }),
    ]);

    return { platforms, platformsPrev, newsCurrent, newsSnaps, aiNote, ghRepos };
  }

  // ========== Platform ranking ==========
  const upIcon   = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 4l6 6h-4v6H10V10H6l6-6z"/></svg>`;
  const downIcon = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="transform:scaleY(-1)"><path d="M12 4l6 6h-4v6H10V10H6l6-6z"/></svg>`;
  const flatIcon = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M4 12h16v2H4z"/></svg>`;

  const scorePlatform = p => typeof p.score === "number"
    ? p.score
    : Math.round((p.stars7d ?? 0)*0.6 + (p.ghTrend ?? 0)*0.3 + (p.webTrend ?? 0)*0.1);

  function deltaFromPrev(cur, prevMap){
    if(!prevMap) return null;
    const key = cur.id || cur.name;
    const prev = prevMap.get(key);
    if(!prev) return null;
    const d = scorePlatform(cur) - scorePlatform(prev);
    if (d === 0) return { dir:"flat", val:0 };
    return { dir: d>0 ? "up" : "down", val: Math.abs(d) };
  }

  function renderPlatforms(platforms, platformsPrev){
    const prevMap = platformsPrev ? new Map(platformsPrev.map(p=>[(p.id||p.name), p])) : null;
    const ranked = (platforms||[])
      .map(p => ({ ...p, _score: scorePlatform(p), _delta: deltaFromPrev(p, prevMap)}))
      .sort((a,b)=> b._score - a._score)
      .slice(0, 20);

    elPlatform.innerHTML = ranked.map((p,i)=>{
      const d = p._delta;
      const arrow = d?.dir==="up" ? upIcon : d?.dir==="down" ? downIcon : flatIcon;
      const delta = d ? `<span class="change ${d.dir}">${arrow}<span> ${d.val}</span></span>` : "";
      const sub = [p.tagline || p.desc || "", p.url ? new URL(p.url).hostname : ""].filter(Boolean).join(" · ");
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
            <div class="kpi">${p._score}</div>
            ${delta}
          </div>
        </li>
      `;
    }).join("");
  }

  // ========== GitHub AI (프론트 표시 전용; 실제 데이터는 수집 파이프라인에서) ==========
  function computeRepoScore(r, mode){
    if (mode==="commits") return r.commits30d ?? 0;
    if (mode==="releases") return r.releases90d ?? 0;
    return r.stars7d ?? r.stargazers_count ?? 0; // default
  }

  function renderRepos(repos, mode, q){
    const list = (repos && (repos.items || repos)) || [];
    const normQ = (q||"").trim().toLowerCase();
    const filtered = list.filter(r=>{
      if(!normQ) return true;
      const hay = [r.full_name, r.name, r.description, (r.topics||[]).join(" ")].join(" ").toLowerCase();
      return hay.includes(normQ);
    });
    const sorted = filtered
      .map(r => ({...r, _score: computeRepoScore(r, mode)}))
      .sort((a,b)=> b._score - a._score)
      .slice(0, 30);

    $("#repoList").innerHTML = sorted.length
      ? sorted.map(r=>{
          const meta = [
            r.language,
            r.license?.spdx_id,
            r._score ? `${mode}:${fmt(r._score)}` : null
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
        }).join("")
      : `<div class="mut">수집된 GitHub 데이터가 없습니다.</div>`;
  }

  // ========== AI NEWS ==========
  const by = (arr, keyer) => { const s=new Set(), out=[]; for(const x of arr){ const k=keyer(x); if(s.has(k)) continue; s.add(k); out.push(x);} return out; };
  const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ""; } };

  function normalizeNews(news){
    const items = (news && (news.items||news)) || [];
    return items.map((n,i)=>({
      id: n.id || n.url || `n${i}`,
      title: n.title || n.headline || "(제목 없음)",
      url: n.url || "#",
      summary: n.summary || n.desc || "",
      source: n.source || domainOf(n.url || ""),
      ts: n.ts || n.date || n.published_at || "",
      score: n.score ?? 0
    }));
  }

  function renderNews(news, q){
    const items0 = normalizeNews(news);
    // 1) URL 중복 제거
    const byUrl = by(items0, x=>x.url||x.id);
    // 2) 도메인별 최대 3건
    const domainCount = {};
    const trimmed = [];
    for(const it of byUrl){
      const d = it.source || domainOf(it.url);
      domainCount[d] = (domainCount[d]||0) + 1;
      if (domainCount[d] <= 3) trimmed.push(it);
    }
    // 3) 검색
    const normQ = (q||"").trim().toLowerCase();
    let arr = trimmed.filter(n=>{
      if(!normQ) return true;
      const hay = [n.title, n.summary, n.source].join(" ").toLowerCase();
      return hay.includes(normQ);
    });
    // 4) 숨김 적용
    arr = arr.filter(n => !prefs.hiddenNews[n.id]);
    // 5) 정렬: score > 최신
    arr.sort((a,b) => (b.score - a.score) || String(b.ts).localeCompare(String(a.ts)));

    elNews.innerHTML = arr.map(n=>{
      const bookmarked = !!prefs.bookmarked[n.id];
      const seen = prefs.seenNews[n.id];
      const meta = [ n.source, n.ts ? new Date(n.ts).toLocaleString() : "" ].filter(Boolean).join(" · ");
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

    // 액션
    elNews.onclick = (e)=>{
      const btn = e.target.closest("button[data-act]");
      if(!btn) return;
      const { act, id } = btn.dataset;
      if(act==="hide"){ prefs.hiddenNews[id]=true; savePrefs(); renderNews(news, elQ.value); }
      if(act==="bookmark"){ prefs.bookmarked[id]=!prefs.bookmarked[id]; savePrefs(); renderNews(news, elQ.value); }
    };
    elNews.addEventListener("click", (e)=>{
      const a = e.target.closest("a[href]");
      if(!a) return;
      const card = a.closest("article");
      const id = card?.querySelector('button[data-id]')?.dataset.id;
      if(id){ prefs.seenNews[id]=nowISO(); savePrefs(); }
    }, {capture:true});
  }

  // ========== AI NOTE ==========
  function renderNote(aiNote, news, repos){
    elNoteDate.textContent = todayISO();
    // 서버 생성 노트가 있으면 우선 사용
    if (aiNote && (aiNote.html || aiNote.markdown || aiNote.text)){
      if (aiNote.html){ elNote.innerHTML = aiNote.html; return; }
      const txt = aiNote.markdown || aiNote.text;
      elNote.innerHTML = `<pre style="white-space:pre-wrap">${txt}</pre>`;
      return;
    }
    // 임시 인사이트 (요약 아님: 신호 나열)
    const items = normalizeNews(news).slice(0,8);
    const bullets = items.map(n=>`- ${n.title} (${n.source})`).join("\n");
    elNote.innerHTML = `
      <div class="mut">서버 AI 노트(ai_note.json)가 없어 임시로 생성된 클라이언트 노트입니다.</div>
      <h3>오늘의 핵심 신호</h3>
      <pre style="white-space:pre-wrap">${bullets}</pre>
    `;
  }

  // ========== Glue ==========
  function apply(state){
    renderPlatforms(state.platforms, state.platformsPrev);
    renderRepos(state.ghRepos||[], elRepoSort.value, elQ.value);
    renderNews(state.newsCurrent, elQ.value);
    renderNote(state.aiNote, state.newsCurrent, state.ghRepos);
  }

  let state = null;
  (async () => {
    try{
      state = await loadAll({ bust:false });
      apply(state);
    }catch(e){
      console.error(e);
      $("#grid").insertAdjacentHTML("afterbegin",
        `<div class="card" style="grid-column:1/-1;color:#dc2626;">데이터 로드 오류: ${e.message}</div>`);
    }
  })();

  // 이벤트
  elRepoSort.onchange = () => { prefs.repoSort = elRepoSort.value; savePrefs(); apply(state); };
  elQ.oninput = (e) => { prefs.q = e.target.value; savePrefs(); apply(state); };

  // 새로고침 버튼은 HTML에서 location.reload 사용
  // 단축키: CMD/CTRL+K → 검색창 포커스
  window.addEventListener('keydown', (e)=>{
    if((e.ctrlKey||e.metaKey) && e.key==='k'){ e.preventDefault(); elQ.focus(); }
  });
})();
