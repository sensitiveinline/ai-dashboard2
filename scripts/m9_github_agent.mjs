import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const OUT  = path.join(ROOT, 'public', 'data', 'snapshots.json');
const SRC  = path.join(ROOT, 'scripts', 'm9_repos.yml');

const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

const nowISO = ()=> new Date().toISOString();
const sinceDate = new Date(Date.now() - 7*24*3600*1000).toISOString();

function yamlParse(txt){
  const out = { repos: [] };
  let sec = null;
  txt.split('\n').forEach(line=>{
    const s = line.trim();
    if(!s) return;
    if(s.endsWith(':')) { sec = s.slice(0,-1); if(!out[sec]) out[sec]=[]; return; }
    if(s.startsWith('- ')){
      const kv = {};
      s.slice(2).split(/\s+/).forEach(tok=>{
        const m = tok.match(/^(\w+):(.+)$/);
        if(m) kv[m[1]] = m[2];
      });
      // 단순 파서라서 owner/name 형태는 아래처럼 다시 파싱
    }
  });
  // 더 단순/안전: 직접 파싱
  const lines = txt.split('\n'); let arr = [];
  for (let i=0;i<lines.length;i++){
    const L = lines[i].trim();
    if(L.startsWith('- owner:')){
      const owner = L.split(':')[1].trim();
      const name = lines[++i].split(':')[1].trim();
      const tags = (lines[++i].split(':')[1]||'').trim().replace(/[\[\]]/g,'').split(',').map(s=>s.trim()).filter(Boolean);
      arr.push({owner, name, tags});
    }
  }
  out.repos = arr;
  return out;
}

async function gh(pathname){
  const r = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      ...(GH_TOKEN ? {'Authorization': `Bearer ${GH_TOKEN}`} : {})
    }
  });
  if(!r.ok) throw new Error(`${r.status} ${pathname}`);
  return r.json();
}

async function repoStats(r){
  const full = `${r.owner}/${r.name}`;
  // 7일간 머지된 PR 수 (Search API total_count)
  let prs = 0;
  try{
    const q = `repo:${full}+is:pr+is:merged+merged:>=${sinceDate.slice(0,10)}`;
    const s = await gh(`/search/issues?q=${encodeURIComponent(q)}&per_page=1`);
    prs = s.total_count || 0;
  }catch{}
  // 7일간 릴리즈 수
  let releases = 0;
  try{
    const rel = await gh(`/repos/${full}/releases?per_page=20`);
    releases = (rel || []).filter(x => new Date(x.published_at) >= new Date(sinceDate)).length;
  }catch{}
  // 스타 수(현재 총합) — 델타는 추후 prev와 비교하여 계산 가능
  let stars = 0;
  try{
    const info = await gh(`/repos/${full}`);
    stars = info.stargazers_count || 0;
  }catch{}
  return {
    id: full,
    title: r.name,
    stars_delta: 0,          // 델타는 보수적으로 0으로 두고, M10에서 추후 prev 비교 가능
    prs_merged: prs,
    releases: releases,
    tags: r.tags || [],
    url: `https://github.com/${full}`,
    pros: ['활동 증가'],
    cons: ['메타데이터 보강 필요']
  };
}

async function run(){
  // 레포 목록
  const yml = await fs.readFile(SRC,'utf8');
  const { repos=[] } = yamlParse(yml);

  // 수집
  const items = [];
  for(const r of repos){
    try{
      const stat = await repoStats(r);
      items.push(stat);
      await new Promise(res=>setTimeout(res, 250));
    }catch(e){
      console.error('repo fail:', r, e.message);
    }
  }

  // snapshots 합치기 (news 유지, github 교체)
  let base = { generated_at: nowISO(), results: [] };
  try{
    const cur = JSON.parse(await fs.readFile(OUT,'utf8'));
    base = cur && typeof cur==='object' ? cur : base;
  }catch{}
  const others = (base.results||[]).filter(x=>x.from!=='github');
  const results = [...others, { from: 'github', items }];
  const final = { generated_at: nowISO(), results };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(final, null, 2), 'utf8');
  console.log(`✔ snapshots.json[github] updated: ${items.length} repos`);
}

run().catch(e=>{ console.error(e); process.exit(1); });
