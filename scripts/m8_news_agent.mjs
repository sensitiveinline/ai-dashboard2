// M8 News Expert & Source Manager Agent
// - RSS 수집 → 정규화 → (선택) LLM 요약/태깅 → dedup/score → snapshots.json 생성
// Node 20+

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import Parser from 'rss-parser';

// ---------- config ----------
const ROOT = path.resolve('.');
const OUT = path.join(ROOT, 'public', 'data', 'snapshots.json');
const SRC = path.join(ROOT, 'scripts', 'm8_sources.yml');

// 1) LLM 사용여부(Secrets에 OPENAI_API_KEY 설정 시 자동 사용)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const USE_LLM = Boolean(OPENAI_API_KEY);

// ---------- tiny helpers ----------
const nowISO = () => new Date().toISOString();
const dayDiff = (a,b)=> (new Date(a)-new Date(b)) / 86400000;
const toISODate = (d)=> new Date(d || Date.now()).toISOString().slice(0,10);
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

function yamlParse(txt){
  // 매우 단순한 YAML 파서(키:배열) — 복잡해지면 js-yaml 사용 권장
  const obj = {rss:[], allow_domains:[]};
  txt.split('\n').forEach(line=>{
    const s = line.trim();
    if(s.startsWith('- ')){
      const val = s.slice(2).trim();
      if(obj._section) obj[obj._section].push(val);
    }else if(s.endsWith(':')){
      obj._section = s.slice(0,-1);
      if(!obj[obj._section]) obj[obj._section]=[];
    }
  });
  delete obj._section;
  return obj;
}

function normalizeUrl(u){
  try{ return new URL(u).toString(); }catch{ return ''; }
}
function host(u){
  try{ return new URL(u).hostname.replace(/^www\./,''); }catch{ return ''; }
}

// ---------- LLM (선택) ----------
async function llmSummarizeTag(input){
  if(!USE_LLM) return {
    summary: input.title, // LLM 미사용 시 안전 기본값
    tags: ['ai'],
    score: 50
  };

  const sys = `You are a concise AI news tagger. Return JSON with keys: summary(<=2 sentences, Korean), tags(array<=5, lowercase), score(0-100).`;
  const user = `Title: ${input.title}
URL: ${input.url}
Domain: ${host(input.url)}
Snippet: ${input.content?.slice(0,500) || ''}`;

  const body = {
    model: "gpt-4o-mini",
    messages: [{role:"system", content:sys},{role:"user", content:user}],
    temperature: 0.3,
    response_format: { type: "json_object" }
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  if(!r.ok) throw new Error(`LLM ${r.status}`);
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  let parsed = {};
  try{ parsed = JSON.parse(content); }catch{ parsed = {}; }
  return {
    summary: parsed.summary || input.title,
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0,5) : ['ai'],
    score: Number(parsed.score ?? 50)
  };
}

// ---------- main ----------
async function run(){
  // 1) 소스 읽기
  const yml = await fs.readFile(SRC, 'utf8');
  const {rss=[], allow_domains=[]} = yamlParse(yml);

  // 2) RSS 수집
  const parser = new Parser({ timeout: 15000 });
  const items = [];
  for(const url of rss){
    try{
      const feed = await parser.parseURL(url);
      for(const it of (feed.items || [])){
        const urlN = normalizeUrl(it.link || it.guid || '');
        if(!urlN) continue;
        if(allow_domains.length && !allow_domains.includes(host(urlN))) continue;
        items.push({
          id: urlN,
          url: urlN,
          title: (it.title || '').trim(),
          content: (it.contentSnippet || it.content || '').trim(),
          date: toISODate(it.isoDate || it.pubDate || nowISO())
        });
      }
      await sleep(300);
    }catch(e){
      console.error('RSS fail:', url, e?.message);
    }
  }

  // 3) 최근 48h 위주 + dedup by URL
  const seen = new Set();
  const recent = items
    .filter(x => dayDiff(nowISO(), x.date) <= 2.1)
    .filter(x => !seen.has(x.id) && seen.add(x.id));

  // 4) 요약/태깅/스코어(선택적으로 LLM 사용)
  const outNews = [];
  for(const it of recent.slice(0,50)){ // 상한(방어)
    try{
      const ai = await llmSummarizeTag(it);
      outNews.push({
        title: it.title || 'Untitled',
        url: it.url,
        source: host(it.url),
        date: it.date,
        summary: ai.summary,
        tags: ai.tags,
        score: ai.score
      });
      if(USE_LLM) await sleep(400);
    }catch(e){
      console.error('AI fail:', it.url, e?.message);
    }
  }

  // 5) 기존 snapshots.json과 합치기(깃허브 섹션 보존)
  let base = { generated_at: nowISO(), results: [] };
  try{
    const cur = JSON.parse(await fs.readFile(OUT, 'utf8'));
    base = cur && typeof cur === 'object' ? cur : base;
  }catch{}
  const other = (base.results || []).filter(x => x.from !== 'news');
  const results = [
    ...other,
    { from: 'news', items: outNews }
  ];

  const final = { generated_at: nowISO(), results };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(final, null, 2), 'utf8');

  console.log(`✔ snapshots.json updated: ${outNews.length} news`);
}

run().catch(e=>{ console.error(e); process.exit(1); });
