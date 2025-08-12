// ==== M7: wire UI to data (platform_rankings.json + snapshots.json) ====

const ENDPOINTS = {
  rankings: "public/data/platform_rankings.json",
  snap:     "public/data/snapshots.json",
};

async function fetchJson(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (e) {
    console.error("fetch failed:", url, e);
    return null;
  }
}

// ---------- state ----------
let platforms = [];   // [{name, score, change7d, highlight}]
let reposBase  = [];  // [{id,title,stars,commits,releases,tags,pros,cons,url}]
let news       = [];  // [{title,source,url,date,summary}]

// ---------- dom helpers ----------
const $ = (id) => document.getElementById(id);
const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };

function changeBadge(pct = 0) {
  const up = pct > 0, flat = pct === 0;
  const cls = flat ? "flat" : (up ? "up" : "down");
  const arrow = flat
    ? `<svg viewBox="0 0 24 24"><path d="M3 12 H21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
    : `<svg viewBox="0 0 24 24" class="trend ${up ? "" : "down"}"><path d="M3 16 L9 10 L13 14 L21 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const text = `${up ? "+" : (flat ? "" : "")}${(+pct).toFixed(1)}%`;
  return `<span class="change ${cls}">${arrow}<span>${text}</span></span>`;
}

// ---------- renderers ----------
function renderPlatforms(){
  const ol = $("platformList");
  if (!ol) return;
  if (!platforms.length) { ol.innerHTML = `<li class="mut">데이터 없음</li>`; return; }
  ol.innerHTML = platforms.slice(0, 5).map((p, i) => `
    <li class="rank-item">
      <div class="rank-left">
        <div class="rank-num">${i + 1}</div>
        <div class="rank-texts">
          <div class="rank-title">${p.name}</div>
          <div class="rank-sub">${p.highlight || ""}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div class="kpi">Score ${Math.round(p.score || 0)}</div>
        ${changeBadge(p.change7d ?? 0)}
      </div>
    </li>
  `).join("");
}

function renderRepos(){
  const sort = $("repoSort")?.value || "stars";
  const q = ($("q")?.value || "").trim().toLowerCase();
  let xs = reposBase.filter(r => (r.title + r.id + (r.tags||[]).join(" ")).toLowerCase().includes(q));
  xs.sort((a,b)=>{
    if (sort === "commits")  return (b.commits  || 0) - (a.commits  || 0);
    if (sort === "releases") return (b.releases || 0) - (a.releases || 0);
    return (b.stars   || 0) - (a.stars   || 0);
  });
  const box = $("repoList");
  if (!box) return;
  if (!xs.length) { box.innerHTML = `<div class="mut">레포 데이터 없음</div>`; return; }
  box.innerHTML = xs.slice(0, 8).map((r, i) => `
    <div class="card" style="border:1px dashed var(--bd); padding:12px; margin-bottom:10px;">
      <div class="row">
        <div>
          <div class="kpi">${i + 1}. ${r.title}</div>
          <div class="mut">${r.id} · ${(r.tags || []).join(" / ")}</div>
        </div>
        <div class="mut">⭐ +${r.stars || 0} · ⟲ ${r.commits || 0} · ⎇ ${r.releases || 0}</div>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr; margin-top:8px;">
        <ul style="margin:0; padding-left:18px;">${(r.pros || []).map(x => `<li>👍 ${x}</li>`).join("")}</ul>
        <ul style="margin:0; padding-left:18px;">${(r.cons || []).map(x => `<li>👎 ${x}</li>`).join("")}</ul>
      </div>
      <div class="mut" style="margin-top:6px;"><a href="${r.url || "#"}" target="_blank" rel="noreferrer">Source</a></div>
    </div>
  `).join("");
}

