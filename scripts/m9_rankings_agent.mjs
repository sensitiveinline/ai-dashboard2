import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SNAP = path.join(ROOT, 'public', 'data', 'snapshots.json');
const OUT  = path.join(ROOT, 'public', 'data', 'platform_rankings.json');
const PREV = path.join(ROOT, 'public', 'data', 'platform_rankings.prev.json');
const CFG  = path.join(ROOT, 'config', 'platforms.yml');

function yamlParse(txt){
  const platforms=[]; const weights={};
  let mode='';
  for(const L of txt.split('\n')){
    const s=L.trim(); if(!s) continue;
    if(s==='platforms:'){ mode='p'; continue; }
    if(s==='weights:'){ mode='w'; continue; }
    if(mode==='p' && s.startsWith('- ')){
      const id = s.split(':')[1].trim();
      // 다음 줄들 읽기 간단 파서
    }
  }
  // 더 안전한 단순 파서
  const lines = txt.split('\n'); let arr=[];
  for(let i=0;i<lines.length;i++){
    const L=lines[i].trim();
    if(L.startsWith('- id:')){
      const id=L.split(':')[1].trim();
      const name=lines[++i].split(':')[1].trim();
      const repos=(lines[++i].split(':')[1]||'').replace(/[\[\]]/g,'').split(',').map(s=>s.trim()).filter(Boolean);
      const keywords=(lines[++i].split(':')[1]||'').replace(/[\[\]]/g,'').split(',').map(s=>s.trim()).filter(Boolean);
      arr.push({id,name,repos,keywords});
    }
    if(L.startsWith('interest:')) weights.interest=Number(L.split(':')[1]);
    if(L.startsWith('community:')) weights.community=Number(L.split(':')[1]);
    if(L.startsWith('updates:')) weights.updates=Number(L.split(':')[1]);
  }
  return {platforms:arr, weights};
}

async function run(){
  const cfg = yamlParse(await fs.readFile(CFG,'utf8'));
  let snap = {results:[]};
  try{ snap = JSON.parse(await fs.readFile(SNAP,'utf8')); }catch{}

  const news = (snap.results||[]).find(x=>x.from==='news')?.items||[];
  const gh   = (snap.results||[]).find(x=>x.from==='github')?.items||[];

  const items = cfg.platforms.map(p=>{
    // interest: 해당 플랫폼 키워드가 제목/요약/태그에 몇 번 등장했는지(최근 뉴스)
    const interest = news.reduce((acc,n)=>{
      const blob = `${n.title||''} ${n.summary||''} ${(n.tags||[]).join(' ')}`.toLowerCase();
      return acc + (p.keywords.some(k=>blob.includes(k.toLowerCase())) ? 1 : 0);
    },0);

    // community: 관련 레포의 7일 병합 PR 수 합
    const prs = gh
      .filter(r=>p.repos.includes(r.id))
      .reduce((a,r)=>a+(r.prs_merged||0),0);

    // updates: 관련 레포의 7일 릴리즈 수 합
    const rel = gh
      .filter(r=>p.repos.includes(r.id))
      .reduce((a,r)=>a+(r.releases||0),0);

    const scoreRaw = cfg.weights.interest*interest + cfg.weights.community*prs + cfg.weights.updates*rel;
    const score = Math.round(scoreRaw);
    return {
      platform: p.name,
      score,
      breakdown: { interest, community: prs, updates: rel },
      delta_7d: 0
    };
  });

  // 이전 점수와 비교해 delta_7d 근사
  try{
    const prev = JSON.parse(await fs.readFile(OUT,'utf8'));
    items.forEach(it=>{
      const old = (prev.items||[]).find(x=>x.platform===it.platform);
      if(old) it.delta_7d = Math.round(it.score - (old.score||0));
    });
    await fs.writeFile(PREV, JSON.stringify(prev,null,2));
  }catch{}

  const out = { generated_at: new Date().toISOString(), items };
  await fs.writeFile(OUT, JSON.stringify(out,null,2),'utf8');
  console.log(`✔ platform_rankings.json updated (${items.length} platforms)`);
}

run().catch(e=>{ console.error(e); process.exit(1); });
