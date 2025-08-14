import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Ajv from "ajv";

// ---------- constants ----------
const OUT_DIR   = path.join(process.cwd(), "public/data");
const OUT_SNAP  = path.join(OUT_DIR, "news_snapshots.json");
const OUT_CURR  = path.join(OUT_DIR, "news_current.json");
const TODAY     = new Date().toISOString().slice(0,10);
const API_KEY   = process.env.GEMINI_API_KEY;

// ---------- schema (hard contract for UI) ----------
const schema = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    required: ["title", "url", "summary", "source", "ts"],
    properties: {
      title:   { type: "string", minLength: 1, maxLength: 300 },
      url:     { type: "string", minLength: 1 },
      summary: { type: "string", minLength: 1, maxLength: 1200 },
      source:  { type: "string", minLength: 1, maxLength: 120 },
      ts:      { type: "string", minLength: 10 }
    },
    additionalProperties: true
  }
};
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

// ---------- helpers ----------
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

function stripFences(txt=""){
  // remove code fences & backticks & smart quotes
  let t = txt.replace(/```[\s\S]*?```/g, (m)=> m.replace(/```/g,""))
             .replace(/^```|```$/g,"")
             .replace(/[“”]/g,'"').replace(/[‘’]/g,"'");
  // extract first balanced JSON array if present
  const s = t.indexOf("["); const e = t.lastIndexOf("]");
  if (s !== -1 && e !== -1 && e>s) t = t.slice(s, e+1);
  return t.trim();
}

function sanitizeItems(arr){
  const seen = new Set();
  const norm = (u)=>{
    try{
      const url = new URL(u);
      // drop tracking params
      ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id"].forEach(k=>url.searchParams.delete(k));
      return url.toString();
    }catch{ return String(u||""); }
  };
  return arr.map(x=>{
    const url = norm(x.url||"");
    const key = (x.title||"").toLowerCase()+"|"+(new URL(url||"http://x.invalid").hostname || "");
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      title:   String(x.title||"").slice(0,300).trim(),
      url,
      summary: String(x.summary||x.description||"").slice(0,1200).trim(),
      source:  String(x.source || (()=>{
        try{ return new URL(url).hostname; }catch{ return ""; }
      })() || "").slice(0,120),
      ts: new Date().toISOString()
    };
  }).filter(Boolean).filter(x=>x.title && x.url && x.summary && x.source);
}

async function writeAtomic(file, data){
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), "."+path.basename(file)+"."+crypto.randomBytes(5).toString("hex"));
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

async function readJSON(file, fallback){
  try { return JSON.parse(await fs.readFile(file,"utf8")); }
  catch { return fallback; }
}

async function withRetry(fn, {tries=5, base=800, tag="task"}={}){
  let last;
  for (let i=0;i<tries;i++){
    try { return await fn(); }
    catch(e){
      last = e;
      const status = e?.status ?? e?.response?.status ?? 0;
      const retriable = status===429 || status>=500 || e?.code==="ECONNRESET" || e?.code==="ETIMEDOUT";
      if (!retriable || i===tries-1) throw e;
      const jitter = Math.floor(Math.random()*200);
      const wait = Math.min(30000, base * (2**i)) + jitter;
      console.log(`[retry] ${tag} #${i+1} in ${wait}ms (status=${status})`);
      await sleep(wait);
    }
  }
  throw last;
}

// ---------- LLM call (with model fallback + timeout) ----------
async function callGemini(prompt, modelName){
  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: modelName });
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 60_000); // 60s hard timeout
  try{
    const res = await model.generateContent({ contents:[{role:"user",parts:[{text:prompt}]}] }, { signal: controller.signal });
    return res.response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchNewsLLM(){
  const prompt = `
오늘 날짜 기준 신뢰할 수 있는 출처의 AI 관련 주요 뉴스 8개를
**JSON 배열만** 출력해.
각 항목은 정확히 다음 키를 포함해야 해:
{"title":"","url":"","summary":"","source":""}
- title: 헤드라인(간결)
- url: 원문 링크(https:// 로 시작)
- summary: 2~3문장 요약 (사실 위주)
- source: 매체 도메인(예: theverge.com)
마크다운/코드펜스/설명/빈 행 금지. JSON 외 다른 텍스트 쓰지 마.
  `.trim();

  // primary model
  try{
    return await withRetry(async()=>{
      return await callGemini(prompt, "gemini-2.0-flash");
    }, {tries:4, base:900, tag:"gemini-flash"});
  }catch(e){
    console.warn("[fallback] switching to gemini-2.0-flash-mini", e?.status || e?.message);
    // fallback model (cheaper / laxer limits)
    return await withRetry(async()=>{
      return await callGemini(prompt, "gemini-2.0-flash-mini");
    }, {tries:4, base:900, tag:"gemini-mini"});
  }
}

// ---------- main ----------
async function main(){
  if (!API_KEY) {
    console.error("GEMINI_API_KEY is missing in environment.");
    process.exit(2);
  }

  const snap = await readJSON(OUT_SNAP, {});
  if (snap[TODAY]) {
    console.log(`cache exists for ${TODAY} -> skip generation`);
    await writeAtomic(OUT_CURR, JSON.stringify(snap[TODAY], null, 2));
    return;
  }

  const rawText = await fetchNewsLLM();
  const cleaned = stripFences(rawText);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error("[parse] raw:", rawText.slice(0, 200));
    console.error("[parse] cleaned:", cleaned.slice(0, 200));
    throw new Error("LLM JSON parse failed");
  }

  const items = sanitizeItems(parsed);
  if (!validate(items)) {
    console.error(validate.errors);
    throw new Error("schema validation failed");
  }

  // write snapshot + current atomically
  const nextSnap = { ...snap, [TODAY]: items };
  await writeAtomic(OUT_SNAP, JSON.stringify(nextSnap, null, 2));
  await writeAtomic(OUT_CURR, JSON.stringify(items, null, 2));
  console.log(`wrote ${OUT_SNAP} & ${OUT_CURR} for ${TODAY} (${items.length} items)`);
}

main().catch((e)=>{ console.error(e); process.exit(1); });
