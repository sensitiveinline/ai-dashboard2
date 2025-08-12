// M8 News Expert & Source Manager Agent with Gemini
// Node 20+, 무료 Gemini API 사용

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import Parser from 'rss-parser';
import { GoogleGenerativeAI } from "@google/generative-ai";

// ---------- config ----------
const ROOT = path.resolve('.');
const OUT = path.join(ROOT, 'public', 'data', 'snapshots.json');
const SRC = path.join(ROOT, 'scripts', 'm8_sources.yml');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const USE_GEMINI = Boolean(GEMINI_API_KEY);
const genAI = USE_GEMINI ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const nowISO = () => new Date().toISOString();
const dayDiff = (a,b)=> (new Date(a)-new Date(b)) / 86400000;
const toISODate = (d)=> new Date(d || Date.now()).toISOString().slice(0,10);
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

function yamlParse(txt){
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

async function llmSummarizeTag(input){
  if(!USE_GEMINI){
    return { summary: input.title, tags: ["ai"], score: 50 };
  }
  const prompt = `다음 뉴스의 요약(2문장 이내, 한국어), 태그(최대 5개, 소문자), 중요도 점수(0~100)를 JSON으로 반환하세요.
Title: ${input.title}
URL: ${input.url}
Domain: ${host(input.url)}
Snippet: ${(input.content || "").slice(0,500)}`;

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(prompt, {
    generationConfig: { responseMimeType: "application/json" }
  });

  let data = {};
  try { data = JSON.parse(result.response.text()); } catch(e) {}
  return {
    summary: data.summary || input.title,
    tags: Array.isArray(data.tags) ? data.tags.slice(0,5) : ["ai"],
    score: Number(data.score ?? 50)
  };
}

async function run(){
  const yml = await fs.readFile(SRC, 'utf8');
  const {rss=[], allow_domains=[]} = yamlParse(yml);

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

  const seen = new Set();
  const recent = items
    .filter(x => dayDiff(nowISO(), x.date) <= 2.1)
    .filter(x => !seen.has(x.id) && seen.add(x.id));

  const outNews = [];
  for(const it of recent.slice(0,50)){
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
      if(USE_GEMINI) await sleep(300);
    }catch(e){
      console.error('AI fail:', it.url, e?.message);
    }
  }

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
