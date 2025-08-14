console.log('AI-Dashboard build: 20250814-090556');
// ---- safe utils ----
function toArray(x){ if(Array.isArray(x))return x; if(x&&Array.isArray(x.items))return x.items; if(x&&typeof x==="object"){const v=Object.values(x); if(v.length===1&&Array.isArray(v[0])) return v[0]; return v;} return []; }
function assertArray(label,v){ if(!Array.isArray(v)) console.warn(`[warn]  expected array, got:`, v); }

console.log("APP_JS_VERSION","v-fix-terminal");
console.log("APP_JS_VERSION","v-clean-PLAT-003");
// ===== AI Dashboard app.js (clean reset) =====
console.log("APP_JS_VERSION","v-clean-PLAT-003");

// ---------- Utils ----------
function asArr(x){ return Array.isArray(x) ? x : ((x && x.items) || []); }
const $ = (sel, root=document) => root.querySelector(sel);

// Optional SVG icons (심플)
const upIcon   = '▲';
const downIcon = '▼';
const flatIcon = '—';

// ---------- Scoring ----------
function scorePlatform(p){
  const s7  = Number(p.stars7d   ?? p.stars_7d   ?? 0);
  const s30 = Number(p.stars30d  ?? p.stars_30d  ?? 0);
  const m   = Number(p.mentions  ?? 0);
  const tr  = Number(p.trend     ?? 0);
  return s7*3 + s30*1 + m*0.5 + tr*2;
}

function deltaFromPrev(cur, prevMap){
  if(!prevMap) return null;
  const key  = cur.id || cur.name;
  const prev = key ? prevMap.get(key) : null;
  if(!prev) return null;
  const d = scorePlatform(cur) - scorePlatform(prev);
  if (d === 0) return { dir:"flat", val:0 };
  return { dir: d>0 ? "up" : "down", val: Math.abs(d) };
}

// ---------- Render: Platforms (single definition) ----------
function renderPlatforms(platforms, platformsPrev){
  platforms = toArray(platforms);
  platformsPrev = toArray(platformsPrev);

  console.debug("[renderPlatforms call]", {ap:Array.isArray(platforms), an:Array.isArray(platformsPrev), lenP:platforms?.length??null, lenN:platformsPrev?.length??null});

  // 계약 보장(추가 안전망): 어떤 입력이 와도 배열
  platforms     = asArr(platforms);
  platformsPrev = asArr(platformsPrev);

  // prevMap을 .map 없이 안전하게 구성
  const prevArr = asArr(platformsPrev);
  let prevMap = null;
  if (prevArr.length){
    prevMap = new Map();
    for (const p of prevArr){
      const key = p.id || p.name;
      if (key) prevMap.set(key, p);
    }
  }

  const ranked = platforms
    .map(p => ({ 
      ...p, 
      _score: scorePlatform(p), 
      _delta: deltaFromPrev(p, prevMap) 
    }))
    .sort((a,b)=> b._score - a._score)
    .slice(0, 20);

  // 렌더 타겟 찾기 (없으면 #grid에 카드로 삽입, 그것도 없으면 그냥 종료)
  const elPlatform = $("#platforms-root") || $("#platforms") || $("#grid");
  if (!elPlatform) return;

  // 간단 카드 UI
  const rows = ranked.map((p, i) => {
    const d = p._delta;
    const badge = !d ? flatIcon : (d.dir === "up" ? upIcon : (d.dir === "down" ? downIcon : flatIcon));
    const score = (p._score ?? 0).toFixed(2);
    return `
      <div class="row" style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.06);">
        <div style="width:24px;opacity:.7">${i+1}</div>
        <div style="flex:1;font-weight:600">${p.name || p.id || "(unknown)"}</div>
        <div style="width:48px;text-align:center">${badge}</div>
        <div style="width:72px;text-align:right;opacity:.8">${score}</div>
      </div>`;
  }).join("");

  const html = `
    <div class="card" style="padding:16px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.06);background:#fff;">
      <div style="font-weight:700;margin-bottom:8px">AI 플랫폼 순위 (Top 20)</div>
      <div>${rows || '<div style="opacity:.6">표시할 데이터가 없습니다.</div>'}</div>
    </div>
  `;

  // #grid가 있으면 카드 하나로 넣고, #platforms-root면 내용만 교체
  if (elPlatform.id === "grid"){
    // grid면 카드 추가(존재 카드 교체를 원하면 필요에 맞게 수정)
    elPlatform.insertAdjacentHTML("afterbegin", html);
  } else {
    elPlatform.innerHTML = html;
  }
}

// ---------- Render: Stubs (크래시 방지용, 원하면 구현 대체) ----------
function renderRepos(repos=[], sort="stars", q=""){ /* no-op safe */ }
function renderNews(news=[], q=""){ /* no-op safe */ }
function renderNote(aiNote=[], news=[], repos=[]){ /* no-op safe */ }

// ---------- Data Loader ----------
async function loadJSON(url, {bust=false} = {}){
  const u = bust ? `${url}?b=${Date.now()}` : url;
  const res = await fetch(u);
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

async function loadAll({bust=false} = {}){
  const [curRaw, prevRaw, news, ghRepos, aiNote] = await Promise.all([
    loadJSON("data/platform_rankings.json",      {bust}),
    loadJSON("data/platform_rankings.prev.json", {bust}),
    loadJSON("data/news_snapshots.json",         {bust}),
    loadJSON("data/gh_repos.json",               {bust}),
    loadJSON("data/ai_note.json",                {bust}),
  ]);

  // ✅ 계약 원천 보장: 최상위는 항상 배열
  const platforms     = asArr(curRaw  || []);
  const platformsPrev = asArr(prevRaw || []);
assertArray("platformsPrev", platformsPrev);

  return {
    platforms,
    platformsPrev,
    newsCurrent: Array.isArray(news) ? news : [],
    ghRepos: Array.isArray(ghRepos) ? ghRepos : [],
    aiNote: Array.isArray(aiNote) ? aiNote : (aiNote ? [aiNote] : []),
  };
}

// ---------- Glue ----------
function apply(state){
  // 호출부에서도 이중 방어(입력 보장)
  renderPlatforms(asArr(state.platforms), asArr(state.platformsPrev));
  renderRepos(state.ghRepos || [], ($("#repo-sort")?.value ?? "stars"), ($("#q")?.value ?? ""));
  renderNews(state.newsCurrent || [], ($("#q")?.value ?? ""));
  renderNote(state.aiNote || [], state.newsCurrent || [], state.ghRepos || []);
}

// ---------- Init ----------
let state = null;
(async () => {
  try{
    state = await loadAll({ bust:false });
    apply(state);
  }catch(e){
    console.error(e);
    const grid = $("#grid") || document.body;
    grid.insertAdjacentHTML("afterbegin",
      `<div class="card" style="grid-column:1/-1;color:#dc2626;padding:12px;border-radius:8px;background:#fff1f0;border:1px solid #ffccc7;">
         데이터 로드 오류: ${e?.message || e}
       </div>`);
  }
})();

// ---------- Events (존재 시에만 연결) ----------
const elRepoSort = $("#repo-sort");
const elQ = $("#q");
if (elRepoSort) elRepoSort.onchange = () => { apply(state); };
if (elQ) elQ.oninput = () => { apply(state); };

// ===== End =====