function renderNews(){
  const box = $("newsList");
  if (!box) return;
  if (!news.length) { box.innerHTML = `<div class="mut">뉴스 데이터 없음</div>`; return; }
  box.innerHTML = news.map(n => `
    <div class="card" style="border:1px dashed var(--bd); padding:12px;">
      <div class="row">
        <div>
          <div class="kpi">${n.title}</div>
          <div class="mut">${n.source || ""} · ${n.date || ""}</div>
        </div>
        <a class="mut" href="${n.url || "#"}" target="_blank" rel="noreferrer">원문</a>
      </div>
      <p style="margin:6px 0 0;">${n.summary || ""}</p>
    </div>
  `).join("");
}

function renderNote(){
  const d = new Date().toISOString().slice(0,10);
  const dateEl = $("noteDate"); if (dateEl) dateEl.textContent = `Date: ${d}`;
  const topP = platforms[0] || { name: "—", highlight: "" };
  const topR = (reposBase.slice().sort((a,b)=>(b.stars||0)-(a.stars||0))[0]) || { title: "—" };
  setHTML("noteBox", `
    <div>
      <div class="kpi" style="margin-bottom:6px;">Hot Features</div>
      <ol style="margin:0; padding-left:18px;">
        <li>${topP.name} 업데이트 — 👍 ${topP.highlight || "업데이트"} / 👎 세부 문서 확인 필요</li>
        <li>GitHub: ${topR.title} — 👍 Stars↑·커밋 활발 / 👎 환경·권한 구성 필요</li>
        <li>멀티모달·에이전트 주간 강세 — 👍 사용사례 증가 / 👎 비용·품질 편차</li>
      </ol>
    </div>
  `);
}

// ---------- mapping: JSON -> state ----------
function mapFromRankings(r){
  platforms = (r?.items || []).map(x => ({
    id: (x.platform || "").toLowerCase(),
    name: x.platform,
    score: x.score,
    change7d: x.delta_7d ?? 0,
    highlight: `interest ${Math.round(x.breakdown?.interest || 0)} · community ${Math.round(x.breakdown?.community || 0)} · updates ${Math.round(x.breakdown?.updates || 0)}`,
    url: "#",
  }));
}

function mapFromSnapshot(s){
  const repos = [], newsItems = [];
  (s?.results || []).forEach(r => {
    if (r.from === "github") {
      (r.items || []).forEach(it => {
        repos.push({
          id: it.repo || "org/name",
          title: (it.repo || "repo").split("/").slice(-1)[0],
          stars: it.stars_delta || 0,
          commits: it.prs_merged || 0,      // 대용치
          releases: it.releases || 0,
          tags: ["ai","agent"],
          pros: ["활동 증가","릴리즈 감지"],
          cons: ["메타데이터 보강 필요"],
          url: it.repo ? `https://github.com/${it.repo}` : "#",
        });
      });
    }
    if (r.from === "news") {
      (r.items || []).forEach(it => {
        newsItems.push({
          title: it.title || "Untitled",
          source: "news",
          url: it.url || "#",
          date: (s.generated_at || "").slice(0,10),
          summary: it.summary || "",
        });
      });
    }
  });
  // de-dup
  const seen = new Set();
  reposBase = repos.filter(x => !seen.has(x.id) && seen.add(x.id)).slice(0, 12);
  news = newsItems.slice(0, 6);
}

// ---------- boot ----------
(async function boot(){
  // 로딩 표시
  setHTML("platformList", `<li class="mut">불러오는 중…</li>`);
  setHTML("repoList", `<div class="mut">불러오는 중…</div>`);
  setHTML("newsList", `<div class="mut">불러오는 중…</div>`);

  const [rankings, snap] = await Promise.all([
    fetchJson(ENDPOINTS.rankings),
    fetchJson(ENDPOINTS.snap),
  ]);

  if (rankings) mapFromRankings(rankings);
  if (snap)     mapFromSnapshot(snap);

  renderPlatforms();
  renderRepos();
  renderNews();
  renderNote();

  // 이벤트
  $("repoSort")?.addEventListener("change", renderRepos);
  $("q")?.addEventListener("input", renderRepos);
})();
# 리포 루트에서
nano app.js     # 위 코드로 모두 교체 → 저장(CTRL+O) → 종료(CTRL+X)

./deploy.sh     # 자동 add/commit/push
